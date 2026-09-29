// INTERVAL -- the markup editorial pages are written in. Used by the pages
// that draw them, the page lint, and the admin dashboard's editor, so a line
// is measured the same way everywhere it is written or checked.
//
//   [y]Yellow text [w]then white         colour: k r g y b m c w
//   [bg=b]on a blue band to the line end  background from here on
//   [?]a hidden answer[/?]                concealed until REVEAL
//   [!]flashing[/!]                       flashing
//   [dh] at the very start of a line      double height: the line takes two rows
//
// Anything else in square brackets is text. A line's width is its length
// with the tags removed, and the lint holds that to 40.

import { fold, COLS, WHITE, BLACK } from './teletext.js'

const COLOUR_LETTERS = { k: 0, r: 1, g: 2, y: 3, b: 4, m: 5, c: 6, w: 7 }

/** Parse one line to { dh, segments: [{ text, fg, bg, con, flash }] }. */
export function parseLine(line, { fg = WHITE, bg = BLACK } = {}) {
  let s = String(line ?? '')
  let dh = false
  if (s.startsWith('[dh]')) { dh = true; s = s.slice(4) }
  const segments = []
  let cur = { text: '', fg, bg, con: false, flash: false }
  const push = () => { if (cur.text) segments.push(cur); cur = { ...cur, text: '' } }
  const re = /\[(\/?)(\?|!|bg=[krgybmcw]|[krgybmcw])\]/g
  let at = 0, m
  while ((m = re.exec(s))) {
    cur.text += s.slice(at, m.index)
    at = re.lastIndex
    push()
    const [, close, tag] = m
    if (tag === '?') cur.con = !close
    else if (tag === '!') cur.flash = !close
    else if (tag.startsWith('bg=')) cur.bg = COLOUR_LETTERS[tag[3]]
    else if (!close) cur.fg = COLOUR_LETTERS[tag]
  }
  cur.text += s.slice(at)
  push()
  for (const seg of segments) seg.text = fold(seg.text)
  return { dh, segments }
}

/** Visible width of a line: its text with the tags removed. */
export const lineWidth = (line) => parseLine(line).segments.reduce((n, s) => n + s.text.length, 0)

/** Rows a line takes on the page. */
export const lineRows = (line) => (parseLine(line).dh ? 2 : 1)

/**
 * Draw markup lines onto `page` from row `top`, at column `col`. A
 * background set with [bg=] runs to the end of the row, the way a teletext
 * "new background" code did. Returns the next free row.
 */
export function drawLines(page, lines, top, col = 1) {
  let r = top
  for (const line of lines) {
    const { dh, segments } = parseLine(line)
    let c = col
    for (const seg of segments) {
      if (seg.bg !== BLACK) { page.band(r, seg.bg, c, COLS); if (dh) page.band(r + 1, seg.bg, c, COLS) }
      if (dh) c = page.double(r, c, seg.text, seg.fg, seg.bg)
      else if (seg.con) c = page.concealed(r, c, seg.text, seg.fg, seg.bg)
      else if (seg.flash) c = page.flashing(r, c, seg.text, seg.fg, seg.bg)
      else c = page.text(r, c, seg.text, seg.fg, seg.bg)
    }
    r += dh ? 2 : 1
  }
  return r
}

/** Problems with a set of markup lines placed from `top` to `bottom`. */
export function lintLines(lines, { top = 4, bottom = 22, col = 1 } = {}) {
  const out = []
  let rows = 0
  lines.forEach((line, i) => {
    const w = lineWidth(line)
    if (col + w > COLS) out.push(`line ${i + 1} is ${w} wide; ${COLS - col} fit`)
    rows += lineRows(line)
  })
  if (top + rows - 1 > bottom) out.push(`${rows} rows of text; ${bottom - top + 1} fit`)
  return out
}
