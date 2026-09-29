// INTERVAL -- the carousel and the reception model. Pure functions of a clock
// and a random source, so the timing the whole app's feel rests on can be
// tested without one.
//
// How real teletext arrived: the broadcaster did not answer requests. It sent
// every page, over and over, a few lines of each TV field, grouped in eight
// "magazines" (the first digit of the page number) that went round in
// parallel. A set keyed to page 302 watched magazine 3 go past and grabbed 302
// when it came round. The header counted through the pages as they passed,
// which is the rolling number everyone remembers -- the wait made visible.
//
// This models that with a fixed period per magazine and each page at a fixed
// slot within it, so the wait for a page is honest: it depends on where in
// the loop the magazine is right now, not on a random number drawn at the
// keypress. Key the same page twice in a row and the second wait is the
// first one minus the time since -- which is how it felt.

/** One pass of a magazine. Real services ran 20-30s for a full magazine; a
 *  web toy that made you wait that long would be sat in front of by nobody,
 *  so this keeps the SHAPE (a wait that depends on the loop) at a length a
 *  person will stay for. 2026-09-28: 2.6s read as slow rather than charming
 *  once the novelty went; 0.9s keeps the count visible and never a wait --
 *  0.3 to 1.2s from the key to the page. */
export const MAG_PERIOD_MS = 900

/** A page is never grabbed sooner than this after the key, even if its slot
 *  is passing right now: the header has to be seen to roll, or the page
 *  appears to load on request and the carousel is invisible. */
export const MIN_WAIT_MS = 320

/** How often a page's subpages rotate on the broadcaster's side. */
export const SUBPAGE_MS = 9000

/** Where in its magazine's loop a page sits, 0..1. A hash of the number, so
 *  it is stable across reloads and differs between neighbours. */
export function pageSlot(num) {
  let h = 2166136261
  for (const ch of String(num).toUpperCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

/** The first time at or after `now + minWait` that page `num` is on air. */
export function nextTransmission(num, now, { period = MAG_PERIOD_MS, minWait = MIN_WAIT_MS } = {}) {
  const from = now + minWait
  const phase = pageSlot(num) * period
  const k = Math.ceil((from - phase) / period)
  return phase + k * period
}

/** The page number the header shows rolling past while a page in magazine
 *  `mag` is being searched for: the pages of that magazine going by, in
 *  transmission order. */
export function rollingNumber(mag, now) {
  const n = Math.floor(now / 38) % 100
  return `${mag}${String(n).padStart(2, '0')}`
}

/** Which subpage the broadcaster is sending at `now`, of `count`. */
export function subpageAt(count, now, period = SUBPAGE_MS) {
  if (!(count > 1)) return 0
  return Math.floor(now / period) % count
}

/** Is `num` a well-formed page number: magazine 1-8, then two hex digits. */
export function validPage(num) {
  return /^[1-8][0-9A-F]{2}$/.test(String(num).toUpperCase())
}

// ---------------------------------------------------------------------------
// Reception.
//
// Teletext's header rows carried Hamming-coded addresses and survived almost
// anything; the page text carried only a parity bit per character. So on a
// weak signal the page number and clock stayed perfect while the text filled
// with wrong characters -- and each time the carousel came round again, the
// decoder overwrote whatever it now received cleanly. A bad page repairs
// itself over a few passes, and never completely while the signal is poor.
// That is what receive() models, and why the set never garbles row 0.
// ---------------------------------------------------------------------------

/** Chance a character arrives wrong at reception `rx` (0 dead .. 1 perfect).
 *  Curved so the top half of the range is nearly clean: a signal has to be
 *  genuinely poor before the text notices. */
export function errorRate(rx) {
  const q = Math.min(1, Math.max(0, rx))
  return Math.pow(1 - q, 2.2) * 0.55
}

const JUNK = 'ABCDEFGHJKLMNPRSTUVWXYZabdeghkmnpqrsuwxz0123456789#%&*+=<>?@/[]'

/**
 * One transmission of a page, through the aerial. `truth` is the page as
 * sent; `shown` is the decoder's memory of it (a Page of the same shape,
 * mutated in place). `initial` is the first grab after a page change, when
 * the decoder has nothing to keep and a bad character or a missing one is
 * all there is. Colours and flags are never garbled -- the model keeps them
 * from `truth`, which errs on the side of a readable page.
 */
export function receive(truth, shown, rx, rand = Math.random, initial = false) {
  const e = errorRate(rx)
  for (let r = 1; r < truth.cells.length; r++) {
    const tr = truth.cells[r], sr = shown.cells[r]
    for (let c = 0; c < tr.length; c++) {
      const t = tr[c], s = sr[c]
      if (e === 0 || rand() >= e) { s.ch = t.ch; s.mos = t.mos; continue }
      if (initial || rand() < 0.3) {
        if (t.mos >= 0) { s.mos = Math.floor(rand() * 64); s.ch = ' ' }
        else if (t.ch === ' ' && rand() > 0.3) { s.ch = ' '; s.mos = -1 }
        else { s.ch = JUNK[Math.floor(rand() * JUNK.length)]; s.mos = -1 }
      }
      // Otherwise: a parity failure, discarded; the decoder keeps what it had.
    }
  }
  return shown
}
