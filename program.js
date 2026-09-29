// INTERVAL -- the set. Power, the keypad, the carousel wait, reception, the
// cycling through the sections, and drawing a page onto the tube.
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
const { cellAt } = await import(`./pointer.js?v=${V}`)
const Pic = await import(`./pictures.js?v=${V}`)
const editorial = (await import(`./editorial.json?v=${V}`, { with: { type: 'json' } })).default

export const STORAGE_KEY = 'interval:state:v1'
/** How long the set waits for a page whose source has not answered before
 *  it gives up and shows the off-air page, if the source has also failed. */
export const FEED_WAIT_MS = 15000
/** How often, while on, the set asks every source whether it is due. */
export const FEED_POLL_MS = 30000
/** How long cycling (N) leaves a page up: long enough to show its
 *  subpages, within these bounds. A page of eight facts shows three. */
export const CYCLE_MIN_MS = 12000
export const CYCLE_MAX_MS = 36000
/**
 * Switching on (2026-09-28): the tube warms from a bright line, then the
 * INTERVAL ident assembles to a three-note chime, then the set goes to its
 * page. It was a fade to the welcome page, and nothing happened that anyone
 * would remember. Any key skips it; a number keyed to wake the set skips it
 * outright, since that viewer knows where they are going.
 */
export const BOOT_LINE_MS = 550
export const BOOT_IDENT_MS = 1850
export const BOOT_MS = BOOT_LINE_MS + BOOT_IDENT_MS
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
    this.cycle = { on: false, section: 0, index: 0, next: Infinity, holdSection: false }
    this.subEpoch = 0
    this.nextLive = Infinity
    this.boot = null
    this.identHold = false
    this.quiet = false
    this.pendingReload = false

    const saved = loadState()
    const q = queryParams()
    this.colourMode = Math.max(0, COLOUR_MODES.findIndex(m => m.key === saved.colourMode))
    this.game = { i: 0, score: 0, answered: null, best: saved.gameBest || 0 }
    this.weatherConsent = saved.weatherConsent || null
    // 190, the welcome, is where the set lands when it is switched on
    // (2026-09-28): it says what INTERVAL is and how to let it cycle. A link
    // with ?page= still opens where it points.
    this.startPage = [q.get('page'), '190'].map(x => String(x || '').toUpperCase()).find(C.validPage)
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

    if (q.get('power') === 'on') this.powerUp({ quiet: true })
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
  /** `quiet` is for a power-on nobody pressed for (?power=on, the dashboard's
   *  preview): a browser refuses sound without a gesture, and trying only
   *  fills the console with autoplay warnings. */
  powerUp({ quiet = false } = {}) {
    if (this.power) return
    this.power = true
    this.quiet = quiet
    this.lastKeyAt = perf()
    if (!quiet) { sfx.playPowerOn(); sfx.startHum() }
    const p = this.s.crt.params
    // The tube warming: the picture comes up out of black over a second, with
    // a bloom that settles as it does.
    this.fxTween(p, 'brightness', 0.05, this.crtBase.brightness, 1100)
    this.fxTween(p, 'bloomAmt', this.crtBase.bloomAmt * 2.4, this.crtBase.bloomAmt, 1400)
    this.s.term.clear()
    // A quiet start (?power=on: the dashboard's preview, a shared link) goes
    // straight to its page; a switch-on the viewer pressed gets the ident.
    if (quiet) this.request(this.startPage || '190')
    else this.boot = { t0: perf(), chimed: false }
    this.nextFeedPoll = 0
    if (this.weatherConsent === 'yes' && this.locationState === 'unknown') this.requestLocation()
    announce('INTERVAL switched on.', 'power')
  },

  /** End the switch-on sequence and go to the page. */
  skipBoot() {
    if (!this.boot) return
    this.boot = null
    // The ident stays up under the searching header until the first page
    // lands, rather than the tube going blank for the wait between them.
    this.identHold = true
    if (!this.want && !this.page) this.request(this.startPage || '190')
  },

  powerDown() {
    if (!this.power) return
    this.power = false
    this.boot = null
    sfx.playPowerOff()
    sfx.stopHum()
    this.stopCycle()
    this.fxClear()
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
    this.publishFastext()
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
        touch: this.touch(),
        locationState: this.locationState,
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
    this.identHold = false
    this.pages = pages
    if (!this.quiet) sfx.playPageTick()
    this.subMs = def.subpageMs ?? C.SUBPAGE_MS
    // Subpages count from the page's arrival, so a page always opens on its
    // first screen (2026-09-28). The broadcaster's own clock, which the first
    // version followed, opened a twelve-fact page at fact seven.
    this.subEpoch = Date.now()
    this.sub = 0
    this.nextLive = def.liveMs ? now + def.liveMs : Infinity
    if (this.cycle.on) this.cycle.next = now + this.cycleDwell(def, pages.length)
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
    this.publishFastext()
  },

  /** Tell the page around the tube what the four coloured keys do now, so
   *  the phone remote's buttons can carry the same labels as the screen. A
   *  hook rather than DOM code here, because program.js runs in Node too. */
  publishFastext() {
    const labels = this.cycle.on || !this.power ? [null, null, null, null]
      : [0, 1, 2, 3].map(i => this.truth?.fastext?.[i]?.[0] ?? null)
    const key = labels.join('|')
    if (key === this._fastextKey) return
    this._fastextKey = key
    try { globalThis.INTERVAL_FASTEXT?.(labels) } catch (e) {}
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
    const want = this.hold ? Math.min(this.sub, pages.length - 1) : C.subpageAt(pages.length, Date.now() - this.subEpoch, this.subMs)
    const turned = want !== this.sub
    this.sub = Math.min(want, pages.length - 1)
    this.setTruth(pages[this.sub], turned)
    if (turned) this.announcePage(def)
  },

  /** A page that moves (liveMs: the breathing circle, the population
   *  count) is re-drawn in place between transmissions, without the
   *  reception pass -- it is the set animating, not the signal arriving. */
  liveRender(now) {
    const def = Pages.pageDef(this.page, this.ctx())
    if (!def?.liveMs) { this.nextLive = Infinity; return }
    this.nextLive = now + def.liveMs
    const { pages } = this.render(this.page)
    if (!pages) return
    this.pages = pages
    this.truth = pages[Math.min(this.sub, pages.length - 1)]
    this.shown = this.truth.clone()
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

  // ---------------------------------------------------------------- cycling
  // N lets the set turn its own pages: every page of a section, then the next
  // section, round all seven (pages.js SECTIONS). H while cycling holds the
  // section -- round its pages again and again -- until H once more. Keying a
  // page takes the set back. Manual on purpose: the set does nothing on its
  // own until asked (2026-09-28).

  cycleDwell(def, subs) {
    if (def?.cycleMs) return def.cycleMs
    return Math.min(CYCLE_MAX_MS, Math.max(CYCLE_MIN_MS, subs * (def?.subpageMs ?? C.SUBPAGE_MS)))
  },

  /** The pages of a section cycling can show: the weather pages only once
   *  the set knows where it is, since without that they are a question. */
  cyclePages(section) {
    return Pages.SECTIONS[section].pages.map(([, n]) => n)
      .filter(n => !((n === '300' || n === '301') && this.locationState !== 'granted'))
  },

  startCycle() {
    const c = this.cycle
    const here = Pages.sectionOf(this.page)
    c.on = true
    c.holdSection = false
    c.section = here >= 0 ? here : 0
    const pages = this.cyclePages(c.section)
    const at = pages.indexOf(this.page)
    if (at >= 0) {
      // Already on a page of this section: give it its time, then move on.
      c.index = at
      c.next = perf() + CYCLE_MIN_MS
    } else {
      c.index = 0
      c.next = Infinity
      this.request(pages[0])
    }
    this.flash('CYCLING')
    this.publishFastext()
    announce(`Cycling through the sections, starting with ${Pages.SECTIONS[c.section].name.toLowerCase()}.`, 'cycle')
  },

  stopCycle() {
    const c = this.cycle
    if (!c.on) return
    c.on = false
    c.next = Infinity
    this.publishFastext()
    announce('Cycling stopped.', 'cycle')
  },

  cycleTick(now) {
    const c = this.cycle
    if (!c.on || this.want || now < c.next) return
    let pages = this.cyclePages(c.section)
    c.index++
    if (c.index >= pages.length) {
      c.index = 0
      if (!c.holdSection) {
        c.section = (c.section + 1) % Pages.SECTIONS.length
        pages = this.cyclePages(c.section)
        announce(Pages.SECTIONS[c.section].name, 'cycle')
      }
    }
    c.next = Infinity
    this.request(pages[c.index])
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

  // ---------------------------------------------------------------- pointer
  /**
   * What is under a finger: a fastext key, a page number printed on the
   * page, or nothing. Touch only -- main.js ignores the mouse, and
   * pointer.js says why. On a phone the finger is the remote, and the page
   * numbers were always printed for the viewer to use.
   */
  linkAtCell(row, col) {
    if (!this.power || !this.truth) return null
    let src = row
    if (this.size === 1) src = 1 + ((row - 1) >> 1)
    else if (this.size === 2) src = 13 + ((row - 1) >> 1)
    if (row < 1 || src > 24) return null
    if (src === 24) {
      if (this.cycle.on) return null
      const i = this.truth.fastextAt(col)
      return i === null ? null : { kind: 'fastext', i }
    }
    const num = this.truth.pageNumberAt(src, col)
    if (num && num !== this.page && Pages.pageDef(num, this.ctx())) return { kind: 'page', num }
    return null
  },

  /** Pointer position (CSS pixels within the canvas) to a link, or null. */
  linkAt(x, y, W, H) {
    const cell = cellAt(x, y, W, H, this.s.crt.params, this.s.term)
    return cell ? this.linkAtCell(cell.row, cell.col) : null
  },

  /** A tap on the tube. Returns what it did. A set in standby switches on
   *  wherever it is touched. */
  click(x, y, W, H) {
    if (!this.power) { sfx.playKeyClick(); this.powerUp(); return 'power' }
    const link = this.linkAt(x, y, W, H)
    return this.followLink(link)
  },

  followLink(link) {
    if (!link) return null
    sfx.playKeyClick()
    this.lastKeyAt = perf()
    this.entry = ''
    if (link.kind === 'fastext') {
      const target = this.truth.fastext[link.i][1]
      if (this.cycle.on) this.stopCycle()
      this.fastext(link.i)
    } else {
      if (this.cycle.on) this.stopCycle()
      this.request(link.num)
    }
    return link.kind
  },

  // ---------------------------------------------------------------- keys
  flash(text) { this.msg = { text, until: perf() + HEADER_MSG_MS } },

  fastext(i) {
    const f = this.truth?.fastext?.[i]
    if (!f) { this.flash('NO LINK'); return }
    this.follow(f[1])
  },

  follow(target) {
    if (target === 'locate') { this.requestLocation(); return }
    if (target === 'sub:next') { this.stepSub(1); return }
    if (target.startsWith('game:')) { this.gameMove(target.slice(5)); return }
    this.request(target)
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
        if (/^[1-8]$/.test(k)) { this.skipBoot(); this.want = null; this.entry = k }
      }
      return
    }
    // Any key during the switch-on skips the rest of it -- and then does
    // what it does, except P, which switches off.
    this.quiet = false
    if (this.boot && lower !== 'p') this.skipBoot()

    const handled = this.handleKey(k, lower, e)
    if (handled) {
      sfx.playKeyClick()
      e.preventDefault?.()
      this.lastKeyAt = perf()
    }
  },

  handleKey(k, lower, e) {
    const pageKey = () => { if (this.cycle.on) this.stopCycle() }
    const fast = { F1: 0, F2: 1, F3: 2, F4: 3 }[k] ?? (e.shiftKey && /^Digit[1-4]$/.test(e.code || '') ? +e.code.slice(5) - 1 : null)
    // While cycling, the coloured keys are hidden under the cycling strip,
    // so a coloured key stops the cycle and shows them rather than following
    // a link the viewer cannot see.
    if (fast !== null && this.cycle.on) { this.stopCycle(); this.flash('STOPPED'); return true }
    if (fast !== null) { this.fastext(fast); return true }
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
      case 'h':
        // Cycling: hold the SECTION, going round its pages. Otherwise hold
        // the page that is up, as a teletext set's HOLD did.
        if (this.cycle.on) {
          this.cycle.holdSection = !this.cycle.holdSection
          this.flash(this.cycle.holdSection ? 'SECTION' : 'MOVE ON')
          announce(this.cycle.holdSection ? `Holding ${Pages.SECTIONS[this.cycle.section].name.toLowerCase()}.` : 'Moving on.', 'cycle')
          return true
        }
        this.hold = !this.hold
        this.flash(this.hold ? 'HOLD' : 'RELEASE')
        return true
      case 'c':
        this.colourMode = (this.colourMode + 1) % COLOUR_MODES.length
        this.applyColourMode(true)
        this.flash(COLOUR_MODES[this.colourMode].label)
        this.saveState()
        return true
      case 'n':
        if (this.cycle.on) { this.stopCycle(); this.flash('STOPPED') }
        else this.startCycle()
        return true
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
    if (this.boot) {
      const t = now - this.boot.t0
      if (!this.boot.chimed && t >= BOOT_LINE_MS) { this.boot.chimed = true; sfx.playChime() }
      if (t >= BOOT_MS) this.skipBoot()
      return
    }
    this.updateReception(now)
    this.applyReceptionToTube()
    if (now >= this.nextFeedPoll) {
      this.nextFeedPoll = now + FEED_POLL_MS
      for (const id of Object.keys(FEEDS)) this.ensureFeed(id)
    }
    if (this.want && now >= this.arriveAt) this.tryArrive(now)
    if (this.page && !this.want && now >= this.nextTx) this.retransmit(now)
    if (this.page && !this.want && now >= this.nextLive) this.liveRender(now)
    this.cycleTick(now)
  },

  frame(s, t) {
    const now = perf()
    this.lastFrameAt = now
    this.tick(now)
    if (this.power) this.draw(now)
  },

  // ---------------------------------------------------------------- drawing
  /**
   * Row 0 (2026-09-28, second pass): one page number, the plate, the date,
   * the time. Real teletext showed two numbers -- the page you keyed, and the
   * page going past -- and here that read as a mistake ("P200 ... 200"). Now
   * the one number is what you keyed while you key it, counts in green
   * while the set waits for it, and settles white on the page. The date is
   * US order and the seconds take a colon: Ceefax's "20:15/03" was
   * authentic and read as a typo.
   */
  header(now) {
    const H = new T.Page()
    if (this.entry) H.text(0, 1, `P${this.entry.padEnd(3, '-')}`, T.WHITE)
    else if (this.want) H.text(0, 1, `P${C.rollingNumber(this.want[0], now)}`, T.GREEN)
    else H.text(0, 1, `P${this.page || '---'}`, T.WHITE)
    // The service name on its own plate, yellow on blue (2026-09-28: it read
    // as one more word in a white line of numbers). Messages -- HOLD, SIZE,
    // CYCLING -- take the plate over briefly, in the same place.
    const msg = this.msg && now < this.msg.until ? this.msg.text : null
    H.band(0, T.BLUE, 5, 15)
    if (msg) H.text(0, 6, msg.slice(0, 8), T.WHITE, T.BLUE)
    else if (this.hold) H.text(0, 6, 'HOLD', T.RED, T.BLUE)
    else H.text(0, 6, 'INTERVAL', T.YELLOW, T.BLUE)
    const d = new Date()
    const date = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`
    H.text(0, 18, date, T.WHITE)
    H.text(0, 31, `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`, T.YELLOW)
    return H.cells[0]
  },

  glyphFor(ch) {
    const g = this.s.term.font.glyphs
    return g.get(ch.codePointAt(0)) || g.get(63)
  },

  draw(now) {
    const term = this.s.term
    if (this.boot) { this.drawBoot(now - this.boot.t0); return }
    const hdr = this.header(now)
    for (let x = 0; x < T.COLS; x++) this.putCell(0, x, hdr[x], hdr[x], null)
    if (!this.truth) {
      if (this.identHold) { this.drawBoot(BOOT_MS, 1); return }
      for (let y = 1; y < T.ROWS; y++) for (let x = 0; x < T.COLS; x++) term.put(x, y, ' ', NORMAL, 0, T.cellColour(T.WHITE, T.BLACK))
      return
    }
    const flashOn = (now % 1000) < 700
    for (let y = 1; y < T.ROWS; y++) {
      let src = y, half = null
      if (this.size === 1) { src = 1 + ((y - 1) >> 1); half = (y - 1) & 1 ? 'bottom' : 'top' }
      else if (this.size === 2) { src = 13 + ((y - 1) >> 1); half = (y - 1) & 1 ? 'bottom' : 'top' }
      if (src > 24) { for (let x = 0; x < T.COLS; x++) term.put(x, y, ' ', NORMAL, 0, 7); continue }
      if (src === 24 && this.cycle.on) { this.drawCycleStrip(y, half); continue }
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

  /** The switch-on: a bright line that widens and opens into a white field,
   *  then the ident on black -- the logo assembling, the colour bars, the
   *  line under it. Drawn straight onto the grid; no header yet, the set is
   *  not receiving anything. */
  drawBoot(t, fromRow = 0) {
    const P = new T.Page()
    if (t < BOOT_LINE_MS) {
      const k = t / BOOT_LINE_MS
      const w = Math.min(T.COLS, Math.round(k * 1.6 * T.COLS))
      const c0 = Math.floor((T.COLS - w) / 2)
      const h = k > 0.7 ? Math.round((k - 0.7) / 0.3 * 12) : 0
      for (let r = 12 - h; r <= 12 + h; r++) P.band(r, T.WHITE, c0, c0 + w)
    } else {
      const k = Math.min(1, (t - BOOT_LINE_MS) / (BOOT_IDENT_MS * 0.6))
      P.art(7, 8, Pic.identPixels('INTERVAL', k), { R: T.RED, Y: T.YELLOW, G: T.GREEN, C: T.CYAN, M: T.MAGENTA })
      const bars = [T.WHITE, T.YELLOW, T.CYAN, T.GREEN, T.MAGENTA, T.RED, T.BLUE, T.WHITE]
      const shown = Math.floor(Math.min(1, k * 1.4) * bars.length)
      for (let i = 0; i < shown; i++) P.band(16, bars[i], 8 + i * 3, 11 + i * 3)
      if (k > 0.6) P.text(14, 7, 'THE PAGES BETWEEN PICTURES', T.WHITE)
    }
    for (let y = fromRow; y < T.ROWS; y++) {
      const row = P.cells[y]
      for (let x = 0; x < T.COLS; x++) this.putCell(y, x, row[x], row[x], null)
    }
  },

  /** Row 24 while cycling: where the set is and the two keys that matter.
   *  The coloured keys are hidden while it runs (see handleKey). */
  drawCycleStrip(y, half) {
    const P = new T.Page()
    const c = this.cycle
    const sec = Pages.SECTIONS[c.section]
    P.band(24, T.BLUE)
    P.text(24, 1, c.holdSection ? 'HOLDING' : 'CYCLING', T.YELLOW, T.BLUE)
    P.text(24, 9, T.clip(sec.name, 8), T.WHITE, T.BLUE)
    P.text(24, 18, c.holdSection ? 'H MOVES ON' : 'H HOLDS', T.CYAN, T.BLUE)
    P.text(24, 31, 'N STOPS', T.CYAN, T.BLUE)
    for (let x = 0; x < T.COLS; x++) this.putCell(y, x, P.cells[24][x], P.cells[24][x], half)
  },
}

export default program
