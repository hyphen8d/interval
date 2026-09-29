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
// ctx: { entry(feedId), status(feedId), env, now, date, editorial }
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
  2: { name: 'KNOWLEDGE', band: MAGENTA, ink: WHITE, accent: YELLOW },
  3: { name: 'WEATHER', band: BLUE, ink: CYAN, accent: YELLOW },
  4: { name: 'EARTH', band: RED, ink: YELLOW, accent: WHITE },
  5: { name: 'SIGNAL', band: YELLOW, ink: BLUE, accent: RED },
  6: { name: 'GAMES', band: MAGENTA, ink: YELLOW, accent: WHITE },
  7: { name: 'GALLERY', band: CYAN, ink: BLUE, accent: BLUE },
  8: { name: 'SERVICE', band: BLUE, ink: WHITE, accent: YELLOW },
}
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

const thousands = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n ?? ''))

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

const INDEX_ENTRIES = [
  ['NEWS', '101'], ['MOST READ', '104'], ['TECH', '150'], ['NOTICES', '190'], ['HELP', '199'],
  ['ON THIS DAY', '200'], ['BIRTHS', '202'], ['ARTICLE', '250'], ['WEATHER', '300'],
  ['5-DAY FORECAST', '301'], ['SKY TONIGHT', '310'], ['SPACE WEATHER', '320'], ['EARTHQUAKES', '400'],
  ['SIGNAL', '500'], ['QUIZ', '600'], ['GALLERY', '700'], ['OVERNIGHT', '800'], ['SUBTITLES', '888'],
]

const defs = []
const page = (num, title, def) => { defs.push({ num, title, feeds: [], ...def }); return num }

page('100', 'Index', {
  render(ctx) {
    const p = new Page()
    p.band(1, BLUE); p.band(2, BLUE)
    p.double(1, 1, 'INTERVAL', YELLOW, BLUE)
    p.text(1, 24, 'THE PAGES', WHITE)
    p.text(2, 24, 'BETWEEN PICTURES', CYAN)
    const half = Math.ceil(INDEX_ENTRIES.length / 2)
    INDEX_ENTRIES.forEach(([label, num], i) => {
      const col = i < half ? 1 : 21
      const row = 4 + (i % half) * 2
      p.text(row, col, label, i % 2 ? WHITE : YELLOW)
      p.text(row, col + 15, num, CYAN)
    })
    // The ways in, said once, where a first-time viewer is looking
    // (2026-09-28: the fastext row was not read as something to press).
    // Keyboard on a desktop, taps on a phone -- no mouse (pointer.js).
    if (ctx.env.touch) {
      p.text(22, 1, 'TAP A NUMBER, OR KEY IT IN. HELP: 199', MAGENTA)
      p.text(23, 1, 'THE COLOURED KEYS BELOW ARE LINKS', WHITE)
    } else {
      p.text(22, 1, 'KEY A PAGE NUMBER.  HELP: 199', MAGENTA)
      p.text(23, 1, 'COLOURED KEYS: F1-F4, OR SHIFT+1-4', WHITE)
    }
    p.fast([['News', '101'], ['Weather', '300'], ['SIGNAL', '500'], ['Quiz', '600']])
    return [p]
  },
})

/** Capitalised words, for spotting the same story told twice. */
const namesIn = (t) => new Set((t.match(/\b[A-Z][a-z]{3,}\b/g) || []).filter(w => !['The', 'This', 'That', 'After', 'During', 'Former'].includes(w)))
export function sameStory(a, b) {
  const na = namesIn(a)
  let shared = 0
  for (const w of namesIn(b)) if (na.has(w)) shared++
  return shared >= 2
}

// ---------------------------------------------------------------------------
// News (2026-09-28, second pass). Ceefax's shape: 101 is a page of headlines,
// each with a page number, and every story has a page of its own. The first
// pass packed briefs onto two screens and had to cut every story to its first
// sentence to do it; this one gives each story the room to be told whole,
// and makes the page numbers the way around, which is what teletext is.
// ---------------------------------------------------------------------------

/** Story pages: 111 to 129, one per story, in the order 101 lists them.
 *  Decimal only: a hex number (11A) is one no remote can key, and the
 *  hidden pages are the only place those belong. */
export const STORY_FIRST = 111
export const STORY_MAX = 19

/** The portal's sections, as the one word a headline is filed under when the
 *  item has no topic of its own; and the order the headlines take within a
 *  day -- politics and science first, so the page does not open on three
 *  airstrikes in a row just because Wikipedia files conflicts first. */
const SECTIONS = [
  ['Politics and elections', 'POLITICS'], ['International relations', 'WORLD'],
  ['Science and technology', 'SCIENCE'], ['Business and economy', 'BUSINESS'],
  ['Health and environment', 'HEALTH'], ['Arts and culture', 'ARTS'],
  ['Law and crime', 'CRIME'], ['Sports', 'SPORT'],
  ['Disasters and accidents', 'DISASTER'], ['Armed conflicts and attacks', 'CONFLICT'],
]
const sectionWord = (cat) => SECTIONS.find(([c]) => c === cat)?.[1] ?? 'NEWS'
/** "BUSINESS" -> "Business": a fallback label in the case the others are in. */
const titleCase = (w) => w[0] + w.slice(1).toLowerCase()
const sectionRank = (cat) => { const i = SECTIONS.findIndex(([c]) => c === cat); return i < 0 ? SECTIONS.length : i }

/** A headline label from the article or topic Wikipedia files the item
 *  under: "the AFL Grand Final" -> "AFL Grand Final", "2026 Berlin Marathon"
 *  -> "Berlin Marathon". Measured against real items before it was built on
 *  (2026-09-28): most carry one; the rest fall back to their section. */
export function newsLabel(raw, category, text = '') {
  let t = String(raw ?? '').trim()
  t = t.replace(/^(the|a|an)\s+/i, '').replace(/^\d{4}\s+/, '').replace(/\s+\([^)]*\)$/, '')
  if (t) return clip(t[0].toUpperCase() + t.slice(1), 33)
  // No topic: the section, and the first name in the story -- a place or a
  // person -- so two fallbacks in one list are not both just "Disaster"
  // (which is how the first cut of this read).
  const name = namePhrase(text)
  const sec = titleCase(sectionWord(category))
  return clip(name ? `${sec}: ${name}` : sec, 33)
}

/** The first run of capitalised words after a story's opening word:
 *  "Eighty-one people in Uttar Pradesh, India" -> "Uttar Pradesh". */
export function namePhrase(text) {
  const words = String(text).split(/\s+/).slice(1)
  let run = []
  for (const w of words) {
    const bare = w.replace(/[,.;:'"()]+$/g, '').replace(/'s$/, '')
    if (/^[A-Z][\w-]*$/.test(bare)) { run.push(bare); if (/[,.;:]$/.test(w)) break }
    else if (run.length) {
      // A lone adjective of place ("Himalayan", "Russian") describes the
      // name that follows it; keep looking for the name.
      if (run.length === 1 && /(an|ese|ish|ic)$/.test(run[0])) { run = []; continue }
      break
    }
  }
  return run.join(' ')
}

const isoLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const LONG_DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
const MONTH_NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']
/** How a log's date reads next to the viewer's own day. */
function dayLabel(iso, now) {
  const today = new Date(now)
  if (!iso || iso === isoLocal(today)) return 'TODAY'
  const y = new Date(now); y.setDate(y.getDate() - 1)
  if (iso === isoLocal(y)) return 'YESTERDAY'
  const d = new Date(`${iso}T12:00`)
  return `${LONG_DAYS[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`
}

/**
 * The stories, in the order 101 lists them, each with its page number:
 * "In the news" first (Wikipedia's own pick, current by definition), then
 * the Current events log, newest day first and politics-before-airstrikes
 * within a day, anything retelling a story already listed left out.
 */
export function newsStories(ctx) {
  const itn = ctx.entry('itn')?.data
  if (!itn) return []
  const now = ctx.now
  const out = itn.stories.map((text, i) => ({ label: newsLabel(itn.labels?.[i], null), text, section: 'IN THE NEWS', when: 'TODAY', top: true }))
  const events = (ctx.entry('events')?.data?.items || []).map((e, i) => ({ ...e, i }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || sectionRank(a.category) - sectionRank(b.category) || a.i - b.i)
  for (const e of events) {
    if (out.some(s => sameStory(s.text, e.text))) continue
    out.push({ label: newsLabel(e.topic, e.category, e.text), text: e.text, section: sectionWord(e.category), when: dayLabel(e.date, now), top: false })
  }
  return out.slice(0, STORY_MAX).map((s, i) => ({ ...s, num: String(STORY_FIRST + i) }))
}

/** One headline on 101: the label and its page number, then the story's
 *  opening words -- a label alone ("Kyiv strikes") says too little. */
function headlineBlock(story) {
  return {
    height: 2,
    draw(p, r) {
      p.text(r, 1, clip(story.label, 33), YELLOW)
      p.text(r, 36, story.num, CYAN)
      p.text(r + 1, 1, clip(story.text, 38), WHITE)
    },
  }
}

page('101', 'News headlines', {
  feeds: ['itn', 'events'],
  subpageMs: 12000,
  render(ctx) {
    return gate(ctx, '101', 'NEWS', ['itn'], () => {
      const stories = newsStories(ctx)
      // Blocks in order; a day heading goes in wherever the day changes, so
      // yesterday's news says so instead of passing as today's.
      const blocks = []
      let day = null
      const now = new Date(ctx.now)
      const todayLine = `${LONG_DAYS[now.getDay()]} ${now.getDate()} ${MONTH_NAMES[now.getMonth()]}`
      for (const s of stories) {
        if (s.when !== day) {
          const head = s.when === 'TODAY' ? todayLine : s.when
          blocks.push({ height: 1, heading: true, draw: (p, r) => p.text(r, 1, head, s.when === 'TODAY' ? GREEN : MAGENTA) })
          day = s.when
        }
        blocks.push(headlineBlock(s))
      }
      const laid = paginate(blocks, { gap: 0 })
      // A day heading that ends up at the foot of a page, with its stories
      // on the next one, belongs on that next page.
      for (let i = 0; i < laid.length - 1; i++) {
        const last = laid[i][laid[i].length - 1]
        if (last?.block.heading) { laid[i].pop(); laid[i + 1] = paginate([last.block, ...laid[i + 1].map(x => x.block)], { gap: 0 })[0] }
      }
      return laid.slice(0, 2).map((placed, i) => {
        const p = new Page()
        masthead(p, '101', 'NEWS', { sub: i, subs: Math.min(2, laid.length), right: 'HEADLINES' })
        for (const { block, row } of placed) block.draw(p, row)
        p.text(22, 1, 'KEY A STORY NUMBER TO READ IT', MAGENTA)
        creditLine(p, ctx, 'itn')
        p.fast([['First', stories[0]?.num ?? '101'], ['Ongoing', '102'], ['Most read', '104'], ['Index', '100']])
        return p
      })
    })
  },
})

/** A story's own page. Registered on demand by pageDef(), like SIGNAL's
 *  stations: the numbers exist once the news has arrived. */
function storyPage(story, stories, ctx) {
  const p = new Page()
  masthead(p, story.num, 'NEWS', { right: story.section })
  const head = wrapText(story.label, 38)
  let r = BODY_TOP
  head.slice(0, 2).forEach(l => { p.double(r, 1, l, YELLOW); r += 2 })
  const now = new Date(ctx.now)
  const when = story.when === 'TODAY' ? `${LONG_DAYS[now.getDay()]} ${now.getDate()} ${MONTH_NAMES[now.getMonth()]}` : story.when
  p.text(r, 1, story.top ? when : `${story.section}  ${when}`, story.when === 'TODAY' ? CYAN : MAGENTA)
  r = p.wrap(r + 2, 1, story.text, 38, WHITE, 21)
  // The foot of the page points onward, as Ceefax's story pages did: the
  // next few headlines, with their numbers, in whatever room the story left.
  const i = stories.findIndex(s => s.num === story.num)
  const next = stories[(i + 1) % stories.length]
  const more = [1, 2, 3, 4, 5, 6].map(k => stories[(i + k) % stories.length]).filter(s => s !== story)
  let row = r + 1
  if (row <= 19 && more.length) {
    p.text(row++, 1, 'MORE HEADLINES', GREEN)
    for (const s of more) {
      if (row > 21) break
      p.text(row, 1, clip(s.label, 33), YELLOW)
      p.text(row, 36, s.num, CYAN)
      row++
    }
  }
  creditLine(p, ctx, story.top ? 'itn' : 'events')
  p.fast([['Headlines', '101'], ['Next', next.num], ['Most read', '104'], ['Index', '100']])
  return p
}

page('102', 'Ongoing and recent deaths', {
  feeds: ['itn'],
  render(ctx) {
    return gate(ctx, '102', 'ONGOING', ['itn'], ({ itn }) => {
      const blocks = []
      if (itn.ongoing.length) {
        blocks.push({ height: 1, draw: (p, r) => p.text(r, 1, 'ONGOING', CYAN) })
        itn.ongoing.forEach(o => blocks.push(textBlock('*', o, { leadFg: CYAN })))
      }
      if (itn.deaths.length) {
        blocks.push({ height: 1, draw: (p, r) => p.text(r, 1, 'RECENT DEATHS', CYAN) })
        const names = itn.deaths.join(', ')
        blocks.push(textBlock(null, names))
      }
      return listPage('102', 'ONGOING', blocks, ctx, {
        feed: 'itn', right: 'NEWS', gap: 0,
        fast: [['Headlines', '101'], ['Most read', '104'], ['This day', '200'], ['Index', '100']],
      })
    })
  },
})

page('104', 'Most read on Wikipedia', {
  feeds: ['featured'],
  render(ctx) {
    return gate(ctx, '104', 'MOST READ', ['featured'], ({ featured }) => {
      const blocks = featured.mostread.slice(0, 15).map((a, i) => ({
        height: a.description ? 2 : 1,
        draw(p, r) {
          p.text(r, 1, String(i + 1).padStart(2), YELLOW)
          p.text(r, 4, clip(a.title, 28), WHITE)
          const v = thousands(a.views)
          p.text(r, 39 - v.length, v, GREEN)
          if (a.description) p.text(r + 1, 4, clip(a.description, 35), CYAN)
        },
      }))
      return listPage('104', 'MOST READ', blocks, ctx, {
        feed: 'featured', right: 'YESTERDAY', gap: 0,
        fast: [['News', '101'], ['Article', '250'], ['Tech', '150'], ['Index', '100']],
      })
    })
  },
})

page('150', 'Tech: top of Hacker News', {
  feeds: ['hn'],
  subpageMs: 12000,
  render(ctx) {
    return gate(ctx, '150', 'TECH', ['hn'], ({ hn }) => {
      const blocks = hn.stories.map((s, i) => {
        const lines = wrapText(s.title, 34)
        return {
          height: lines.length + 1,
          draw(p, r) {
            p.text(r, 1, String(i + 1).padStart(2), YELLOW)
            lines.forEach((l, k) => p.text(r + k, 4, l, WHITE))
            p.text(r + lines.length, 4, clip(`${s.score} PTS  ${s.comments} COMMENTS  ${s.domain}`, 35), GREEN)
          },
        }
      })
      return listPage('150', 'TECH', blocks, ctx, {
        feed: 'hn', right: 'HACKER NEWS',
        fast: [['News', '101'], ['Most read', '104'], ['Notices', '190'], ['Index', '100']],
      })
    })
  },
})

/** A notice page: written in the admin dashboard, stored in editorial.json,
 *  drawn from its markup (markup.js). Any number no fixed page uses. */
function noticePage(n) {
  const p = new Page()
  masthead(p, n.page, n.title || 'NOTICES', { right: 'INTERVAL' })
  drawLines(p, n.lines || [], BODY_TOP, 1)
  p.fast([['Index', '100'], ['Help', '199'], ['SIGNAL', '500'], ['Overnight', '800']])
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
    p.fast([['Index', '100'], ['Notices', '190'], ['Quiz', '600'], ['Overnight', '800']])
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
        p.fast([['Events', '201'], ['Births', '202'], ['Deaths', '203'], ['Index', '100']])
        return p
      })
    })
  },
})

for (const [num, title, key, heading] of [
  ['201', 'On this day: more events', 'events', 'EVENTS'],
  ['202', 'On this day: births', 'births', 'BIRTHS'],
  ['203', 'On this day: deaths', 'deaths', 'DEATHS'],
]) {
  page(num, title, {
    feeds: ['otd'],
    subpageMs: 14000,
    render(ctx) {
      return gate(ctx, num, heading, ['otd'], ({ otd }) =>
        listPage(num, heading, otd[key].slice(0, 24).map(e => textBlock(String(e.year ?? ''), e.text, { width: 38 })), ctx, {
          feed: 'otd', right: 'ON THIS DAY',
          fast: [['This day', '200'], ['Events', '201'], ['Births', '202'], ['Deaths', '203']],
        }))
    },
  })
}

page('250', 'Article of the day', {
  feeds: ['featured'],
  subpageMs: 16000,
  render(ctx) {
    return gate(ctx, '250', 'ARTICLE', ['featured'], ({ featured }) => {
      const tfa = featured.tfa
      if (!tfa) return listPage('250', 'ARTICLE', [], ctx, { feed: 'featured', fast: [['Index', '100']], empty: 'No featured article today.' })
      const head = wrapText(tfa.title, 19)
      const lines = wrapText(tfa.extract, 38)
      const first = BODY_BOTTOM - (BODY_TOP + head.length * 2 + (tfa.description ? 2 : 1)) + 1
      const chunks = [lines.slice(0, first)]
      for (let i = first; i < lines.length; i += BODY_BOTTOM - BODY_TOP + 1) chunks.push(lines.slice(i, i + BODY_BOTTOM - BODY_TOP + 1))
      return chunks.map((chunk, i) => {
        const p = new Page()
        masthead(p, '250', 'ARTICLE OF THE DAY', { sub: i, subs: chunks.length, right: 'WIKIPEDIA' })
        let r = BODY_TOP
        if (i === 0) {
          head.slice(0, 2).forEach(h => { p.double(r, 1, h, YELLOW); r += 2 })
          if (tfa.description) { p.text(r, 1, clip(tfa.description, 38), CYAN); r++ }
          r++
        }
        chunk.forEach(l => { if (r <= BODY_BOTTOM) p.text(r++, 1, l, WHITE) })
        creditLine(p, ctx, 'featured')
        p.fast([['Most read', '104'], ['This day', '200'], ['News', '101'], ['Index', '100']])
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
    p.fast([loc === 'insecure' || loc === 'unsupported' || loc === 'asking' ? null : ['Locate me', 'locate'], ['Sky', '310'], ['Space', '320'], ['Index', '100']])
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
    p.fast([['Weather', '300'], ['Space', '320'], ['Gallery', '700'], ['Index', '100']])
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
      p.fast([['Weather', '300'], ['Sky', '310'], ['Quakes', '400'], ['Index', '100']])
      return [p]
    })
  },
})

page('400', 'Earthquakes', {
  feeds: ['quakes'],
  render(ctx) {
    return gate(ctx, '400', 'EARTHQUAKES', ['quakes'], ({ quakes }) => {
      const rows = quakes.slice(0, 32)
      const per = 14
      const chunks = []
      for (let i = 0; i < Math.max(1, rows.length); i += per) chunks.push(rows.slice(i, i + per))
      return chunks.map((chunk, i) => {
        const p = new Page()
        masthead(p, '400', 'EARTHQUAKES', { sub: i, subs: chunks.length, right: 'PAST DAY' })
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
        p.fast([['Space', '320'], ['Weather', '300'], ['News', '101'], ['Index', '100']])
        return p
      })
    })
  },
})

/** SIGNAL station page numbers: 511-519 for YM, 521-529 for ZM, in
 *  frequency order. SIGNAL's own lint holds each band to nine public
 *  stations, which is exactly why nine numbers per band is enough. */
export function stationPages(roster) {
  const out = []
  for (const [band, base] of [['ym', 0x511], ['zm', 0x521]]) {
    roster.stations.filter(s => s.band === band).slice(0, 9)
      .forEach((s, i) => out.push({ num: (base + i).toString(16).toUpperCase(), station: s }))
  }
  return out
}
const bandLabel = (b) => (b === 'zm' ? 'ZM' : 'YM')
const freqText = (f) => (Number.isFinite(f) ? f.toFixed(1) : '--')

page('500', 'SIGNAL listings', {
  feeds: ['signal'],
  render(ctx) {
    return gate(ctx, '500', 'SIGNAL', ['signal'], ({ signal }) => {
      const pages = stationPages(signal)
      return ['ym', 'zm'].map((band, i) => {
        const p = new Page()
        masthead(p, '500', 'SIGNAL', { sub: i, subs: 2, right: 'LISTINGS' })
        p.text(BODY_TOP - 1, 1, band === 'ym' ? 'YM BAND   100.0-900.0 KHZ' : 'ZM BAND   1000.0-1800.0 KHZ', CYAN)
        let r = BODY_TOP + 1
        for (const { num, station } of pages.filter(x => x.station.band === band)) {
          p.text(r, 1, num, CYAN)
          p.text(r, 5, freqText(station.freq).padStart(6), YELLOW)
          p.text(r, 13, clip(station.callsign, 26), WHITE)
          p.text(r + 1, 13, clip(station.tagline, 26), GREEN)
          r += 2
        }
        creditLine(p, ctx, 'signal')
        p.fast([['First', pages.find(x => x.station.band === band)?.num ?? '500'], ['Overnight', '800'], ['Band', 'sub:next'], ['Index', '100']])
        return p
      })
    })
  },
})

/** One page per station, generated from the roster. Registered on demand by
 *  pageDef(), since the numbers only exist once SIGNAL's roster has arrived. */
function stationPage(num, station, all, ctx) {
  const p = new Page()
  masthead(p, num, 'SIGNAL', { right: `${bandLabel(station.band)} BAND` })
  p.double(BODY_TOP, 1, clip(station.callsign, 38), YELLOW)
  p.text(BODY_TOP + 2, 1, `${freqText(station.freq)} KHZ`, WHITE)
  p.text(BODY_TOP + 2, 14, `${station.tracks.length} TRACKS ON ROTATION`, GREEN)
  let r = p.wrap(BODY_TOP + 4, 1, station.tagline, 38, CYAN) + 1
  if (station.desc) r = p.wrap(r, 1, station.desc, 38, WHITE, 19) + 1
  p.text(21, 1, 'RED: TUNE IN ON SIGNAL', RED)
  creditLine(p, ctx, 'signal')
  const i = all.findIndex(x => x.num === num)
  const next = all[(i + 1) % all.length].num
  p.fast([['Tune in', `signal:${station.id}`], ['Next', next], ['Listings', '500'], ['Index', '100']])
  return p
}

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
      p.fast([['Index', '100'], ['Notices', '190'], ['Gallery', '700'], ['Help', '199']])
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
    title: 'SIGNAL',
    draw(p) {
      // SIGNAL's own mark: two arcs over a dot, from its favicon.
      const cx = 40, cy = 44
      const art = pixels(80, 57, (x, y) => {
        const d = Math.hypot(x - cx, (y - cy) * 1.6)
        if (d < 3.2) return 'G'
        if (y > cy - 2) return null
        if (d > 13 && d < 17) return 'G'
        if (d > 25 && d < 29) return 'G'
        return null
      })
      p.art(3, 0, art, { G: GREEN })
      p.text(22, 12, 'TUNE IN: PAGE 500', YELLOW)
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
      p.fast([['Index', '100'], ['Sky', '310'], ['Quiz', '600'], ['Overnight', '800']])
      return p
    })
  },
})

page('800', 'Overnight pages', {
  feeds: ['signal'],
  render(ctx) {
    const p = new Page()
    masthead(p, '800', 'OVERNIGHT', { right: 'AFTER HOURS' })
    const o = ctx.editorial.overnight || {}
    let r = p.wrap(BODY_TOP, 1, `From ${pad2(o.startHour ?? 0)}:00, a set left alone turns its own pages, a few seconds each, while a SIGNAL station plays underneath. Key any page to take the set back.`, 38, WHITE) + 1
    const st = ctx.entry('signal')?.data?.stations?.find(s => s.id === o.stationId)
    p.text(r, 1, "TONIGHT'S STATION", YELLOW); r += 2
    if (st) {
      p.text(r, 1, freqText(st.freq).padStart(6), YELLOW); p.text(r, 9, clip(st.callsign, 30), WHITE)
      p.text(r + 1, 9, clip(st.tagline, 30), CYAN); r += 3
    } else { p.text(r, 1, 'WAITING FOR SIGNAL\'S ROSTER', CYAN); r += 2 }
    r = p.wrap(r, 1, 'The music is YouTube, through SIGNAL\'s own tracks. M mutes it.', 38, GREEN) + 1
    p.text(21, 1, ctx.env.overnight?.on ? 'OVERNIGHT IS ON.  RED STOPS IT.' : 'RED STARTS IT NOW.', RED)
    p.fast([[ctx.env.overnight?.on ? 'Stop' : 'Start now', 'overnight'], ['Subtitles', '888'], ['SIGNAL', '500'], ['Index', '100']])
    return [p]
  },
})

page('888', 'Subtitles', {
  render(ctx) {
    const p = new Page()
    const now = ctx.env.overnight?.on ? ctx.env.overnight.track : null
    if (!now) {
      masthead(p, '888', 'SUBTITLES')
      p.wrap(BODY_TOP + 2, 1, 'No subtitles on this service. When the overnight music is playing, this page says what it is.', 38, WHITE)
      p.fast([['Overnight', '800'], ['Index', '100'], null, null])
      return [p]
    }
    // Subtitles sit low on a black box over the picture, in double height,
    // the way page 888 did.
    const lines = wrapText(`${now.title}${now.artist ? ` - ${now.artist}` : ''}`, 34).slice(0, 2)
    lines.forEach((l, i) => {
      const r = 16 + i * 3
      const c = Math.floor((COLS - l.length) / 2)
      p.band(r, BLACK); p.band(r + 1, BLACK)
      p.double(r, c, l, i ? CYAN : YELLOW, BLACK)
    })
    p.fast([['Overnight', '800'], ['Index', '100'], null, null])
    return [p]
  },
})

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/** Every fixed page, by number. */
export const PAGES = new Map(defs.map(d => [d.num, d]))

/**
 * The definition for a page number, including the ones that only exist once
 * a feed has answered (SIGNAL's station pages). Null for a page the service
 * does not carry, which the set searches for forever, as a real one did.
 */
export function pageDef(num, ctx) {
  const n = String(num).toUpperCase()
  if (PAGES.has(n)) return PAGES.get(n)
  const notice = (ctx?.editorial?.notices || []).find(x => String(x.page).toUpperCase() === n)
  if (notice) return { num: n, title: `Notice: ${notice.title || n}`, feeds: [], render: () => [noticePage({ ...notice, page: n })] }
  if (/^1[12][0-9A-F]$/.test(n) && ctx?.entry) {
    const stories = newsStories(ctx)
    const story = stories.find(x => x.num === n)
    if (story) return { num: n, title: `News: ${story.label}`, feeds: ['itn', 'events'], render: (c) => [storyPage(story, stories, c)] }
  }
  const roster = ctx?.entry?.('signal')?.data
  if (roster && /^5[12]\d$/.test(n)) {
    const all = stationPages(roster)
    const hit = all.find(x => x.num === n)
    if (hit) return { num: n, title: `SIGNAL: ${hit.station.callsign}`, feeds: ['signal'], render: (c) => [stationPage(n, hit.station, all, c)] }
  }
  return null
}

/** The pages UP and DOWN step through: everything not hidden, in order,
 *  station pages included once the roster is in. */
export function pageOrder(ctx) {
  const nums = defs.filter(d => !d.hidden).map(d => d.num)
  for (const n of ctx?.editorial?.notices || []) nums.push(String(n.page).toUpperCase())
  if (ctx?.entry) nums.push(...newsStories(ctx).map(x => x.num))
  const roster = ctx?.entry?.('signal')?.data
  if (roster) nums.push(...stationPages(roster).map(x => x.num))
  return [...new Set(nums)].sort((a, b) => parseInt(a, 16) - parseInt(b, 16))
}

/** All the magazines' index entries, for the lint: every one must exist. */
export const INDEX = INDEX_ENTRIES
