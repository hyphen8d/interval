// The set, end to end: power, the keypad, the carousel wait, and what the
// tube shows at each step. Driven through tests/harness.mjs on a fake clock.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boot, BASE_TIME, NEVER } from './harness.mjs'
import { nextTransmission, MIN_WAIT_MS } from '../carousel.js'
import { RED } from '../teletext.js'
import * as Pages from '../pages.js'

test('switching on lands on the welcome, 190', async () => {
  const h = await boot()
  assert.match(h.row(0), /^ P190 INTERVAL\s+Mon Sep 28\s+20:00:0\d$/)
  assert.ok(h.find('Press N and the set turns its own'))
  assert.equal(h.colourAt(3, 1).bg, RED, 'the masthead is in colour: the news magazine, 1xx')
  h.shutdown()
})

test('a set in standby shows standby, and wakes on a number', async () => {
  const h = await boot({ power: false })
  h.advance(100)
  assert.ok(h.find('STANDBY'))
  h.key('3')
  assert.ok(h.program.power)
  assert.equal(h.program.entry, '3', 'the number that woke it starts the entry')
  h.shutdown()
})

test('keying a page: the old page stays up while the header rolls, then the new one lands', async () => {
  const h = await boot()
  h.key('2'); h.key('0')
  h.advance(50)
  assert.match(h.row(0), /^ P20-/, 'the half-keyed number shows')
  h.key('0')
  h.advance(MIN_WAIT_MS - 100)
  assert.ok(h.find('Bite-sized pages'), 'still the welcome: nothing arrives on request')
  assert.match(h.row(0), /^ P2\d\d INTERVAL/, 'the page number is counting through magazine 2')
  await h.settle(3000)
  assert.ok(h.page().includes('ON THIS DAY'))
  assert.ok(h.find('SEP 28'), 'and the grid shows it')
  assert.match(h.row(0), /^ P200 INTERVAL\s+Mon Sep 28/)
  h.shutdown()
})

test('the wait is where the page is in the loop', async () => {
  const h = await boot()
  const t0 = h.now
  h.program.request('101')
  const due = nextTransmission('101', t0)
  h.advance(due - t0 - 20)
  assert.equal(h.program.page, '190')
  await h.settle(100, 50)
  assert.equal(h.program.page, '101')
  h.shutdown()
})

test('a page the service does not carry is searched for forever', async () => {
  const h = await boot()
  await h.go('777', 8000)
  assert.equal(h.program.page, '190')
  assert.equal(h.program.want, '777')
  h.key('Escape')
  assert.equal(h.program.want, null, 'Escape gives up the search')
  h.shutdown()
})

test('a page whose source fails comes up off air, and says so', async () => {
  const h = await boot({ feeds: 'fail' })
  await h.go('101', 6000)
  assert.ok(h.page().includes('OFF AIR'))
  assert.ok(h.find('It will come back by itself'))
  h.shutdown()
})

test('a page whose source never answers keeps the set searching', async () => {
  const h = await boot({ feeds: 'never' })
  await h.go('330', 6000)
  assert.equal(h.program.page, '190')
  assert.equal(h.program.want, '330')
  h.shutdown()
})

test('fastext follows the coloured links, by F-key and by Shift+number', async () => {
  const h = await boot()
  h.key('F2')
  await h.settle(3500)
  assert.equal(h.program.page, '101', 'green on the welcome is News')
  h.key('$', { shiftKey: true, code: 'Digit4' })
  await h.settle(3500)
  assert.equal(h.program.page, '100', 'cyan on the news is the index')
  h.shutdown()
})

test('UP and DOWN step through the pages that exist', async () => {
  const h = await boot()
  h.key('ArrowUp'); await h.settle(3500)
  assert.equal(h.program.page, '199')
  h.key('ArrowDown'); await h.settle(3500)
  assert.equal(h.program.page, '190')
  h.shutdown()
})

test('subpages turn on their own, and HOLD stops them', async () => {
  const h = await boot()
  await h.go('200', 3500)
  const first = h.program.sub
  h.key('h')
  await h.settle(20000, 500)
  assert.equal(h.program.sub, first, 'held')
  assert.match(h.row(0), /HOLD/)
  h.key('h')
  await h.settle(12000, 500)
  assert.notEqual(h.program.sub, first, 'released, it turns again')
  h.shutdown()
})

test('LEFT and RIGHT step through subpages and hold the one you chose', async () => {
  const h = await boot()
  await h.go('200', 3500)
  const n = h.program.pages.length
  const s0 = h.program.sub
  h.key('ArrowRight')
  assert.equal(h.program.sub, (s0 + 1) % n)
  assert.ok(h.program.hold)
  h.shutdown()
})

test('C cycles colour, black-and-white and the green monitor', async () => {
  const h = await boot()
  h.key('c'); h.advance(50)
  assert.equal(h.crt.phosphor, 'bw')
  assert.ok(h.term.palette.every(([r, g, b]) => r === g && g === b), 'greys')
  h.key('c'); h.advance(50)
  assert.equal(h.crt.phosphor, 'monitor')
  h.key('c'); h.advance(50)
  assert.equal(h.crt.phosphor, 'colour')
  assert.ok(!h.term.palette.every(([r, g, b]) => r === g && g === b))
  h.shutdown()
})

test('poor reception garbles the page and never the header', async () => {
  const h = await boot({ query: '?rx=0.25' })
  await h.go('101', 3500)
  // Damaged somewhere, against the page as sent. It once asked that one
  // headline be broken, and reception is random: now and then the whole
  // sentence came through clean and the test failed (2026-10-01).
  const sent = h.program.truth.lines(), seen = h.program.shown.lines()
  assert.ok(sent.slice(1).some((l, r) => l !== seen[r + 1]), 'the text is damaged')
  assert.match(h.row(0), /^ P101 INTERVAL\s+Mon Sep 28/, 'the header is not')
  assert.ok(h.crt.params.noise > 0.2, 'and the tube shows it')
  h.shutdown()
})

test('the colour mode survives a reload; the set still lands on the welcome', async () => {
  const h = await boot()
  await h.go('310', 3500)
  h.key('c')
  const saved = JSON.parse(h.store.get('interval:state:v1'))
  h.shutdown()
  const h2 = await boot({ saved })
  assert.equal(h2.program.page, '190')
  assert.equal(h2.crt.phosphor, 'bw')
  h2.shutdown()
})

test('?page= opens a page directly', async () => {
  const h = await boot({ query: '?page=1af' })
  assert.equal(h.program.page, '1AF')
  h.shutdown()
})

test('weather: red asks for the location, and the forecast follows', async () => {
  const h = await boot({ location: 'grant' })
  await h.go('300', 3500)
  assert.ok(h.page().includes('LOCAL WEATHER'))
  h.key('F1')
  await h.settle(3000)
  assert.equal(h.geoCalls.length, 1)
  assert.ok(h.find('SUNRISE 06:49'), 'the forecast for where you are')
  const saved = JSON.parse(h.store.get('interval:state:v1'))
  assert.equal(saved.weatherConsent, 'yes')
  assert.ok(!JSON.stringify(saved).includes('40.7'), 'the position itself is never stored')
  h.shutdown()
})

test('weather: a refusal is remembered as a refusal', async () => {
  const h = await boot({ location: 'deny' })
  await h.go('300', 3500)
  h.key('F1')
  await h.settle(1000)
  assert.ok(h.find('You said no'))
  assert.equal(JSON.parse(h.store.get('interval:state:v1')).weatherConsent, 'no')
  h.shutdown()
})

test('weather: an insecure origin is not mistaken for a refusal', async () => {
  const h = await boot({ location: 'grant', secure: false })
  await h.go('300', 3500)
  assert.ok(h.find('secure connection'))
  h.key('F1')
  assert.equal(h.geoCalls.length, 0)
  h.shutdown()
})

test('N cycles through the sections, a page at a time, and says where it is', async () => {
  const h = await boot()
  h.key('n')
  assert.ok(h.program.cycle.on)
  await h.settle(3500)
  assert.equal(h.program.page, '101', 'the welcome is not a section: cycling starts at the news')
  assert.match(h.row(24), /CYCLING\s+NEWS\s+H HOLDS\s+N STOPS/)
  assert.deepEqual(h.fastextLabels.at(-1), [null, null, null, null], 'the coloured keys give way to the strip')
  const seen = new Set()
  for (let i = 0; i < 40 && seen.size < 6; i++) { await h.settle(5000, 500); seen.add(h.program.page) }
  assert.ok(['101', '102', '200', '201'].every(n => seen.has(n)), `went round news and today: ${[...seen]}`)
  h.shutdown()
})

test('H while cycling holds the section; H again moves on', async () => {
  const h = await boot()
  await h.go('200', 3500)
  h.key('n')
  h.key('h')
  assert.ok(h.program.cycle.holdSection)
  const seen = new Set()
  for (let i = 0; i < 40; i++) { await h.settle(5000, 500); seen.add(h.program.page) }
  assert.deepEqual([...seen].sort(), ['200', '201', '202', '203'], 'round TODAY and nowhere else')
  assert.match(h.row(24), /HOLDING\s+TODAY\s+H MOVES ON/)
  h.key('h')
  for (let i = 0; i < 20 && Pages.sectionOf(h.program.page) === 1; i++) await h.settle(5000, 500)
  assert.equal(Pages.sectionOf(h.program.page), 2, 'on to the weather section')
  h.shutdown()
})

test('cycling skips the weather pages that would only ask where you are', async () => {
  const h = await boot()
  assert.deepEqual(h.program.cyclePages(2), ['302'], 'only the cities page, until the set knows where it is')
  h.shutdown()
})

test('keying a page, or a coloured key, stops the cycle', async () => {
  const h = await boot()
  h.key('n'); await h.settle(3500)
  h.key('3'); h.key('1'); h.key('0')
  assert.ok(!h.program.cycle.on)
  h.key('n'); await h.settle(3500)
  h.key('F1')
  h.advance(50)
  assert.ok(!h.program.cycle.on)
  assert.match(h.row(0), /STOPPED/)
  h.shutdown()
})

test('the set never cycles by itself', async () => {
  const h = await boot({ startAt: new Date(2026, 8, 29, 1, 0).getTime() })
  await h.settle(20 * 60 * 1000, 10000)
  assert.ok(!h.program.cycle.on)
  assert.equal(h.program.page, '190')
  h.shutdown()
})

test('the hidden game on 1FF answers with the coloured keys and keeps a best score', async () => {
  const h = await boot()
  h.key('1'); h.key('f'); h.key('f')
  await h.settle(3500)
  assert.equal(h.program.page, '1FF')
  assert.ok(h.page().includes('FOUR KEYS'))
  h.key('F1')
  assert.ok(h.page().includes('RIGHT!'))
  assert.equal(h.program.game.score, 1)
  h.key('F1')
  h.key('F1')
  assert.ok(h.page().includes('NOT THIS TIME'), 'question 2: Ceefax began in 1974, not 1970')
  assert.equal(JSON.parse(h.store.get('interval:state:v1')).gameBest, 1)
  h.shutdown()
})

test('the screen reader hears each page as it arrives, not the clock', async () => {
  const h = await boot()
  const before = h.announced.length
  await h.go('101', 3500)
  const said = h.announced.slice(before)
  // Whichever subpage the loop was sending when it arrived, read as prose.
  const speech = h.program.truth.speech()
  assert.ok(speech.length > 100)
  assert.ok(said.some(s => s.startsWith('Page 101, News headlines, ') && s.includes(speech)))
  const n = h.announced.length
  h.advance(5000)
  assert.equal(h.announced.length, n, 'nothing new while the page just sits there')
  h.shutdown()
})

test('switching off returns to standby and a deploy is picked up at the switch', async () => {
  const h = await boot()
  h.deploy('newer')
  await h.program.checkBuild()
  h.key('p')
  h.advance(400)
  assert.ok(h.find('STANDBY'))
  assert.equal(h.reloads.length, 1)
  h.shutdown()
})


test('switching on: a bright line, the decoder reporting in, the ident, then the welcome', async () => {
  const { BOOT_LINE_MS, BOOT_IDENT_AT, BOOT_POST_LINE_MS, BOOT_MS, bootLines } = await import('../program.js')
  const h = await boot({ power: false })
  h.key('p')
  h.advance(200)
  assert.ok(h.term.colors.some(c => (c >> 4) === 7), 'a white line across the tube')
  assert.equal(h.row(0), '', 'no header while the set is warming up')
  h.advance(BOOT_LINE_MS + BOOT_POST_LINE_MS)
  assert.ok(h.find('TELETEXT DECODER'))
  assert.ok(h.find('SYNC') && !h.find('PAGE STORE'), 'the readout lands a line at a time')
  h.advance(bootLines().length * BOOT_POST_LINE_MS)
  assert.ok(h.find('PAGE 190 REQUESTED'))
  assert.match(h.text(), /PAGE STORE\s+:\s+\d+ PAGES, 7 SECTIONS/)
  assert.ok(h.program.feeds.entries.size > 0, 'the sources are asked for while it boots')
  const elapsed = 200 + BOOT_LINE_MS + BOOT_POST_LINE_MS + bootLines().length * BOOT_POST_LINE_MS
  h.advance(BOOT_IDENT_AT + 900 - elapsed)
  assert.ok(h.find('THE PAGES BETWEEN PICTURES'), h.text())
  assert.ok(h.term.gfx.some(Boolean), 'the logo in block graphics')
  await h.settle(BOOT_MS + 1500)
  assert.equal(h.program.page, '190')
  h.shutdown()
})

test('a key skips the ident; a number keyed to wake the set skips it outright', async () => {
  const h = await boot({ power: false })
  h.key('p'); h.advance(300)
  h.key('i')
  assert.equal(h.program.boot, null)
  await h.settle(2000)
  assert.equal(h.program.page, '100', 'I still went to the index')
  h.shutdown()
  const h2 = await boot({ power: false })
  h2.key('3'); h2.key('0'); h2.key('2')
  assert.equal(h2.program.boot, null)
  await h2.settle(2000)
  assert.equal(h2.program.page, '302')
  h2.shutdown()
})

test('pages that move: the clock ticks, the candle flickers, the fish swim, the rain falls', async () => {
  const Pic = await import('../pictures.js')
  const differs = (f, a, b) => f(a).join('') !== f(b).join('')
  assert.ok(differs(Pic.candlePixels, 0, 500))
  assert.ok(differs(Pic.aquariumPixels, 0, 3000))
  assert.ok(differs(Pic.lighthousePixels, 0, 2500))
  assert.ok(differs(Pic.auroraPixels, 0, 3000))
  assert.ok(differs(Pic.trainPixels, 10000, 11000))
  assert.ok(differs(Pic.launchPixels, 0, 1000))
  assert.ok(differs(Pic.moonrisePixels, 0, 20000))
  assert.ok(differs(Pic.seaPixels, 0, 2000))
  assert.notEqual(Pic.weatherCell('rain', 0), Pic.weatherCell('rain', 250))
  assert.equal(Pic.weatherKind(63), 'rain'); assert.equal(Pic.weatherKind(73), 'snow'); assert.equal(Pic.weatherKind(2), null)
  const h = await boot()
  await h.go('202', 3000)
  const before = h.text()
  h.advance(1100)
  assert.notEqual(h.text(), before, 'the clock moved on a second')
  assert.match(h.page(), /TOKYO\s+\d\d:\d\d/)
  h.shutdown()
})

test('the clock digits are the time', async () => {
  const { clockPixels } = await import('../pictures.js')
  const px = clockPixels('18:08:00')
  assert.equal(px.length, 15)
  assert.equal(px[0].length, 6 * 8 + 2 * 4)
  // The 1 has only its right-hand segments lit.
  assert.ok(px.every(row => row.slice(0, 4) === '....'))
})

test('the arrival tick only for a page keyed, and the chime only at switch-on', async () => {
  // power: false -- the set switches itself on from ?power=on; the harness
  // pressing P as well would switch it straight back off.
  const h = await boot({ query: '?power=on', power: false })
  await h.settle(2000)
  assert.equal(h.program.quiet, true, 'a start nobody pressed makes no sound')
  assert.equal(h.program.page, '190', 'and goes straight to its page, no ident')
  h.key('1'); h.key('0'); h.key('1')
  assert.equal(h.program.quiet, false)
  h.shutdown()
})

test('focus: red starts and pauses, the timer runs on other pages, and chimes when done', async () => {
  const h = await boot()
  await h.go('502', 2000)
  h.key('F1')
  assert.equal(h.program.focus.state, 'run')
  await h.go('101', 2000)
  await h.settle(25 * 60000, 30000)
  assert.equal(h.program.focus.state, 'done')
  assert.match(h.row(0), /TIME'S UP|INTERVAL/)
  assert.ok(h.announced.some(s => /Time's up/.test(s)))
  await h.go('502', 2000)
  h.key('F3')
  assert.equal(h.program.focus.mode, 'break')
  h.key('F1'); h.advance(10000); h.key('F1')
  assert.equal(h.program.focus.state, 'paused')
  assert.ok(h.program.focus.left < 5 * 60000 && h.program.focus.left > 4 * 60000)
  h.shutdown()
})

test('decide: the die tumbles, then lands on 1-20; the coin lands on heads or tails', async () => {
  const h = await boot()
  await h.go('503', 2000)
  h.key('F1')
  const v = h.program.decide.value
  assert.ok(v >= 1 && v <= 20)
  h.advance(1200)
  assert.ok(h.announced.some(s => s === `You rolled ${v}.`))
  h.key('F2'); h.advance(1200)
  assert.ok(h.announced.some(s => s === 'Heads.' || s === 'Tails.'))
  h.shutdown()
})

test('cycling skips the timer, the dice, and a league with no games', async () => {
  const h = await boot()
  const sec = (name) => Pages.SECTIONS.findIndex(s => s.name === name)
  const pause = h.program.cyclePages(sec('PAUSE'))
  assert.ok(!pause.includes('502') && !pause.includes('503'))
  assert.ok(pause.includes('501'))
  h.program.feeds.entries.get('sport_nba').data = { games: [] }
  h.program.feeds.entries.get('sport_nba').key = 'live'
  assert.ok(!h.program.cyclePages(sec('SPORT')).includes('602'))
  h.shutdown()
})

test('402 reads the household numbers out of markets.json, through the parser', async () => {
  const h = await boot()
  await h.go('402', 3000)
  assert.ok(h.find('GAS, US AVERAGE'), h.page())
  assert.ok(h.find('INFLATION'))
  assert.ok(!h.find('not in the last build'))
  h.shutdown()
})

// ------------------------------------------------------- 2026-10-01 review
// Each of these failed against the code before the fix it covers.

test('every switch-on lands on 190, not the page the set was switched off on', async () => {
  const { BOOT_MS } = await import('../program.js')
  const h = await boot()
  await h.go('101', 3500)
  assert.equal(h.program.page, '101')
  h.key('p'); h.advance(400)
  assert.ok(h.find('STANDBY'))
  h.key('p'); await h.settle(BOOT_MS + 2000)
  assert.equal(h.program.page, '190')
  assert.ok(h.find('Press N and the set turns its own'))
  h.shutdown()
  // A ?page= link opens where it points once; the next switch-on is 190.
  const h2 = await boot({ query: '?page=302' })
  assert.equal(h2.program.page, '302')
  h2.key('p'); h2.advance(400)
  h2.key('p'); await h2.settle(BOOT_MS + 2000)
  assert.equal(h2.program.page, '190')
  h2.shutdown()
})

test('Escape while the cycle is waiting for its page stops the cycle', async () => {
  const h = await boot()
  h.key('n')
  assert.ok(h.program.want, 'cycling asked for the first news page')
  h.key('Escape')
  assert.equal(h.program.want, null)
  assert.ok(!h.program.cycle.on, 'and the cycle is off, not waiting for nothing')
  h.advance(50)
  assert.match(h.row(0), /STOPPED/)
  h.shutdown()
})

test('cycling passes over a section with nothing to show, and will not start with nothing at all', async () => {
  const h = await boot()
  const sport = Pages.SECTIONS.findIndex(s => s.name === 'SPORT')
  for (const lg of Object.values(Pages.LEAGUE_PAGES)) {
    const e = h.program.feeds.entries.get(`sport_${lg}`)
    if (e) e.data = { games: [] }
    else h.program.feeds.entries.set(`sport_${lg}`, { data: { games: [] }, at: Date.now() })
  }
  assert.deepEqual(h.program.cyclePages(sport), [])
  // From the last page before SPORT, the next stop is the gallery.
  const before = Pages.SECTIONS[sport - 1].pages.map(([, n]) => n)
  h.program.cycle = { on: true, section: sport - 1, index: h.program.cyclePages(sport - 1).length - 1, next: 0, holdSection: false }
  h.program.cycleTick(h.now)
  assert.equal(h.program.want, Pages.SECTIONS[sport + 1].pages[0][1], `asked for the gallery, not page ${h.program.want}`)
  assert.ok(before.length)
  h.program.stopCycle(); h.program.want = null
  // Nothing anywhere: N says so and the cycle stays off.
  h.program.cyclePages = () => []
  h.key('n')
  assert.ok(!h.program.cycle.on)
  assert.equal(h.program.want, null)
  h.advance(50)
  assert.match(h.row(0), /NO PAGES/)
  h.shutdown()
})

test('cycling moves on from a page whose source never answers', async () => {
  const { FEED_WAIT_MS } = await import('../program.js')
  const h = await boot({ feeds: (url) => (url.includes('Template:In_the_news') ? NEVER : undefined) })
  h.key('n')
  assert.equal(h.program.want, '101')
  await h.settle(FEED_WAIT_MS - 2000, 500)
  assert.equal(h.program.want, '101', 'given its time first')
  assert.equal(h.program.page, '190')
  await h.settle(6000, 500)
  assert.ok(h.program.cycle.on)
  assert.equal(h.program.page, '102', 'then passed over for the next page')
  h.shutdown()
})

test('a page that throws while drawing comes up off air and says why', async () => {
  const h = await boot()
  const P = await import(`../pages.js?v=${h.tag}`)
  P.PAGES.get('102').render = () => { throw new Error('series is not an array') }
  const err = console.error
  const logged = []
  console.error = (...a) => logged.push(a)
  try { await h.go('102', 3500) } finally { console.error = err }
  assert.equal(h.program.page, '102', 'it arrives, rather than being searched for forever')
  assert.ok(h.page().includes('OFF AIR'), h.page())
  assert.ok(h.page().includes('series is not an array'))
  assert.equal(logged.length, 1, 'logged once, not on every pass')
  h.shutdown()
})

test('a focus session does not run out while the set is off', async () => {
  const { BOOT_MS } = await import('../program.js')
  const h = await boot()
  await h.go('502', 2000)
  h.key('F1')
  assert.equal(h.program.focus.state, 'run')
  h.advance(60000)
  h.key('p'); h.advance(400)
  h.advance(30 * 60000)
  const n = h.announced.length
  h.key('p'); await h.settle(BOOT_MS + 2000)
  assert.ok(!h.announced.slice(n).some(s => /Time's up/.test(s)), 'no chime for a session that ended unseen')
  assert.equal(h.program.focus.state, 'paused')
  assert.equal(h.program.focus.left, 24 * 60000, "paused with the 24 minutes it had left")
  h.shutdown()
})

test('switching back on inside the fade to standby: no standby, no reload', async () => {
  const { BOOT_MS } = await import('../program.js')
  const h = await boot()
  h.deploy('newer')
  await h.program.checkBuild()
  h.key('p'); h.advance(100)
  h.key('p'); h.advance(400)
  assert.ok(h.program.power)
  assert.equal(h.reloads.length, 0, 'a set that is on is not reloaded under the viewer')
  assert.ok(!h.find('STANDBY'))
  await h.settle(BOOT_MS + 2000)
  assert.equal(h.program.page, '190')
  assert.ok(!h.find('STANDBY'))
  h.shutdown()
})

test('a quiet start gets its whistle and hum on the first key', async () => {
  const { WHISTLE_HZ } = await import('../sfx.js')
  const h = await boot({ query: '?power=on', power: false, audio: true })
  await h.settle(2000)
  assert.ok(!h.audioLog.some(e => e.value === WHISTLE_HZ), 'silent until a gesture')
  h.key('1')
  assert.ok(h.audioLog.some(e => e.value === WHISTLE_HZ), 'the key is the gesture')
  h.shutdown()
})

test('the effects queue drains on the fallback ticker when frames stop', async () => {
  const h = await boot()
  let ran = 0
  h.program.fxAfter(500, () => ran++)
  h.starve(1000)
  assert.equal(ran, 1, 'a covered window gets 0fps and still runs its effects')
  h.shutdown()
})

test('switching off clears the effects queue; only `always` effects survive', async () => {
  const h = await boot()
  const ran = []
  const obj = { v: 0 }
  h.program.fxAfter(1000, () => ran.push('plain'))
  h.program.fxAfter(1000, () => ran.push('always'), true)
  h.program.fxTween(obj, 'v', 0, 10, 5000)
  h.advance(100)
  h.key('p')
  assert.equal(obj.v, 10, 'a cancelled tween lands where it was going')
  h.advance(1500)
  assert.deepEqual(ran, ['always'])
  h.shutdown()
})

test('an off-air page turns its windmill in place, though its page does not move', async () => {
  const h = await boot({ feeds: 'fail' })
  await h.go('101', 6000)
  assert.ok(h.page().includes('OFF AIR'))
  assert.ok(Number.isFinite(h.program.nextLive), 'the set redraws it')
  const sails = () => h.program.truth.cells.slice(3, 8).map(row => row.slice(27, 37).map(x => x.mos).join()).join('|')
  const before = sails()
  h.advance(2000)
  assert.notEqual(sails(), before, 'and the sails have turned')
  h.shutdown()
})
