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
