// Text grid -> 8-bit beam-intensity framebuffer.
//
// One byte per pixel: beam intensity, not colour. The phosphor tint is applied
// in the shader, so changing it needs no re-rasterisation.
//
// At 80x25 in an 8x16 face the framebuffer is 732x410: 80 cells of 9-dot advance
// plus 6px margins, 25 rows of 16 plus 5px margins.
//
// The cell planes are in ./cellgrid.js, which this extends.

import { CellGrid, NORMAL, BRIGHT, BOLD, DIM, ALT, ITALIC, MUTED, FAINT, BG, DEFAULT_COLOR } from './cellgrid.js'

// Attribute bits are defined in cellgrid.js; this file maps them to beam
// levels. Re-exported so one import covers both.
export {
  NORMAL, BRIGHT, BOLD, DIM, ALT, ITALIC, MUTED, FAINT, BG, ATTR_MASK,
  CellGrid, SCROLLBACK_MAX, DEFAULT_COLOR, color,
} from './cellgrid.js'

// Beam intensity per intensity bit, and the three tiers below both.
const LEVELS = [205, 255]
const DIM_LEVEL = 150
/** FAINT. Fills only. */
const FAINT_LEVEL = 100
/** MUTED, between DIM and NORMAL. Nothing else depends on it. */
const MUTED_LEVEL = 180
/**
 * Background level under a BG cell. Roughly a sixth of NORMAL.
 *
 * Far below FAINT (100): at that level the field competes with the NORMAL
 * strokes drawn on it, and matches the drop shadow the panel casts.
 */
const BG_LEVEL = 34

/**
 * Beam drive under a coloured background, in colour mode (see setPalette).
 * NORMAL's level rather than BG_LEVEL: a teletext background is a solid
 * colour field at full saturation, not the faint panel shading BG gives a
 * monochrome program.
 */
const BG_COLOR_LEVEL = 205

export class Term extends CellGrid {
  /**
   * padX/padY are unlit margin inside the framebuffer, keeping text off the edge
   * of the swept raster.
   *
   * @param {import('./bdf.js').BitmapFont} font
   */
  constructor(font, cols = 80, rows = 25, padX = 6, padY = 5) {
    super(font, cols, rows)
    this.padX = padX
    this.padY = padY

    /** The family's bold. Null makes BOLD a one-pixel smear instead. */
    this.bold = null

    /** The family's oblique. Null makes ITALIC draw the roman. */
    this.italic = null

    /**
     * A second face, for cells attributed ALT. Does not change the grid: cell
     * size, advance and framebuffer stay the main face's, and the glyph is
     * fitted into the cell left-aligned, vertically centred and clipped.
     */
    this.alt = null

    /** Where the cursor was last stamped ({x, y}), or null, so a partial
     *  raster() can un-stamp it. See raster(). */
    this._cursorStamp = null

    /**
     * Colour mode (2026-09-28, INTERVAL). Null is the monochrome engine: one
     * byte of beam intensity per pixel, the tint applied in the shader. Set
     * to an array of [r, g, b] (0..255) by setPalette() and the framebuffer
     * becomes RGBA, each cell drawn in its colour-plane entries (see
     * CellGrid.colors). The CRT must be built with `color: true` to match.
     */
    this.palette = null

    // Assigned by setFont.
    this.w = 0
    this.h = 0
    this.fb = new Uint8Array(0)
    this.setFont(font)
  }

  /** Drop the bold and oblique. Called by setFont: cuts belong to one family. */
  clearCuts() {
    this.bold = null
    this.italic = null
    this.dirty = true
  }

  /**
   * Swap the face. The grid is measured in cells, so the planes are untouched;
   * only the framebuffer changes size, so CRT.setSource must be called with the
   * new w/h.
   */
  setFont(font) {
    this.font = font
    // 9-dot advance for an 8-dot font, as in VGA text mode. The spare column
    // gives the bold smear somewhere to go; without it glyphs fuse.
    this.advance = font.cellW + 1
    this.w = this.cols * this.advance + this.padX * 2
    this.h = this.rows * font.cellH + this.padY * 2
    this.fb = new Uint8Array(this.w * this.h * this.channels)
    this.dirty = true
  }

  /** Bytes per framebuffer pixel: 1 for beam intensity, 4 for RGBA. */
  get channels() { return this.palette ? 4 : 1 }

  /**
   * Enter colour mode, or change palette within it. Index 0 is the colour a
   * cell's background takes when nothing is drawn there, and is expected to
   * be black. Swapping one palette for another of the same mode keeps the
   * framebuffer and re-rasterises; crossing between mono and colour
   * reallocates it, and the CRT would then need rebuilding, so a program
   * picks its mode once.
   *
   * @param {Array<number[]>|null} palette
   */
  setPalette(palette) {
    const wasColor = !!this.palette
    this.palette = palette ? palette.map(c => [c[0], c[1], c[2]]) : null
    if (wasColor !== !!this.palette) this.fb = new Uint8Array(this.w * this.h * this.channels)
    this.dirty = true
  }

  /**
   * Rasterise the dirty rows (2026-08-25 audit -- was the whole grid, ~300k
   * byte writes, on any change at all; see CellGrid.dirtyRows). ~12k byte
   * writes per row. Call only when dirty.
   *
   * @returns {Array<[number, number]>} framebuffer pixel-row bands [y0, y1)
   *   that were redrawn, merged where adjacent, for CRT.upload() to send
   *   just those. Empty if nothing was dirty.
   */
  raster() {
    const { cols, rows, font, fb, w, dirtyRows, palette } = this
    const { cellH, glyphs } = font
    const C = this.channels
    // Colour mode: per-cell drive for lit and unlit pixels, as RGB. Reused
    // across cells rather than allocated per cell.
    const fgc = [0, 0, 0], bgc = [0, 0, 0]

    // The cursor is an inversion stamped over the text after it is drawn.
    // When it moves or blinks, the row it was on has to be redrawn (to erase
    // the old stamp) and the row it is on now too; when it has not moved,
    // the stamp from last time is still in the framebuffer and only needs
    // re-applying if its row is being redrawn anyway.
    const wantStamp = this.showCursor && this.cursorVisible && !this.view
    const prev = this._cursorStamp
    const moved = wantStamp ? (!prev || prev.x !== this.cx || prev.y !== this.cy) : !!prev
    if (moved) {
      if (prev && prev.y < rows) dirtyRows[prev.y] = 1
      if (wantStamp && this.cy < rows) dirtyRows[this.cy] = 1
    }
    const restamp = wantStamp && this.cy < rows && dirtyRows[this.cy] === 1

    const bands = []
    for (let gy = 0; gy < rows; gy++) {
      if (!dirtyRows[gy]) continue
      const oy = this.padY + gy * cellH
      // Clear just this row's band of the framebuffer, then draw into it.
      // The padding rows above and below the grid are never written, so
      // they stay at the zero the buffer was allocated with.
      fb.fill(0, oy * w * C, (oy + cellH) * w * C)
      const last = bands[bands.length - 1]
      if (last && last[1] === oy) last[1] = oy + cellH
      else bands.push([oy, oy + cellH])

      // Scrolled back: rows above the live grid come from the history planes.
      // `back` is how far above the grid this row sits. view is clamped by
      // scrollView, so the index is in range.
      const back = this.view - gy
      const hc = back > 0 ? this.histChars[this.histChars.length - back] : null
      const ha = back > 0 ? this.histAttrs[this.histAttrs.length - back] : null
      const hi = back > 0 ? this.histInv[this.histInv.length - back] : null
      const base = (gy - this.view) * cols

      for (let gx = 0; gx < cols; gx++) {
        const i = base + gx
        const code = hc ? hc[gx] : this.chars[i]
        const attr = ha ? ha[gx] : this.attrs[i]
        // Per-cell bitmap, if any. Never for a scrollback row: the history
        // planes are text only.
        const pic = hc ? undefined : this.gfx[i]
        // Which table this cell draws from. Precedence: bitmap, ALT, italic,
        // bold, roman. Null means roman, and is also what an unloaded cut is,
        // so no caller checks whether a face has one.
        let face = pic ? null
          : (attr & ALT) ? this.alt
          : (attr & ITALIC) ? this.italic
          : (attr & BOLD) ? this.bold
          : null

        // Fallback is per glyph, not per face. A cut is drawn for text and is
        // usually missing the box and block ranges; those cells drop to the
        // roman, and the smear is reinstated below.
        let glyph = pic
        if (!glyph && face) {
          glyph = face.glyphs.get(code)
          if (!glyph) face = null
        }
        if (!glyph) glyph = glyphs.get(code)
        if (!glyph) glyph = glyphs.get(63)
        if (!glyph) continue

        // Lowest tier wins where several bits are set.
        const lvl = attr & FAINT ? FAINT_LEVEL
          : attr & DIM ? DIM_LEVEL
          : attr & MUTED ? MUTED_LEVEL
          : LEVELS[attr & BRIGHT]
        const inv = hi ? hi[gx] : this.inverse[i]
        // Background level. Zero unless BG is set.
        const gnd = attr & BG ? BG_LEVEL : 0
        // Colour mode. History rows carry no colours (see CellGrid.scroll)
        // and draw in the default pair.
        let paint = !!gnd
        if (palette) {
          const cv = hc ? DEFAULT_COLOR : this.colors[i]
          const f = palette[cv & 15] || palette[7] || [255, 255, 255]
          const bi = cv >> 4
          const b = palette[bi] || palette[0] || [0, 0, 0]
          for (let k = 0; k < 3; k++) {
            fgc[k] = (f[k] * lvl / 255) | 0
            // A black background leaves the field unlit, as mono does; a
            // coloured one is a solid field. BG on black keeps its mono
            // meaning, in the foreground's colour.
            bgc[k] = bi ? (b[k] * BG_COLOR_LEVEL / 255) | 0 : (f[k] * gnd / 255) | 0
          }
          paint = bi !== 0 || !!gnd
        }
        const adv = this.advance
        const ox = this.padX + gx * adv
        // Whether to extend the glyph's rightmost pixel across the advance gap.
        // VGA did this for its line-graphics range so rules and fills joined
        // across cells; U+2500..259F covers box drawing, blocks and shades.
        // Bitmaps need it too, or every ninth column of an image is unlit.
        //
        // Shades keep their pattern: the test below only fires where the glyph's
        // own rightmost pixel is lit.
        const joinCol = !!pic || (code >= 0x2500 && code <= 0x259f)

        // Fit a foreign face into this cell: left-aligned, vertically centred
        // (a BitmapFont has no baseline), clipped in both directions. For a cut
        // of the same family this is the identity.
        const shift = face ? adv - face.cellW : 1
        const dy = face ? (cellH - face.cellH) >> 1 : 0
        // Smear only when the bold is synthetic.
        const smear = (attr & BOLD) && !(face && face === this.bold)

        for (let y = 0; y < cellH; y++) {
          // Zero, not skip, where a foreign face is shorter than the cell:
          // unpainted rows leave gaps in an inverse bar.
          const row = (face ? glyph[y - dy] : glyph[y]) ?? 0
          // Widen to the cell: bit (adv-1) is the leftmost pixel.
          let bits = shift >= 0 ? row << shift : row >>> -shift
          // Fill all `shift` columns, not one: the gap is wider for a narrow
          // foreign face, and a partial fill dashes every rule.
          if (joinCol && shift > 0 && (row & 1)) bits |= (1 << shift) - 1
          // Synthetic bold: smear one pixel right.
          if (smear) bits |= bits >>> 1
          // A background level counts as something to draw; without it the
          // blank rows of a panel are skipped and the fill comes out striped.
          if (!bits && !inv && !paint) continue
          let p = (oy + y) * w + ox
          if (C === 1) {
            for (let x = 0; x < adv; x++, p++) {
              const on = (bits >>> (adv - 1 - x)) & 1
              fb[p] = (inv ? !on : on) ? lvl : gnd
            }
          } else {
            for (let x = 0; x < adv; x++, p++) {
              const on = (bits >>> (adv - 1 - x)) & 1
              const src = (inv ? !on : on) ? fgc : bgc
              const q = p * 4
              fb[q] = src[0]; fb[q + 1] = src[1]; fb[q + 2] = src[2]; fb[q + 3] = 255
            }
          }
        }
      }
    }

    // No cursor while scrolled back (wantStamp is false then).
    if (restamp) this.stampCursor()
    this._cursorStamp = wantStamp ? { x: this.cx, y: this.cy } : null
    this.clearDirty()
    return bands
  }

  stampCursor() {
    const { font, fb, w } = this
    const ox = this.padX + this.cx * this.advance
    const oy = this.padY + this.cy * font.cellH
    if (this.cx >= this.cols || this.cy >= this.rows) return
    const C = this.channels
    for (let y = 2; y < font.cellH - 2; y++) {
      let p = (oy + y) * w + ox
      for (let x = 0; x < this.advance; x++, p++) {
        for (let k = 0; k < Math.min(C, 3); k++) fb[p * C + k] = 255 - fb[p * C + k]
      }
    }
  }
}
