// INTERVAL -- where on the page a touch is, and what kind of touch it was.
// Pure, so it is testable.
//
// TOUCH ONLY (2026-09-28). The desktop set is driven from the keyboard and
// nothing else, as SIGNAL is: pointing at the picture with a mouse was built,
// then taken out, because driving it from the keys is most of what makes it
// feel like a machine rather than a web page. On a phone the finger IS the
// input, and SIGNAL's answer there is taps and swipes on the tube; this is
// INTERVAL's version of that.
//
// The tube is not a DOM element per character: it is one canvas, and the
// page is drawn into a framebuffer that the CRT's composite pass stretches
// onto a curved 4:3 face in the middle of it. So a click has to be run
// through the same geometry the shader uses (src/crt.js COMPOSITE: the face
// fitted to the narrow axis, scaled by `fill`, barrel-warped by `curve`) to
// land on the character the eye sees. Getting the warp wrong shows up at the
// corners, which is exactly where the fastext row is.

/**
 * @param {number} x, y   pointer position in CSS pixels within the canvas
 * @param {number} W, H   the canvas's CSS size
 * @param {object} params crt.params (fill, aspect, curve)
 * @param {object} term   { w, h, padX, padY, advance, font: { cellH }, cols, rows }
 * @returns {{ row: number, col: number } | null}  null off the page
 */
export function cellAt(x, y, W, H, params, term) {
  const aspect = params.aspect || 4 / 3
  const fill = params.fill ?? 0.9
  const k = params.curve ?? 0
  const s = Math.min(W / aspect, H)
  // The shader's p: centred, y up, in units of half the narrow axis.
  const px = (x - W / 2) / s * 2
  const py = (H / 2 - y) / s * 2
  const qx = px / (fill * aspect), qy = py / fill
  const r2 = qx * qx + qy * qy
  const scale = (1 + k * r2) / (1 + 2 * k)
  const u = 0.5 + 0.5 * qx * scale
  const v = 0.5 + 0.5 * qy * scale
  if (u < 0 || u > 1 || v < 0 || v > 1) return null
  // The framebuffer's row 0 is the top; the texture's v = 0 is the bottom.
  const fx = u * term.w, fy = (1 - v) * term.h
  const col = Math.floor((fx - term.padX) / term.advance)
  const row = Math.floor((fy - term.padY) / term.font.cellH)
  if (col < 0 || row < 0 || col >= term.cols || row >= term.rows) return null
  return { row, col }
}

/** Below this much movement a touch is a tap. */
export const TAP_SLOP_PX = 12
/** At least this far, mostly in one direction, is a swipe. */
export const SWIPE_MIN_PX = 40
/** A touch held longer than this and not moved is not a tap. */
export const TAP_MAX_MS = 600

/**
 * What a touch was, from how far it moved and how long it lasted:
 * 'tap', a swipe direction ('left' 'right' 'up' 'down', the way the finger
 * went), or null for anything ambiguous -- a diagonal smear, a long press.
 */
export function gesture(dx, dy, ms) {
  const ax = Math.abs(dx), ay = Math.abs(dy)
  if (ax < TAP_SLOP_PX && ay < TAP_SLOP_PX) return ms <= TAP_MAX_MS ? 'tap' : null
  if (Math.max(ax, ay) < SWIPE_MIN_PX) return null
  if (ax > ay * 1.5) return dx < 0 ? 'left' : 'right'
  if (ay > ax * 1.5) return dy < 0 ? 'up' : 'down'
  return null
}
