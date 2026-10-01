// INTERVAL -- the moving pictures: the switch-on ident, the clock's digits,
// the candle, the aquarium, the living gallery. Pure functions of time
// (milliseconds), each returning pixel maps for Page.art() -- so a picture is
// testable (draw it at two times, compare), and a page that uses one only has
// to declare liveMs to move (pages.js).
//
// 2026-09-28: the breathing page was the one thing a viewer called out as
// fun, and every page with blank space around it was asking for the same
// treatment. The rule these keep: they MOVE SLOWLY. This is a set left on in
// a room; a picture that flickers for attention is a screensaver, not a page.
//
// A mosaic "pixel" is half a character cell wide and a third of one tall.
// On the tube that is about 1.24 times as wide as it is high, which is why
// anything round here scales its x distances by 1.24 (see pages.js 500).

const V = globalThis.INTERVAL_BUILD ?? ''
const { pixels, hash2 } = await import(`./teletext.js?v=${V}`)

/** An integer hash of three numbers, 0..1: for flicker that is random
 *  but the same at the same moment, so a test can pin it. */
export const hash3 = (a, b, c) => hash2(a * 7919 + c, b * 104729 + c * 31)

// ---------------------------------------------------------------------------
// The ident: INTERVAL in a 5x7 block face, one colour a letter.
// ---------------------------------------------------------------------------

export const FONT5x7 = {
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
}
/** Letter colours, as pixel characters Page.art() maps: the rainbow of the
 *  teletext palette, minus blue (too dark on black) and white. */
export const IDENT_INKS = ['R', 'Y', 'G', 'C', 'M', 'R', 'Y', 'G']

/**
 * The word, 6 pixels a letter (5 and a gap), each font row doubled so the
 * letters stand 14 pixels tall -- 48x14 pixels, 24 cells by 5 rows.
 * `progress` 0..1 reveals the pixels in a scattered order, so the logo
 * assembles out of the dark rather than wiping on.
 */
export function identPixels(word = 'INTERVAL', progress = 1) {
  const letters = [...word]
  return pixels(letters.length * 6, 14, (x, y) => {
    const li = Math.floor(x / 6), lx = x % 6
    const g = FONT5x7[letters[li]]
    if (!g || lx > 4 || g[y >> 1][lx] !== '#') return null
    return hash2(x, y) < progress * 1.15 ? IDENT_INKS[li % IDENT_INKS.length] : null
  })
}

// ---------------------------------------------------------------------------
// The clock: seven-segment digits, 6x15 pixels (3 cells by 5 rows) each.
// ---------------------------------------------------------------------------

const SEG = { a: [0, 0, 6, 2], b: [4, 0, 2, 8], c: [4, 7, 2, 8], d: [0, 13, 6, 2], e: [0, 7, 2, 8], f: [0, 0, 2, 8], g: [0, 7, 6, 2] }
const DIGIT_SEGS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg']

/** "12:34:56" as pixels: digits 8 pixels apart (a cell's gap), colons 4. */
export function clockPixels(text, ink = 'Y') {
  const places = []
  let x = 0
  for (const ch of text) {
    if (ch === ':') { places.push({ ch, x }); x += 4 } else { places.push({ ch, x }); x += 8 }
  }
  return pixels(x, 15, (px, py) => {
    for (const p of places) {
      if (p.ch === ':') {
        if (px >= p.x && px < p.x + 2 && ((py >= 3 && py < 5) || (py >= 10 && py < 12))) return ink
        continue
      }
      if (px < p.x || px >= p.x + 6) continue
      for (const s of DIGIT_SEGS[+p.ch] || '') {
        const [sx, sy, w, h] = SEG[s]
        if (px - p.x >= sx && px - p.x < sx + w && py >= sy && py < sy + h) return ink
      }
    }
    return null
  })
}

// ---------------------------------------------------------------------------
// The candle for "A thought": a stick and a flame that moves a little.
// ---------------------------------------------------------------------------

/** 24x30 pixels: a flame (rows 0-15), the wick, a stick. The flame's
 *  height and lean change every 140ms, gently -- a candle in still air. A
 *  first cut at 16x21 read as a matchstick; this size is a candle. */
export function candlePixels(ms) {
  const k = Math.floor(ms / 140)
  const tall = 12 + hash3(k, 1, 3) * 2.5
  const lean = (hash3(k, 2, 5) - 0.5) * 1.6
  return pixels(24, 30, (x, y) => {
    if (y >= 18) return x >= 9 && x <= 14 ? 'W' : null
    if (y >= 16) return x === 11 || x === 12 ? 'W' : null
    const cy = 15 - y
    if (cy > tall) return null
    // A teardrop: widest a third of the way up, closing to a point.
    const u = (cy + 0.5) / tall
    const half = 3.6 * Math.sin(Math.PI * Math.min(1, u * 1.2)) * (u < 0.3 ? 1 : 1 - (u - 0.3) * 1.05)
    const cx = 12 + lean * u
    const d = Math.abs(x + 0.5 - cx)
    if (d > half) return null
    // Two colours, not three: a cell holds one, and a red rim broke into
    // fragments. A yellow flame with a small white heart at its root.
    return u > 0.08 && u < 0.22 && d < 1 ? 'W' : 'Y'
  })
}

// ---------------------------------------------------------------------------
// The aquarium: fish, weed and bubbles on a blue ground.
// ---------------------------------------------------------------------------

const FISH = ['.###.#', '######', '.###.#']
const FISH_SHOAL = [
  { ink: 'Y', y: 10, speed: 0.0042, phase: 0, dir: -1 },
  { ink: 'M', y: 22, speed: 0.0030, phase: 30, dir: 1 },
  { ink: 'R', y: 31, speed: 0.0055, phase: 55, dir: -1 },
  { ink: 'W', y: 17, speed: 0.0024, phase: 12, dir: 1 },
]
const WEED = [6, 19, 47, 66]

/** 80x51 pixels (rows 4-20 of a page). Sand along the bottom, weed that
 *  sways, fish that swim across and come round again, bubbles from the
 *  weed. Everything is a function of `ms`, so it never runs away. */
export function aquariumPixels(ms) {
  const W = 80, H = 51
  const fishAt = FISH_SHOAL.map(f => {
    const travel = W + 12
    const pos = ((ms * f.speed + f.phase) % travel + travel) % travel
    return { ...f, x: Math.round(f.dir > 0 ? pos - 8 : W - pos + 2), y: Math.round(f.y + 1.5 * Math.sin(ms / 900 + f.phase)) }
  })
  return pixels(W, H, (x, y) => {
    if (y >= H - 3) return (x + y) % 5 ? 'Y' : null
    for (const f of fishAt) {
      const fx = x - f.x, fy = y - f.y
      if (fx < 0 || fx >= 6 || fy < 0 || fy >= 3) continue
      const col = f.dir > 0 ? 5 - fx : fx
      if (FISH[fy][col] === '#') return f.ink
    }
    for (const w of WEED) {
      const height = 14 + (w % 7)
      if (y < H - 3 - height || y >= H - 3) continue
      const sway = Math.round(1.5 * Math.sin(ms / 1400 + w + (H - y) / 6) * ((H - 3 - y) / height))
      if (x === w + sway || x === w + sway + 1) return 'G'
    }
    for (const w of WEED) {
      // A bubble every few seconds from each weed, rising and wobbling.
      const period = 4200 + (w % 5) * 700
      const k = (ms + w * 300) / period
      const age = k - Math.floor(k)
      const by = Math.round((H - 20) * (1 - age))
      const bx = w + 3 + Math.round(Math.sin(age * 12 + w))
      if (y === by && x === bx) return 'C'
    }
    return null
  })
}

// ---------------------------------------------------------------------------
// The living gallery: the same pictures, moving slowly.
// ---------------------------------------------------------------------------

/** The moon rises over a minute, sets behind the sea, rises again; the
 *  stars twinkle; the reflection follows the moon. */
export function moonrisePixels(ms) {
  const HZ = 40
  const rise = (ms % 60000) / 60000
  const my = 34 - rise * 24, mx = 57
  return pixels(80, 57, (x, y) => {
    if (y < HZ && (x - mx) ** 2 + ((y - my) * 1.24) ** 2 < 70) return 'W'
    if (y < HZ) return hash2(x, y) > 0.986 && hash3(x, y, Math.floor(ms / 900)) > 0.25 ? 'Y' : null
    if (y === HZ) return 'C'
    const spread = 2 + (y - HZ) / 4
    const shimmer = (x * 3 + y * 5 + Math.floor(ms / 400)) % 4 !== 0
    if (rise > 0.15 && Math.abs(x - mx) < spread && shimmer && y % 2 === 0) return 'Y'
    if (y % 3 === 0 && (x + y * 5 + Math.floor(ms / 700)) % 13 < 3) return 'C'
    return null
  })
}

/** Windows go on and off, a few at a time, as in a real city at night. */
export function cityPixels(ms) {
  const k = Math.floor(ms / 1500)
  return pixels(80, 57, (x, y) => {
    const h = 18 + Math.floor(hash2(Math.floor(x / 7), 2) * 28)
    if (y > 56 - h) {
      if (x % 7 === 6) return null
      const window = (x % 2 === 0) && (y % 3 === 0)
      const lit = hash2(x, y) > 0.45 !== (hash3(x, y, k) > 0.93)
      return window && lit ? 'Y' : 'B'
    }
    if (hash2(x, y + 99) > 0.992) return 'W'
    return null
  })
}

/** Swell lines rolling under a low sun. */
export function seaPixels(ms) {
  const t = ms / 1000
  return pixels(80, 57, (x, y) => {
    if ((x - 22) ** 2 + ((y - 16) * 1.24) ** 2 < 70) return 'Y'
    for (const [base, amp, len, ch, speed] of [[30, 2, 23, 'C', 0.9], [38, 3, 17, 'B', 1.3], [47, 3.5, 13, 'W', 1.8]]) {
      const w = base + amp * Math.sin((x + base) / len * Math.PI * 2 - t * speed)
      if (Math.abs(y - w) < 1) return ch
    }
    return null
  })
}

// ---------------------------------------------------------------------------
// Weather that moves: a two-cell window of rain, snow or storm.
// ---------------------------------------------------------------------------

/** Mosaic bits for one cell of weather at time `ms`: rain falls in
 *  diagonal streaks, snow drifts, a storm flashes now and then. */
export function weatherCell(kind, ms, col = 0) {
  const f = Math.floor(ms / 220) + col * 2
  if (kind === 'rain') return [9, 36, 18][f % 3]
  if (kind === 'snow') return [1, 8, 16, 2, 32, 4][(f + col) % 6]
  if (kind === 'storm') return hash3(Math.floor(ms / 300), col, 7) > 0.85 ? 63 : [9, 36, 18][f % 3]
  return 0
}
/** Which kind of moving weather a WMO code is, or null for none. */
export function weatherKind(code) {
  if (code >= 95) return 'storm'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  return null
}

/** A lighthouse on a headland at night (2026-09-28). The lamp turns once
 *  every ten seconds: the beam swings across the sky, foreshortens as it
 *  comes round towards you, flares when it points straight out of the
 *  screen, and goes behind the tower on the far side. The tower's bands are
 *  a whole cell row each -- a band edge inside a cell would put red and
 *  white in one cell, and a cell holds one colour. Sea below row 12. */
export const LIGHTHOUSE_HZ = 36
export function lighthousePixels(ms) {
  const HZ = LIGHTHOUSE_HZ, lx = 58, ly = 7
  const a = (ms % 10000) / 10000 * Math.PI * 2
  const c = Math.cos(a), toward = Math.sin(a) > 0
  const reach = 74 * Math.abs(c)
  return pixels(80, 57, (x, y) => {
    const ground = x < 40 ? 99 : 28 + Math.round(((x - lx) / 17) ** 2 * 10)
    if (y >= ground) return 'G'
    // The roof, the lantern, then the tower, widening a little to its foot.
    if (y >= 3 && y <= 5 && Math.abs(x - lx) <= y - 3) return 'R'
    if (y >= 6 && y <= 8 && Math.abs(x - lx) <= 2) return 'Y'
    if (y >= 9 && y < ground && Math.abs(x - lx) <= 2 + (y - 9) / 12) return Math.floor(y / 3) % 2 ? 'W' : 'R'
    // Straight at you: a glare round the lantern.
    if (toward && Math.abs(c) < 0.18 && y < HZ && (x - lx) ** 2 + ((y - ly) * 1.5) ** 2 < 26) return 'Y'
    // The beam: a wedge from the lamp, dotted while it points away.
    const dx = x - lx
    if (y < HZ && dx * c > 0 && Math.abs(dx) <= reach) {
      const half = 0.6 + Math.abs(dx) * 0.07
      if (Math.abs(y - ly) <= half && (toward || (x + y) % 2 === 0)) return 'Y'
    }
    // Waves: short dashes at scattered places along each line, drifting.
    if (y >= HZ) return y % 3 === 1 && hash2(Math.floor((x + Math.floor(ms / 400) * (y % 2 ? 1 : -1)) / 4), y) > 0.7 ? 'C' : null
    return hash2(x, y + 7) > 0.99 && hash3(x, y, Math.floor(ms / 1100)) > 0.2 ? 'W' : null
  })
}

/** The northern lights over snow and pines (2026-09-28): curtains that
 *  drift and fold, rayed from top to bottom, brightest along their lower
 *  edge, with a magenta fringe above -- which is what the aurora does. */
export function auroraPixels(ms) {
  const t = ms / 1000
  const TREES = [[6, 10], [12, 13], [19, 9], [54, 11], [60, 14], [67, 10], [74, 12]]
  return pixels(80, 57, (x, y) => {
    const g = Math.round(45 + 3 * Math.sin(x / 9) + 2 * Math.sin(x / 4.3 + 1))
    for (const [tx, h] of TREES) {
      const tip = Math.round(45 + 3 * Math.sin(tx / 9) + 2 * Math.sin(tx / 4.3 + 1)) - h
      if (y >= tip && y <= tip + h + 1 && Math.abs(x - tx) <= (y - tip) / 3) return 'G'
    }
    if (y >= g) return 'W'
    const mid = 16 + 5 * Math.sin(x / 11 + t * 0.2) + 3 * Math.sin(x / 5.3 - t * 0.33)
    const top = mid - 9 - 4 * Math.sin(x / 7 + t * 0.25), bottom = mid + 6
    if (y >= top && y <= bottom) {
      const k = (y - top) / (bottom - top)
      const rays = 0.55 + 0.45 * Math.sin(x * 1.3 + t * 0.9 + Math.sin(x / 3 + t * 0.4) * 2)
      // A fixed dither, not a per-frame one: the curtain drifts through it
      // and so moves smoothly, where fresh noise every frame read as static.
      if (k > 0.8 || Math.pow(k, 1.6) * rays * 1.3 > hash2(x, y + 11)) return k < 0.3 && rays > 0.6 ? 'M' : 'G'
    }
    return hash2(x, y + 31) > 0.988 ? 'W' : null
  })
}

/** A night train crossing a valley (2026-09-28): hills under a moon, and
 *  every forty seconds a train runs across on the track, its windows lit,
 *  its headlight ahead of it and its reflection shivering in the river.
 *  Nothing else moves, so the train is an event: the picture is mostly
 *  waiting for it. Rows 13 down are blue (the gallery's bgFor).
 *
 *  The body is black, and it is the cells' BACKGROUND, not pixels
 *  (`trainSpan` tells the page's bgFor where it is): a cell holds one ink
 *  and one paper, so yellow windows in a black body on a blue valley is
 *  three colours unless the body is the paper. The first cut had no body,
 *  and the windows read as a dashed line across the screen. */
export const TRAIN_WATER = 39
export const TRAIN_ROOF = 36
const TRAIN_CARS = 4, TRAIN_CAR = 13, TRAIN_LEN = TRAIN_CARS * TRAIN_CAR + 10
export function trainSpan(ms) {
  const tail = Math.round(-TRAIN_LEN + ((ms % 40000) / 40000) * (80 + TRAIN_LEN + 60))
  return [tail, tail + TRAIN_LEN - 1]
}
export function trainPixels(ms) {
  const CARS = TRAIN_CARS, CAR = TRAIN_CAR, LEN = TRAIN_LEN
  const [tail, head] = trainSpan(ms)
  const lit = (x) => {
    const u = x - tail
    if (u < 0 || u >= LEN) return false
    if (u >= CARS * CAR) return u === LEN - 3 || u === LEN - 4
    // A window is one whole cell and so is the gap after it: a 2-on/1-off
    // pattern smeared into a solid strip, since a cell is two pixels wide.
    const w = u % CAR
    return w >= 1 && w <= 11 && x % 4 < 2
  }
  return pixels(80, 57, (x, y) => {
    if ((x - 14) ** 2 + ((y - 8) * 1.3) ** 2 < 20) return 'W'
    const hill = Math.round(30 + 4 * Math.sin(x / 13) + 3 * Math.sin(x / 6 + 2))
    // The body's two cell rows: the black paper shows, but for the windows.
    const inTrain = x >= tail - 1 && x <= head + 1 && y >= TRAIN_ROOF && y <= 41
    if (inTrain) return y >= 39 && y <= 40 && lit(x) ? 'Y' : null
    if (y < TRAIN_WATER) {
      if (y >= hill) return 'B'
      return hash2(x, y + 53) > 0.988 ? 'W' : null
    }
    // Windows (39-40), the headlight throwing light ahead, the rails (42).
    if (y <= 40 && lit(x)) return 'Y'
    if (y === 40 && x > head && x <= head + 9 && (x - head) % 2 === 1) return 'W'
    if (y === 42) return x % 4 === 0 ? 'W' : null
    // The river: the windows again, upside down and broken up.
    if ((y === 47 || y === 48) && lit(x) && hash3(x, y, Math.floor(ms / 250)) > 0.35) return 'Y'
    if (y >= 46 && y % 3 === 1 && (x * 3 + y + Math.floor(ms / 600)) % 17 < 2) return 'C'
    return null
  })
}

/** The launch countdown's picture, 18x24 pixels: the curve of the Earth, a
 *  pad, and the ascent drawn as a dotted arc that goes up and then leans
 *  over (a gravity turn), with a craft climbing it every six seconds. In the
 *  last minute the arc fills in yellow behind the craft. 2026-09-28: it was
 *  a rocket standing on its pad -- a tall white tube, rounded red nose, two
 *  fins at the base -- and it read as something else entirely. The path is
 *  the thing a countdown is about, and nothing tall and upright is drawn. */
export function launchPixels(ms, lit = false) {
  const W = 18, H = 24
  const at = (s) => [2 + 15 * s * s, 19 - 18 * s]
  const k = (ms % 6000) / 6000
  const [cx, cy] = at(k)
  return pixels(W, H, (x, y) => {
    // The Earth: a wide circle, so the ground curves away at both ends.
    if ((x - 9) ** 2 * 1.9 + (y - 60) ** 2 < 39 ** 2) return 'G'
    if (y === 21 && x >= 1 && x <= 4) return 'R'
    if (Math.abs(x - cx) < 1.1 && Math.abs(y - cy) < 1.1) return 'W'
    for (let i = 0; i <= 40; i++) {
      const s = i / 40, [px, py] = at(s)
      if (Math.round(px) !== x || Math.round(py) !== y) continue
      if (lit && s < k) return 'Y'
      return i % 3 === 0 ? 'C' : null
    }
    return null
  })
}

/** A coin, 20x14 pixels, spinning: its width narrows and widens while it is
 *  in the air (`spin` 0..1 through a flip), round when it lands. */
export function coinPixels(spin = 0) {
  const squash = spin > 0 ? Math.abs(Math.cos(spin * Math.PI * 6)) : 1
  return pixels(20, 14, (x, y) => {
    const dx = (x + 0.5 - 10) / (9 * Math.max(0.12, squash) / 1.24), dy = (y + 0.5 - 7) / 6.5
    const d = dx * dx + dy * dy
    return d < 1 ? (d > 0.62 ? 'Y' : 'W') : null
  })
}

// ---------------------------------------------------------------------------
// 2026-10-01: more of the same. The owner liked the rain, the launch arc and
// the candle, and asked where else they could go. What those three share is
// that the picture IS the data -- it is raining, a launch is coming, a
// thought is being kept company -- so each of these draws something the page
// already says, and moves no faster than the candle does.
// ---------------------------------------------------------------------------

/** Two cells of mosaic (4x3 pixels) from a pixel test: [bits0, bits1]. */
function twoCells(on) {
  const out = [0, 0]
  for (let c = 0; c < 2; c++) for (let py = 0; py < 3; py++) for (let px = 0; px < 2; px++) {
    if (on(c * 2 + px, py)) out[c] |= 1 << (py * 2 + px)
  }
  return out
}

/** Which sky a WMO code is, for the two moving cells on a cities row: the
 *  falling kinds (weatherKind), else sun or star, part, cloud or fog. Only
 *  the falling kinds moved at first, so a clear day sat still beside a
 *  drizzle that fell; now every row has weather in it. */
export function skyKind(code, isDay = true) {
  const k = weatherKind(code)
  if (k) return k
  if (code === 0 || code === 1) return isDay ? 'sun' : 'star'
  if (code === 2) return isDay ? 'part' : 'partnight'
  if (code === 3) return 'cloud'
  if (code === 45 || code === 48) return 'fog'
  return null
}

/** The two cells of a sky at time `ms`, as [[bits, ink], [bits, ink]] --
 *  an ink per cell, since a cell holds one. Slow: the sun's rays come and
 *  go every 1.1s, a cloud moves a pixel every 0.9s, a star twinkles. */
export function skyCells(kind, ms) {
  const both = (bits, ink) => bits.map(b => [b, ink])
  if (kind === 'rain' || kind === 'snow' || kind === 'storm') {
    const ink = kind === 'snow' ? 'W' : kind === 'storm' ? 'Y' : 'C'
    return [0, 1].map(col => [weatherCell(kind, ms, col), ink])
  }
  // Nothing on a cell's top pixel row (2026-10-01, seen on the tube):
  // three sunny cities in a row joined into one yellow bar down the column.
  // With the top row dark, a row's sky always stands apart from the next.
  const f = Math.floor(ms / 1100)
  const sun = (x, y) => y >= 1 && (x === 1 || x === 2 || (f % 2 === 1 && y === 1 && (x === 0 || x === 3)))
  const twinkle = hash3(Math.floor(ms / 700), 4, 11) > 0.55
  // A pixel in from the left edge: CLEAR is the one five-letter sky word,
  // and a star's left arm touched its R.
  const star = (x, y) => (x === 2 && y === 1) || (twinkle && ((x === 2 && y === 2) || (y === 1 && (x === 1 || x === 3))))
  const small = (x, y) => x === 1 && (y === 1 || (twinkle && y === 2))
  if (kind === 'sun') return both(twoCells(sun), 'Y')
  if (kind === 'star') return both(twoCells(star), 'W')
  if (kind === 'cloud') {
    // Back and forth across the two cells, never out of them: wrapping
    // round, it left the row empty a frame in seven and read as missing.
    const s = [-1, 0, 1, 2, 1, 0][Math.floor(ms / 900) % 6]
    return both(twoCells((x, y) => (y === 2 && x >= s && x <= s + 2) || (y === 1 && x >= s + 1 && x <= s + 2)), 'W')
  }
  if (kind === 'part' || kind === 'partnight') {
    // The sun (or a star) in the first cell, a cloud puffing in the second.
    const [a] = twoCells(kind === 'part' ? (x, y) => y >= 1 && (x === 1 || (f % 2 === 1 && x === 0 && y === 1)) : small)
    const puff = Math.floor(ms / 1500) % 2
    const [, b] = twoCells((x, y) => x >= 2 && (y === 2 || (y === 1 && x === 2 + puff)))
    return [[a, kind === 'part' ? 'Y' : 'W'], [b, 'W']]
  }
  if (kind === 'fog') {
    const g = Math.floor(ms / 800)
    return both(twoCells((x, y) => y >= 1 && (x + (y === 1 ? g : -g) + 12) % 3 !== 0), 'W')
  }
  return [[0, 'W'], [0, 'W']]
}

/** A birthday cake for Born today (201), 28x18 pixels: three candles with
 *  the 501 candle's flame in small, white icing, a magenta cake. Each part
 *  is whole cell rows -- flames, candles, icing, cake -- so no cell has to
 *  choose between two colours. */
export const CAKE_CANDLES = [7, 14, 21]
export function cakePixels(ms) {
  const k = Math.floor(ms / 150)
  return pixels(28, 18, (x, y) => {
    if (y >= 12) return x >= 1 && x <= 26 ? 'M' : null
    if (y >= 9) return x >= 1 && x <= 26 && (y < 11 || x % 4 < 2) ? 'W' : null
    for (const [i, c] of CAKE_CANDLES.entries()) {
      if (y >= 6) { if (x === c - 1 || x === c) return 'C'; continue }
      const tall = 3.6 + hash3(k, i, 3) * 1.6
      const lean = (hash3(k, i, 5) - 0.5) * 1.2
      const cy = 5 - y
      if (cy > tall) continue
      const u = (cy + 0.5) / tall
      const half = 1.4 * Math.sin(Math.PI * Math.min(1, u * 1.25)) + 0.15
      if (Math.abs(x + 0.5 - (c + lean * u)) < half) return 'Y'
    }
    return null
  })
}

/** The sun's path across today for 300, 76x9 pixels (rows 19-21): a dotted
 *  arc from sunrise to sunset with the sun where it is now (`frac` 0..1 of
 *  the daylight gone), glinting. After dark the arc is fainter and the moon
 *  crosses it instead (`frac` of the night gone), under a few stars. The
 *  launch arc on 203 is the model: the path is the thing. */
export function sunArcPixels(frac, isDay, ms) {
  const W = 76, H = 9
  const at = (s) => [2 + 71 * s, 8 - 7 * Math.sin(Math.PI * s)]
  const [bx, by] = at(Math.min(1, Math.max(0, frac)))
  const glint = Math.floor(ms / 1000) % 2
  const STARS = [[6, 1], [12, 3], [17, 0], [58, 1], [64, 3], [70, 0]]
  return pixels(W, H, (x, y) => {
    const dx = x + 0.5 - bx, dy = y + 0.5 - by
    if (isDay) {
      if (Math.abs(dx) < 1.6 && Math.abs(dy) < 1.6) return 'Y'
      if (glint && ((Math.abs(dx) < 0.6 && Math.abs(dy) < 2.6) || (Math.abs(dy) < 0.6 && Math.abs(dx) < 2.6))) return 'Y'
    } else {
      if (dx * dx + dy * dy < 2.4) return 'W'
      for (const [i, [sx, sy]] of STARS.entries()) if (x === sx && y === sy && hash3(Math.floor(ms / 800), i, 7) > 0.35) return 'W'
    }
    for (let i = 0; i <= 60; i++) {
      const [px, py] = at(i / 60)
      if (Math.round(px - 0.5) === x && Math.round(py - 0.5) === y) return i % (isDay ? 3 : 6) === 0 ? 'C' : null
    }
    return null
  })
}

/** An hourglass for the focus timer (502), 12x24 pixels: caps top and
 *  bottom, a post each side, and the sand -- `frac` of it still in the top
 *  bulb -- with a thin stream falling while it runs. The glass itself is not
 *  drawn: its edge would share cells with the sand, and the sand's shape
 *  says where the glass is. */
export function hourglassPixels(frac, running, ms) {
  const hw = (y) => (y <= 10 ? 1 + (10 - y) * 0.45 : 1 + (y - 13) * 0.45)
  const inside = (x, y) => Math.abs(x + 0.5 - 6) < hw(y)
  const rows = (ys) => ys.map(y => [...Array(12).keys()].filter(x => inside(x, y)))
  const top = rows([10, 9, 8, 7, 6, 5, 4, 3]), bottom = rows([20, 19, 18, 17, 16, 15, 14, 13])
  const cap = top.reduce((n, r) => n + r.length, 0)
  const fill = (bulb, ys, n) => {
    const on = new Set()
    bulb.forEach((xs, i) => {
      // The middle of a row fills first, so a part-filled row is a mound.
      const order = xs.slice().sort((a, b) => Math.abs(a + 0.5 - 6) - Math.abs(b + 0.5 - 6))
      for (const x of order) if (n-- > 0) on.add(`${x},${ys[i]}`)
    })
    return on
  }
  const f = Math.min(1, Math.max(0, frac))
  const sandTop = fill(top, [10, 9, 8, 7, 6, 5, 4, 3], Math.round(f * cap))
  const sandBottom = fill(bottom, [20, 19, 18, 17, 16, 15, 14, 13], Math.round((1 - f) * cap))
  const pileTop = Math.min(21, ...[...sandBottom].map(k => +k.split(',')[1]))
  const step = Math.floor(ms / 150)
  return pixels(12, 24, (x, y) => {
    if (y <= 2 || y >= 21) return 'W'
    if (x === 0 || x === 11) return 'C'
    if (sandTop.has(`${x},${y}`) || sandBottom.has(`${x},${y}`)) return 'S'
    if (running && f > 0 && f < 1 && x === 5 && y >= 11 && y < pileTop && (y + step) % 2 === 0) return 'S'
    return null
  })
}

/** The world for the clock (202), 76x9 pixels, west to east from 180W:
 *  land as rough longitude spans per band of latitude (63N down to 49S, 14
 *  degrees a row). Coarse on purpose: at this size a coastline is a guess,
 *  and the shapes only have to read as the continents. */
const WORLD = [
  [[-165, -60], [-50, -20], [5, 180]],
  [[-125, -55], [-5, 140]],
  [[-120, -77], [-10, 120], [130, 140]],
  [[-105, -87], [-17, 58], [70, 88], [95, 110]],
  [[-77, -55], [-12, 48], [98, 125]],
  [[-80, -35], [12, 40], [105, 140]],
  [[-70, -40], [14, 35], [44, 50], [114, 150]],
  [[-72, -57], [18, 28], [116, 150], [172, 178]],
  [[-75, -66]],
]
export const WORLD_W = 76
export const worldLon = (x) => -180 + (x + 0.5) * 360 / WORLD_W
/** The longitude the sun is over at `ms` (noon there), ignoring the
 *  equation of time: a cell is 4.7 degrees, about nineteen minutes. */
export const sunLon = (ms) => { const d = new Date(ms); return ((12 - (d.getUTCHours() + d.getUTCMinutes() / 60)) * 15 + 540) % 360 - 180 }
/** Whether it is day at longitude `lon` (degrees) at `ms`. */
export const dayAt = (lon, ms) => Math.cos((lon - sunLon(ms)) * Math.PI / 180) > 0
/** The map at `ms`: land 'G' in daylight, 'B' at night, decided per CELL
 *  column (two pixels), so a cell never holds day and night land at once. */
export function worldPixels(ms) {
  return pixels(WORLD_W, WORLD.length, (x, y) => {
    const lon = worldLon(x)
    if (!WORLD[y].some(([a, b]) => lon >= a && lon <= b)) return null
    return dayAt(worldLon(x - (x % 2) + 0.5), ms) ? 'G' : 'B'
  })
}

/** A windmill, 20x15 pixels, its sails turning once every sixteen seconds:
 *  the interval picture (2026-10-01). The set is called INTERVAL after the
 *  films the BBC ran between programmes -- the potter's wheel, the windmill
 *  -- and an off-air page is exactly that: a gap with something to look at. */
export function windmillPixels(ms) {
  const hx = 10, hy = 5
  // In steps of 15 degrees, two-thirds of a second each (still a turn
  // every sixteen seconds). Turned smoothly, the one-pixel sails changed
  // two-thirds of their pixels at every quarter-second redraw: a shimmer,
  // not a windmill. Stepped, each position holds, like clockwork.
  const turn = Math.floor(ms / (16000 / 24)) * (2 * Math.PI / 24)
  return pixels(20, 15, (x, y) => {
    const dx = (x + 0.5 - hx) / 1.24, dy = y + 0.5 - hy
    for (let k = 0; k < 4; k++) {
      const a = turn + k * Math.PI / 2
      const along = dx * Math.cos(a) + dy * Math.sin(a)
      const across = -dx * Math.sin(a) + dy * Math.cos(a)
      if (along > 0.6 && along < 5.2 && across > -0.5 && across < (along > 2 ? 1.3 : 0.5)) return 'Y'
    }
    if (y === 14) return 'G'
    if (y >= 6 && Math.abs(x + 0.5 - hx) < 1.2 + (y - 6) * 0.3) return 'W'
    return null
  })
}
