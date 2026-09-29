import test from 'node:test'
import assert from 'node:assert/strict'
import {
  nextTransmission, pageSlot, subpageAt, validPage, rollingNumber, receive, errorRate,
  MAG_PERIOD_MS, MIN_WAIT_MS,
} from '../carousel.js'
import { Page } from '../teletext.js'

test('a page arrives within one loop, and never before the header has been seen to roll', () => {
  for (const num of ['100', '101', '302', '1AF', '888']) {
    for (const now of [0, 1234, 99999]) {
      const at = nextTransmission(num, now)
      assert.ok(at >= now + MIN_WAIT_MS, `${num} at ${now}: not before the minimum wait`)
      assert.ok(at < now + MIN_WAIT_MS + MAG_PERIOD_MS, `${num} at ${now}: within one pass`)
    }
  }
})

test('the wait depends on where the loop is, not on a dice roll at the keypress', () => {
  const a = nextTransmission('300', 5000)
  assert.equal(nextTransmission('300', 5000), a, 'deterministic')
  assert.equal(nextTransmission('300', 5000 + MAG_PERIOD_MS), a + MAG_PERIOD_MS, 'periodic')
  const waits = ['100', '101', '102', '103', '104', '150', '199'].map(n => nextTransmission(n, 0))
  assert.ok(new Set(waits).size > 3, 'neighbouring pages sit at different points in the loop')
})

test('page slots are stable fractions of the loop', () => {
  const s = pageSlot('101')
  assert.ok(s >= 0 && s < 1)
  assert.equal(pageSlot('101'), s)
  assert.equal(pageSlot('1af'), pageSlot('1AF'))
})

test('subpages turn on the broadcaster clock', () => {
  assert.equal(subpageAt(1, 1e6), 0)
  assert.equal(subpageAt(3, 0, 1000), 0)
  assert.equal(subpageAt(3, 1500, 1000), 1)
  assert.equal(subpageAt(3, 3500, 1000), 0)
})

test('valid page numbers: magazine 1-8, then two hex digits', () => {
  for (const ok of ['100', '1AF', '8FF', '1ff']) assert.ok(validPage(ok), ok)
  for (const bad of ['000', '900', '10', '1000', '1G0', '']) assert.ok(!validPage(bad), bad)
})

test('the rolling header counts through the right magazine', () => {
  assert.match(rollingNumber('3', 12345), /^3\d\d$/)
  assert.notEqual(rollingNumber('3', 0), rollingNumber('3', 400))
})

function pageWith(text) {
  const p = new Page()
  for (let r = 1; r < 24; r++) p.text(r, 0, text)
  return p
}

test('perfect reception copies the page exactly', () => {
  const truth = pageWith('THE QUICK BROWN FOX JUMPS OVER THE DOG')
  const shown = receive(truth, new Page(), 1, Math.random, true)
  assert.deepEqual(shown.lines(), truth.lines())
})

test('poor reception garbles the text and never row 0, and passes repair it', () => {
  const truth = pageWith('THE QUICK BROWN FOX JUMPS OVER THE DOG')
  truth.text(0, 0, 'HEADER ROW BELONGS TO THE SET')
  const shown = new Page()
  shown.text(0, 0, 'HEADER ROW BELONGS TO THE SET')
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  receive(truth, shown, 0.3, rand, true)
  // Cell by cell: comparing trimmed lines would misalign on one bad trailing
  // character and count everything after it as wrong.
  const wrong = () => {
    let n = 0
    for (let r = 1; r < 24; r++) for (let c = 0; c < 40; c++) if (shown.cells[r][c].ch !== truth.cells[r][c].ch) n++
    return n
  }
  const first = wrong()
  assert.ok(first > 50, `a weak signal mangles the page (${first} wrong)`)
  assert.equal(shown.lines()[0], truth.lines()[0], 'the header is Hamming-coded and never garbles')
  for (let i = 0; i < 12; i++) receive(truth, shown, 0.3, rand, false)
  assert.ok(wrong() < first / 2, 'each pass through the loop repairs some of it')
})

test('error rate is zero on a perfect signal and rises as it fails', () => {
  assert.equal(errorRate(1), 0)
  assert.ok(errorRate(0.9) < 0.01, 'a good signal is nearly clean')
  assert.ok(errorRate(0.3) > errorRate(0.6))
})
