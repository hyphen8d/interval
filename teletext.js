// INTERVAL -- the teletext page model. Pure: no DOM, no engine, no clock, so
// Node can build every page the set can show and test it.
//
// A page is 40x25 cells. Row 0 is the header the SET writes (page number,
// service name, clock) -- a page never draws there. Rows 1-23 are the page,
// row 24 is the fastext row. That split is the real one: the broadcaster
// sent rows 1-24 and the receiver generated the header's clock itself.
//
// Each cell carries what a teletext decoder resolved its control codes to:
// a character or a 2x3 block-graphic ("mosaic"), a foreground and background
// out of eight colours, and three flags -- double height, concealed (the
// REVEAL key), and separated graphics. Real teletext spent a cell on every
// control code (a "spacing attribute"), which is why colour changes on real
// pages always cost a blank column. This model does NOT reproduce that: a
// composer can change colour between adjacent characters. It is the one
// liberty taken with the format, taken because the constraint shows up as
// nothing but awkward spacing in a model, and the pages here are laid out
// by hand with those gaps already in them where they look right.

export const COLS = 40
export const ROWS = 25
export const BODY_TOP = 1
export const BODY_BOTTOM = 23
export const FASTEXT_ROW = 24

export const BLACK = 0, RED = 1, GREEN = 2, YELLOW = 3, BLUE = 4, MAGENTA = 5, CYAN = 6, WHITE = 7
export const COLOUR_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
/** The four fastext keys, in remote-control order. */
export const FASTEXT_COLOURS = [RED, GREEN, YELLOW, CYAN]
/** Each key is a cap this many cells wide, in a slot of ten. */
export const FASTEXT_CAP = 9
export const FASTEXT_SLOT = 10

/**
 * The eight teletext colours as the colour tube draws them. Not the pure
 * #FF0000-style primaries of the spec: those clip hard through the CRT's
 * bloom, and blue in particular comes out as a dark smear on a phosphor
 * that renders it at full drive. Nudged until each reads as its name on the
 * tube, which is the only place they are ever seen.
 */
export const PALETTE = [
  [0, 0, 0],
  [255, 46, 38],
  [46, 232, 66],
  [255, 236, 52],
  [60, 86, 255],
  [255, 56, 222],
  [48, 236, 255],
  [246, 246, 246],
]

/** Rec. 601 luma of a palette entry, 0..1. What a black-and-white set showed. */
export const luma = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255

/**
 * The same eight colours on a black-and-white set: each colour at its luma,
 * as grey. The CRT tints the result with the monochrome phosphor. Blue text
 * on black comes out at about 11% -- barely there -- and that is not a bug:
 * it is exactly what teletext looked like on a black-and-white portable, and
 * why broadcasters' style guides warned against blue on black.
 */
/** The spec's primaries: what the broadcast signal actually carried, and so
 *  what a black-and-white set turned into grey. The colour palette above is
 *  nudged for the tube; the greys come from these, or blue would read at
 *  38% instead of the 11% it really did. */
export const SPEC_PALETTE = [
  [0, 0, 0], [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
]

export const MONO_PALETTE = SPEC_PALETTE.map(c => {
  const l = Math.round(luma(c) * 255)
  return [l, l, l]
})

const blankCell = () => ({ ch: ' ', fg: WHITE, bg: BLACK, dh: 0, mos: -1, sep: false, con: false, flash: false })

// Characters the font carries but a teletext page should never show, folded
// to what a 1980s character generator would have had. NFKD then strip marks
// covers the accented Latin a Wikipedia headline is full of.
const FOLD = new Map([
  ['‘', "'"], ['’', "'"], ['“', '"'], ['”', '"'],
  ['–', '-'], ['—', '-'], ['−', '-'], ['…', '...'],
  [' ', ' '], [' ', ' '], ['​', ''], ['×', 'x'],
  ['′', "'"], ['″', '"'], ['·', '.'], ['•', '*'],
])
/** Fold a string to what the page can carry. Keeps £ and °, which Terminus
 *  has and teletext pages used. */
export function fold(text) {
  let out = ''
  for (const ch of String(text ?? '')) {
    if (FOLD.has(ch)) { out += FOLD.get(ch); continue }
    const code = ch.codePointAt(0)
    // ▲ and ▼ are the money pages' arrows; Terminus has both.
    if (code < 0x80 || ch === '£' || ch === '°' || ch === '▲' || ch === '▼') { out += ch; continue }
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    out += /^[\x20-\x7e]+$/.test(base) ? base : '?'
  }
  return out
}

/** Word-wrap to `width`. A word longer than the line is broken hard, with no
 *  hyphen -- teletext pages did not hyphenate. */
export function wrapText(text, width) {
  const words = fold(text).split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (let w of words) {
    while (w.length > width) {
      if (line) { lines.push(line); line = '' }
      lines.push(w.slice(0, width))
      w = w.slice(width)
    }
    if (!line) line = w
    else if (line.length + 1 + w.length <= width) line += ' ' + w
    else { lines.push(line); line = w }
  }
  if (line) lines.push(line)
  return lines
}

/** Trim to `width`, ending on a word boundary where there is one close by. */
export function clip(text, width) {
  const t = fold(text)
  if (t.length <= width) return t
  const cut = t.slice(0, width)
  const sp = cut.lastIndexOf(' ')
  return (sp > width * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')
}

export class Page {
  constructor() {
    this.cells = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, blankCell))
    /** [label, target] per fastext key, in FASTEXT_COLOURS order. */
    this.fastext = []
    /** Anything written off the page: the lint reports these. */
    this.issues = []
  }

  cell(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS ? this.cells[r][c] : null
  }

  _off(r, c, what) {
    this.issues.push(`${what} off the page at row ${r}, col ${c}`)
  }

  /** Write text. `bg` undefined leaves each cell's background alone, which is
   *  how text goes onto a band drawn first. Returns the column after. */
  text(r, c, s, fg = WHITE, bg) {
    let i = 0
    for (const ch of fold(s)) {
      const x = this.cell(r, c + i)
      if (!x) { if (ch !== ' ') this._off(r, c + i, `"${fold(s).slice(i, i + 12)}"`); break }
      Object.assign(x, { ch, fg, mos: -1, dh: 0, con: false, flash: false })
      if (bg !== undefined) x.bg = bg
      i++
    }
    return c + i
  }

  /** Paint a run of background. */
  band(r, bg, c0 = 0, c1 = COLS) {
    for (let c = c0; c < c1; c++) { const x = this.cell(r, c); if (x) x.bg = bg }
  }

  /** Double-height text across rows r and r+1. */
  double(r, c, s, fg = WHITE, bg) {
    const t = fold(s)
    this.text(r, c, t, fg, bg)
    for (let i = 0; i < t.length; i++) {
      const top = this.cell(r, c + i), bot = this.cell(r + 1, c + i)
      if (!top) continue
      top.dh = 1
      if (bot) Object.assign(bot, { ch: top.ch, fg, mos: -1, dh: 2, con: false, flash: false, bg: bg ?? bot.bg })
    }
    return c + t.length
  }

  /** Concealed text: drawn only while REVEAL is on. */
  concealed(r, c, s, fg = WHITE, bg) {
    const end = this.text(r, c, s, fg, bg)
    for (let x = c; x < end; x++) { const cl = this.cell(r, x); if (cl) cl.con = true }
    return end
  }

  flashing(r, c, s, fg = WHITE, bg) {
    const end = this.text(r, c, s, fg, bg)
    for (let x = c; x < end; x++) { const cl = this.cell(r, x); if (cl) cl.flash = true }
    return end
  }

  /** One mosaic cell. `bits`: bit0 top-left, bit1 top-right, bit2 mid-left,
   *  bit3 mid-right, bit4 bottom-left, bit5 bottom-right. */
  mosaic(r, c, bits, fg = WHITE, bg, sep = false) {
    const x = this.cell(r, c)
    if (!x) { this._off(r, c, 'mosaic'); return }
    Object.assign(x, { ch: ' ', fg, mos: bits & 63, sep, dh: 0, con: false, flash: false })
    if (bg !== undefined) x.bg = bg
  }

  /** Word-wrapped text from row r. Returns the next free row. Refuses to run
   *  past `lastRow` and records that as an issue, because a paragraph that
   *  silently loses its last line reads as finished. */
  wrap(r, c, text, width = COLS - c, fg = WHITE, lastRow = BODY_BOTTOM - 1) {
    const lines = wrapText(text, width)
    lines.forEach((l, i) => {
      if (r + i > lastRow) { if (i === lines.length - 1 || r + i === lastRow + 1) this._off(r + i, c, `wrapped text "${l.slice(0, 12)}"`); return }
      this.text(r + i, c, l, fg)
    })
    return Math.min(r + lines.length, lastRow + 1)
  }

  /**
   * Block graphics from a pixel map: `lines` are strings, two pixels per
   * column and three per row; `pal` maps a pixel character to a colour. A
   * cell can hold one foreground colour, so where pixels of two colours share
   * a cell the commoner wins -- the real limit of the format, and the reason
   * teletext art has the look it has. `bgFor(row)` paints the background.
   */
  art(r0, c0, lines, pal, bgFor, sep = false) {
    const rows = Math.ceil(lines.length / 3)
    const cols = Math.ceil(Math.max(0, ...lines.map(l => l.length)) / 2)
    for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
      const counts = new Map()
      for (let py = 0; py < 3; py++) for (let px = 0; px < 2; px++) {
        const ch = (lines[rr * 3 + py] || '')[cc * 2 + px]
        if (ch && pal[ch] !== undefined) counts.set(ch, (counts.get(ch) || 0) + 1)
      }
      const bg = bgFor ? bgFor(r0 + rr, c0 + cc) : undefined
      if (!counts.size) { if (bg !== undefined) this.band(r0 + rr, bg, c0 + cc, c0 + cc + 1); continue }
      const pick = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      let bits = 0
      for (let py = 0; py < 3; py++) for (let px = 0; px < 2; px++) {
        if ((lines[rr * 3 + py] || '')[cc * 2 + px] === pick) bits |= 1 << (py * 2 + px)
      }
      this.mosaic(r0 + rr, c0 + cc, bits, pal[pick], bg, sep)
    }
  }

  /** A horizontal bar of mosaic blocks `halves` half-cells long. */
  bar(r, c, halves, fg, bg) {
    for (let h = 0; h < halves; h += 2) this.mosaic(r, c + h / 2, halves - h >= 2 ? 63 : 21, fg, bg)
  }

  /**
   * The fastext row: up to four [label, target] pairs, drawn as KEYS -- a
   * nine-cell cap in the key's colour with the label centred on it, and a
   * one-cell gap before the next. A null entry leaves that key dead and its
   * slot blank.
   *
   * 2026-09-28 -- real teletext drew these as plain coloured words, and it
   * worked because the viewer held a remote with four coloured buttons on
   * it; the word matched a button in their hand. On a keyboard nothing
   * matches, and plain coloured words read as more text: the first review of
   * the set said nobody would know the row could be used. A filled cap is the
   * button itself, which is the thing the row stands for. Dark text on
   * green, yellow and cyan; white on red, where black loses to it.
   */
  fast(entries) {
    this.fastext = entries.slice(0, 4)
    this.fastext.forEach((e, i) => {
      if (!e) return
      const col = FASTEXT_COLOURS[i], x0 = i * FASTEXT_SLOT
      // One word, capitals, eight letters at most, centred on a nine-cell
      // cap (2026-09-28): mixed-case two-word labels ("This day", "Locate
      // me") sat off-centre and read as leftovers. The lint holds the rule;
      // this only makes sure a stray lower-case label still draws right.
      const label = clip(String(e[0]).toUpperCase(), FASTEXT_CAP - 1)
      this.band(FASTEXT_ROW, col, x0, x0 + FASTEXT_CAP)
      this.text(FASTEXT_ROW, x0 + Math.floor((FASTEXT_CAP - label.length) / 2), label, col === RED ? WHITE : BLACK)
    })
  }

  /** Which fastext key, if any, column `c` of the bottom row is on. The gap
   *  between caps belongs to no key. */
  fastextAt(c) {
    const i = Math.floor(c / FASTEXT_SLOT)
    if (i < 0 || i > 3 || c - i * FASTEXT_SLOT >= FASTEXT_CAP) return null
    return this.fastext[i] ? i : null
  }

  /** The page number printed at row r, column c, if one is: a magazine digit
   *  and two hex digits standing alone (not part of "2026" or "4.5"). What a
   *  click on the screen follows. A near miss by one column still counts,
   *  since a thumb is wider than a character. */
  pageNumberAt(r, c) {
    const row = this.cells[r]
    if (!row) return null
    const text = row.map(x => (x.mos >= 0 || x.dh === 2 ? ' ' : x.ch)).join('')
    for (const m of text.matchAll(/(?<![\w.])[1-8][0-9A-F]{2}(?![\w.])/g)) {
      if (c >= m.index - 1 && c <= m.index + 3) return m[0]
    }
    return null
  }

  /** The page as plain text, one string per row: what the screen reader is
   *  given and what tests read. Concealed text is blank unless `reveal`. */
  lines({ reveal = false, from = 0, to = ROWS - 1 } = {}) {
    const out = []
    for (let r = from; r <= to; r++) {
      out.push(this.cells[r].map(x => {
        if (x.dh === 2 || x.mos >= 0) return ' '
        if (x.con && !reveal) return ' '
        return x.ch
      }).join('').replace(/\s+$/, ''))
    }
    return out
  }

  /** Readable text for the screen reader. A wrapped paragraph is one
   *  sentence, not one sentence per row (joining rows with full stops read
   *  "the. Brisbane Lions"); a blank row ends a paragraph; a run of spaces
   *  inside a row is a column gap and reads as a comma. */
  speech({ reveal = false } = {}) {
    const paras = []
    let cur = []
    for (const l of this.lines({ reveal, from: BODY_TOP, to: BODY_BOTTOM })) {
      const t = l.replace(/\s{2,}/g, ', ').trim()
      if (t) { cur.push(t); continue }
      if (cur.length) { paras.push(cur.join(' ')); cur = [] }
    }
    if (cur.length) paras.push(cur.join(' '))
    return paras.join('. ').replace(/([.!?])\./g, '$1')
  }

  clone() {
    const p = new Page()
    p.cells = this.cells.map(row => row.map(x => ({ ...x })))
    p.fastext = this.fastext.slice()
    p.issues = this.issues.slice()
    return p
  }
}

/** A pixel map for Page.art(), from a function of (x, y) returning a pixel
 *  character or null. */
export function pixels(w, h, fn) {
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y) || '.').join(''))
}

/** A deterministic 0..1 hash of two integers, for art that must look random
 *  and be the same every time it is drawn. */
export function hash2(x, y) {
  let n = (x * 374761393 + y * 668265263) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

// ---------------------------------------------------------------------------
// Glyphs for the engine. The cell is the font's (8x16 for Terminus); these
// build the per-cell bitmaps CellGrid.putGlyph() takes, one word per row, bit
// (cellW-1) leftmost. Cached and returned by reference: putGlyph() treats a
// re-put of the same reference as a no-op, which is what keeps a static page
// from re-rasterising every frame.
// ---------------------------------------------------------------------------

const mosaicCache = new Map()
/**
 * The bitmap for a mosaic cell. Columns split 4|4 (the rasteriser extends a
 * bitmap's rightmost lit pixel across the advance gap, so the right half
 * draws 5 wide and meets the next cell). Rows split 5|6|5 of 16.
 * Separated graphics drop the last column and row of each block, which is
 * the whole of what "separated" meant.
 */
export function mosaicBitmap(bits, sep = false, cellW = 8, cellH = 16) {
  const key = `${bits}:${sep ? 1 : 0}:${cellW}x${cellH}`
  let bm = mosaicCache.get(key)
  if (bm) return bm
  const half = cellW >> 1
  const b0 = Math.round(cellH * 5 / 16), b1 = cellH - Math.round(cellH * 5 / 16)
  const bands = [[0, b0], [b0, b1], [b1, cellH]]
  // Bit (cellW-1) is the leftmost pixel, so a block's RIGHTMOST column is its
  // lowest bit -- the one separated graphics leave dark.
  const colMask = (right) => {
    const lo = right ? 0 : half, hi = right ? half : cellW
    let m = 0
    for (let b = lo + (sep ? 1 : 0); b < hi; b++) m |= 1 << b
    return m
  }
  const L = colMask(false), R = colMask(true)
  bm = new Array(cellH).fill(0)
  for (let band = 0; band < 3; band++) {
    const [y0, y1] = bands[band]
    for (let y = y0; y < y1 - (sep ? 1 : 0); y++) {
      if (bits & (1 << (band * 2))) bm[y] |= L
      if (bits & (1 << (band * 2 + 1))) bm[y] |= R
    }
  }
  mosaicCache.set(key, bm)
  return bm
}

const doubleCache = new WeakMap()
/**
 * The top or bottom half of a glyph stretched to a whole cell: each of the
 * glyph's rows drawn twice. `glyph` is the font's row array for the
 * character (BitmapFont.glyphs.get(code)); missing glyphs return null.
 */
export function doubleBitmap(glyph, half) {
  if (!glyph) return null
  let pair = doubleCache.get(glyph)
  if (!pair) {
    const h = glyph.length, mid = h >> 1
    const stretch = (from) => Array.from({ length: h }, (_, y) => glyph[from + (y >> 1)] ?? 0)
    pair = { top: stretch(0), bottom: stretch(mid) }
    doubleCache.set(glyph, pair)
  }
  return half === 'bottom' ? pair.bottom : pair.top
}

/** Pack a cell's colours for the engine's colour plane (low nibble fg). */
export const cellColour = (fg, bg) => (fg & 15) | ((bg & 15) << 4)
