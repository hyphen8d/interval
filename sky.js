// INTERVAL -- the sky, worked out on the set. No network: the moon's phase
// is arithmetic on the date, which makes page 310 the one page that is live
// with the aerial unplugged.

export const SYNODIC_DAYS = 29.530588853
/** A known new moon: 2000-01-06 18:14 UTC. */
export const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14)

const NAMES = [
  [1.84566, 'NEW MOON'], [5.53699, 'WAXING CRESCENT'], [9.22831, 'FIRST QUARTER'],
  [12.91963, 'WAXING GIBBOUS'], [16.61096, 'FULL MOON'], [20.30228, 'WANING GIBBOUS'],
  [23.99361, 'LAST QUARTER'], [27.68493, 'WANING CRESCENT'], [Infinity, 'NEW MOON'],
]

/**
 * The moon at time `ms`. Mean-phase arithmetic: good to within about half a
 * day, which is far inside what a 24x24-dot picture of it can show.
 * `phase` is 0..1 round the cycle (0 new, 0.5 full); `lit` is the fraction
 * of the disc lit.
 */
export function moon(ms = Date.now()) {
  const days = (ms - REF_NEW_MOON) / 864e5
  const age = ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS
  const phase = age / SYNODIC_DAYS
  const lit = (1 - Math.cos(2 * Math.PI * phase)) / 2
  const name = NAMES.find(([d]) => age < d)[1]
  const toFull = ((SYNODIC_DAYS / 2 - age) % SYNODIC_DAYS + SYNODIC_DAYS) % SYNODIC_DAYS
  const toNew = SYNODIC_DAYS - age
  return { age, phase, lit, name, toFull, toNew }
}

/** Is the pixel at normalised disc position (nx, ny), each -1..1, lit at
 *  `phase`? Waxing lights the right-hand side (northern hemisphere view). */
export function litAt(nx, ny, phase) {
  if (nx * nx + ny * ny > 1) return null
  const w = Math.sqrt(1 - ny * ny)
  return phase < 0.5
    ? nx > w * Math.cos(2 * Math.PI * phase)
    : nx < w * Math.cos(2 * Math.PI * (phase - 0.5))
}

/** "08:42" -> minutes; null for anything else. */
export const minutesOf = (hhmm) => {
  const m = /^(\d\d):(\d\d)$/.exec(String(hhmm ?? ''))
  return m ? +m[1] * 60 + +m[2] : null
}

/** Day length from two "HH:MM" strings, as "11H 53M". */
export function dayLength(rise, set) {
  const a = minutesOf(rise), b = minutesOf(set)
  if (a === null || b === null || b <= a) return null
  const d = b - a
  return `${Math.floor(d / 60)}H ${String(d % 60).padStart(2, '0')}M`
}
