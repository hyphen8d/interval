// The markup notice pages are written in (markup.js).
import test from 'node:test'
import assert from 'node:assert/strict'
import { Page, BLACK, BLUE, YELLOW } from '../teletext.js'
import { drawLines, parseLine, lineWidth } from '../markup.js'

test('[bg=k] after [bg=b] puts the black back for the rest of the row', () => {
  const p = new Page()
  drawLines(p, ['[bg=b][y]TITLE[bg=k][w] after'], 4, 1)
  assert.equal(p.cells[4][1].bg, BLUE)
  assert.equal(p.cells[4][5].bg, BLUE)
  assert.equal(p.cells[4][6].bg, BLACK, 'the background changes where the tag is')
  assert.equal(p.cells[4][39].bg, BLACK, 'and runs to the end of the row')
  const q = new Page()
  drawLines(q, ['[bg=b]TITLE[bg=k]'], 4, 1)
  assert.equal(q.cells[4][6].bg, BLACK, 'a line that ends on the change keeps it')
  assert.equal(q.cells[4][5].bg, BLUE)
})

test('a background with no change draws as before', () => {
  const p = new Page()
  drawLines(p, ['[bg=b][y]ON BLUE'], 4, 1)
  assert.equal(p.cells[4][39].bg, BLUE)
  assert.equal(p.cells[4][0].bg, BLACK, 'from the column the line starts at')
  assert.equal(p.cells[4][1].fg, YELLOW)
  assert.equal(lineWidth('[bg=b]TITLE[bg=k]'), 5)
  assert.equal(parseLine('[y]plain').segments.length, 1)
})
