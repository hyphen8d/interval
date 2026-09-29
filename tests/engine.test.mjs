// The one change INTERVAL made to the vendored engine: a colour plane. The
// monochrome engine must be untouched by it, and the colour one must put the
// right colour in the right pixel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseBDF } from '../src/bdf.js'
import { Term, NORMAL, BG, DEFAULT_COLOR, color } from '../src/term.js'

const font = parseBDF(readFileSync(new URL('../fonts/ter-u16b.bdf', import.meta.url), 'utf8'))
// The engine draws a block cursor unless told not to; screen.js turns it off
// every frame from RENDER.cursor, and a bare Term here must do the same or
// the cursor inverts cell 0 under every assertion.
function term(cols, rows) { const t = new Term(font, cols, rows); t.showCursor = false; return t }
const PAL = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255]]

test('without a palette the framebuffer is one byte of beam per pixel, as before', () => {
  const t = term(4, 2)
  assert.equal(t.channels, 1)
  assert.equal(t.fb.length, t.w * t.h)
  t.put(0, 0, 'A')
  t.raster()
  assert.ok(t.fb.some(v => v === 205), 'a NORMAL stroke at the NORMAL level')
})

test('a palette makes it RGBA, strokes in the foreground and the field in the background', () => {
  const t = term(4, 2)
  t.setPalette(PAL)
  assert.equal(t.channels, 4)
  assert.equal(t.fb.length, t.w * t.h * 4)
  t.put(0, 0, 'A', NORMAL, 0, color(3, 4))   // yellow on blue
  t.raster()
  const px = (x, y) => Array.from(t.fb.slice((y * t.w + x) * 4, (y * t.w + x) * 4 + 3))
  const cell = []
  for (let y = t.padY; y < t.padY + 16; y++) for (let x = t.padX; x < t.padX + 9; x++) cell.push(px(x, y).join(','))
  const kinds = new Set(cell)
  assert.ok(kinds.has('205,205,0'), 'yellow strokes at NORMAL drive')
  assert.ok(kinds.has('0,0,205'), 'a solid blue field')
  assert.equal(kinds.size, 2)
  assert.deepEqual(px(0, 0), [0, 0, 0], 'the margin stays black')
})

test('a black background leaves the field unlit, and BG keeps its mono meaning', () => {
  const t = term(2, 1)
  t.setPalette(PAL)
  t.put(0, 0, ' ', NORMAL, 0, color(2, 0))
  t.put(1, 0, ' ', BG, 0, color(2, 0))
  t.raster()
  const at = (x) => Array.from(t.fb.slice(((t.padY + 8) * t.w + x) * 4, ((t.padY + 8) * t.w + x) * 4 + 3))
  assert.deepEqual(at(t.padX + 2), [0, 0, 0])
  assert.deepEqual(at(t.padX + 9 + 2), [0, 34, 0], 'BG on black: the faint panel level, in the foreground colour')
})

test('colour is part of the no-op check: same cell, new colour, redraws', () => {
  const t = term(2, 1)
  t.setPalette(PAL)
  t.put(0, 0, 'X', NORMAL, 0, DEFAULT_COLOR)
  t.raster()
  t.put(0, 0, 'X', NORMAL, 0, DEFAULT_COLOR)
  assert.equal(t.dirty, false, 'identical put is free')
  t.put(0, 0, 'X', NORMAL, 0, color(1))
  assert.equal(t.dirty, true)
})

test('swapping palettes within colour mode keeps the framebuffer', () => {
  const t = term(2, 1)
  t.setPalette(PAL)
  const fb = t.fb
  t.setPalette(PAL.map(([r, g, b]) => { const l = Math.round((r + g + b) / 3); return [l, l, l] }))
  assert.equal(t.fb, fb)
  assert.equal(t.dirty, true)
})
