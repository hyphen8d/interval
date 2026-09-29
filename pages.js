// INTERVAL -- the page map: every page on the service, what it is built
// from, and how it is drawn. This file is to INTERVAL what stations.js is to
// SIGNAL, except that pages are composed from live data rather than listed
// as data, so each entry carries a render() instead of a track list.
//
// A page definition:
//   num      '101' -- magazine digit, then two hex digits
//   title    what the screen reader and the dashboard call it
//   feeds    the sources it is drawn from (feeds.js). A page whose feeds have
//            never answered is not on air yet: render() returns null and the
//            set keeps searching, the way a set did for a page the
//            broadcaster was not sending.
//   hidden   off the index and skipped by UP/DOWN. Reachable by number only.
//   subpageMs  how long each subpage stays up before the next (default
//            carousel.js SUBPAGE_MS, 9s). Longer on pages of running text:
//            nine seconds is a headline, not a paragraph.
//   render   (ctx) -> Page[] -- one Page per subpage.
//
//   liveMs   re-draw the page this often while it is up, for a page that
//            moves (the breathing page, the world population count).
//
// ctx: { entry(feedId), status(feedId), env, now, date, editorial }
//
// 2026-09-28, third pass -- the brief. INTERVAL is a set you put on and let
// cycle: bite-sized pages in a fun interface, every one of them readable at
// a glance, and if you want more you go and find it elsewhere. That is the
// test for a page now, ahead of "would a real teletext set have this?": a
// page that needs reading, rather than glancing at, does not belong. It is
// why the story pages, the most-read list (a title and a view count tell you
// nothing), Hacker News (points and comments are noise), the article of the
// day and the SIGNAL listings all went.
//
// Layout contract every page keeps (tests/pages.test.mjs holds it): rows 1-2
// are the masthead, the body is rows 4-21, row 22 is spare, row 23 is the
// credit line and row 24 the fastext row. The set writes row 0.

// Siblings are imported as ?v=<build>, like every app module (see main.js):
// a bare import would be cached across a deploy and pair this file with a
// stale copy of the one it imports.
const V = globalThis.INTERVAL_BUILD ?? ''
const {
  Page, pixels, hash2, wrapText, clip,
  BLACK, RED, GREEN, YELLOW, BLUE, MAGENTA, CYAN, WHITE, COLS,
} = await import(`./teletext.js?v=${V}`)
const { KEYS, FASTEXT_ALT } = await import(`./constants.js?v=${V}`)
const { moon, litAt, dayLength } = await import(`./sky.js?v=${V}`)
const { FEEDS, staleAfter } = await import(`./feeds.js?v=${V}`)
const { drawLines } = await import(`./markup.js?v=${V}`)

export const BODY_TOP = 4
export const BODY_BOTTOM = 21

/**
 * The magazines: each first digit is a section with an identity, the way a
 * SIGNAL station is a callsign with a tint and an ident. `band` is the
 * masthead colour, `ink` the title on it, `accent` the small print.
 */
export const MAGAZINES = {
  1: { name: 'NEWS', band: RED, ink: WHITE, accent: YELLOW },
  2: { name: 'TODAY', band: MAGENTA, ink: WHITE, accent: YELLOW },
  3: { name: 'WEATHER', band: BLUE, ink: CYAN, accent: YELLOW },
  4: { name: 'MONEY', band: YELLOW, ink: BLUE, accent: RED },
  5: { name: 'PAUSE', band: CYAN, ink: BLUE, accent: BLUE },
  6: { name: 'QUIZ', band: GREEN, ink: BLACK, accent: BLACK },
  7: { name: 'GALLERY', band: WHITE, ink: BLUE, accent: RED },
  8: { name: 'SERVICE', band: BLUE, ink: WHITE, accent: YELLOW },
}

/**
 * The seven sections, in the order cycling goes through them (N), and the
 * pages in each. H while cycling holds the section: the set keeps going
 * round its pages until H again. The index lists the same thing.
 */
export const SECTIONS = [
  { name: 'NEWS', pages: [['HEADLINES', '101'], ['FACTS', '102']] },
  { name: 'TODAY', pages: [['THIS DAY', '200'], ['BORN TODAY', '201']] },
  { name: 'WEATHER', pages: [['TODAY', '300'], ['5-DAY', '301'], ['SKY', '310'], ['SPACE', '320'], ['QUAKES', '330']] },
  { name: 'MONEY', pages: [['CURRENCIES', '400'], ['METALS', '401'], ['THE WORLD', '410']] },
  { name: 'PAUSE', pages: [['BREATHE', '500'], ['A THOUGHT', '501']] },
  { name: 'QUIZ', pages: [['QUIZ', '600']] },
  { name: 'GALLERY', pages: [['PICTURES', '700']] },
]
export const sectionOf = (num) => SECTIONS.findIndex(s => s.pages.some(([, n]) => n === String(num).toUpperCase()))
export const magazineOf = (num) => MAGAZINES[String(num)[0]] || MAGAZINES[8]

// ---------------------------------------------------------------------------
// Shared furniture
// ---------------------------------------------------------------------------

/** Rows 1-2: the magazine's band, the title in double height, and a small
 *  right-hand block -- the section name over the subpage count. */
export function masthead(p, num, title, { sub = 0, subs = 1, right } = {}) {
  const m = magazineOf(num)
  p.band(1, m.band); p.band(2, m.band)
  p.double(1, 1, clip(title, 26), m.ink, m.band)
  const tag = clip(right ?? m.name, 11)
  p.text(1, 39 - tag.length, tag, m.accent)
  if (subs > 1) {
    const s = `${sub + 1}/${subs}`
    p.text(2, 39 - s.length, s, m.accent)
  }
}

const pad2 = (n) => String(n).padStart(2, '0')
const clock = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
function when(ms, nowMs) {
  const d = new Date(ms), n = new Date(nowMs)
  const sameDay = d.toDateString() === n.toDateString()
  return sameDay ? clock(ms) : `${DAYS[d.getDay()]} ${clock(ms)}`
}

/**
 * Row 23: whose data this is and how old. Stale data is shown, never hidden
 * -- a page that went blank because a source hiccuped would be worse than
 * one that says plainly it is the 14:02 copy. That is check-roster's rule
 * ("a throttled run must never read as a clean one") applied to the viewer.
 */
export function creditLine(p, ctx, feedId) {
  const e = ctx.entry(feedId)
  const label = FEEDS[feedId]?.label ?? feedId.toUpperCase()
  if (!e || !e.data) { p.text(23, 1, `SOURCE: ${label}`, GREEN); return }
  const stale = ctx.now - e.at > staleAfter(FEEDS[feedId])
  if (stale) p.text(23, 1, clip(`${label}  NOT UPDATED SINCE ${when(e.at, ctx.now)}`, 38), RED)
  else p.text(23, 1, clip(`SOURCE: ${label}   UPDATED ${when(e.at, ctx.now)}`, 38), GREEN)
}

/** A page whose source has never answered, once the set has given up
 *  waiting for it. Honest about why, and about what happens next. */
export function offAir(num, title, feedIds, ctx) {
  const p = new Page()
  masthead(p, num, title)
  p.double(5, 2, 'OFF AIR', YELLOW)
  let r = p.wrap(8, 2, 'This page is built from a source that has not answered the set yet.', 36, WHITE)
  for (const id of feedIds) {
    const e = ctx.entry(id)
    r = p.wrap(r + 1, 2, `${FEEDS[id]?.title ?? id}: ${e?.error ? `failed (${e.error})` : 'no answer yet'}`, 36, CYAN)
  }
  p.wrap(r + 1, 2, 'It will come back by itself when the source answers. Nothing needs doing.', 36, GREEN)
  p.fast([['Index', '100'], null, null, ['Help', '199']])
  return p
}

/**
 * Lay blocks of lines out across as many subpages as they need. A block is
 * never split: a story continued on the next subpage reads as two stories.
 */
export function paginate(blocks, { top = BODY_TOP, bottom = BODY_BOTTOM, gap = 1 } = {}) {
  const pages = [[]]
  let row = top
  for (const b of blocks) {
    const h = Math.min(b.height, bottom - top + 1)
    if (row + h - 1 > bottom && pages[pages.length - 1].length) { pages.push([]); row = top }
    pages[pages.length - 1].push({ block: b, row })
    row += h + gap
  }
  return pages
}

/** A block of wrapped text: optional coloured lead, then a paragraph. */
function textBlock(lead, body, { leadFg = YELLOW, fg = WHITE, width = 38, col = 1 } = {}) {
  const lines = wrapText(body, width - (lead ? lead.length + 1 : 0))
  return {
    height: lines.length,
    draw(p, row) {
      if (lead) p.text(row, col, lead, leadFg)
      const c = col + (lead ? lead.length + 1 : 0)
      lines.forEach((l, i) => p.text(row + i, c, l, fg))
    },
  }
}

/** A list page: masthead, paginated blocks, credit, fastext. */
function listPage(num, title, blocks, ctx, { feed, fast, right, gap = 1, empty = 'Nothing to show on this page right now.' } = {}) {
  const laid = blocks.length ? paginate(blocks, { gap }) : [[]]
  return laid.map((placed, i) => {
    const p = new Page()
    masthead(p, num, title, { sub: i, subs: laid.length, right })
    if (!blocks.length) p.wrap(BODY_TOP, 1, empty, 38, CYAN)
    for (const { block, row } of placed) block.draw(p, row)
    if (feed) creditLine(p, ctx, feed)
    p.fast(fast)
    return p
  })
}

/** Everything a page needs from a feed, or null when it has never answered
 *  (so the set keeps searching) -- or an off-air page once it has failed. */
function need(ctx, num, title, ...ids) {
  for (const id of ids) {
    const e = ctx.entry(id)
    if (e && e.data) continue
    if (e && e.error && !e.loading) return { off: [offAir(num, title, ids, ctx)] }
    return { wait: true }
  }
  return { data: Object.fromEntries(ids.map(id => [id, ctx.entry(id).data])) }
}
const gate = (ctx, num, title, ids, fn) => {
  const g = need(ctx, num, title, ...ids)
  if (g.wait) return null
  if (g.off) return g.off
  return fn(g.data)
}


// ---------------------------------------------------------------------------
// WMO weather codes, as words a row can carry.
// ---------------------------------------------------------------------------
const WMO = [
  [[0], 'CLEAR', 'SUN'], [[1], 'FAIR', 'SUN'], [[2], 'PARTLY CLOUDY', 'PART'], [[3], 'CLOUDY', 'CLD'],
  [[45, 48], 'FOG', 'FOG'], [[51, 53, 55], 'DRIZZLE', 'DRZL'], [[56, 57], 'FREEZING DRIZZLE', 'ICE'],
  [[61, 63, 65], 'RAIN', 'RAIN'], [[66, 67], 'FREEZING RAIN', 'ICE'], [[71, 73, 75, 77], 'SNOW', 'SNOW'],
  [[80, 81, 82], 'SHOWERS', 'SHWR'], [[85, 86], 'SNOW SHOWERS', 'SNOW'], [[95], 'THUNDERSTORMS', 'STRM'],
  [[96, 99], 'STORMS WITH HAIL', 'HAIL'],
]
export const wmoWords = (code) => (WMO.find(([cs]) => cs.includes(code)) || [null, '--', '--'])
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const compass = (deg) => (Number.isFinite(deg) ? COMPASS[Math.round(deg / 45) % 8] : '')

/** A small weather picture, 11 columns by 4 rows, for a WMO code. */
function weatherIcon(code) {
  const sun = (x, y) => (x - 7) ** 2 + (y - 5) ** 2 < 18
  const cloud = (x, y) => ((x - 13) / 8) ** 2 + ((y - 7.5) / 3.3) ** 2 < 1 || ((x - 10) / 4) ** 2 + ((y - 5.5) / 3) ** 2 < 1
  const kind = wmoWords(code)[2]
  return pixels(22, 12, (x, y) => {
    if (kind === 'SUN') return sun(x, y) ? 'Y' : null
    if (kind === 'PART') return cloud(x, y) ? 'W' : sun(x, y) ? 'Y' : null
    if (kind === 'FOG') return y % 3 === 1 && x > 2 && x < 20 ? 'W' : null
    const c = cloud(x, y - 1.5)
    if (c) return 'W'
    if (y >= 9) {
      if ((kind === 'RAIN' || kind === 'SHWR' || kind === 'DRZL') && (x + y) % 4 === 0 && x > 5 && x < 20) return 'C'
      if ((kind === 'SNOW' || kind === 'ICE') && (x * 3 + y) % 5 === 0 && x > 5 && x < 20) return 'W'
      if ((kind === 'STRM' || kind === 'HAIL') && x === 12 - (y - 9)) return 'Y'
    }
    return null
  })
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

const defs = []
const page = (num, title, def) => { defs.push({ num, title, feeds: [], ...def }); return num }
const LONG_DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
const MONTH_NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']
const longDate = (ms) => { const d = new Date(ms); return `${LONG_DAYS[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}` }

page('100', 'Index', {
  render(ctx) {
    const p = new Page()
    p.band(1, BLUE); p.band(2, BLUE)
    p.double(1, 1, 'INTERVAL', YELLOW, BLUE)
    p.text(1, 24, 'THE PAGES', WHITE)
    p.text(2, 24, 'BETWEEN PICTURES', CYAN)
    // Section by section, the section name in its own masthead colour, its
    // pages beside it -- the index is the map cycling follows.
    let r = BODY_TOP
    for (const sec of SECTIONS) {
      const m = MAGAZINES[sec.pages[0][1][0]]
      p.text(r, 1, sec.name, m.band === BLUE ? CYAN : m.band === WHITE ? WHITE : m.band)
      // Two to a row: a ten-column label and its number, twice.
      sec.pages.forEach(([label, num], i) => {
        const row = r + Math.floor(i / 2), col = i % 2 ? 25 : 10
        p.text(row, col, clip(label, 10), WHITE)
        p.text(row, col + 11, num, CYAN)
      })
      r += Math.ceil(sec.pages.length / 2)
    }
    p.text(r + 1, 10, 'WELCOME', WHITE); p.text(r + 1, 21, '190', CYAN)
    p.text(r + 1, 25, 'HELP', WHITE); p.text(r + 1, 36, '199', CYAN)
    // The ways in, said once, where a first-time viewer is looking.
    // Keyboard on a desktop, taps on a phone -- no mouse (pointer.js).
    p.text(22, 1, ctx.env.touch ? 'TAP A NUMBER, OR KEY IT IN' : 'KEY A PAGE NUMBER', MAGENTA)
    p.text(23, 1, ctx.env.touch ? 'CYCLE: THE CYCLE BUTTON' : 'N: LET THE SET CYCLE THE PAGES', WHITE)
    p.fast([['News', '101'], ['Weather', '300'], ['Money', '400'], ['Pause', '500']])
    return [p]
  },
})

// ---------------------------------------------------------------------------
// News: short bits you take in at a glance (2026-09-28, third pass). The
// second pass made 101 a Ceefax-style headline index with a page per story,
// and it was too much: this set is left on to cycle, and a story that needs
// its own page to be read is a story for somewhere else. So: two screens of
// briefs, back to the first pass's shape.
// ---------------------------------------------------------------------------

/** Capitalised words, for spotting the same story told twice. */
const namesIn = (t) => new Set((t.match(/\b[A-Z][a-z]{3,}\b/g) || []).filter(w => !['The', 'This', 'That', 'After', 'During', 'Former'].includes(w)))
export function sameStory(a, b) {
  const na = namesIn(a)
  let shared = 0
  for (const w of namesIn(b)) if (na.has(w)) shared++
  return shared >= 2
}

/** The first sentence of a news item: what a bite-sized brief is. */
export function brief(text, max = 170) {
  const first = String(text).match(/^.+?[.!?](?=\s+[A-Z0-9"']|$)/)?.[0] ?? String(text)
  return first.length <= max ? first : `${clip(first, max - 3)}...`
}

/** Portal sections, in the order briefs take within a day: politics and
 *  science before conflicts, so the page does not open on three airstrikes
 *  because Wikipedia files those first. */
const PORTAL_ORDER = ['Politics and elections', 'International relations', 'Science and technology',
  'Business and economy', 'Health and environment', 'Arts and culture', 'Law and crime', 'Sports',
  'Disasters and accidents', 'Armed conflicts and attacks']
const portalRank = (c) => { const i = PORTAL_ORDER.indexOf(c); return i < 0 ? PORTAL_ORDER.length : i }

/**
 * Fill exactly `pages` subpages from `blocks`, in order, letting a later
 * block fill the gap an earlier one could not -- so each page ends full.
 */
export function fillPages(blocks, pages, { top = BODY_TOP, bottom = BODY_BOTTOM, gap = 1 } = {}) {
  const out = []
  const left = blocks.slice()
  for (let pg = 0; pg < pages && left.length; pg++) {
    const placed = []
    let row = top
    for (let k = 0; k < left.length;) {
      const b = left[k]
      if (row + b.height - 1 <= bottom) { placed.push({ block: b, row }); row += b.height + gap; left.splice(k, 1) }
      else k++
    }
    if (placed.length) out.push(placed)
  }
  return out
}

page('101', 'News headlines', {
  feeds: ['itn', 'events'],
  subpageMs: 12000,
  render(ctx) {
    return gate(ctx, '101', 'NEWS', ['itn'], ({ itn }) => {
      const events = (ctx.entry('events')?.data?.items || []).map((e, i) => ({ ...e, i }))
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || portalRank(a.category) - portalRank(b.category) || a.i - b.i)
      const briefs = []
      for (const e of events) {
        const t = brief(e.text)
        if ([...itn.stories, ...briefs].some(s => sameStory(s, t))) continue
        briefs.push(t)
      }
      // Briefs cut off with "..." go last: a sentence that ends reads as
      // news, one that trails off as a fault.
      const whole = briefs.filter(t => !t.endsWith('...')), cut = briefs.filter(t => t.endsWith('...'))
      const blocks = [...itn.stories.map(brief), ...whole, ...cut].map(t => textBlock(null, t))
      const laid = fillPages(blocks, 2)
      return laid.map((placed, i) => {
        const p = new Page()
        masthead(p, '101', 'NEWS', { sub: i, subs: laid.length, right: i ? 'HEADLINES' : longDate(ctx.now).split(' ')[0] })
        for (const { block, row } of placed) block.draw(p, row)
        creditLine(p, ctx, 'itn')
        p.fast([['Did you', '102'], ['This day', '200'], ['Weather', '300'], ['Index', '100']])
        return p
      })
    })
  },
})

page('102', 'Did you know', {
  feeds: ['dyk'],
  subpageMs: 12000,
  render(ctx) {
    return gate(ctx, '102', 'DID YOU KNOW', ['dyk'], ({ dyk }) => dyk.facts.map((fact, i) => {
      const p = new Page()
      masthead(p, '102', 'DID YOU KNOW', { sub: i, subs: dyk.facts.length, right: 'NEWS' })
      p.double(BODY_TOP + 1, 1, '...that', YELLOW)
      p.wrap(BODY_TOP + 4, 1, fact, 38, WHITE, BODY_BOTTOM)
      creditLine(p, ctx, 'dyk')
      p.fast([['Headlines', '101'], ['This day', '200'], ['Born', '201'], ['Index', '100']])
      return p
    }))
  },
})

page('190', 'Welcome', {
  render(ctx) {
    const n = (ctx.editorial.notices || []).find(x => String(x.page) === '190') || { page: '190', title: 'WELCOME', lines: [] }
    return [noticePage({ ...n, page: '190' })]
  },
})

/** A notice page: written in the admin dashboard, stored in editorial.json,
 *  drawn from its markup (markup.js). */
function noticePage(n) {
  const p = new Page()
  masthead(p, n.page, n.title || 'NOTICES', { right: 'INTERVAL' })
  drawLines(p, n.lines || [], BODY_TOP, 1)
  p.fast([['Index', '100'], ['News', '101'], ['Help', '199'], ['Pause', '500']])
  return p
}

page('199', 'Help: using the set', {
  render(ctx) {
    const p = new Page()
    masthead(p, '199', 'HELP', { right: 'HOW TO USE' })
    let r = BODY_TOP
    for (const k of KEYS) {
      p.text(r, 1, k.keys, YELLOW)
      p.text(r, 12, k.label, WHITE)
      r++
      if (k.id === 'fastext') p.text(r++, 12, `OR ${FASTEXT_ALT}`, CYAN)
    }
    if (ctx.env.touch) p.wrap(r + 1, 1, 'Or tap a page number or a coloured key. Swipe for pages and subpages.', 38, WHITE, 21)
    p.text(22, 1, 'The top line counts while you wait.', GREEN)
    p.fast([['Index', '100'], ['Welcome', '190'], ['News', '101'], ['Quiz', '600']])
    return [p]
  },
})

page('1AF', 'Engineering test page', {
  hidden: true,
  render() {
    const p = new Page()
    p.band(1, WHITE); p.band(2, WHITE)
    p.double(1, 1, 'TEST PAGE 1AF', BLUE, WHITE)
    ;[BLACK, RED, GREEN, YELLOW, BLUE, MAGENTA, CYAN, WHITE].forEach((col, i) => {
      for (let r = 4; r < 8; r++) p.band(r, col, i * 5, i * 5 + 5)
    })
    p.text(8, 1, 'BLK  RED  GRN  YEL  BLU  MAG  CYN  WHT', WHITE)
    for (let i = 0; i < 32; i++) { p.mosaic(10, 4 + i, i, YELLOW); p.mosaic(11, 4 + i, i + 32, YELLOW) }
    for (let i = 0; i < 32; i++) { p.mosaic(12, 4 + i, i + 16, CYAN, BLACK, true) }
    p.text(13, 4, ' !"#$%&\'()*+,-./0123456789:;<=>?', WHITE)
    p.text(14, 4, '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_', GREEN)
    p.text(15, 4, '`abcdefghijklmnopqrstuvwxyz{|}~£', CYAN)
    p.wrap(17, 1, 'No remote control could key this page: its number has a letter in it. Real services kept their engineering pages here.', 38, WHITE)
    p.flashing(21, 1, 'THERE IS ANOTHER ON 1FF', MAGENTA)
    p.fast([['Index', '100'], ['1FF', '1FF'], null, ['Help', '199']])
    return [p]
  },
})

page('1FF', 'Four keys: a hidden game', {
  hidden: true,
  render(ctx) {
    const qs = ctx.editorial.fourkeys || []
    const g = ctx.env.game || { i: 0, score: 0, answered: null, best: 0 }
    const p = new Page()
    masthead(p, '6FF', 'FOUR KEYS', { right: `SCORE ${g.score}` })
    if (!qs.length) { p.wrap(BODY_TOP, 1, 'No questions loaded.', 38, CYAN); return [p] }
    const q = qs[g.i % qs.length]
    let r = p.wrap(BODY_TOP, 1, q.q, 38, WHITE)
    r++
    const cols = [RED, GREEN, YELLOW, CYAN]
    q.options.forEach((o, k) => {
      const mark = g.answered === null ? '' : k === q.answer ? ' <- RIGHT' : k === g.answered ? ' <- NO' : ''
      p.band(r, cols[k], 1, 4)
      p.text(r, 5, clip(o + mark, 33), cols[k])
      r += 2
    })
    if (g.answered === null) {
      p.text(20, 1, 'ANSWER WITH THE FOUR COLOURED KEYS', MAGENTA)
      p.fast(q.options.map((o, k) => [o, `game:${k}`]))
    } else {
      p.double(18, 1, g.answered === q.answer ? 'RIGHT!' : 'NOT THIS TIME', g.answered === q.answer ? GREEN : RED)
      p.text(21, 1, `BEST ${g.best}  QUESTION ${(g.i % qs.length) + 1} OF ${qs.length}`, CYAN)
      p.fast([['Next', 'game:next'], ['Index', '100'], null, ['Restart', 'game:reset']])
    }
    return [p]
  },
})

page('200', 'On this day', {
  feeds: ['otd'],
  subpageMs: 12000,
  render(ctx) {
    return gate(ctx, '200', 'ON THIS DAY', ['otd'], ({ otd }) => {
      const picks = otd.selected.length ? otd.selected : otd.events.slice(0, 8)
      // "28 SEP": the masthead's small print has eleven columns.
      const date = ctx.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()
      return picks.map((e, i) => {
        const p = new Page()
        masthead(p, '200', 'ON THIS DAY', { sub: i, subs: picks.length, right: date })
        p.double(BODY_TOP, 1, String(e.year ?? ''), YELLOW)
        p.wrap(BODY_TOP + 3, 1, e.text, 38, WHITE, BODY_BOTTOM)
        creditLine(p, ctx, 'otd')
        p.fast([['Born', '201'], ['News', '101'], ['Weather', '300'], ['Index', '100']])
        return p
      })
    })
  },
})

/**
 * Born today: one person a screen. Wikipedia's list runs newest first and
 * is hundreds long, most of it recent athletes, so a dozen are taken evenly
 * across it -- a spread of eras rather than the first twelve footballers.
 * The entry is "Name, what they were (d. year)"; the name goes big.
 */
export function pickBirths(births, n = 12) {
  if (births.length <= n) return births.slice()
  const step = births.length / n
  return Array.from({ length: n }, (_, i) => births[Math.floor(i * step + step / 2)])
}
page('201', 'Born today', {
  feeds: ['otd'],
  subpageMs: 10000,
  render(ctx) {
    return gate(ctx, '201', 'BORN TODAY', ['otd'], ({ otd }) => {
      const picks = pickBirths(otd.births).sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
      return picks.map((e, i) => {
        const p = new Page()
        masthead(p, '201', 'BORN TODAY', { sub: i, subs: picks.length, right: 'TODAY' })
        const at = e.text.indexOf(', ')
        const name = at > 0 ? e.text.slice(0, at) : e.text
        const what = at > 0 ? e.text.slice(at + 2) : ''
        p.double(BODY_TOP, 1, String(e.year ?? ''), CYAN)
        let r = BODY_TOP + 3
        for (const l of wrapText(name, 38).slice(0, 2)) { p.double(r, 1, l, YELLOW); r += 2 }
        if (what) p.wrap(r + 1, 1, what[0].toUpperCase() + what.slice(1), 38, WHITE, BODY_BOTTOM)
        creditLine(p, ctx, 'otd')
        p.fast([['This day', '200'], ['News', '101'], ['Weather', '300'], ['Index', '100']])
        return p
      })
    })
  },
})

/** Weather pages share a front door: no location yet, and why. */
function weatherGate(num, title, ctx, fn) {
  const loc = ctx.env.locationState
  if (loc !== 'granted') {
    const p = new Page()
    masthead(p, num, title)
    p.double(BODY_TOP, 1, 'LOCAL WEATHER', YELLOW)
    const copy = {
      insecure: ['The set can only ask where you are over a secure connection, and this page is on plain http.', 'Open INTERVAL over https or on localhost.'],
      unsupported: ['This browser has no location service, so there is nothing to ask.'],
      denied: ['You said no to sharing your location, so there is no local forecast.', 'Press red to be asked again.'],
      asking: ['Asking your browser where you are...'],
      failed: ['Your browser could not say where you are. Press red to try again.'],
    }[loc] || [
      'The forecast is for where you are, so the set has to ask. Press red and your browser will.',
      'Your position is used for the forecast and kept in memory only. Nothing is stored.',
    ]
    let r = BODY_TOP + 3
    for (const para of copy) r = p.wrap(r, 1, para, 38, WHITE) + 1
    p.fast([loc === 'insecure' || loc === 'unsupported' || loc === 'asking' ? null : ['Locate me', 'locate'], ['Sky', '310'], ['Quakes', '330'], ['Index', '100']])
    return [p]
  }
  return gate(ctx, num, title, ['weather'], ({ weather }) => fn(weather))
}

page('300', 'Weather: today', {
  feeds: ['weather'],
  render(ctx) {
    return weatherGate('300', 'WEATHER', ctx, (w) => {
      const p = new Page()
      masthead(p, '300', 'WEATHER', { right: 'TODAY' })
      p.art(BODY_TOP, 1, weatherIcon(w.current.code), { W: WHITE, Y: YELLOW, C: CYAN })
      p.text(BODY_TOP, 14, 'NOW', YELLOW)
      p.double(BODY_TOP + 1, 14, `${w.current.temp}${w.units}`, WHITE)
      p.text(BODY_TOP + 1, 22, clip(wmoWords(w.current.code)[1], 17), CYAN)
      if (w.current.wind !== null) p.text(BODY_TOP + 3, 14, `WIND ${compass(w.current.windDir)} ${w.current.wind} ${w.windUnit}`, GREEN)
      let r = BODY_TOP + 6
      for (const part of w.parts) {
        p.text(r, 1, part.name, YELLOW)
        if (part.temp !== null) {
          p.text(r, 12, `${part.temp}${w.units}`.padStart(4), WHITE)
          p.text(r, 18, clip(wmoWords(part.code)[1], 14), CYAN)
          if (part.pop !== null) p.text(r, 34, `${part.pop}%`.padStart(4), part.pop >= 50 ? CYAN : GREEN)
        } else p.text(r, 12, 'PAST', MAGENTA)
        r += 2
      }
      const today = w.days[0]
      if (today) {
        p.text(r, 1, `SUNRISE ${today.sunrise ?? '--:--'}   SUNSET ${today.sunset ?? '--:--'}`, WHITE)
        p.text(r + 1, 1, `HIGH ${today.hi}${w.units}   LOW ${today.lo}${w.units}`, YELLOW)
      }
      p.text(22, 1, '% IS THE CHANCE OF RAIN', MAGENTA)
      creditLine(p, ctx, 'weather')
      p.fast([['5-day', '301'], ['Sky', '310'], ['Space', '320'], ['Index', '100']])
      return [p]
    })
  },
})

page('301', 'Weather: five days', {
  feeds: ['weather'],
  render(ctx) {
    return weatherGate('301', '5-DAY FORECAST', ctx, (w) => {
      const p = new Page()
      masthead(p, '301', '5-DAY FORECAST', { right: 'WEATHER' })
      p.text(BODY_TOP, 1, 'DAY', CYAN); p.text(BODY_TOP, 6, 'HIGH', CYAN); p.text(BODY_TOP, 12, 'LOW', CYAN)
      p.text(BODY_TOP, 17, 'SKY', CYAN); p.text(BODY_TOP, 34, 'RAIN', CYAN)
      w.days.slice(0, 5).forEach((d, i) => {
        const r = BODY_TOP + 2 + i * 3
        const day = new Date(`${d.date}T12:00`)
        p.text(r, 1, i === 0 ? 'TDY' : DAYS[day.getDay()], YELLOW)
        p.text(r, 6, `${d.hi}${w.units}`, YELLOW)
        p.text(r, 12, `${d.lo}${w.units}`, CYAN)
        p.text(r, 17, clip(wmoWords(d.code)[1], 16), WHITE)
        if (d.pop !== null) p.text(r, 34, `${d.pop}%`.padStart(4), d.pop >= 50 ? CYAN : GREEN)
        // A bar from the low to the high on a shared scale.
        const lo = Math.min(...w.days.map(x => x.lo)), hi = Math.max(...w.days.map(x => x.hi))
        const span = Math.max(1, hi - lo)
        const a = Math.round((d.lo - lo) / span * 60), b = Math.round((d.hi - lo) / span * 60)
        const start = Math.floor(a / 2)
        p.bar(r + 1, 6 + start, Math.max(2, b - start * 2), d.hi >= 80 || (w.units === 'C' && d.hi >= 27) ? RED : YELLOW)
      })
      creditLine(p, ctx, 'weather')
      p.fast([['Today', '300'], ['Sky', '310'], ['Space', '320'], ['Index', '100']])
      return [p]
    })
  },
})

page('310', 'Sky tonight', {
  render(ctx) {
    const m = moon(ctx.now)
    const p = new Page()
    masthead(p, '310', 'SKY TONIGHT', { right: 'THE MOON' })
    const art = pixels(24, 24, (x, y) => {
      const lit = litAt((x + 0.5 - 12) / 11.5, (y + 0.5 - 12) / 11.5, m.phase)
      return lit === null ? null : lit ? 'W' : 'B'
    })
    p.art(BODY_TOP, 1, art, { W: WHITE, B: BLUE })
    p.text(BODY_TOP, 16, 'THE MOON', YELLOW)
    p.text(BODY_TOP + 2, 16, m.name, WHITE)
    p.text(BODY_TOP + 4, 16, `LIT   ${Math.round(m.lit * 100)}%`, GREEN)
    p.text(BODY_TOP + 5, 16, `AGE   ${m.age.toFixed(1)} DAYS`, GREEN)
    const full = m.toFull < 1 ? 'FULL TONIGHT' : `FULL IN ${Math.round(m.toFull)} DAYS`
    const nw = m.toNew < 1 ? 'NEW TONIGHT' : `NEW IN ${Math.round(m.toNew)} DAYS`
    p.text(BODY_TOP + 7, 16, m.phase < 0.5 ? full : nw, CYAN)
    const w = ctx.entry('weather')?.data
    const today = ctx.env.locationState === 'granted' ? w?.days?.[0] : null
    let r = BODY_TOP + 10
    if (today) {
      p.text(r, 1, `SUNRISE ${today.sunrise}   SUNSET ${today.sunset}`, YELLOW)
      const len = dayLength(today.sunrise, today.sunset)
      if (len) p.text(r + 1, 1, `DAYLIGHT ${len}`, WHITE)
      r += 3
    } else {
      r = p.wrap(r, 1, 'Sunrise and sunset need your location: see page 300.', 38, WHITE) + 1
    }
    p.wrap(r, 1, 'Worked out on the set from the date. This page needs no signal at all.', 38, GREEN)
    p.fast([['Weather', '300'], ['Space', '320'], ['Breathe', '500'], ['Index', '100']])
    return [p]
  },
})

page('320', 'Space weather', {
  feeds: ['kp'],
  render(ctx) {
    return gate(ctx, '320', 'SPACE WEATHER', ['kp'], ({ kp }) => {
      const p = new Page()
      masthead(p, '320', 'SPACE WEATHER', { right: 'AURORA' })
      const now = kp.latest.kp
      const level = now >= 7 ? ['SEVERE STORM', MAGENTA] : now >= 5 ? ['GEOMAGNETIC STORM', RED] : now >= 4 ? ['ACTIVE', YELLOW] : ['QUIET', GREEN]
      p.text(BODY_TOP, 1, 'PLANETARY K-INDEX NOW', CYAN)
      p.double(BODY_TOP + 1, 1, now.toFixed(1), WHITE)
      p.double(BODY_TOP + 1, 8, level[0], level[1])
      // The last 24 readings (3 days), as a bar chart: one column each,
      // three rows high, so 18 half-blocks of scale for Kp 0-9.
      const last = kp.readings.slice(-24)
      const top = BODY_TOP + 5
      p.text(top, 1, 'LAST 3 DAYS', CYAN)
      last.forEach((rd, i) => {
        const units = Math.round(Math.min(9, rd.kp) / 9 * 9)
        const col = rd.kp >= 5 ? RED : rd.kp >= 4 ? YELLOW : GREEN
        for (let k = 0; k < 3; k++) {
          const fill = Math.max(0, Math.min(3, units - (2 - k) * 3))
          const bits = [0, 48, 60, 63][fill]
          if (bits) p.mosaic(top + 1 + k, 2 + i, bits, col)
        }
      })
      p.text(top + 4, 1, '0-3 QUIET   4 ACTIVE   5+ STORM', WHITE)
      p.wrap(top + 6, 1, now >= 5
        ? 'A storm this strong can push the aurora well south of the usual latitudes. Worth a look outside after dark.'
        : 'Aurora is unlikely away from high latitudes at this level.', 38, WHITE)
      creditLine(p, ctx, 'kp')
      p.fast([['Weather', '300'], ['Sky', '310'], ['Quakes', '330'], ['Index', '100']])
      return [p]
    })
  },
})

page('330', 'Earthquakes', {
  feeds: ['quakes'],
  render(ctx) {
    return gate(ctx, '330', 'EARTHQUAKES', ['quakes'], ({ quakes }) => {
      const rows = quakes.slice(0, 32)
      const per = 14
      const chunks = []
      for (let i = 0; i < Math.max(1, rows.length); i += per) chunks.push(rows.slice(i, i + per))
      return chunks.map((chunk, i) => {
        const p = new Page()
        masthead(p, '330', 'EARTHQUAKES', { sub: i, subs: chunks.length, right: 'PAST DAY' })
        p.text(BODY_TOP, 1, 'MAGNITUDE 4.5 AND OVER', CYAN)
        p.text(BODY_TOP + 1, 1, 'TIME  MAG WHERE', YELLOW)
        if (!rows.length) p.text(BODY_TOP + 3, 1, 'None in the past day.', WHITE)
        chunk.forEach((q, k) => {
          const r = BODY_TOP + 2 + k
          const d = new Date(q.time)
          p.text(r, 1, `${pad2(d.getHours())}${pad2(d.getMinutes())}`, CYAN)
          p.text(r, 6, q.mag.toFixed(1), q.mag >= 6 ? RED : YELLOW)
          p.text(r, 10, clip(q.place, 20), WHITE)
          const col = q.mag >= 6.5 ? MAGENTA : q.mag >= 5.5 ? RED : YELLOW
          p.bar(r, 31, Math.max(1, Math.round((q.mag - 4) * 3)), col)
          if (q.tsunami) p.text(r, 30, 'T', MAGENTA)
        })
        p.text(22, 1, 'TIMES LOCAL.  T: TSUNAMI MESSAGE ISSUED', MAGENTA)
        creditLine(p, ctx, 'quakes')
        p.fast([['Space', '320'], ['Weather', '300'], ['Money', '400'], ['Index', '100']])
        return p
      })
    })
  },
})


// ---------------------------------------------------------------------------
// Money: the world's numbers at a glance. No crypto (2026-09-28, by choice),
// and no stock indices: nothing that serves them is open to a browser
// without a key, and this site has no server to hide one behind.
// ---------------------------------------------------------------------------

const CURRENCY_NAMES = { EUR: 'Euro', GBP: 'Pound', JPY: 'Yen', CNY: 'Yuan', CAD: 'Canadian dollar', CHF: 'Swiss franc', AUD: 'Australian dollar', INR: 'Rupee' }
/** A rate to four significant figures: 0.8789, 15.69, 156.9. */
const sig = (x) => (x >= 100 ? x.toFixed(1) : x >= 10 ? x.toFixed(2) : x.toFixed(4))
/** ▲ or ▼ and the day's change in percent, or blank when unchanged. */
function move(now, prev) {
  if (!Number.isFinite(prev) || prev === 0) return null
  const pct = (now - prev) / prev * 100
  if (Math.abs(pct) < 0.005) return { mark: '=', pct: '0.00%', up: null }
  return { mark: pct > 0 ? '▲' : '▼', pct: `${Math.abs(pct).toFixed(2)}%`, up: pct > 0 }
}

page('400', 'Currencies', {
  feeds: ['rates'],
  render(ctx) {
    return gate(ctx, '400', 'CURRENCIES', ['rates'], ({ rates }) => {
      const p = new Page()
      masthead(p, '400', 'CURRENCIES', { right: 'MONEY' })
      p.text(BODY_TOP, 1, 'ONE US DOLLAR BUYS', CYAN)
      const order = ['EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'CHF', 'AUD', 'INR']
      const byCode = Object.fromEntries(rates.rates.map(r => [r.code, r]))
      let r = BODY_TOP + 2
      for (const code of order) {
        const x = byCode[code]
        if (!x) continue
        p.text(r, 1, code, YELLOW)
        p.text(r, 6, CURRENCY_NAMES[code] || code, WHITE)
        p.text(r, 24, sig(x.rate).padStart(8), WHITE)
        const m = move(x.rate, x.prev)
        if (m) { p.text(r, 33, m.mark, m.up === null ? WHITE : m.up ? GREEN : RED); p.text(r, 34, m.pct.padStart(6), m.up === null ? WHITE : m.up ? GREEN : RED) }
        r += 2
      }
      p.text(22, 1, `${rates.date}  ▲ THE DOLLAR BUYS MORE`, CYAN)
      creditLine(p, ctx, 'rates')
      p.fast([['Metals', '401'], ['World', '410'], ['News', '101'], ['Index', '100']])
      return [p]
    })
  },
})

const money$ = (x) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
page('401', 'Gold and silver', {
  feeds: ['metals'],
  render(ctx) {
    return gate(ctx, '401', 'GOLD & SILVER', ['metals'], ({ metals }) => {
      const p = new Page()
      masthead(p, '401', 'GOLD & SILVER', { right: 'MONEY' })
      p.text(BODY_TOP, 1, 'PER TROY OUNCE, IN US DOLLARS', CYAN)
      const colour = { XAU: YELLOW, XAG: WHITE, XPT: CYAN }
      let r = BODY_TOP + 2
      for (const m of metals.metals) {
        p.text(r, 1, m.name.toUpperCase(), colour[m.symbol] || WHITE)
        p.double(r + 1, 1, money$(m.price), colour[m.symbol] || WHITE)
        r += 4
      }
      const gold = metals.metals.find(m => m.symbol === 'XAU'), silver = metals.metals.find(m => m.symbol === 'XAG')
      if (gold && silver) p.text(r, 1, `ONE OUNCE OF GOLD = ${Math.round(gold.price / silver.price)} OF SILVER`, GREEN)
      creditLine(p, ctx, 'metals')
      p.fast([['Currency', '400'], ['World', '410'], ['News', '101'], ['Index', '100']])
      return [p]
    })
  },
})

/**
 * The world in numbers. The population is the World Bank's latest mid-year
 * figure grown at its latest growth rate to this second -- an estimate,
 * ticking, which is what the page says it is. liveMs keeps it moving.
 */
export function worldPopulationNow(world, nowMs) {
  const pop = world['SP.POP.TOTL'], grow = world['SP.POP.GROW']
  if (!pop) return null
  const midYear = Date.UTC(pop.year, 6, 1)
  const years = (nowMs - midYear) / (365.2425 * 864e5)
  const rate = (grow?.value ?? 0.9) / 100
  return Math.round(pop.value * Math.pow(1 + rate, years))
}
page('410', 'The world in numbers', {
  feeds: ['world'],
  liveMs: 1000,
  render(ctx) {
    return gate(ctx, '410', 'THE WORLD', ['world'], ({ world }) => {
      const p = new Page()
      masthead(p, '410', 'THE WORLD', { right: 'IN NUMBERS' })
      const pop = worldPopulationNow(world, ctx.now)
      p.text(BODY_TOP, 1, 'PEOPLE ALIVE NOW (ESTIMATE)', CYAN)
      if (pop) p.double(BODY_TOP + 1, 1, pop.toLocaleString('en-US'), YELLOW)
      const line = (r, label, id, fmt) => {
        const x = world[id]
        if (!x) return
        p.text(r, 1, label, WHITE)
        p.text(r, 26, fmt(x.value).padStart(7), YELLOW)
        p.text(r, 34, String(x.year), CYAN)
      }
      line(BODY_TOP + 5, 'ECONOMIC GROWTH', 'NY.GDP.MKTP.KD.ZG', v => `${v.toFixed(1)}%`)
      line(BODY_TOP + 7, 'INFLATION', 'FP.CPI.TOTL.ZG', v => `${v.toFixed(1)}%`)
      line(BODY_TOP + 9, 'UNEMPLOYMENT', 'SL.UEM.TOTL.ZS', v => `${v.toFixed(1)}%`)
      line(BODY_TOP + 11, 'POPULATION GROWTH', 'SP.POP.GROW', v => `${v.toFixed(2)}%`)
      p.text(BODY_TOP + 13, 1, 'WHOLE WORLD, LATEST YEAR REPORTED', GREEN)
      creditLine(p, ctx, 'world')
      p.fast([['Currency', '400'], ['Metals', '401'], ['News', '101'], ['Index', '100']])
      return [p]
    })
  },
})

// ---------------------------------------------------------------------------
// Pause (2026-09-28): the mindful section. Worked out on the set or written
// in the editorial file -- the quote services a browser could use either
// had no CORS (ZenQuotes) or no longer answer.
// ---------------------------------------------------------------------------

/** Box breathing: in four, hold four, out four, hold four. */
export const BREATH = [['BREATHE IN', 4000], ['HOLD', 4000], ['BREATHE OUT', 4000], ['HOLD', 4000]]
export const BREATH_CYCLE_MS = BREATH.reduce((n, [, ms]) => n + ms, 0)
/** Where in the breath `ms` falls: the step, the count within it, and how
 *  full the lungs are (0..1), which sizes the circle. */
export function breathAt(ms) {
  let t = ((ms % BREATH_CYCLE_MS) + BREATH_CYCLE_MS) % BREATH_CYCLE_MS
  for (let i = 0; i < BREATH.length; i++) {
    const [word, len] = BREATH[i]
    if (t < len) {
      const k = t / len
      const full = i === 0 ? k : i === 1 ? 1 : i === 2 ? 1 - k : 0
      return { word, step: i, count: Math.floor(k * 4) + 1, full }
    }
    t -= len
  }
  return { word: BREATH[0][0], step: 0, count: 1, full: 0 }
}
page('500', 'Breathe', {
  liveMs: 200,
  render(ctx) {
    const b = breathAt(ctx.now)
    const p = new Page()
    masthead(p, '500', 'BREATHE', { right: 'PAUSE' })
    // The circle: 80x45 dots. On the tube a dot is about 1.24 times as wide
    // as it is tall (half a 9-dot cell stretched onto a 4:3 face, by a third
    // of a 16-line one), so x distances count for 1.24 to keep it round.
    // The first cut had the factor inverted and drew an oval.
    const radius = 3 + b.full * 15
    const art = pixels(80, 45, (x, y) => {
      const d = Math.hypot((x - 40) * 1.24, y - 22)
      return d < radius ? 'C' : null
    })
    p.art(BODY_TOP, 0, art, { C: b.step === 2 ? BLUE : CYAN })
    const word = b.word
    p.band(19, BLACK); p.band(20, BLACK)
    p.double(19, Math.floor((COLS - word.length) / 2), word, WHITE)
    p.text(21, 19, String(b.count), YELLOW)
    p.text(22, 1, 'IN FOUR, HOLD FOUR, OUT FOUR, HOLD FOUR', GREEN)
    p.fast([['A thought', '501'], ['Index', '100'], ['News', '101'], ['Gallery', '700']])
    return [p]
  },
})

/** Today's thought: one from the editorial list, the same all day. */
export function thoughtFor(list, nowMs) {
  if (!list?.length) return null
  const d = new Date(nowMs)
  const day = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5)
  return list[day % list.length]
}
page('501', 'A thought', {
  render(ctx) {
    const t = thoughtFor(ctx.editorial.thoughts, ctx.now)
    const p = new Page()
    masthead(p, '501', 'A THOUGHT', { right: 'FOR TODAY' })
    if (!t) { p.wrap(BODY_TOP, 1, 'No thoughts written yet.', 38, CYAN); return [p] }
    const lines = wrapText(`"${t.text}"`, 36)
    let r = Math.max(BODY_TOP + 1, 12 - lines.length)
    for (const l of lines) p.text(r++, 2, l, YELLOW)
    if (t.by) p.text(r + 1, 38 - Math.min(36, t.by.length + 2), clip(`- ${t.by}`, 36), CYAN)
    p.fast([['Breathe', '500'], ['Index', '100'], ['News', '101'], ['Gallery', '700']])
    return [p]
  },
})

page('600', 'Quiz', {
  render(ctx) {
    const qs = ctx.editorial.quiz || []
    const per = 4
    const chunks = []
    for (let i = 0; i < Math.max(1, qs.length); i += per) chunks.push(qs.slice(i, i + per))
    return chunks.map((chunk, i) => {
      const p = new Page()
      masthead(p, '600', 'QUIZ', { sub: i, subs: chunks.length, right: 'R REVEALS' })
      let r = BODY_TOP
      chunk.forEach((q, k) => {
        p.text(r, 1, String(i * per + k + 1).padStart(2), YELLOW)
        r = p.wrap(r, 4, q.q, 35, WHITE)
        p.text(r, 4, 'A:', GREEN)
        p.concealed(r, 7, clip(q.a, 32), YELLOW)
        r += 2
      })
      p.text(22, 1, 'R REVEALS THE ANSWERS', MAGENTA)
      p.fast([['Index', '100'], ['Gallery', '700'], ['Pause', '500'], ['Help', '199']])
      return p
    })
  },
})

// Gallery: block-graphic pictures, generated rather than stored so each is a
// few lines of arithmetic instead of a thousand hand-placed cells.
const GALLERY = [
  {
    title: 'MOONRISE',
    draw(p) {
      const HZ = 40
      const art = pixels(80, 57, (x, y) => {
        if ((x - 57) ** 2 + (y - 14) ** 2 < 62) return 'W'
        if (y < HZ) return hash2(x, y) > 0.986 ? 'Y' : null
        if (y === HZ) return 'C'
        const spread = 2 + (y - HZ) / 4
        if (Math.abs(x - 57) < spread && (x * 3 + y * 5) % 4 !== 0 && y % 2 === 0) return 'Y'
        if (y % 3 === 0 && (x + y * 5) % 13 < 3) return 'C'
        return null
      })
      p.art(3, 0, art, { W: WHITE, Y: YELLOW, C: CYAN }, (r) => ((r - 3) * 3 < HZ ? BLUE : BLACK))
    },
  },
  {
    title: 'TEST CARD',
    draw(p) {
      const bars = [WHITE, YELLOW, CYAN, GREEN, MAGENTA, RED, BLUE, BLACK]
      for (let r = 3; r < 22; r++) bars.forEach((c, i) => p.band(r, c, i * 5, i * 5 + 5))
      const art = pixels(80, 57, (x, y) => {
        const d = Math.hypot((x - 40) / 1, (y - 28) * 1.5)
        return d < 22 && d > 19.5 ? 'W' : d <= 19.5 && d > 18 ? 'K' : null
      })
      p.art(3, 0, art, { W: WHITE, K: BLACK })
      p.band(12, BLACK, 12, 28); p.band(13, BLACK, 12, 28)
      p.double(12, 16, 'INTERVAL', WHITE, BLACK)
    },
  },
  {
    title: 'THE SEA',
    draw(p) {
      // Swell lines under a low sun: three sine waves, each a band of dots.
      const art = pixels(80, 57, (x, y) => {
        if ((x - 22) ** 2 + ((y - 16) * 1.6) ** 2 < 70) return 'Y'
        for (const [base, amp, len, ch] of [[30, 2, 23, 'C'], [38, 3, 17, 'B'], [47, 3.5, 13, 'W']]) {
          const w = base + amp * Math.sin((x + base) / len * Math.PI * 2)
          if (Math.abs(y - w) < 1) return ch
        }
        return null
      })
      p.art(3, 0, art, { Y: YELLOW, C: CYAN, B: BLUE, W: WHITE })
    },
  },
  {
    title: 'CITY AT NIGHT',
    draw(p) {
      const art = pixels(80, 57, (x, y) => {
        const bw = 6 + Math.floor(hash2(Math.floor(x / 7), 1) * 4)
        const h = 18 + Math.floor(hash2(Math.floor(x / 7), 2) * 28)
        if (y > 56 - h) {
          if (x % 7 === 6) return null
          const lit = (x % 2 === 0) && (y % 3 === 0) && hash2(x, y) > 0.45
          return lit ? 'Y' : 'B'
        }
        if (hash2(x, y + 99) > 0.992) return 'W'
        return null
      })
      p.art(3, 0, art, { Y: YELLOW, B: BLUE, W: WHITE })
    },
  },
]

page('700', 'Gallery', {
  render() {
    return GALLERY.map((g, i) => {
      const p = new Page()
      masthead(p, '700', 'GALLERY', { sub: i, subs: GALLERY.length, right: 'PICTURES' })
      g.draw(p)
      p.text(23, 1, `${g.title}, IN 2 BY 3 BLOCKS`, CYAN)
      p.fast([['Index', '100'], ['Sky', '310'], ['Quiz', '600'], ['Breathe', '500']])
      return p
    })
  },
})

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/** Every fixed page, by number. */
export const PAGES = new Map(defs.map(d => [d.num, d]))

/**
 * The definition for a page number, including notice pages written in the
 * editorial file. Null for a page the service does not carry, which the set
 * searches for forever, as a real one did.
 */
export function pageDef(num, ctx) {
  const n = String(num).toUpperCase()
  if (PAGES.has(n)) return PAGES.get(n)
  const notice = (ctx?.editorial?.notices || []).find(x => String(x.page).toUpperCase() === n)
  if (notice) return { num: n, title: `Notice: ${notice.title || n}`, feeds: [], render: () => [noticePage({ ...notice, page: n })] }
  return null
}

/** The pages UP and DOWN step through: everything not hidden, in order. */
export function pageOrder(ctx) {
  const nums = defs.filter(d => !d.hidden).map(d => d.num)
  for (const n of ctx?.editorial?.notices || []) nums.push(String(n.page).toUpperCase())
  return [...new Set(nums)].sort((a, b) => parseInt(a, 16) - parseInt(b, 16))
}

/** Every page the index points at, for the lint: each must exist. */
export const INDEX = SECTIONS.flatMap(s => s.pages).concat([['NOTICES', '190'], ['HELP', '199']])
