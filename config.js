// INTERVAL -- every tunable value for the tube. Same shape as SIGNAL's
// config.js, because the engine takes the same config; the numbers differ
// because this is a colour television showing text, not a monochrome
// terminal, and the stated ranges are what each was tuned within.

const V = globalThis.INTERVAL_BUILD ?? ''
const { PALETTE: TELETEXT } = await import(`./teletext.js?v=${V}`)

/** Touch-first device: the page shows the on-screen remote (index.html). The
 *  grid does NOT change with it. Teletext was forty columns on every set
 *  that ever showed it, so there is one layout here, where SIGNAL needs an
 *  80x25 desktop grid and a 42x22 one for phones. */
export const TOUCH =
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

/**
 * CRT parameters. Softer and rounder than SIGNAL's `sharp` preset: a
 * domestic colour set of the teletext years, with a shadow mask rather than a
 * fine grille, more curvature, and less bloom -- a solid blue masthead band
 * at SIGNAL's bloom would glow like a lamp.
 */
export const SCREEN = {
  decay: 0.62,
  beam: 0.62,
  sharpen: 0.7,
  scanMin: 0.42,
  scanMax: 0.7,
  threshold: 0.62,
  bloomAmt: 0.72,
  fill: 0.9,
  aspect: 4 / 3,
  curve: 0.028,
  glass: 0.02,
  vignette: 0.34,
  brightness: 1.12,
  bg: 0.035,
  ambient: 0.06,
  ambientFalloff: 2.2,
  maskAmt: 0.42,
  maskPitch: 3,
  chroma: 0.55,
  noise: 0.07,
  noiseStreak: 4,
  snow: 0.0012,
  flicker: 0.04,
  roll: 0.1,
  rollSpeed: 0.21,
}

/**
 * Tints. `colour` is white because the colour is in the framebuffer: a
 * colour tube's phosphors are mixed, not tinted. `bw` is P4, the bluish
 * white of a black-and-white set. `monitor` is SIGNAL's own P1 green -- a
 * green-screen monitor showing teletext, which is how a BBC Micro's Mode 7
 * looked on the monochrome monitor half the country's schools had.
 */
export const PHOSPHORS = {
  colour: [1.0, 1.0, 1.0],
  bw: [0.86, 0.92, 1.0],
  monitor: [0.18, 1.0, 0.36],
}
export const PHOSPHOR = 'colour'

/** The colour tube's palette (see teletext.js for why these values). */
export const PALETTE = TELETEXT

/** 40x25. The framebuffer is 372x410 in an 8x16 face and is stretched onto
 *  the 4:3 faceplate, which widens every character by about half: teletext's
 *  own proportions, as it happens. */
export const GRID = { cols: 40, rows: 25, padX: 6, padY: 5 }

/** Terminus BOLD as the regular face. Teletext's character generator drew
 *  strokes two dots wide; Terminus's regular weight, stretched half again
 *  across a 4:3 face, reads as a hairline. */
export const FONT = {
  regular: new URL('./fonts/ter-u16b.bdf', import.meta.url).href,
  bold: null,
  italic: null,
}

export const RENDER = {
  superSample: 2,
  pixelBudget: 2.6e6,
  blinkMs: 480,
  cursor: false,
}
