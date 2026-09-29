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
//            moves (breathe, the clock, the candle, the gallery, the
//            gallery, weather that rains). The pictures are pictures.js.
//   cycleMs  how long cycling (N) leaves the page up, where the default
//            (its subpages' worth, 12-36s) is wrong for it.
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
const { FEEDS, staleAfter, LEAGUES } = await import(`./feeds.js?v=${V}`)
const { drawLines } = await import(`./markup.js?v=${V}`)
const Pic = await import(`./pictures.js?v=${V}`)

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
  6: { name: 'SPORT', band: GREEN, ink: BLACK, accent: BLACK },
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
  { name: 'TODAY', pages: [['THIS DAY', '200'], ['BORN TODAY', '201'], ['CLOCK', '202'], ['COMING UP', '203']] },
  // 300 is LOCAL, not TODAY: the index printed TODAY as a section and again
  // as a weather page two rows apart.
  { name: 'WEATHER', pages: [['LOCAL', '300'], ['5-DAY', '301'], ['US CITIES', '302']] },
  { name: 'MONEY', pages: [['MARKETS', '401'], ['YOUR MONEY', '402']] },
  // In page-number order (2026-09-28): SPORT came before PAUSE, and the index
  // read 401, 601, 500 -- which on a teletext index looks like a misprint.
  { name: 'PAUSE', pages: [['BREATHE', '500'], ['A THOUGHT', '501'], ['FOCUS', '502'], ['DECIDE', '503']] },
  // Three to a row on the index (`perRow`), so the short league names.
  { name: 'SPORT', perRow: 3, pages: [['NFL', '601'], ['NBA', '602'], ['MLB', '603'], ['NHL', '604'], ['EPL', '605'], ['CFB', '606']] },
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
  p.fast([['INDEX', '100'], null, null, ['HELP', '199']])
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
function weatherIcon(code, ms = 0) {
  const f = Math.floor(ms / 250)
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
      // The drops fall: the pattern steps down a row every quarter second.
      if ((kind === 'RAIN' || kind === 'SHWR' || kind === 'DRZL') && (x + y - f) % 4 === 0 && x > 5 && x < 20) return 'C'
      if ((kind === 'SNOW' || kind === 'ICE') && (x * 3 + y - f) % 5 === 0 && x > 5 && x < 20) return 'W'
      if ((kind === 'STRM' || kind === 'HAIL') && x === 12 - (y - 9) && f % 6 < 2) return 'Y'
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
/** "MONDAY, SEPTEMBER 28": US order (2026-09-28; "MONDAY 28 SEPTEMBER" read
 *  as British to the people this is for). */
const longDate = (ms) => { const d = new Date(ms); return `${LONG_DAYS[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}` }

/**
 * The NOW line on the index (2026-09-28): what is happening, in one row --
 * the Dow's last move, the temperature (here if the set knows where here
 * is, else New York), and a score (a game in progress, else the latest
 * final). Ceefax's 100 carried a teaser for the same reason: an index that
 * is only a table of contents is a page nobody leaves up. Each item appears
 * only once its source has answered, so the index never waits on a fetch;
 * items that would not fit are dropped whole, never cut.
 */
export function nowItems(ctx) {
  const items = []
  const dow = ctx.entry('markets')?.data?.series?.find(s => s.id === 'DJIA')
  if (dow && Number.isFinite(dow.prev) && dow.prev) {
    const pct = (dow.value / dow.prev - 1) * 100
    items.push([`DOW ${pct >= 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}%`, pct >= 0 ? GREEN : RED])
  }
  const here = ctx.entry('weather')?.data
  const cities = ctx.entry('cities')?.data
  if (here?.current && Number.isFinite(here.current.temp)) items.push([`HERE ${here.current.temp}${here.units || 'F'}`, CYAN])
  else {
    const ny = cities?.cities?.find(c => c.name === 'NEW YORK')
    if (ny && Number.isFinite(ny.temp)) items.push([`NYC ${ny.temp}${cities.units || 'F'}`, CYAN])
  }
  const games = LEAGUES.flatMap(([key]) => (ctx.entry(`sport_${key}`)?.data?.games || []))
  const g = games.find(x => x.state === 'in') ||
    games.filter(x => x.state === 'post').sort((a, b) => (b.date || 0) - (a.date || 0))[0]
  if (g) items.push([`${g.away.abbr} ${g.away.score} ${g.home.abbr} ${g.home.score}`, g.state === 'in' ? GREEN : WHITE])
  return items
}

page('100', 'Index', {
  feeds: ['markets', 'cities', ...LEAGUES.map(([key]) => `sport_${key}`)],
  // Redrawn in place so the NOW line keeps up; the table itself never moves.
  liveMs: 15000,
  render(ctx) {
    const p = new Page()
    p.band(1, BLUE); p.band(2, BLUE)
    p.double(1, 1, 'INTERVAL', YELLOW, BLUE)
    // INDEX, not the tagline again: the header row already says INTERVAL.
    p.double(1, 33, 'INDEX', WHITE, BLUE)
    let c = 5
    const items = nowItems(ctx)
    if (items.length) p.text(3, 1, 'NOW', YELLOW)
    for (const [text, colour] of items) {
      if (c + text.length > COLS - 1) break
      p.text(3, c, text, colour)
      c += text.length + 2
    }
    // Section by section, in page-number order, the name in its own
    // masthead colour and a blank row between sections -- the index is the
    // map cycling follows. Two to a row (ten-column label, then its number),
    // or three for a section of short names (sport).
    let r = 5
    for (const sec of SECTIONS) {
      const m = MAGAZINES[sec.pages[0][1][0]]
      p.text(r, 1, sec.name, m.band === BLUE ? CYAN : m.band === WHITE ? WHITE : m.band)
      const per = sec.perRow || 2
      sec.pages.forEach(([label, num], i) => {
        const row = r + Math.floor(i / per)
        if (per === 3) {
          const col = 10 + (i % 3) * 10
          p.text(row, col, label, WHITE); p.text(row, col + label.length + 1, num, CYAN)
        } else {
          const col = i % 2 ? 25 : 10
          p.text(row, col, clip(label, 10), WHITE)
          p.text(row, col + 11, num, CYAN)
        }
      })
      r += Math.ceil(sec.pages.length / per) + 1
    }
    // The two pages outside the sections, straight under the list and in its
    // columns, so they read as part of it.
    p.text(r - 1, 10, 'WELCOME', WHITE); p.text(r - 1, 21, '190', CYAN)
    p.text(r - 1, 25, 'HELP', WHITE); p.text(r - 1, 36, '199', CYAN)
    // The ways in, said once, in one line, where a first-time viewer is
    // looking. Keyboard on a desktop, taps on a phone -- no mouse (pointer.js).
    p.text(23, 1, ctx.env.touch ? 'TAP A NUMBER, OR PRESS CYCLE' : 'KEY A PAGE NUMBER, OR N TO CYCLE', MAGENTA)
    p.fast([['NEWS', '101'], ['WEATHER', '302'], ['SPORT', '601'], ['PAUSE', '500']])
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
        p.fast([['FACTS', '102'], ['TODAY', '200'], ['WEATHER', '300'], ['INDEX', '100']])
        return p
      })
    })
  },
})

/**
 * Did you know (2026-09-28, second pass): short tech, gaming and hacking
 * facts from the editorial file, eight a day, a different eight each day.
 * The first pass read Wikipedia's own "Did you know", which is true and odd
 * and far too deep for a glance ("...that Sun Pictures released nearly 20
 * films between 2008 and 2010..."), and it cannot be steered to a subject.
 */
export const FACTS_PER_DAY = 8
export function factsFor(list, nowMs) {
  if (!list?.length) return []
  const d = new Date(nowMs)
  const day = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5)
  const n = Math.min(FACTS_PER_DAY, list.length)
  return Array.from({ length: n }, (_, i) => list[(day * n + i) % list.length])
}
const TAG_COLOUR = { TECH: CYAN, GAMES: GREEN, HACKING: MAGENTA }
page('102', 'Did you know', {
  subpageMs: 12000,
  render(ctx) {
    const facts = factsFor(ctx.editorial.facts, ctx.now)
    if (!facts.length) return [listPage('102', 'DID YOU KNOW', [], ctx, { fast: [['INDEX', '100']], empty: 'No facts written yet.' })[0]]
    return facts.map((f, i) => {
      const p = new Page()
      masthead(p, '102', 'DID YOU KNOW', { sub: i, subs: facts.length, right: f.tag || 'NEWS' })
      p.text(BODY_TOP + 1, 1, f.tag || '', TAG_COLOUR[f.tag] || YELLOW)
      p.wrap(BODY_TOP + 3, 1, f.text, 38, WHITE, BODY_BOTTOM)
      p.fast([['NEWS', '101'], ['TODAY', '200'], ['BORN', '201'], ['INDEX', '100']])
      return p
    })
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
  p.fast([['INDEX', '100'], ['NEWS', '101'], ['HELP', '199'], ['PAUSE', '500']])
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
    p.fast([['INDEX', '100'], ['WELCOME', '190'], ['NEWS', '101'], ['PAUSE', '500']])
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
    p.fast([['INDEX', '100'], ['1FF', '1FF'], null, ['HELP', '199']])
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
      p.fast([['NEXT', 'game:next'], ['INDEX', '100'], null, ['RESTART', 'game:reset']])
    }
    return [p]
  },
})

page('200', 'On this day', {
  feeds: ['otd'],
  subpageMs: 12000,
  render(ctx) {
    return gate(ctx, '200', 'ON THIS DAY', ['otd'], ({ otd }) => {
      // Six, spread across the day's picks: eighteen screens of history is a
      // lecture, and this is a glance (2026-09-28).
      const pool = otd.selected.length ? otd.selected : otd.events
      const picks = pickEvenly(pool, 6)
      // "28 SEP": the masthead's small print has eleven columns.
      const date = ctx.date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }).toUpperCase()
      return picks.map((e, i) => {
        const p = new Page()
        masthead(p, '200', 'ON THIS DAY', { sub: i, subs: picks.length, right: date })
        p.double(BODY_TOP, 1, String(e.year ?? ''), YELLOW)
        p.wrap(BODY_TOP + 3, 1, e.text, 38, WHITE, BODY_BOTTOM)
        creditLine(p, ctx, 'otd')
        p.fast([['BORN', '201'], ['NEWS', '101'], ['WEATHER', '300'], ['INDEX', '100']])
        return p
      })
    })
  },
})

/**
 * Born today: one person a screen. Wikipedia's list runs newest first and
 * is hundreds long, most of it recent athletes, so six are taken evenly
 * across it -- a spread of eras rather than the first six footballers.
 * The entry is "Name, what they were (d. year)"; the name goes big.
 */
export function pickEvenly(list, n) {
  if (list.length <= n) return list.slice()
  const step = list.length / n
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step + step / 2)])
}
export const pickBirths = (births, n = 6) => pickEvenly(births, n)
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
        p.fast([['TODAY', '200'], ['NEWS', '101'], ['WEATHER', '300'], ['INDEX', '100']])
        return p
      })
    })
  },
})

/** "DAYLIGHT 11H 53M  SUNSET IN 2H 13M": the day's length and what is
 *  left of it, from the forecast's "HH:MM" local times. */
export function sunInfo(rise, set, nowMs) {
  const toMin = (t) => { const m = /^(\d\d):(\d\d)$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null }
  const a = toMin(rise), b = toMin(set)
  if (a === null || b === null || b <= a) return null
  const d = new Date(nowMs), now = d.getHours() * 60 + d.getMinutes()
  const len = `DAYLIGHT ${Math.floor((b - a) / 60)}H ${pad2((b - a) % 60)}M`
  const until = now < a ? `  SUNRISE IN ${span((a - now) * 60000)}` : now < b ? `  SUNSET IN ${span((b - now) * 60000)}` : '  THE SUN IS DOWN'
  return len + until
}

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
    p.fast([loc === 'insecure' || loc === 'unsupported' || loc === 'asking' ? null : ['LOCATE', 'locate'], ['CITIES', '302'], ['NEWS', '101'], ['INDEX', '100']])
    return [p]
  }
  return gate(ctx, num, title, ['weather'], ({ weather }) => fn(weather))
}

page('300', 'Weather: today', {
  feeds: ['weather'],
  liveMs: 250,
  render(ctx) {
    return weatherGate('300', 'WEATHER', ctx, (w) => {
      const p = new Page()
      masthead(p, '300', 'WEATHER', { right: 'TODAY' })
      p.art(BODY_TOP, 1, weatherIcon(w.current.code, ctx.now), { W: WHITE, Y: YELLOW, C: CYAN })
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
        // How long the day is, and how long is left of it (2026-09-28).
        const sun = sunInfo(today.sunrise, today.sunset, ctx.now)
        if (sun) p.text(r + 2, 1, sun, CYAN)
      }
      p.text(22, 1, '% IS THE CHANCE OF RAIN', MAGENTA)
      creditLine(p, ctx, 'weather')
      p.fast([['5-DAY', '301'], ['CITIES', '302'], ['NEWS', '101'], ['INDEX', '100']])
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
      p.fast([['NOW', '300'], ['CITIES', '302'], ['NEWS', '101'], ['INDEX', '100']])
      return [p]
    })
  },
})

/** Twelve US cities at once (2026-09-28): the weather page that needs no
 *  location, so cycling can show it to everyone. */
page('302', 'Weather: US cities', {
  feeds: ['cities'],
  liveMs: 220,
  render(ctx) {
    return gate(ctx, '302', 'US CITIES', ['cities'], ({ cities }) => {
      const p = new Page()
      masthead(p, '302', 'US CITIES', { right: 'RIGHT NOW' })
      p.text(BODY_TOP, 1, 'CITY', CYAN); p.text(BODY_TOP, 16, 'NOW', CYAN); p.text(BODY_TOP, 22, 'SKY', CYAN); p.text(BODY_TOP, 32, 'HI/LO', CYAN)
      cities.cities.forEach((c, i) => {
        const r = BODY_TOP + 2 + i
        const hot = cities.units === 'F' ? c.temp >= 85 : c.temp >= 29
        const cold = cities.units === 'F' ? c.temp <= 40 : c.temp <= 4
        p.text(r, 1, c.name, i % 2 ? WHITE : YELLOW)
        p.text(r, 15, `${c.temp}${cities.units}`.padStart(4), hot ? RED : cold ? CYAN : WHITE)
        p.text(r, 22, clip(wmoWords(c.code)[2], 5), GREEN)
        // Where it is raining, snowing or storming, the row shows it.
        const kind = Pic.weatherKind(c.code)
        if (kind) for (const k of [0, 1]) p.mosaic(r, 27 + k, Pic.weatherCell(kind, ctx.now, k), kind === 'snow' ? WHITE : kind === 'storm' ? YELLOW : CYAN)
        p.text(r, 30, `${c.hi}/${c.lo}`.padStart(8), WHITE)
      })
      creditLine(p, ctx, 'cities')
      p.fast([['LOCAL', '300'], ['5-DAY', '301'], ['NEWS', '101'], ['INDEX', '100']])
      return [p]
    })
  },
})

/**
 * The clock (2026-09-28): the time in big seven-segment digits, the date, and
 * the time in five other cities. Ceefax had a clock page, and it is the
 * page most worth leaving up.
 */
export const WORLD_CLOCKS = [
  ['LOS ANGELES', 'America/Los_Angeles'], ['NEW YORK', 'America/New_York'], ['LONDON', 'Europe/London'],
  ['BERLIN', 'Europe/Berlin'], ['TOKYO', 'Asia/Tokyo'], ['SYDNEY', 'Australia/Sydney'],
]
const hhmmIn = (ms, tz) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz })
page('202', 'Clock', {
  liveMs: 500,
  render(ctx) {
    const p = new Page()
    masthead(p, '202', 'CLOCK', { right: 'TODAY' })
    const d = new Date(ctx.now)
    const t = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    const px = Pic.clockPixels(t)
    const cells = Math.ceil(px[0].length / 2)
    p.art(BODY_TOP + 1, Math.floor((COLS - cells) / 2), px, { Y: YELLOW })
    const date = longDate(ctx.now)
    p.text(BODY_TOP + 7, Math.floor((COLS - date.length) / 2), date, CYAN)
    WORLD_CLOCKS.forEach(([name, tz], i) => {
      const r = BODY_TOP + 10 + Math.floor(i / 2) * 2, c = i % 2 ? 21 : 1
      p.text(r, c, name, WHITE)
      let hm = '--:--'
      try { hm = hhmmIn(ctx.now, tz) } catch (e) { /* no time zone data */ }
      p.text(r, c + 13, hm, YELLOW)
    })
    p.fast([['TODAY', '200'], ['NEWS', '101'], ['PAUSE', '500'], ['INDEX', '100']])
    return [p]
  },
})


/** "3H 12M", "2D 4H", "45M": a span, the two largest units. */
export function span(ms) {
  const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mm = m % 60
  return d ? `${d}D ${h}H` : h ? `${h}H ${mm}M` : `${mm}M`
}
/** "02:11:04" under a day. */
const hms = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); return `${pad2(Math.floor(t / 3600))}:${pad2(Math.floor(t % 3600 / 60))}:${pad2(t % 60)}` }
/** A ticking countdown: "4D 03:32:58", "03:32:58" under a day. The first
 *  cut showed hours up to 99 ("99:32:58" on a Monday evening), which reads
 *  as a clock, not as four days. Past 99 days, `span` (never ticks). */
export const countdown = (ms) => ms < 864e5 ? hms(ms) : ms < 100 * 864e5 ? `${Math.floor(ms / 864e5)}D ${hms(ms % 864e5)}` : span(ms)
/** The start of next Saturday, local time; null when it is the weekend. */
export function weekendIn(nowMs) {
  const d = new Date(nowMs), day = d.getDay()
  if (day === 0 || day === 6) return null
  const sat = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (6 - day))
  return sat.getTime() - nowMs
}

/**
 * Coming up (2026-09-28): three countdowns that tick -- the weekend, the next
 * public holiday, the next rocket launch, with its ascent drawn beside it
 * (pictures.js launchPixels; the rocket-on-a-pad it replaced read as
 * something else). A page to hold on a Friday afternoon.
 */
page('203', 'Coming up', {
  feeds: ['holidays', 'launches'],
  liveMs: 1000,
  render(ctx) {
    const p = new Page()
    masthead(p, '203', 'COMING UP', { right: 'COUNTDOWNS' })
    const wk = weekendIn(ctx.now)
    p.text(BODY_TOP, 1, 'THE WEEKEND', YELLOW)
    if (wk === null) p.double(BODY_TOP + 1, 1, "IT'S THE WEEKEND", GREEN)
    else p.double(BODY_TOP + 1, 1, countdown(wk), WHITE)
    const hol = (ctx.entry('holidays')?.data?.holidays || []).find(h => Date.parse(`${h.date}T23:59`) > ctx.now)
    p.text(BODY_TOP + 4, 1, 'NEXT HOLIDAY', YELLOW)
    if (hol) {
      const days = Math.max(0, Math.ceil((new Date(`${hol.date}T00:00`).getTime() - ctx.now) / 864e5))
      p.text(BODY_TOP + 5, 1, clip(hol.names.join(' / '), 38), WHITE)
      p.text(BODY_TOP + 6, 1, `${shortDay(hol.date)}  ${days === 0 ? 'TODAY' : days === 1 ? 'TOMORROW' : `IN ${days} DAYS`}`, CYAN)
    } else p.text(BODY_TOP + 5, 1, 'WAITING FOR THE CALENDAR', CYAN)
    const next = (ctx.entry('launches')?.data?.launches || []).find(l => l.net > ctx.now - 60000)
    p.text(BODY_TOP + 9, 1, 'NEXT ROCKET LAUNCH', YELLOW)
    if (next) {
      const t = next.net - ctx.now
      p.double(BODY_TOP + 10, 1, t <= 0 ? 'LIFTOFF' : `T-${countdown(t)}`, t < 3600e3 ? GREEN : WHITE)
      p.text(BODY_TOP + 12, 1, clip(next.mission || next.vehicle, 30), WHITE)
      p.text(BODY_TOP + 13, 1, clip(next.vehicle, 30), CYAN)
      p.text(BODY_TOP + 14, 1, clip(`${next.provider}, ${next.where}`, 30), CYAN)
      if (next.status && next.status !== 'Go') p.text(BODY_TOP + 15, 1, `STATUS: ${next.status.toUpperCase()}`, MAGENTA)
      p.art(BODY_TOP + 9, 31, Pic.launchPixels(ctx.now, t < 60000), { G: GREEN, W: WHITE, C: CYAN, Y: YELLOW, R: RED })
    } else p.text(BODY_TOP + 10, 1, 'WAITING FOR THE SCHEDULE', CYAN)
    p.fast([['CLOCK', '202'], ['SPORT', '601'], ['NEWS', '101'], ['INDEX', '100']])
    return [p]
  },
})

// ---------------------------------------------------------------------------
// Money: the world's numbers at a glance. No crypto (2026-09-28, by choice),
// and no stock indices: nothing that serves them is open to a browser
// without a key, and this site has no server to hide one behind.
// ---------------------------------------------------------------------------

/** ▲ or ▼ and the day's change in percent, or blank when unchanged. */
function move(now, prev) {
  if (!Number.isFinite(prev) || prev === 0) return null
  const pct = (now - prev) / prev * 100
  if (Math.abs(pct) < 0.005) return { mark: '=', pct: '0.00%', up: null }
  return { mark: pct > 0 ? '▲' : '▼', pct: `${Math.abs(pct).toFixed(2)}%`, up: pct > 0 }
}

/** 51,481.51 -> "51,481.51"; the index levels want their thousands. */
const grouped = (x, dp = 2) => x.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
const shortDay = (iso) => { const d = new Date(`${iso}T12:00`); return `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}` }

/**
 * A bar chart in one row: two bars a cell, each 0-3 blocks high, scaled from
 * the lowest value to the highest. Ten closes make five cells.
 */
export function sparkline(p, r, c, values, ink) {
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1
  const h = values.map(v => 1 + Math.round((v - lo) / span * 2))
  const LEFT = [0, 16, 20, 21], RIGHT = [0, 32, 40, 42]
  for (let i = 0; i < h.length; i += 2) p.mosaic(r, c + i / 2, LEFT[h[i]] | RIGHT[h[i + 1] ?? 0], ink)
}

/**
 * World markets at the close (2026-09-28): the Dow, the S&P 500, the
 * Nasdaq and the Nikkei, then the VIX, the ten-year yield and oil. Built by
 * the deploy workflow from FRED (tools/fetch-markets.mjs), because nothing
 * serves index levels to a browser without a key. Each row carries its own
 * close's date: FRED's series do not all update on the same day.
 */
page('401', 'World markets', {
  feeds: ['markets'],
  render(ctx) {
    return gate(ctx, '401', 'MARKETS', ['markets'], ({ markets }) => {
      const p = new Page()
      masthead(p, '401', 'MARKETS', { right: 'CLOSES' })
      let r = BODY_TOP
      for (const s of markets.series) {
        if (r > 19) break
        const value = s.kind === 'percent' ? `${s.value.toFixed(2)}%` : s.kind === 'dollars' ? `$${s.value.toFixed(2)}` : grouped(s.value, s.kind === 'level' ? 2 : 2)
        p.text(r, 1, clip(s.name, 16), YELLOW)
        p.text(r, 18, value.padStart(10), WHITE)
        const m = move(s.value, s.prev)
        if (m) { const c = m.up === null ? WHITE : m.up ? GREEN : RED; p.text(r, 29, m.mark, c); p.text(r, 30, m.pct.padStart(6), c) }
        p.text(r + 1, 18, `CLOSE ${shortDay(s.date)}`.padStart(10), CYAN)
        if (s.history?.length > 1) sparkline(p, r + 1, 1, s.history, s.value >= s.history[0] ? GREEN : RED)
        r += 2
      }
      // The file is rebuilt a few times each weekday; one that has not been
      // rebuilt in days means the workflow has stopped, and the page says so.
      const age = markets.at ? ctx.now - Date.parse(markets.at) : 0
      if (age > 3 * 864e5) p.text(21, 1, clip(`PRICES NOT REFRESHED SINCE ${shortDay(markets.at.slice(0, 10))}`, 38), RED)
      else p.text(21, 1, 'DAILY CLOSES, UPDATED EACH WEEKDAY', GREEN)
      creditLine(p, ctx, 'markets')
      p.fast([['WEATHER', '302'], ['NEWS', '101'], ['CLOCK', '202'], ['INDEX', '100']])
      return [p]
    })
  },
})

/**
 * Your money (2026-09-28): the numbers that reach a household -- gas, a
 * mortgage, prices, the Fed's rate, jobs -- each against its last reading.
 * Built by the deploy workflow from FRED with the markets (fetch-markets.mjs
 * HOUSEHOLD); weekly and monthly, so each row says when.
 */
page('402', 'Your money', {
  feeds: ['markets'],
  render(ctx) {
    return gate(ctx, '402', 'YOUR MONEY', ['markets'], ({ markets }) => {
      const p = new Page()
      masthead(p, '402', 'YOUR MONEY', { right: 'HOUSEHOLD' })
      let r = BODY_TOP
      for (const s of markets.household || []) {
        const value = s.kind === 'gallon' ? `$${s.value.toFixed(2)}` : `${s.value.toFixed(s.kind === 'yoy' ? 1 : 2)}%`
        p.text(r, 1, s.name, YELLOW)
        p.double(r + 1, 1, value, WHITE)
        const m = move(s.value, s.prev)
        // Up is bad news for every one of these, so up is red.
        if (m) { const c = m.up === null ? WHITE : m.up ? RED : GREEN; p.text(r + 1, 14, m.mark, c); p.text(r + 1, 16, s.kind === 'gallon' ? `${(s.value - s.prev) >= 0 ? '+' : '-'}$${Math.abs(s.value - s.prev).toFixed(2)}` : `${(s.value - s.prev) >= 0 ? '+' : '-'}${Math.abs(s.value - s.prev).toFixed(2)}`, c) }
        const when = s.kind === 'yoy' || s.id === 'UNRATE' ? `${MONTH_NAMES[+s.date.slice(5, 7) - 1].slice(0, 3)} ${s.date.slice(0, 4)}` : shortDay(s.date)
        p.text(r + 1, 30, when.padStart(9), CYAN)
        if (s.history?.length > 1) sparkline(p, r + 2, 30, s.history, s.value > s.history[0] ? RED : GREEN)
        r += 3
      }
      if (!(markets.household || []).length) p.wrap(BODY_TOP, 1, 'The household numbers were not in the last build. They come back with the next.', 38, CYAN)
      creditLine(p, ctx, 'markets')
      p.fast([['MARKETS', '401'], ['WEATHER', '302'], ['NEWS', '101'], ['INDEX', '100']])
      return [p]
    })
  },
})

// ---------------------------------------------------------------------------
// Sport (2026-09-28): this week's games, a page a league, from ESPN's
// scoreboards. Refreshed every minute while a game is on (feeds.js).
// ---------------------------------------------------------------------------

/** A game's status, as the row shows it: the clock while it is on, the
 *  start in the viewer's own time before, FINAL after. */
export function gameStatus(g) {
  if (g.state === 'in') return { text: g.detail.toUpperCase(), fg: GREEN }
  if (g.state === 'post') return { text: /FT|final/i.test(g.detail) ? (g.detail.replace(/^FT$/, 'FINAL').toUpperCase()) : g.detail.toUpperCase(), fg: WHITE }
  const d = new Date(g.date)
  const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toUpperCase()
  return { text: `${day} ${time}`, fg: CYAN }
}
const GAME_ORDER = { in: 0, pre: 1, post: 2 }
/** Page number -> league key, for cycling to skip a league with no games. */
export const LEAGUE_PAGES = Object.fromEntries(LEAGUES.map(([key, , , num]) => [num, key]))
for (const [key, name, , num] of LEAGUES) {
  page(num, `Sport: ${name}`, {
    feeds: [`sport_${key}`],
    subpageMs: 12000,
    render(ctx) {
      return gate(ctx, num, name, [`sport_${key}`], (data) => {
        const games = data[`sport_${key}`].games.slice()
          .sort((a, b) => GAME_ORDER[a.state] - GAME_ORDER[b.state] || (a.state === 'post' ? b.date - a.date : a.date - b.date))
        const per = 16
        const chunks = []
        for (let i = 0; i < Math.max(1, games.length); i += per) chunks.push(games.slice(i, i + per))
        return chunks.map((chunk, i) => {
          const p = new Page()
          masthead(p, num, clip(name, 22), { sub: i, subs: chunks.length, right: 'SPORT' })
          if (!games.length) p.wrap(BODY_TOP + 1, 1, 'No games this week.', 38, CYAN)
          else { p.text(BODY_TOP, 1, 'AWAY', CYAN); p.text(BODY_TOP, 11, 'HOME', CYAN) }
          chunk.forEach((g, k) => {
            const r = BODY_TOP + 2 + k
            const st = gameStatus(g)
            const post = g.state === 'post'
            p.text(r, 1, clip(g.away.abbr, 4), post && g.away.winner ? YELLOW : WHITE)
            if (g.state !== 'pre') p.text(r, 6, String(g.away.score).padStart(3), post && g.away.winner ? YELLOW : WHITE)
            p.text(r, 11, clip(g.home.abbr, 4), post && g.home.winner ? YELLOW : WHITE)
            if (g.state !== 'pre') p.text(r, 16, String(g.home.score).padStart(3), post && g.home.winner ? YELLOW : WHITE)
            p.text(r, 22, clip(st.text, 17), st.fg)
          })
          if (games.some(g => g.state === 'in')) p.text(21, 1, 'LIVE: SCORES UPDATE EVERY MINUTE', GREEN)
          creditLine(p, ctx, `sport_${key}`)
          const i2 = LEAGUES.findIndex(l => l[0] === key)
          p.fast([['NEXT', LEAGUES[(i2 + 1) % LEAGUES.length][3]], ['NEWS', '101'], ['WEATHER', '302'], ['INDEX', '100']])
          return p
        })
      })
    },
  })
}

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
  cycleMs: 32000,
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
    p.fast([['THOUGHT', '501'], ['INDEX', '100'], ['NEWS', '101'], ['GALLERY', '700']])
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
  liveMs: 140,
  render(ctx) {
    const t = thoughtFor(ctx.editorial.thoughts, ctx.now)
    const p = new Page()
    masthead(p, '501', 'A THOUGHT', { right: 'FOR TODAY' })
    if (!t) { p.wrap(BODY_TOP, 1, 'No thoughts written yet.', 38, CYAN); return [p] }
    const lines = wrapText(`"${t.text}"`, 36)
    let r = BODY_TOP + 1
    for (const l of lines) p.text(r++, 2, l, YELLOW)
    if (t.by) p.text(r + 1, 38 - Math.min(36, t.by.length + 2), clip(`- ${t.by}`, 36), CYAN)
    // A candle under it, for the empty half of the page (2026-09-28).
    p.art(11, 14, Pic.candlePixels(ctx.now), { Y: YELLOW, R: RED, W: WHITE })
    p.fast([['BREATHE', '500'], ['INDEX', '100'], ['NEWS', '101'], ['GALLERY', '700']])
    return [p]
  },
})

/**
 * Focus (2026-09-28): a work timer -- twenty-five minutes, or a five-minute
 * break -- in big digits, started and stopped with the coloured keys. The
 * timer lives in the set (program.js), so it keeps running on other pages
 * and the chime comes wherever you are. The page to hold while working.
 */
export const FOCUS_MS = 25 * 60000, BREAK_MS = 5 * 60000
page('502', 'Focus timer', {
  // A page you use, not one to watch: cycling passes it by.
  noCycle: true,
  liveMs: 250,
  render(ctx) {
    const f = ctx.env.focus || { state: 'idle', mode: 'work', left: FOCUS_MS }
    const p = new Page()
    masthead(p, '502', 'FOCUS', { right: f.mode === 'break' ? 'BREAK' : 'WORK' })
    const left = f.state === 'run' ? Math.max(0, f.endsAt - ctx.now) : f.left
    const whole = f.mode === 'break' ? BREAK_MS : FOCUS_MS
    const secs = Math.ceil(left / 1000)
    const text = `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`
    const px = Pic.clockPixels(text, f.state === 'done' ? 'G' : f.mode === 'break' ? 'C' : 'Y')
    p.art(BODY_TOP + 2, Math.floor((COLS - Math.ceil(px[0].length / 2)) / 2), px, { Y: YELLOW, C: CYAN, G: GREEN })
    // How far through, as a bar of blocks across the page.
    const done = Math.round((1 - left / whole) * 76)
    p.bar(BODY_TOP + 9, 1, Math.max(0, done), f.mode === 'break' ? CYAN : YELLOW)
    const say = { idle: f.mode === 'break' ? 'A FIVE-MINUTE BREAK. RED STARTS IT.' : 'TWENTY-FIVE MINUTES. RED STARTS IT.', run: f.mode === 'break' ? 'BREAK. BACK SOON.' : 'FOCUSING. RED PAUSES.', paused: 'PAUSED. RED CARRIES ON.', done: f.mode === 'break' ? 'BREAK OVER.' : "TIME'S UP. TAKE A BREAK." }[f.state]
    if (f.state === 'done') p.flashing(BODY_TOP + 12, Math.floor((COLS - say.length) / 2), say, GREEN)
    else p.text(BODY_TOP + 12, Math.floor((COLS - say.length) / 2), say, WHITE)
    p.text(BODY_TOP + 15, 1, 'THE TIMER KEEPS GOING ON OTHER PAGES.', CYAN)
    p.fast([[f.state === 'run' ? 'PAUSE' : 'START', 'focus:start'], ['RESET', 'focus:reset'], [f.mode === 'break' ? 'WORK' : 'BREAK', 'focus:mode'], ['INDEX', '100']])
    return [p]
  },
})

/**
 * Decide for me (2026-09-28): roll a d20 or flip a coin on a coloured key.
 * The result tumbles for most of a second before it lands.
 */
export const ROLL_MS = 900
page('503', 'Decide for me', {
  noCycle: true,
  liveMs: 70,
  render(ctx) {
    const d = ctx.env.decide
    const p = new Page()
    masthead(p, '503', 'DECIDE', { right: 'FOR ME' })
    const tumbling = d && ctx.now - d.at < ROLL_MS
    if (!d) {
      p.wrap(BODY_TOP + 3, 1, 'Can not choose? Red rolls a twenty-sided die. Green flips a coin.', 38, WHITE)
    } else if (d.kind === 'd20') {
      const n = tumbling ? 1 + Math.floor(Pic.hash3(Math.floor(ctx.now / 60), 3, 9) * 20) : d.value
      const px = Pic.clockPixels(String(n), tumbling ? 'W' : n === 20 ? 'G' : n === 1 ? 'R' : 'Y')
      p.text(BODY_TOP, 1, 'D20', CYAN)
      p.art(BODY_TOP + 2, Math.floor((COLS - Math.ceil(px[0].length / 2)) / 2), px, { W: WHITE, G: GREEN, R: RED, Y: YELLOW })
      if (!tumbling) {
        const say = n === 20 ? 'NATURAL TWENTY!' : n === 1 ? 'CRITICAL FAIL' : n >= 15 ? 'GOOD ROLL' : n <= 5 ? 'OUCH' : ''
        if (say) p.double(BODY_TOP + 9, Math.floor((COLS - say.length) / 2), say, n === 20 ? GREEN : n === 1 ? RED : WHITE)
      }
    } else {
      const spin = tumbling ? (ctx.now - d.at) / ROLL_MS : 0
      p.text(BODY_TOP, 1, 'COIN', CYAN)
      p.art(BODY_TOP + 2, 15, Pic.coinPixels(spin), { Y: YELLOW, W: WHITE })
      if (!tumbling) { const say = d.value ? 'HEADS' : 'TAILS'; p.double(BODY_TOP + 8, Math.floor((COLS - say.length) / 2), say, YELLOW) }
    }
    p.fast([['D20', 'decide:d20'], ['FLIP', 'decide:coin'], ['PAUSE', '500'], ['INDEX', '100']])
    return [p]
  },
})

// Gallery: block-graphic pictures, generated rather than stored so each is a
// few lines of arithmetic instead of a thousand hand-placed cells.
const GALLERY = [
  {
    title: 'MOONRISE',
    // The moon rises over a minute, stars twinkle (pictures.js).
    draw(p, ms, pic) { p.art(3, 0, pic(Pic.moonrisePixels, ms), { W: WHITE, Y: YELLOW, C: CYAN }, (r) => ((r - 3) * 3 < 40 ? BLUE : BLACK)) },
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
    draw(p, ms, pic) { p.art(3, 0, pic(Pic.seaPixels, ms), { Y: YELLOW, C: CYAN, B: BLUE, W: WHITE }) },
  },
  {
    title: 'CITY AT NIGHT',
    draw(p, ms, pic) { p.art(3, 0, pic(Pic.cityPixels, ms), { Y: YELLOW, B: BLUE, W: WHITE }) },
  },
  // 2026-09-28: the aquarium came here from PAUSE (it was 502), and three
  // more pictures joined it.
  {
    title: 'AQUARIUM',
    draw(p, ms, pic) {
      for (let r = 3; r <= 21; r++) p.band(r, BLUE)
      p.art(4, 0, pic(Pic.aquariumPixels, ms), { Y: YELLOW, M: MAGENTA, R: RED, W: WHITE, G: GREEN, C: CYAN }, () => BLUE)
    },
  },
  {
    title: 'LIGHTHOUSE',
    draw(p, ms, pic) { p.art(3, 0, pic(Pic.lighthousePixels, ms), { W: WHITE, R: RED, Y: YELLOW, G: GREEN, C: CYAN }, (r) => ((r - 3) * 3 >= Pic.LIGHTHOUSE_HZ ? BLUE : BLACK)) },
  },
  {
    title: 'NORTHERN LIGHTS',
    draw(p, ms, pic) { p.art(3, 0, pic(Pic.auroraPixels, ms), { W: WHITE, G: GREEN, M: MAGENTA }) },
  },
  {
    title: 'NIGHT TRAIN',
    draw(p, ms, pic) {
      const [tail, head] = Pic.trainSpan(ms)
      p.art(3, 0, pic(Pic.trainPixels, ms), { W: WHITE, Y: YELLOW, B: BLUE, C: CYAN }, (r, c) => {
        const y = (r - 3) * 3
        if (y >= Pic.TRAIN_ROOF && y < 42 && c * 2 + 1 >= tail - 1 && c * 2 <= head + 1) return BLACK
        return y >= Pic.TRAIN_WATER ? BLUE : BLACK
      })
    },
  },
]

/** Only the picture on screen moves (2026-09-28). Drawing all eight every
 *  200ms took ~16ms a time in Node -- on the Mac mini's CPU, most of a frame.
 *  The others are drawn once, frozen at a fixed moment, and cached; a
 *  subpage that turns shows its still for one redraw, then comes to life. */
const FROZEN_MS = 4000
const stills = new Map()

page('700', 'Gallery', {
  liveMs: 200,
  subpageMs: 15000,
  render(ctx) {
    const live = ctx.env?.sub
    const draw = (g, i, ms) => {
      const p = new Page()
      masthead(p, '700', 'GALLERY', { sub: i, subs: GALLERY.length, right: 'PICTURES' })
      g.draw(p, ms, (fn, t) => fn(t))
      p.text(23, 1, `${g.title}, IN 2 BY 3 BLOCKS`, CYAN)
      p.fast([['INDEX', '100'], ['NEWS', '101'], ['WEATHER', '302'], ['BREATHE', '500']])
      return p
    }
    // The set never writes into a page it was handed (carousel.js receive()
    // reads it and garbles its own copy), so a still can be shared.
    return GALLERY.map((g, i) => {
      if (live === undefined || live === i) return draw(g, i, ctx.now)
      if (!stills.has(i)) stills.set(i, draw(g, i, FROZEN_MS))
      return stills.get(i)
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
