import test from 'node:test'
import assert from 'node:assert/strict'
import {
  Page, fold, wrapText, clip, mosaicBitmap, doubleBitmap, cellColour, MONO_PALETTE, SPEC_PALETTE, luma,
  RED, BLUE, WHITE, YELLOW, BLACK,
} from '../teletext.js'

test('fold keeps ASCII, £ and °, and flattens the rest', () => {
  assert.equal(fold('Thaçi – “quoted” … ok'), 'Thaci - "quoted" ... ok')
  assert.equal(fold('£5 at 20°'), '£5 at 20°')
  assert.equal(fold('漢字'), '??')
})

test('wrapText breaks on words and hard-breaks a word too long for the line', () => {
  assert.deepEqual(wrapText('one two three four', 9), ['one two', 'three', 'four'])
  assert.deepEqual(wrapText('abcdefghijkl', 5), ['abcde', 'fghij', 'kl'])
})

test('clip ends on a word boundary when one is close', () => {
  assert.equal(clip('Kosovo Liberation Army', 18), 'Kosovo Liberation')
  assert.equal(clip('short', 10), 'short')
})

test('text written off the page is recorded, not silently lost', () => {
  const p = new Page()
  p.text(4, 35, 'too long for this row')
  assert.equal(p.issues.length, 1)
  const q = new Page()
  q.text(4, 35, 'fits ')
  assert.equal(q.issues.length, 0, 'trailing spaces past the edge are not an issue')
})

test('double height puts the same character in both rows and marks the halves', () => {
  const p = new Page()
  p.double(5, 2, 'HI', YELLOW, BLUE)
  assert.equal(p.cells[5][2].dh, 1)
  assert.equal(p.cells[6][2].dh, 2)
  assert.equal(p.cells[6][2].ch, 'H', 'the bottom row carries the character for its lower half')
  assert.equal(p.cells[6][3].bg, BLUE)
  assert.deepEqual(p.lines({ from: 5, to: 6 }), ['  HI', ''], 'read once, not twice')
})

test('concealed text is blank until revealed', () => {
  const p = new Page()
  p.text(4, 1, 'Q:')
  p.concealed(4, 4, 'ANSWER')
  assert.equal(p.lines({ from: 4, to: 4 })[0], ' Q:')
  assert.equal(p.lines({ reveal: true, from: 4, to: 4 })[0], ' Q: ANSWER')
})

test('speech reads a wrapped paragraph as one sentence and a column gap as a comma', () => {
  const p = new Page()
  p.text(4, 1, 'The Brisbane Lions win their')
  p.text(5, 1, 'third premiership in a row.')
  p.text(7, 1, 'NEWS'); p.text(7, 20, '101')
  assert.equal(p.speech(), 'The Brisbane Lions win their third premiership in a row. NEWS, 101')
})

test('art picks the commoner colour where two share a cell, as the format forces', () => {
  const p = new Page()
  p.art(4, 0, ['YY', 'YW', 'WW'], { Y: YELLOW, W: WHITE })
  assert.equal(p.cells[4][0].fg, YELLOW)
  assert.equal(p.cells[4][0].mos, 0b000111, 'top two and the mid-left block are the yellow ones')
})

test('mosaic bitmaps: a full block fills the cell, separated leaves gutters', () => {
  const full = mosaicBitmap(63)
  assert.equal(full.length, 16)
  assert.ok(full.every(r => r === 0xff))
  const sep = mosaicBitmap(63, true)
  assert.ok(sep.every(r => (r & 0b00010001) === 0), 'each block loses its rightmost column')
  assert.ok(sep.some(r => r === 0), 'and its bottom row')
  const topLeft = mosaicBitmap(1)
  assert.equal(topLeft[0], 0xf0, 'bit 0 is the top-left block: the high nibble is the left of the cell')
  assert.equal(topLeft[8], 0)
  assert.equal(mosaicBitmap(1), topLeft, 'cached by reference, so a re-put is a no-op in the grid')
})

test('doubleBitmap stretches each half of a glyph to a whole cell', () => {
  const glyph = Array.from({ length: 16 }, (_, i) => i)
  const top = doubleBitmap(glyph, 'top'), bottom = doubleBitmap(glyph, 'bottom')
  assert.deepEqual(top.slice(0, 4), [0, 0, 1, 1])
  assert.deepEqual(bottom.slice(0, 4), [8, 8, 9, 9])
  assert.equal(doubleBitmap(glyph, 'top'), top)
  assert.equal(doubleBitmap(null, 'top'), null)
})

test('cellColour packs foreground low, background high', () => {
  assert.equal(cellColour(RED, BLUE), 0x41)
  assert.equal(cellColour(WHITE, BLACK), 0x07)
})

test('the black-and-white palette is each broadcast colour at its own luma', () => {
  assert.equal(MONO_PALETTE.length, 8)
  MONO_PALETTE.forEach((c, i) => assert.equal(c[0], Math.round(luma(SPEC_PALETTE[i]) * 255)))
  assert.ok(MONO_PALETTE[BLUE][0] < 60, 'blue nearly vanishes on a black-and-white set, as it did')
})
