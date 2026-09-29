// Touching the screen (2026-09-28; touch only -- see pointer.js): the page
// numbers printed on a page and the coloured keys along the bottom are
// links. The geometry has to match the CRT's own, curve included, or a tap
// lands a row away at the corners -- which is where the fastext row is.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cellAt, gesture } from '../pointer.js'
import { boot } from './harness.mjs'
import { Page, RED, GREEN, BLACK, WHITE } from '../teletext.js'

const TERM = { w: 40 * 9 + 12, h: 25 * 16 + 10, padX: 6, padY: 5, advance: 9, font: { cellH: 16 }, cols: 40, rows: 25 }

/** Where the centre of a cell appears on screen: the shader's warp, run
 *  forwards. The warp is a radial scale, so q is found by fixed point. */
function screenOf(row, col, W, H, { fill, aspect, curve: k }) {
  const u = (TERM.padX + (col + 0.5) * TERM.advance) / TERM.w
  const v = 1 - (TERM.padY + (row + 0.5) * 16) / TERM.h
  const tx = (u - 0.5) * 2, ty = (v - 0.5) * 2
  let qx = tx, qy = ty
  for (let i = 0; i < 50; i++) {
    const scale = (1 + k * (qx * qx + qy * qy)) / (1 + 2 * k)
    qx = tx / scale; qy = ty / scale
  }
  const s = Math.min(W / aspect, H)
  return [W / 2 + qx * fill * aspect * s / 2, H / 2 - qy * fill * s / 2]
}

test('every cell is found where the tube draws it, flat and curved, in any window shape', () => {
  for (const params of [{ fill: 0.9, aspect: 4 / 3, curve: 0 }, { fill: 0.9, aspect: 4 / 3, curve: 0.028 }]) {
    for (const [W, H] of [[1200, 900], [1600, 700], [390, 310]]) {
      for (const [r, c] of [[0, 0], [12, 20], [24, 0], [24, 39], [1, 39], [24, 15]]) {
        const [x, y] = screenOf(r, c, W, H, params)
        assert.deepEqual(cellAt(x, y, W, H, params, TERM), { row: r, col: c }, `${r},${c} at ${W}x${H} curve ${params.curve}`)
      }
    }
  }
})

test('outside the face is nothing', () => {
  const p = { fill: 0.9, aspect: 4 / 3, curve: 0.028 }
  assert.equal(cellAt(2, 2, 1200, 900, p, TERM), null)
  assert.equal(cellAt(1500, 450, 1600, 900, p, TERM), null)
})

test('the fastext row is drawn as four keys, with a gap between each', () => {
  const p = new Page()
  p.fast([['News', '101'], ['Weather', '300'], null, ['Index', '100']])
  assert.equal(p.cells[24][0].bg, RED)
  assert.equal(p.cells[24][8].bg, RED)
  assert.equal(p.cells[24][9].bg, BLACK, 'the gap belongs to no key')
  assert.equal(p.cells[24][10].bg, GREEN)
  assert.equal(p.cells[24][22].bg, BLACK, 'a dead key leaves its slot empty')
  const news = p.cells[24].findIndex(x => x.ch === 'N')
  assert.equal(p.cells[24][news].fg, WHITE, 'white on red')
  // 'A' appears only in WEATHER on this row (NEWS has a W of its own).
  assert.equal(p.cells[24][p.cells[24].findIndex(x => x.ch === 'A')].fg, BLACK, 'dark on green')
  assert.deepEqual([0, 8, 9, 10, 25, 35].map(c => p.fastextAt(c)), [0, 0, null, 1, null, 3])
})

test('a printed page number is a link; a year or a measurement is not', () => {
  const p = new Page()
  p.text(4, 1, 'NEWS           101  QUAKES 400')
  p.text(5, 1, 'In 2026 a 4.5 quake, 1AF hidden')
  assert.equal(p.pageNumberAt(4, 16), '101')
  assert.equal(p.pageNumberAt(4, 18), '101')
  assert.equal(p.pageNumberAt(4, 19), '101', 'a thumb-width miss still counts')
  assert.equal(p.pageNumberAt(4, 8), null)
  assert.equal(p.pageNumberAt(5, 5), null, '2026 is a year')
  assert.equal(p.pageNumberAt(5, 11), null, '4.5 is a magnitude')
  assert.equal(p.pageNumberAt(5, 22), '1AF')
})

test('tapping a number on the index goes there; tapping a coloured key follows it', async () => {
  const h = await boot()
  await h.go('100', 3500)
  const row = h.program.truth.lines().findIndex(l => l.includes('HEADLINES'))
  const col = h.program.truth.lines()[row].indexOf('101')
  assert.equal(h.clickCell(row, col), 'page')
  await h.settle(3500)
  assert.equal(h.program.page, '101')
  assert.equal(h.clickCell(24, 36), 'fastext', 'Index, on cyan')
  await h.settle(3500)
  assert.equal(h.program.page, '100')
  assert.equal(h.clickCell(3, 5), null, 'blank space is not a link')
  h.shutdown()
})

test('a page that does not exist is not a link, and neither is the page you are on', async () => {
  const h = await boot()
  h.program.truth.text(21, 1, 'SEE 777 AND 190')
  assert.equal(h.program.linkAtCell(21, 5), null)
  assert.equal(h.program.linkAtCell(21, 13), null)
  h.shutdown()
})

test('a tap on a set in standby switches it on', async () => {
  const h = await boot({ power: false })
  assert.equal(h.program.click(600, 450, 1200, 900), 'power')
  assert.ok(h.program.power)
  h.shutdown()
})

test('the phone remote is told what the coloured keys do, page by page', async () => {
  const h = await boot()
  assert.deepEqual(h.fastextLabels.at(-1), ['INDEX', 'NEWS', 'HELP', 'PAUSE'])
  await h.go('302', 3500)
  assert.deepEqual(h.fastextLabels.at(-1), ['TODAY', '5-DAY', 'NEWS', 'INDEX'])
  h.key('n')
  assert.deepEqual(h.fastextLabels.at(-1), [null, null, null, null], 'cycling: the strip replaces the keys')
  h.shutdown()
})

test('the index tells a first-time viewer how in: keys on a desktop, taps on a phone', async () => {
  const h = await boot()
  await h.go('100', 3500)
  assert.ok(h.find('KEY A PAGE NUMBER'))
  assert.ok(h.find('N: LET THE SET CYCLE THE PAGES'))
  assert.ok(!h.text().includes('CLICK'), 'no mouse on the desktop set')
  h.shutdown()
})

test('a touch is a tap, a swipe, or nothing', () => {
  assert.equal(gesture(3, -4, 120), 'tap')
  assert.equal(gesture(3, 2, 900), null, 'a long press is not a tap')
  assert.equal(gesture(-80, 10, 200), 'left')
  assert.equal(gesture(90, -5, 200), 'right')
  assert.equal(gesture(4, -70, 200), 'up')
  assert.equal(gesture(-6, 60, 200), 'down')
  assert.equal(gesture(60, 55, 200), null, 'a diagonal smear')
  assert.equal(gesture(25, 0, 200), null, 'too short to be a swipe, too long to be a tap')
})

test('running text turns more slowly than a headline page', async () => {
  const { pageDef } = await import('../pages.js')
  const { SUBPAGE_MS } = await import('../carousel.js')
  assert.ok(pageDef('200').subpageMs > SUBPAGE_MS)
  const h = await boot()
  await h.go('200', 3500)
  assert.equal(h.program.subMs, 12000)
  h.shutdown()
})
