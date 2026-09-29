// INTERVAL -- the set. Power, the keypad, the carousel wait, reception, the
// overnight rotation, and drawing a page onto the tube.
//
// The engine calls init(s) once, frame(s, t) every animation frame and
// key(s, e) on every keydown (src/screen.js). Everything deferred goes on
// the effects queue below rather than on setTimeout, so switching the set
// off can cancel it -- SIGNAL's rule, for SIGNAL's reason: a timer that
// outlives the power switch paints onto a set that is off.
//
// Two clocks, deliberately. performance.now() drives the carousel and every
// effect; Date.now() is the wall clock the header shows and the feeds are
// dated by. The harness fakes both from one counter.

const V = globalThis.INTERVAL_BUILD ?? ''
const T = await import(`./teletext.js?v=${V}`)
const C = await import(`./carousel.js?v=${V}`)
const { FeedCache, FEEDS } = await import(`./feeds.js?v=${V}`)
const Pages = await import(`./pages.js?v=${V}`)
const { COLOUR_MODES, HEADER_MSG_MS } = await import(`./constants.js?v=${V}`)
const sfx = await import(`./sfx.js?v=${V}`)
const { announce } = await import(`./a11y.js?v=${V}`)
const { SCREEN, PALETTE } = await import(`./config.js?v=${V}`)
const { NORMAL, DIM } = await import(`./src/cellgrid.js`)
const editorial = (await import(`./editorial.json?v=${V}`, { with: { type: 'json' } })).default

export const STORAGE_KEY = 'interval:state:v1'
/** How long the set waits for a page whose source has not answered before
 *  it gives up and shows the off-air page, if the source has also failed. */
export const FEED_WAIT_MS = 15000
/** How often, while on, the set asks every source whether it is due. */
export const FEED_POLL_MS = 30000
/** How long each page stays up in the overnight rotation. */
export const OVERNIGHT_PAGE_MS = 14000
/** Pages the overnight rotation shows, in order. */
export const OVERNIGHT_PAGES = ['100', '101', '104', '200', '250', '300', '310', '320', '400', '500', '700', '888']
/** How often an open tab asks whether a new build has been deployed. */
export const BUILD_CHECK_MS = 30 * 60 * 1000

const perf = () => globalThis.performance.now()
const pad2 = (n) => String(n).padStart(2, '0')
const clamp01 = (x) => Math.min(1, Math.max(0, x))

function queryParams() {
  try { return new URLSearchParams(globalThis.location?.search || '') } catch (e) { return new URLSearchParams() }
}
function loadState() {
  try { const raw = globalThis.localStorage?.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : {} } catch (e) { return {} }
}
function unitsForLocale(locale) {
  return /^en-US|^en-LR|^my/.test(String(locale || 'en-US')) ? 'F' : 'C'
}

const program = {
  // ---------------------------------------------------------------- setup
  init(s) {
    this.s = s
    this.power = false
    this.entry = ''
    this.want = null
    this.wantSince = 0
    this.arriveAt = 0
    this.page = null
    this.pages = null
    this.sub = 0
    this.truth = null
    this.shown = null
    this.nextTx = 0
    this.hold = false
    this.reveal = false
    this.size = 0
    this.msg = null
    this.fx = []
    this.lastKeyAt = perf()
    this.lastFrameAt = perf()
    this.nextFeedPoll = 0
    this.rx = 1
    this.interference = null
    this.nextInterference = perf() + this.interferenceGap()
    this.overnight = { on: false, idx: 0, next: 0, muted: false, track: null, player: null, queue: [] }
    this.pendingReload = false

    const saved = loadState()
    const q = queryParams()
    this.colourMode = Math.max(0, COLOUR_MODES.findIndex(m => m.key === saved.colourMode))
    this.overnight.muted = !!saved.muted
    this.game = { i: 0, score: 0, answered: null, best: saved.gameBest || 0 }
    this.weatherConsent = saved.weatherConsent || null
    this.startPage = [q.get('page'), saved.page, '100'].map(x => String(x || '').toUpperCase()).find(C.validPage)
    const rx = parseFloat(q.get('rx'))
    this.forcedRx = Number.isFinite(rx) ? clamp01(rx) : null

    const win = globalThis
    this.units = unitsForLocale(win.navigator?.language)
    this.location = null
    this.locationState = !win.navigator?.geolocation ? 'unsupported' : !win.isSecureContext ? 'insecure' : 'unknown'

    this.feeds = new FeedCache({
      fetch: (...a) => globalThis.fetch(...a),
      now: () => Date.now(),
      storage: globalThis.localStorage || null,
      env: {
        date: () => new Date(),
        get location() { return program.location },
        get units() { return program.units },
        signalUrl: q.get('signal') || null,
        // Overridable so the test harness can hand over a fixture instead
        // of fetching SIGNAL's live roster.
        importModule: (url) => (globalThis.INTERVAL_IMPORT_MODULE ?? ((u) => import(u)))(url),
      },
      onChange: (id) => this.onFeedChange(id),
    })

    this.applyColourMode(false)
    this.crtBase = { ...SCREEN }
    this.drawStandby()

    // The effects queue keeps running when the tab's animation frames stop
    // (a window covered by another reports visible and gets no frames):
    // SIGNAL's fallback ticker, keyed on starvation, never on document.hidden.
    try {
      this.fallback = setInterval(() => {
        if (perf() - this.lastFrameAt > 200) this.tick(perf())
      }, 250)
    } catch (e) {}
    try { this.buildCheck = setInterval(() => this.checkBuild(), BUILD_CHECK_MS) } catch (e) {}

    if (q.get('power') === 'on') this.powerUp()
  },

  // ---------------------------------------------------------------- effects
  fxAfter(ms, fn, always = false) { this.fx.push({ at: perf() + ms, fn, always }) },
  fxTween(obj, key, from, to, ms, always = false) {
    const t0 = perf()
    this.fx = this.fx.filter(f => !(f.tween && f.obj === obj && f.key === key))
    obj[key] = from
    this.fx.push({ tween: true, obj, key, from, to, t0, ms, always })
  },
  fxTick(now) {
    const keep = []
    const due = []
    for (const f of this.fx) {
      if (f.tween) {
        const k = Math.min(1, (now - f.t0) / f.ms)
        f.obj[f.key] = f.from + (f.to - f.from) * k
        if (k < 1) keep.push(f)
      } else if (now >= f.at) due.push(f)
      else keep.push(f)
    }
    this.fx = keep
    for (const f of due) { try { f.fn() } catch (e) { console.error(e) } }
  },
  fxClear() {
    for (const f of this.fx) if (f.tween && !f.always) f.obj[f.key] = f.to
    this.fx = this.fx.filter(f => f.always)
  },

  // ---------------------------------------------------------------- power
  powerUp() {
    if (this.power) return
    this.power = true
    this.lastKeyAt = perf()
    sfx.playPowerOn()
    sfx.startHum()
    const p = this.s.crt.params
    // The tube warming: the picture comes up out of black over a second, with
    // a bloom that settles as it does.
    this.fxTween(p, 'brightness', 0.05, this.crtBase.brightness, 1100)
    this.fxTween(p, 'bloomAmt', this.crtBase.bloomAmt * 2.4, this.crtBase.bloomAmt, 1400)
    this.s.term.clear()
    this.request(this.startPage || '100')
    this.nextFeedPoll = 0
    if (this.weatherConsent === 'yes' && this.locationState === 'unknown') this.requestLocation()
    announce('INTERVAL switched on.', 'power')
  },

  powerDown() {
    if (!this.power) return
    this.power = false
    sfx.playPowerOff()
    sfx.stopHum()
    this.stopOvernight()
    this.fxClear()
    this.startPage = this.page || this.want || this.startPage
    this.want = null
    this.entry = ''
    this.hold = false
    this.reveal = false
    this.size = 0
    const p = this.s.crt.params
    this.fxTween(p, 'brightness', this.crtBase.brightness * 1.6, 0.05, 260, true)
    this.fxAfter(280, () => {
      p.brightness = this.crtBase.brightness
      p.bloomAmt = this.crtBase.bloomAmt
      this.drawStandby()
      // A deploy that landed while the set was on is picked up here, at the
      // power switch, where a reload interrupts nothing (SIGNAL's tickBuild).
      if (this.pendingReload) { try { globalThis.location.reload() } catch (e) {} }
    }, true)
    this.saveState()
    announce('INTERVAL switched off.', 'power')
  },

  drawStandby() {
    const t = this.s.term
    t.clear()
    const col = T.cellColour(T.WHITE, T.BLACK)
    const line = (y, str) => t.text(Math.floor((T.COLS - str.length) / 2), y, str, DIM, 0, col)
    line(11, 'INTERVAL')
    line(13, 'STANDBY')
    line(15, this.touch() ? 'TAP POWER TO SWITCH ON' : 'PRESS P TO SWITCH ON')
  },

  touch() { try { return globalThis.matchMedia?.('(pointer: coarse)').matches } catch (e) { return false } },

  // ---------------------------------------------------------------- pages
  ctx() {
    return {
      entry: (id) => this.feeds.get(id),
      status: (id) => this.feeds.status(id),
      now: Date.now(),
      date: new Date(),
      editorial,
      env: {
        locationState: this.locationState,
        overnight: { on: this.overnight.on, track: this.overnight.track },
        game: this.game,
      },
    }
  },

  /** Ask for a page. The set does not fetch it: it waits for it to come
   *  round (carousel.js). The page on screen stays up until then. */
  request(num) {
    num = String(num).toUpperCase()
    this.want = num
    this.wantSince = perf()
    this.arriveAt = C.nextTransmission(num, perf())
    this.hold = false
    const def = Pages.pageDef(num, this.ctx())
    for (const id of def?.feeds || []) this.ensureFeed(id)
    announce(`Searching for page ${num}.`, 'search')
  },

  ensureFeed(id) {
    if (id === 'weather' && !this.location) return
    this.feeds.ensure(id)
  },

  onFeedChange(id) {
    // A page on screen built from this source is re-sent at its next pass
    // anyway; this just makes a page the set is waiting on arrive as soon as
    // its data does, rather than a whole loop later.
    if (this.want && Pages.pageDef(this.want, this.ctx())?.feeds?.includes(id)) {
      this.arriveAt = Math.min(this.arriveAt, C.nextTransmission(this.want, perf()))
    }
  },

  render(num) {
    const def = Pages.pageDef(num, this.ctx())
    if (!def) return { def: null, pages: null }
    let pages = null
    try { pages = def.render(this.ctx()) } catch (e) { console.error(`page ${num}:`, e) }
    return { def, pages: pages && pages.length ? pages : null }
  },

  tryArrive(now) {
    const { def, pages } = this.render(this.want)
    if (!pages) {
      // Not on air (yet). Try again when it next comes round.
      this.arriveAt = C.nextTransmission(this.want, now)
      return
    }
    this.page = this.want
    this.want = null
    this.pages = pages
    this.sub = Math.min(C.subpageAt(pages.length, Date.now()), pages.length - 1)
    this.reveal = false
    this.size = 0
    this.setTruth(pages[this.sub], true)
    this.nextTx = C.nextTransmission(this.page, now)
    this.saveState()
    try { globalThis.document.title = `${this.page} ${def.title} - INTERVAL` } catch (e) {}
    this.announcePage(def)
  },

  setTruth(page, fresh) {
    this.truth = page
    if (fresh || !this.shown) this.shown = new T.Page()
    C.receive(this.truth, this.shown, this.rx, Math.random, fresh)
  },

  announcePage(def) {
    const subs = this.pages.length > 1 ? `, ${this.sub + 1} of ${this.pages.length}` : ''
    announce(`Page ${this.page}, ${def?.title ?? ''}${subs}. ${this.truth.speech({ reveal: this.reveal })}`, 'page')
  },

  /** The page on screen coming round again: fresh data, the broadcaster's
   *  next subpage, and one more pass through the aerial. */
  retransmit(now) {
    const { def, pages } = this.render(this.page)
    this.nextTx = C.nextTransmission(this.page, now)
    if (!pages) return
    this.pages = pages
    const want = this.hold ? Math.min(this.sub, pages.length - 1) : C.subpageAt(pages.length, Date.now())
    const turned = want !== this.sub
    this.sub = Math.min(want, pages.length - 1)
    this.setTruth(pages[this.sub], turned)
    if (turned) this.announcePage(def)
  },

  stepSub(dir) {
    if (!this.pages || this.pages.length < 2) { this.flash(`${this.sub + 1}/${this.pages?.length || 1}`); return }
    this.sub = (this.sub + dir + this.pages.length) % this.pages.length
    this.hold = true
    this.setTruth(this.pages[this.sub], true)
    this.flash(`${this.sub + 1}/${this.pages.length}`)
    this.announcePage(Pages.pageDef(this.page, this.ctx()))
  },

  stepPage(dir) {
    const order = Pages.pageOrder(this.ctx())
    const from = this.want || this.page || '100'
    const at = order.indexOf(from)
    const n = at < 0
      ? order.find(p => parseInt(p, 16) > parseInt(from, 16)) || order[0]
      : order[(at + dir + order.length) % order.length]
    this.request(n)
  },

  // ---------------------------------------------------------------- reception
  interferenceGap() { return (8 + Math.random() * 17) * 60 * 1000 },

  /** The weather outside reaches the aerial: a storm at the viewer's own
   *  location makes the text worse, rain a little. Only with a location. */
  baseReception() {
    const code = this.location ? this.feeds.get('weather')?.data?.current?.code : null
    if (code >= 95) return 0.72
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 86) || (code >= 71 && code <= 77)) return 0.9
    return 1
  },

  updateReception(now) {
    if (globalThis.INTERVAL_FORCE_RX != null) { this.rx = clamp01(+globalThis.INTERVAL_FORCE_RX); return }
    if (this.forcedRx !== null) { this.rx = this.forcedRx; return }
    let rx = this.baseReception()
    // Now and then something passes -- an aircraft, a car with bad ignition
    // suppression -- and the picture flutters for a few seconds. Rare on
    // purpose: every quarter of an hour or so, and brief.
    if (!this.interference && now >= this.nextInterference) {
      this.interference = { t0: now, ms: 2000 + Math.random() * 4000, depth: 0.3 + Math.random() * 0.35 }
    }
    if (this.interference) {
      const k = (now - this.interference.t0) / this.interference.ms
      if (k >= 1) { this.interference = null; this.nextInterference = now + this.interferenceGap() }
      else rx -= this.interference.depth * Math.sin(Math.PI * k)
    }
    this.rx = clamp01(rx)
  },

  /** One number drives the text errors and the tube, so what you read and
   *  what you see agree -- SIGNAL's tuning distance, as reception. */
  applyReceptionToTube() {
    const p = this.s.crt.params, b = this.crtBase, bad = 1 - this.rx
    p.noise = b.noise + bad * 0.28
    p.snow = b.snow + bad * 0.012
    p.beam = b.beam + bad * 0.7
    p.roll = b.roll + bad * 0.25
  },

  // ---------------------------------------------------------------- overnight
  overnightDue(now) {
    const o = editorial.overnight || {}
    const h = new Date().getHours()
    const from = o.startHour ?? 0, to = o.endHour ?? 6
    const inWindow = from <= to ? h >= from && h < to : h >= from || h < to
    return inWindow && now - this.lastKeyAt > (o.idleMinutes ?? 10) * 60 * 1000
  },

  startOvernight() {
    const o = this.overnight
    o.on = true
    o.idx = 0
    o.next = perf() + OVERNIGHT_PAGE_MS
    this.request(OVERNIGHT_PAGES[0])
    this.flash('NIGHT ON')
    this.startMusic()
    announce('Overnight pages on.', 'overnight')
  },

  stopOvernight() {
    const o = this.overnight
    if (!o.on) return
    o.on = false
    o.track = null
    try { o.player?.stopVideo?.() } catch (e) {}
    announce('Overnight pages off.', 'overnight')
  },

  overnightTick(now) {
    const o = this.overnight
    if (!o.on) { if (this.overnightDue(now)) this.startOvernight(); return }
    if (now < o.next || this.want) return
    // The roster may not have been in when the rotation started.
    if (!o.station) this.startMusic()
    const pages = OVERNIGHT_PAGES.filter(n => !((n === '300') && this.locationState !== 'granted'))
    o.idx = (o.idx + 1) % pages.length
    o.next = now + OVERNIGHT_PAGE_MS
    this.request(pages[o.idx])
  },

  /** The overnight music: SIGNAL's own tracks for the chosen station, through
   *  the YouTube IFrame API, loaded only when first needed. */
  startMusic() {
    const o = this.overnight
    const roster = this.feeds.get('signal')?.data
    const st = roster?.stations?.find(x => x.id === editorial.overnight?.stationId) || roster?.stations?.[0]
    if (!st || !st.tracks.length) { this.ensureFeed('signal'); return }
    o.station = st
    o.queue = st.tracks.slice().sort(() => Math.random() - 0.5)
    const play = () => {
      const next = o.queue.shift() || st.tracks[Math.floor(Math.random() * st.tracks.length)]
      o.track = next
      try {
        o.player.loadVideoById(next.youtubeId)
        if (o.muted) o.player.mute(); else o.player.unMute()
      } catch (e) {}
    }
    o.playNext = play
    if (o.player) { play(); return }
    const doc = globalThis.document
    const make = () => {
      try {
        o.player = new globalThis.YT.Player('ytDock', {
          width: 200, height: 200,
          playerVars: { autoplay: 1, controls: 0, playsinline: 1 },
          events: {
            onReady: () => { if (o.on) play() },
            onStateChange: (e) => { if (e.data === 0 && o.on) play() },
            onError: () => { if (o.on) play() },
          },
        })
      } catch (e) {}
    }
    if (globalThis.YT?.Player) { make(); return }
    if (!doc?.createElement) return
    globalThis.INTERVAL_YT_QUEUE?.push(make)
    if (!doc.getElementById('yt-api')) {
      const tag = doc.createElement('script')
      tag.id = 'yt-api'
      tag.src = 'https://www.youtube.com/iframe_api'
      tag.async = true
      doc.head.appendChild(tag)
    }
  },

  toggleMute() {
    const o = this.overnight
    o.muted = !o.muted
    try { o.muted ? o.player?.mute() : o.player?.unMute() } catch (e) {}
    this.flash(o.muted ? 'MUTED' : 'SOUND ON')
    this.saveState()
  },

  // ---------------------------------------------------------------- location
  requestLocation() {
    if (this.locationState === 'insecure' || this.locationState === 'unsupported') return
    this.locationState = 'asking'
    this.reRender()
    let settled = false
    const done = (state, loc) => {
      if (settled) return
      settled = true
      this.locationState = state
      if (loc) {
        this.location = loc
        this.weatherConsent = 'yes'
        this.feeds.ensure('weather', { force: true }).then(() => this.reRender())
      } else if (state === 'denied') this.weatherConsent = 'no'
      this.saveState()
      this.reRender()
    }
    // A dismissed prompt can call neither callback; don't wait forever.
    this.fxAfter(12000, () => done('failed'), true)
    try {
      globalThis.navigator.geolocation.getCurrentPosition(
        (pos) => done('granted', { lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => done(err && err.code === 1 ? 'denied' : 'failed'),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 15 * 60 * 1000 },
      )
    } catch (e) { done('failed') }
  },

  /** Re-send the page on screen now, for a change the viewer just caused. */
  reRender() {
    if (this.power && this.page && !this.want) this.retransmit(perf())
  },

  // ---------------------------------------------------------------- keys
  flash(text) { this.msg = { text, until: perf() + HEADER_MSG_MS } },

  fastext(i) {
    const f = this.truth?.fastext?.[i]
    if (!f) { this.flash('NO LINK'); return }
    this.follow(f[1])
  },

  follow(target) {
    if (target === 'overnight') { this.overnight.on ? (this.stopOvernight(), this.flash('NIGHT OFF'), this.reRender()) : this.startOvernight(); return }
    if (target === 'locate') { this.requestLocation(); return }
    if (target === 'sub:next') { this.stepSub(1); return }
    if (target.startsWith('signal:')) { this.tuneSignal(target.slice(7)); return }
    if (target.startsWith('game:')) { this.gameMove(target.slice(5)); return }
    this.request(target)
  },

  signalAppUrl(stationId) {
    const base = new URL('./', FEEDS.signal.url(this.feeds.env)).href
    return `${base}?station=${encodeURIComponent(stationId)}`
  },

  tuneSignal(id) {
    this.flash('TUNING')
    try { globalThis.open?.(this.signalAppUrl(id), '_blank', 'noopener') } catch (e) {}
  },

  gameMove(move) {
    const g = this.game, qs = editorial.fourkeys || []
    if (move === 'next') { g.i = (g.i + 1) % Math.max(1, qs.length); g.answered = null }
    else if (move === 'reset') { g.i = 0; g.score = 0; g.answered = null }
    else if (g.answered === null) {
      g.answered = +move
      if (qs[g.i % qs.length]?.answer === g.answered) { g.score++; g.best = Math.max(g.best, g.score) }
      this.saveState()
    }
    this.reRender()
  },

  typeDigit(d) {
    if (!this.entry && !/[1-8]/.test(d)) { this.flash(`NO ${d}XX`); return }
    this.entry += d
    if (this.entry.length === 3) {
      const num = this.entry
      this.entry = ''
      this.request(num)
    }
  },

  key(s, e) {
    const k = e.key
    if (!k || e.metaKey || e.ctrlKey || e.altKey) return
    const lower = k.length === 1 ? k.toLowerCase() : k
    // F5, F11, F12 and the rest belong to the browser.
    if (/^F([5-9]|1[0-9])$/.test(k)) return

    if (!this.power) {
      // A set in standby wakes on the power button or on a number, the way
      // a remote wakes a television. A number also starts the entry.
      if (lower === 'p' || k === 'Enter' || k === ' ' || /^[0-9]$/.test(k)) {
        sfx.playKeyClick()
        e.preventDefault?.()
        this.powerUp()
        if (/^[1-8]$/.test(k)) { this.want = null; this.entry = k }
      }
      return
    }

    const handled = this.handleKey(k, lower, e)
    if (handled) {
      sfx.playKeyClick()
      e.preventDefault?.()
      this.lastKeyAt = perf()
    }
  },

  handleKey(k, lower, e) {
    const pageKey = () => { if (this.overnight.on) this.stopOvernight() }
    const fast = { F1: 0, F2: 1, F3: 2, F4: 3 }[k] ?? (e.shiftKey && /^Digit[1-4]$/.test(e.code || '') ? +e.code.slice(5) - 1 : null)
    if (fast !== null) { pageKey(); this.fastext(fast); return true }
    if (/^[0-9]$/.test(k)) { pageKey(); this.typeDigit(k); return true }
    if (this.entry && /^[a-f]$/.test(lower)) { this.typeDigit(lower.toUpperCase()); return true }
    switch (k) {
      case 'ArrowUp': pageKey(); this.entry = ''; this.stepPage(1); return true
      case 'ArrowDown': pageKey(); this.entry = ''; this.stepPage(-1); return true
      case 'ArrowRight': this.stepSub(1); return true
      case 'ArrowLeft': this.stepSub(-1); return true
      case 'Escape':
      case 'Backspace':
        if (this.entry) { this.entry = ''; this.flash('CLEARED') }
        else if (this.want && this.page) { this.want = null; this.flash('CANCEL') }
        else this.flash('READY')
        return true
    }
    switch (lower) {
      case 'i': pageKey(); this.entry = ''; this.request('100'); return true
      case '?': pageKey(); this.request('199'); return true
      case 'r':
        this.reveal = !this.reveal
        this.flash(this.reveal ? 'REVEAL' : 'CONCEAL')
        if (this.reveal && this.truth) announce(this.truth.speech({ reveal: true }), 'reveal')
        return true
      case 'h':
        this.hold = !this.hold
        this.flash(this.hold ? 'HOLD' : 'RELEASE')
        return true
      case 's':
        this.size = (this.size + 1) % 3
        this.flash(['SIZE', 'SIZE TOP', 'SIZE BOT'][this.size])
        return true
      case 'c':
        this.colourMode = (this.colourMode + 1) % COLOUR_MODES.length
        this.applyColourMode(true)
        this.flash(COLOUR_MODES[this.colourMode].label)
        this.saveState()
        return true
      case 'n':
        if (this.overnight.on) { this.stopOvernight(); this.flash('NIGHT OFF') }
        else this.startOvernight()
        return true
      case 'm': this.toggleMute(); return true
      case 'f': this.toggleFullscreen(); return true
      case 'p': this.powerDown(); return true
    }
    return false
  },

  toggleFullscreen() {
    const doc = globalThis.document
    try {
      if (doc?.fullscreenElement) { doc.exitFullscreen?.(); this.flash('WINDOW') }
      else { doc?.documentElement?.requestFullscreen?.()?.catch?.(() => this.flash('NO FULL')); this.flash('FULL') }
    } catch (e) { this.flash('NO FULL') }
  },

  applyColourMode(clearPersist) {
    const m = COLOUR_MODES[this.colourMode]
    this.s.term.setPalette(m.mono ? T.MONO_PALETTE : PALETTE)
    this.s.crt?.setPhosphor?.(m.phosphor)
  },

  saveState() {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({
        page: this.page || this.startPage,
        colourMode: COLOUR_MODES[this.colourMode].key,
        muted: this.overnight.muted,
        weatherConsent: this.weatherConsent || undefined,
        gameBest: this.game.best || undefined,
      }))
    } catch (e) {}
  },

  async checkBuild() {
    try {
      const res = await globalThis.fetch(`./build.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return
      const { build } = await res.json()
      if (build && String(build) !== String(globalThis.INTERVAL_BUILD)) this.pendingReload = true
    } catch (e) {}
  },

  // ---------------------------------------------------------------- frame
  tick(now) {
    this.fxTick(now)
    if (!this.power) return
    this.updateReception(now)
    this.applyReceptionToTube()
    if (now >= this.nextFeedPoll) {
      this.nextFeedPoll = now + FEED_POLL_MS
      for (const id of Object.keys(FEEDS)) this.ensureFeed(id)
    }
    if (this.want && now >= this.arriveAt) this.tryArrive(now)
    if (this.page && !this.want && now >= this.nextTx) this.retransmit(now)
    this.overnightTick(now)
  },

  frame(s, t) {
    const now = perf()
    this.lastFrameAt = now
    this.tick(now)
    if (this.power) this.draw(now)
  },

  // ---------------------------------------------------------------- drawing
  header(now) {
    const H = new T.Page()
    const shown = this.entry ? this.entry.padEnd(3, '-') : (this.want || this.page || '---')
    H.text(0, 1, `P${shown}`, T.WHITE)
    const msg = this.msg && now < this.msg.until ? this.msg.text : null
    if (msg) H.text(0, 6, msg.slice(0, 8), T.YELLOW)
    else if (this.hold) H.text(0, 6, 'HOLD', T.RED)
    else H.text(0, 6, 'INTERVAL', T.WHITE)
    if (this.want) H.text(0, 15, C.rollingNumber(this.want[0], now), T.GREEN)
    else if (this.page) H.text(0, 15, this.page, T.WHITE)
    const d = new Date()
    const date = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${pad2(d.getDate())} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`
    H.text(0, 19, date, T.WHITE)
    H.text(0, 30, `${pad2(d.getHours())}:${pad2(d.getMinutes())}/${pad2(d.getSeconds())}`, T.YELLOW)
    return H.cells[0]
  },

  glyphFor(ch) {
    const g = this.s.term.font.glyphs
    return g.get(ch.codePointAt(0)) || g.get(63)
  },

  draw(now) {
    const term = this.s.term
    const hdr = this.header(now)
    for (let x = 0; x < T.COLS; x++) this.putCell(0, x, hdr[x], hdr[x], null)
    if (!this.truth) {
      for (let y = 1; y < T.ROWS; y++) for (let x = 0; x < T.COLS; x++) term.put(x, y, ' ', NORMAL, 0, T.cellColour(T.WHITE, T.BLACK))
      return
    }
    const flashOn = (now % 1000) < 700
    for (let y = 1; y < T.ROWS; y++) {
      let src = y, half = null
      if (this.size === 1) { src = 1 + ((y - 1) >> 1); half = (y - 1) & 1 ? 'bottom' : 'top' }
      else if (this.size === 2) { src = 13 + ((y - 1) >> 1); half = (y - 1) & 1 ? 'bottom' : 'top' }
      if (src > 24) { for (let x = 0; x < T.COLS; x++) term.put(x, y, ' ', NORMAL, 0, 7); continue }
      if (src === 24 && this.overnight.on) { this.drawNightStrip(y, half); continue }
      const tr = this.truth.cells[src], sr = this.shown.cells[src]
      for (let x = 0; x < T.COLS; x++) this.putCell(y, x, tr[x], sr[x], half, flashOn)
    }
  },

  /** One cell onto the grid. `tc` is the cell as sent (colours, flags),
   *  `sc` what the decoder holds (character, mosaic -- possibly garbled). */
  putCell(y, x, tc, sc, half, flashOn = true) {
    const term = this.s.term
    const col = T.cellColour(tc.fg, tc.bg)
    const hidden = (tc.con && !this.reveal) || (tc.flash && !flashOn)
    let bm = null
    if (hidden) bm = null
    else if (sc.mos >= 0) bm = T.mosaicBitmap(sc.mos, tc.sep, term.font.cellW, term.font.cellH)
    else if (tc.dh) bm = T.doubleBitmap(this.glyphFor(sc.ch), tc.dh === 1 ? 'top' : 'bottom')
    else if (half) bm = sc.ch === ' ' ? null : this.glyphFor(sc.ch)
    else { term.put(x, y, sc.ch, NORMAL, 0, col); return }
    if (bm && half) bm = T.doubleBitmap(bm, half)
    if (bm) term.putGlyph(x, y, bm, NORMAL, 0, col)
    else term.put(x, y, ' ', NORMAL, 0, col)
  },

  drawNightStrip(y, half) {
    const P = new T.Page()
    const st = this.overnight.station
    P.band(24, T.BLUE)
    P.text(24, 1, this.overnight.muted ? 'MUTED' : 'MUSIC', T.YELLOW, T.BLUE)
    if (st) {
      P.text(24, 8, `SIGNAL ${st.freq.toFixed(1)}`, T.WHITE, T.BLUE)
      P.text(24, 23, T.clip(st.callsign, 16), T.CYAN, T.BLUE)
    } else P.text(24, 8, 'OVERNIGHT PAGES', T.WHITE, T.BLUE)
    for (let x = 0; x < T.COLS; x++) this.putCell(y, x, P.cells[24][x], P.cells[24][x], half)
  },
}

export default program
