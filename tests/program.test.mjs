// The set, end to end: power, the keypad, the carousel wait, and what the
// tube shows at each step. Driven through tests/harness.mjs on a fake clock.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boot, BASE_TIME } from './harness.mjs'
import { nextTransmission, MIN_WAIT_MS } from '../carousel.js'
import { BLUE, YELLOW } from '../teletext.js'

test('switching on lands on the index', async () => {
  const h = await boot()
  assert.match(h.row(0), /^ P100 INTERVAL 100 Mon 28 Sep 20:00\/0\d$/)
  assert.ok(h.find('NEWS           101'))
  assert.deepEqual(h.colourAt(3, 1), { fg: YELLOW, bg: BLUE }, 'the masthead is in colour')
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
  assert.ok(h.find('NEWS           101'), 'still the index: nothing arrives on request')
  assert.match(h.row(0), / 2\d\d Mon/, 'the header is counting through magazine 2')
  await h.settle(3000)
  assert.ok(h.page().includes('ON THIS DAY'))
  assert.ok(h.find('28 SEP'), 'and the grid shows it')
  assert.match(h.row(0), /^ P200 INTERVAL 200 /)
  h.shutdown()
})

test('the wait is where the page is in the loop', async () => {
  const h = await boot()
  const t0 = h.now
  h.program.request('101')
  const due = nextTransmission('101', t0)
  h.advance(due - t0 - 20)
  assert.equal(h.program.page, '100')
  await h.settle(100, 50)
  assert.equal(h.program.page, '101')
  h.shutdown()
})

test('a page the service does not carry is searched for forever', async () => {
  const h = await boot()
  await h.go('777', 8000)
  assert.equal(h.program.page, '100')
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
  await h.go('400', 6000)
  assert.equal(h.program.page, '100')
  assert.equal(h.program.want, '400')
  h.shutdown()
})

test('fastext follows the coloured links, by F-key and by Shift+number', async () => {
  const h = await boot()
  h.key('F1')
  await h.settle(3500)
  assert.equal(h.program.page, '101')
  h.key('!', { shiftKey: true, code: 'Digit4' })
  await h.settle(3500)
  assert.equal(h.program.page, '100')
  h.shutdown()
})

test('UP and DOWN step through the pages that exist', async () => {
  const h = await boot()
  h.key('ArrowUp'); await h.settle(3500)
  assert.equal(h.program.page, '101')
  h.key('ArrowDown'); await h.settle(3500)
  assert.equal(h.program.page, '100')
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

test('REVEAL shows the hidden answers', async () => {
  const h = await boot()
  await h.go('600', 3500)
  assert.ok(!h.find('LINE 21'))
  h.key('r'); h.advance(50)
  assert.ok(h.find('LINE 21'))
  h.shutdown()
})

test('SIZE shows the top half at double height, then the bottom, then normal', async () => {
  const h = await boot()
  const body = () => h.term.gfx.slice(40 * 4, 40 * 5).filter(Boolean).length
  assert.equal(body(), 0, 'normal: row 4 is plain text')
  h.key('s'); h.advance(50)
  assert.ok(body() > 0, 'zoomed rows are drawn as stretched glyphs')
  h.key('s'); h.key('s'); h.advance(50)
  assert.equal(body(), 0)
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
  assert.ok(!h.find('Brisbane Lions win their third'), 'the text is damaged')
  assert.match(h.row(0), /^ P101 INTERVAL 101 Mon 28 Sep/, 'the header is not')
  assert.ok(h.crt.params.noise > 0.2, 'and the tube shows it')
  h.shutdown()
})

test('the page and colour mode survive a reload', async () => {
  const h = await boot()
  await h.go('310', 3500)
  h.key('c')
  const saved = JSON.parse(h.store.get('interval:state:v1'))
  h.shutdown()
  const h2 = await boot({ saved })
  assert.equal(h2.program.page, '310')
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

test('a SIGNAL station page tunes SIGNAL in, in a new tab', async () => {
  const h = await boot()
  await h.go('511', 3500)
  assert.ok(h.page().includes('CIPHER'))
  h.key('F1')
  assert.equal(h.opened.length, 1)
  assert.match(h.opened[0], /^https:\/\/hyphen8d\.github\.io\/signal\/\?station=cipher$/)
  h.shutdown()
})

test('overnight: N turns the rotation on, and it turns the pages', async () => {
  const h = await boot()
  h.key('n')
  assert.ok(h.program.overnight.on)
  await h.settle(3500)
  const first = h.program.page
  await h.settle(16000, 500)
  assert.notEqual(h.program.page, first)
  assert.match(h.row(24), /MUSIC\s+SIGNAL 1092\.0\s+SLOW ORBIT/, 'the strip names the station underneath')
  assert.ok(h.played.length >= 1, 'and SIGNAL is playing')
  await h.go('888', 3500)
  assert.ok(!h.program.overnight.on)
  h.key('4'); h.key('0'); h.key('0')
  assert.ok(!h.program.overnight.on, 'keying a page takes the set back')
  h.shutdown()
})

test('overnight starts by itself after midnight when the set is left alone', async () => {
  const h = await boot({ startAt: new Date(2026, 8, 29, 1, 0).getTime() })
  assert.ok(!h.program.overnight.on)
  await h.settle(11 * 60 * 1000, 5000)
  assert.ok(h.program.overnight.on)
  h.shutdown()
})

test('...and not in the evening', async () => {
  const h = await boot({ startAt: BASE_TIME })
  await h.settle(11 * 60 * 1000, 5000)
  assert.ok(!h.program.overnight.on)
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
  assert.ok(said.some(s => s.startsWith('Page 101, News headlines.') && s.includes('Brisbane Lions win their third premiership')))
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
