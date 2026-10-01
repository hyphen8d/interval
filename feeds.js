// INTERVAL -- where the pages come from. Every source is keyless and
// CORS-open, because the site is static on GitHub Pages with no server to
// proxy through and nowhere to keep a key. That is the same rule SIGNAL's
// lyrics lookup is built on, and it was checked the same way: against the
// live services, with an Origin header (2026-09-28), not from their docs.
//
// The first measurement changed the plan. The pitch had "In the news" coming
// from Wikipedia's aggregated featured feed, and that feed no longer carries
// a `news` key at all -- not today, not on any date sampled back to 2025. The
// same box is still reachable through the action API's parse of
// Template:In_the_news, which is what parseITN() reads. Had the pitch been
// built as written, page 101 would have been empty from the first day.
//
// Pure parsing plus a cache. The parsers take the JSON the services really
// return (tests/fixtures holds a capture of each, dated in its README), so a
// source changing shape fails a test here rather than showing a blank page.

// Siblings are imported as ?v=<build>, like every app module (see main.js):
// a bare import would be cached across a deploy and pair this file with a
// stale copy of the one it imports.
const V = globalThis.INTERVAL_BUILD ?? ''
const { fold } = await import(`./teletext.js?v=${V}`)

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-' }
export function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}
const stripTags = (h) => decodeEntities(String(h).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

/** The <li> items at the top level of the first <ul> in `html`, with nested
 *  lists (the "timeline" sub-links under an ongoing event) dropped. With
 *  `bolds`, each item's bold phrases instead of its text. */
function topLevelItems(html, bolds = false) {
  const start = html.indexOf('<ul')
  if (start < 0) return []
  let depth = 0, i = start, itemStart = -1
  const items = []
  const re = /<(\/?)(ul|li)\b[^>]*>/g
  re.lastIndex = start
  let m
  while ((m = re.exec(html))) {
    const closing = m[1] === '/', tag = m[2]
    if (tag === 'ul') {
      depth += closing ? -1 : 1
      if (depth === 0) break
    } else if (depth === 1) {
      if (!closing) itemStart = re.lastIndex
      else if (itemStart >= 0) { items.push(html.slice(itemStart, m.index)); itemStart = -1 }
    }
    i = re.lastIndex
  }
  if (bolds) return items.map(it => [...it.matchAll(/<b>([\s\S]*?)<\/b>/g)].map(m => fold(stripTags(m[1]))).filter(Boolean))
  return items.map(it => stripTags(it.replace(/<ul[\s\S]*?<\/ul>/g, '')))
}

/**
 * Wikipedia's "In the news" box, from the action API's parse of the template.
 * Three lists: the stories, the ongoing events and the recent deaths. The
 * "(X pictured)" asides refer to a photo the page cannot show, so they go.
 */
export function parseITN(json) {
  let html = json?.parse?.text
  if (typeof html !== 'string') throw new Error('no parse.text in the response')
  html = html.replace(/<style[\s\S]*?<\/style>/g, '')
  // The template page transcludes its own documentation below the box.
  const docs = html.indexOf('documentation-container')
  if (docs > 0) html = html.slice(0, docs)
  const footer = html.indexOf('itn-footer')
  const head = footer > 0 ? html.slice(0, footer) : html
  const stories = topLevelItems(head)
    .map(s => s.replace(/\s*\([^()]*\bpictured\)\s*/gi, ' ').replace(/\s+([.,])/g, '$1').trim())
    .filter(Boolean)
  // The article each story is about is the one set in bold: "the AFL Grand
  // Final", "Hashim Thaci". It is what the headlines page files the story
  // under (pages.js newsLabel).
  const labels = topLevelItems(head, true).map(bolds => bolds[0] || null)
  const after = (label) => {
    if (footer < 0) return []
    const at = html.indexOf(label, footer)
    return at < 0 ? [] : topLevelItems(html.slice(at))
  }
  const out = { stories, labels, ongoing: after('Ongoing'), deaths: after('Recent deaths') }
  if (!out.stories.length) throw new Error('no stories found in the In the news box')
  return out
}

/**
 * Wikipedia's Current events portal for one day: every item, with the
 * section it was filed under. The items are the innermost list entries of
 * the page's content block -- the outer entries are topic headings ("Somali
 * Civil War") with the news nested beneath -- and each ends in bracketed
 * source citations, "(Reuters) (AP)", which are dropped after the final full
 * stop. The portal also carries an edit/history navbar, which is why only
 * the content block is read.
 *
 * Added 2026-09-28 because "In the news" alone is four or five short items:
 * page 101 came out as one screen, or one screen and a lone story on a
 * second. The portal is where those items are written up in the first place.
 */
export function parseCurrentEvents(json) {
  let html = json?.parse?.text
  if (typeof html !== 'string') throw new Error('no parse.text in the response')
  html = html.replace(/<style[\s\S]*?<\/style>/g, '')
  const start = html.indexOf('current-events-content')
  if (start < 0) return []
  const end = html.indexOf('current-events-nav', start)
  html = html.slice(start, end > 0 ? end : undefined)
  const items = []
  const stack = []
  let category = null
  const re = /<(\/?)(li|ul)\b[^>]*>|<p>\s*<b>([\s\S]*?)<\/b>/g
  let m
  while ((m = re.exec(html))) {
    if (m[3] !== undefined) { category = stripTags(m[3]); continue }
    const [, close, tag] = m
    if (tag === 'ul') {
      // An entry with a list under it is a topic heading ("Kyiv strikes");
      // its own text, up to the list, is what the news beneath is about.
      const top = stack[stack.length - 1]
      if (!close && top && !top.hasList) { top.hasList = true; top.topic = fold(stripTags(html.slice(top.from, m.index))).replace(/,.*$/, '').trim() }
      continue
    }
    if (!close) { stack.push({ from: re.lastIndex, hasList: false, topic: null }); continue }
    const li = stack.pop()
    if (!li || li.hasList) continue
    let text = stripTags(html.slice(li.from, m.index))
    text = text.replace(/([.!?]["']?)\s*(\([^()]{1,80}\)\s*)+$/, '$1').trim()
    const topic = [...stack].reverse().find(x => x.topic)?.topic || null
    if (text.length > 20) items.push({ category, topic, text: fold(text) })
  }
  return items
}

const year = (e) => (Number.isFinite(e?.year) ? e.year : null)
// "(pictured)" points at a photo the page cannot show; holidays arrive with a
// newline between the kind of day and its name.
const tidy = (t) => fold(t ?? '').replace(/\s*\((?:[^()]*\s)?pictured\)/gi, '').replace(/\s+/g, ' ').trim()
const event = (e) => ({ year: year(e), text: tidy(e?.text) })

/** On this day: Wikipedia's editorial picks ("selected") plus the full lists. */
export function parseOnThisDay(json) {
  if (!json || !Array.isArray(json.selected) && !Array.isArray(json.events)) throw new Error('no events in the response')
  const byYear = (a, b) => (a.year ?? 0) - (b.year ?? 0)
  return {
    selected: (json.selected || []).map(event).filter(e => e.text).sort(byYear),
    events: (json.events || []).map(event).filter(e => e.text),
    births: (json.births || []).map(event).filter(e => e.text),
    deaths: (json.deaths || []).map(event).filter(e => e.text),
    holidays: (json.holidays || []).map(h => tidy(h?.text)).filter(Boolean),
  }
}

/** Open-Meteo, shaped for the weather magazine. */
export function parseForecast(j) {
  if (!j || !j.current || !j.daily) throw new Error('no forecast in the response')
  const hhmm = (iso) => { const t = String(iso ?? '').slice(11, 16); return /^\d\d:\d\d$/.test(t) ? t : null }
  const d = j.daily
  const days = (d.time || []).map((date, i) => ({
    date,
    code: d.weather_code?.[i] ?? null,
    hi: Math.round(d.temperature_2m_max?.[i]),
    lo: Math.round(d.temperature_2m_min?.[i]),
    pop: d.precipitation_probability_max?.[i] ?? null,
    sunrise: hhmm(d.sunrise?.[i]),
    sunset: hhmm(d.sunset?.[i]),
  }))
  // Today's parts, from the hourly arrays. Hours are read as characters: the
  // strings are zoneless local times (timezone=auto) and parsing them is an
  // engine behaviour this has no need to depend on (see SIGNAL's weather.js).
  const today = days[0]?.date
  const parts = [['MORNING', 6, 11], ['AFTERNOON', 12, 17], ['EVENING', 18, 23]].map(([name, from, to]) => {
    const idx = (j.hourly?.time || []).map((t, i) => [t, i])
      .filter(([t]) => t.startsWith(today) && +t.slice(11, 13) >= from && +t.slice(11, 13) <= to).map(([, i]) => i)
    const temps = idx.map(i => j.hourly.temperature_2m?.[i]).filter(Number.isFinite)
    const codes = idx.map(i => j.hourly.weather_code?.[i]).filter(Number.isFinite)
    const pops = idx.map(i => j.hourly.precipitation_probability?.[i]).filter(Number.isFinite)
    return temps.length ? { name, temp: Math.round(Math.max(...temps)), code: Math.max(...codes), pop: pops.length ? Math.max(...pops) : null } : { name, temp: null, code: null, pop: null }
  })
  return {
    current: {
      temp: Math.round(j.current.temperature_2m),
      code: j.current.weather_code,
      wind: Number.isFinite(j.current.wind_speed_10m) ? Math.round(j.current.wind_speed_10m) : null,
      windDir: j.current.wind_direction_10m ?? null,
    },
    days, parts,
    units: /F/.test(j.current_units?.temperature_2m || '') ? 'F' : 'C',
    windUnit: /mp/.test(j.current_units?.wind_speed_10m || '') ? 'MPH' : 'KM/H',
    timezone: j.timezone || null,
  }
}

// ---------------------------------------------------------------------------
// Sport, space, holidays (2026-09-28). All keyless and browser-readable,
// checked live. ESPN's scoreboard is undocumented: it can change without
// notice, which is what check-feeds is for.
// ---------------------------------------------------------------------------

/** The leagues, as [key, name, ESPN path, page]. NHL (604), the Premier
 *  League (605) and college football (606) were dropped 2026-10-01, the
 *  owner's call: three scoreboards are a sport section you can glance at,
 *  six were most of a cycle. */
export const LEAGUES = [
  ['nfl', 'NFL', 'football/nfl', '601'],
  ['nba', 'NBA', 'basketball/nba', '602'],
  ['mlb', 'MLB', 'baseball/mlb', '603'],
]
export const scoreboardUrl = (path) => `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`

/** A scoreboard: this week's (or round's) games, each with both teams,
 *  their scores, and where the game is -- 'pre', 'in' or 'post'. */
export function parseScoreboard(json) {
  if (!json || !Array.isArray(json.events)) throw new Error('no events in the scoreboard')
  return {
    games: json.events.map(e => {
      const cs = e.competitions?.[0]?.competitors || []
      const side = (h) => {
        const c = cs.find(x => x.homeAway === h) || {}
        return { abbr: fold(c.team?.abbreviation || '?'), name: fold(c.team?.shortDisplayName || ''), score: c.score ?? '', winner: !!c.winner }
      }
      return { date: Date.parse(e.date), state: e.status?.type?.state || 'pre', detail: fold(e.status?.type?.shortDetail || ''), away: side('away'), home: side('home') }
    }).filter(g => Number.isFinite(g.date)),
  }
}
export const anyLive = (data) => !!data?.games?.some(g => g.state === 'in')

export const LAUNCHES_URL = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=6'
/** The next launches, soonest first. "Upcoming" still lists one that went
 *  up an hour ago, so the page filters by time, not this. */
export function parseLaunches(json) {
  if (!json || !Array.isArray(json.results)) throw new Error('no launches in the response')
  return {
    launches: json.results.map(r => {
      const [vehicle, mission] = String(r.name || '').split(' | ')
      return {
        vehicle: fold(vehicle || ''), mission: fold(mission || r.mission?.name || ''),
        net: Date.parse(r.net), status: fold(r.status?.abbrev || ''),
        provider: fold(r.launch_service_provider?.name || ''), where: fold(r.pad?.location?.name || ''),
      }
    }).filter(l => Number.isFinite(l.net)).sort((a, b) => a.net - b.net),
  }
}

export const HOLIDAYS_URL = 'https://date.nager.at/api/v3/NextPublicHolidays/US'
/** The next US public holidays, one entry a date ("Columbus Day" and
 *  "Indigenous Peoples' Day" fall on one Monday, by state). */
export function parseHolidays(json) {
  if (!Array.isArray(json)) throw new Error('not an array')
  const byDate = new Map()
  for (const h of json) {
    if (!h?.date) continue
    const names = byDate.get(h.date) || []
    names.push(fold(h.name || h.localName || ''))
    byDate.set(h.date, names)
  }
  return { holidays: [...byDate].map(([date, names]) => ({ date, names })) }
}

/** The markets file the deploy workflow writes (tools/fetch-markets.mjs):
 *  checked for the shape page 401 reads, since it is built elsewhere. */
export function parseMarkets(json) {
  if (!json || !Array.isArray(json.series) || !json.series.length) throw new Error('no series in markets.json')
  const series = json.series.filter(s => s && s.name && Number.isFinite(s.value))
  if (!series.length) throw new Error('every series in markets.json was empty')
  // Page 402's series. Kept apart from `series` so an old markets.json
  // without them still serves 401. The first cut returned only `series`,
  // and 402 said "not in the last build" against a build that had them all;
  // its tests read the fixture around this parser, so none noticed.
  const household = (Array.isArray(json.household) ? json.household : []).filter(s => s && s.name && Number.isFinite(s.value))
  return { at: json.at || null, series, household }
}

/**
 * The cities page (302): Open-Meteo answers several places in one request
 * when given lists of latitudes and longitudes, as an array in the same
 * order. Needs no location permission, which is the point -- it is the
 * weather page cycling can show everyone. Twelve US cities, then (2026-10-01,
 * the owner's ask) twelve world cities for 302's second screen, west to east
 * round the globe, in the same request: one fetch, one rate limit.
 */
export const CITIES = [
  ['NEW YORK', 40.71, -74.01, 'us'], ['BOSTON', 42.36, -71.06, 'us'], ['WASHINGTON', 38.91, -77.04, 'us'],
  ['MIAMI', 25.76, -80.19, 'us'], ['ATLANTA', 33.75, -84.39, 'us'], ['CHICAGO', 41.88, -87.63, 'us'],
  ['HOUSTON', 29.76, -95.37, 'us'], ['DENVER', 39.74, -104.99, 'us'], ['PHOENIX', 33.45, -112.07, 'us'],
  ['LOS ANGELES', 34.05, -118.24, 'us'], ['SAN FRANCISCO', 37.77, -122.42, 'us'], ['SEATTLE', 47.61, -122.33, 'us'],
  ['MEXICO CITY', 19.43, -99.13, 'world'], ['TORONTO', 43.65, -79.38, 'world'], ['SAO PAULO', -23.55, -46.63, 'world'],
  ['LONDON', 51.51, -0.13, 'world'], ['PARIS', 48.86, 2.35, 'world'], ['BERLIN', 52.52, 13.40, 'world'],
  ['CAIRO', 30.04, 31.24, 'world'], ['DUBAI', 25.20, 55.27, 'world'], ['MUMBAI', 19.08, 72.88, 'world'],
  ['SINGAPORE', 1.35, 103.82, 'world'], ['TOKYO', 35.68, 139.69, 'world'], ['SYDNEY', -33.87, 151.21, 'world'],
]
export function citiesUrl(units) {
  const q = new URLSearchParams({
    latitude: CITIES.map(c => c[1]).join(','), longitude: CITIES.map(c => c[2]).join(','),
    current: 'temperature_2m,weather_code,is_day', daily: 'temperature_2m_max,temperature_2m_min',
    forecast_days: '1', timezone: 'auto', temperature_unit: units === 'C' ? 'celsius' : 'fahrenheit',
  })
  return `https://api.open-meteo.com/v1/forecast?${q}`
}
export function parseCities(json) {
  const list = Array.isArray(json) ? json : [json]
  if (list.length !== CITIES.length) throw new Error(`asked for ${CITIES.length} cities, got ${list.length}`)
  return {
    units: /F/.test(list[0]?.current_units?.temperature_2m || '') ? 'F' : 'C',
    cities: list.map((c, i) => ({
      name: CITIES[i][0],
      world: CITIES[i][3] === 'world',
      temp: Math.round(c.current?.temperature_2m),
      code: c.current?.weather_code ?? null,
      // Day or night there (2026-10-01), so a clear sky in Tokyo at 2am is
      // a star on 302 and not a sun. A copy without it reads as day.
      isDay: c.current?.is_day !== 0,
      hi: Math.round(c.daily?.temperature_2m_max?.[0]),
      lo: Math.round(c.daily?.temperature_2m_min?.[0]),
    })),
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

async function getJSON(fetchImpl, url) {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
const pad2 = (n) => String(n).padStart(2, '0')
const mmdd = (d) => `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`

export const ITN_URL = 'https://en.wikipedia.org/w/api.php?action=parse&page=Template:In_the_news&prop=text&format=json&formatversion=2&origin=*'
/** Built beside the site by the deploy workflow; relative, so it is read
 *  from whatever origin is serving the set. check-feeds passes the live
 *  address, since what it checks is that the workflow is producing it. */
export const MARKETS_URL = 'markets.json'
export const MARKETS_LIVE_URL = 'https://hyphen8d.github.io/interval/markets.json'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** The portal is dated in UTC: that is when Wikipedia's day turns over. */
export const currentEventsTitle = (d) => `${d.getUTCFullYear()}_${MONTHS[d.getUTCMonth()]}_${d.getUTCDate()}`
export const currentEventsUrl = (d) => `https://en.wikipedia.org/w/api.php?action=parse&page=Portal:Current_events/${currentEventsTitle(d)}&prop=text&format=json&formatversion=2&origin=*`
export const onThisDayUrl = (d) => `https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/${mmdd(d)}`
export function forecastUrl(lat, lon, units) {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    current: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    forecast_days: '5', timezone: 'auto',
    temperature_unit: units === 'C' ? 'celsius' : 'fahrenheit',
    wind_speed_unit: units === 'C' ? 'kmh' : 'mph',
  })
  return `https://api.open-meteo.com/v1/forecast?${q}`
}

const MIN = 60 * 1000

/**
 * The sources. `key(env)` is what a cached copy is valid FOR -- a date for the
 * date-shaped feeds, so yesterday's On this day is never shown as today's.
 * `refreshMs` is how often a live copy is re-fetched; a copy older than
 * three of those is shown as stale, with its age, on the page.
 * `label` is the credit line the page prints and the dashboard lists.
 */
export const FEEDS = {
  itn: {
    label: 'WIKIPEDIA', title: 'Wikipedia: In the news', refreshMs: 30 * MIN,
    url: () => ITN_URL,
    load: async (f) => parseITN(await getJSON(f, ITN_URL)),
  },
  events: {
    label: 'WIKIPEDIA', title: 'Wikipedia: Current events (today, then yesterday)', refreshMs: 30 * MIN,
    key: (env) => currentEventsTitle(env.date()),
    url: (env) => currentEventsUrl(env.date()),
    // Today's page is thin early in the (UTC) day, so yesterday's follows it.
    // A missing day is an empty list, not a failure; both missing is.
    load: async (f, env) => {
      const today = env.date(), yesterday = new Date(today.getTime() - 864e5)
      const days = await Promise.all([today, yesterday].map(d =>
        getJSON(f, currentEventsUrl(d)).then(parseCurrentEvents).catch(() => null)))
      if (days.every(d => d === null)) throw new Error('neither day could be read')
      // Each item knows which day's log it came from, as a UTC date, so the
      // headlines page can compare it with the viewer's own date: at 8pm in
      // New York, Wikipedia's "yesterday" is still the viewer's today.
      const iso = (d) => d.toISOString().slice(0, 10)
      return { items: days.flatMap((d, i) => (d || []).map(x => ({ ...x, date: iso(i === 0 ? today : yesterday) }))) }
    },
  },
  otd: {
    label: 'WIKIPEDIA', title: 'Wikipedia: On this day', refreshMs: 6 * 60 * MIN,
    key: (env) => mmdd(env.date()),
    url: (env) => onThisDayUrl(env.date()),
    load: async (f, env) => parseOnThisDay(await getJSON(f, onThisDayUrl(env.date()))),
  },
  weather: {
    label: 'OPEN-METEO', title: 'Open-Meteo: local forecast', refreshMs: 30 * MIN,
    // Keyed by the rounded position, and never persisted (see FeedCache): a
    // forecast is a coarse location, and SIGNAL's rule is that the location
    // lives in memory for the session and is written nowhere.
    key: (env) => env.location ? `${env.location.lat.toFixed(1)},${env.location.lon.toFixed(1)}` : null,
    persist: false,
    url: (env) => env.location ? forecastUrl(env.location.lat, env.location.lon, env.units) : null,
    load: async (f, env) => {
      if (!env.location) throw new Error('no location')
      return parseForecast(await getJSON(f, forecastUrl(env.location.lat, env.location.lon, env.units)))
    },
  },
  cities: {
    label: 'OPEN-METEO', title: 'Open-Meteo: twelve US and twelve world cities', refreshMs: 30 * MIN,
    url: (env) => citiesUrl(env.units),
    load: async (f, env) => parseCities(await getJSON(f, citiesUrl(env.units))),
  },
  ...Object.fromEntries(LEAGUES.map(([key, name, path]) => [`sport_${key}`, {
    label: 'ESPN', title: `ESPN: ${name} scoreboard`, refreshMs: 15 * MIN,
    // While a game is on, every minute: a score is the one thing on this
    // service that changes by the minute and is watched that way.
    liveRefreshMs: MIN, isLive: scoreboardLive,
    url: () => scoreboardUrl(path),
    load: async (f) => parseScoreboard(await getJSON(f, scoreboardUrl(path))),
  }])),
  launches: {
    label: 'THE SPACE DEVS', title: 'Launch Library: upcoming launches', refreshMs: 60 * MIN,
    // Free use is fifteen requests an hour per address: once an hour is it.
    url: () => LAUNCHES_URL,
    load: async (f) => parseLaunches(await getJSON(f, LAUNCHES_URL)),
  },
  holidays: {
    label: 'NAGER.DATE', title: 'Nager.Date: next US public holidays', refreshMs: 24 * 60 * MIN,
    url: () => HOLIDAYS_URL,
    load: async (f) => parseHolidays(await getJSON(f, HOLIDAYS_URL)),
  },
  markets: {
    label: 'FRED', title: 'FRED: market closes (built by the deploy workflow)', refreshMs: 60 * MIN,
    url: (env) => env.marketsUrl || MARKETS_URL,
    load: async (f, env) => parseMarkets(await getJSON(f, env.marketsUrl || MARKETS_URL)),
  },
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

/**
 * A scoreboard is on the minute-by-minute rate while a game is on, and also
 * from one refresh period before a game's start (2026-10-01). At the
 * fifteen-minute rate a game could still read "not started" a quarter of an
 * hour after kickoff, since only a game already 'in' sped the feed up. Bounded
 * to three hours past the start, so a game ESPN leaves at 'pre' (a delay it
 * never resolves) doesn't hold the feed at once a minute for good.
 */
export function scoreboardLive(data, now = Date.now()) {
  if (anyLive(data)) return true
  return !!data?.games?.some(g => g.state === 'pre' && g.date - 15 * MIN <= now && now <= g.date + 3 * 60 * MIN)
}

/**
 * How old a copy has to be before its page says so: three refresh periods,
 * and three of the LIVE period while the copy is live. 2026-10-01: it was
 * always refreshMs * 3, so a live score that stopped updating read as fresh
 * for 45 minutes. `data` and `now` are optional, so `staleAfter(feed)` still
 * answers the resting figure.
 */
export const staleAfter = (feed, data = null, now = Date.now()) =>
  (feed.liveRefreshMs && data && feed.isLive?.(data, now) ? feed.liveRefreshMs : feed.refreshMs) * 3

/** Whether an entry's copy should be shown as stale. A copy dated more than
 *  a minute in the future (a saved copy from a skewed clock) is stale too:
 *  `now - at` is negative, so by age alone it would read fresh for good. */
export function isStale(feed, entry, now = Date.now()) {
  if (!entry?.data) return false
  return entry.at > now + MIN || now - entry.at > staleAfter(feed, entry.data, now)
}

/** How long a fetch may take before it counts as a failure. */
export const FETCH_TIMEOUT_MS = 20 * 1000
function deadline(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms)
  const c = new AbortController()
  setTimeout(() => c.abort(new Error('timed out')), ms)
  return c.signal
}

/** Retry delay after the n-th consecutive failure: 1, 2, 4 ... 30 minutes. */
export const backoffMs = (n) => Math.min(30, 2 ** Math.max(0, n - 1)) * MIN

export class FeedCache {
  /**
   * @param {object} o
   * @param {Function} o.fetch       fetch implementation
   * @param {Function} o.now         ms clock (Date.now shaped)
   * @param {object}   o.env         { date(), location, units, signalUrl, importModule }
   * @param {object}   [o.storage]   localStorage-shaped, for a warm start
   * @param {Function} [o.onChange]  called with the feed id whenever an entry changes
   * @param {string}   [o.build]     the running build, stamped on each saved copy
   * @param {number}   [o.timeoutMs] how long a fetch may take before it fails
   */
  constructor({ fetch, now, env, storage = null, onChange = () => {}, feeds = FEEDS, build = globalThis.INTERVAL_BUILD ?? '', timeoutMs = FETCH_TIMEOUT_MS }) {
    this.build = String(build)
    this.timeoutMs = timeoutMs
    this.fetch = fetch
    this.now = now
    this.env = env
    this.storage = storage
    this.onChange = onChange
    this.feeds = feeds
    this.entries = new Map()
    for (const id of Object.keys(feeds)) this.entries.set(id, this._restore(id))
  }

  _storageKey(id) { return `interval:feed:${id}` }

  /**
   * A saved copy is what an earlier visit's PARSER made of the source, so a
   * copy saved by another build is shown (a warm start beats a blank page)
   * but fetched again at once (`reparse`), not left until its refresh period
   * runs out. 2026-09-28: parseMarkets was fixed to keep 402's `household`,
   * and a browser holding a copy parsed by the old build kept 402 empty for
   * up to an hour after the fix was live.
   *
   * A copy dated in the future (saved under a clock that ran fast) is
   * fetched again at once too: by age alone it would never fall due.
   */
  _restore(id) {
    const blank = { key: null, data: null, at: 0, error: null, loading: false, failures: 0, retryAt: 0, reparse: false, failKey: null }
    if (!this.storage || this.feeds[id].persist === false) return blank
    try {
      const raw = this.storage.getItem(this._storageKey(id))
      if (!raw) return blank
      const saved = JSON.parse(raw)
      const at = saved.at || 0
      return { ...blank, key: saved.key ?? null, data: saved.data ?? null, at, reparse: String(saved.build ?? '') !== this.build || at > this.now() + MIN }
    } catch (e) { return blank }
  }

  _persist(id, e) {
    if (!this.storage || this.feeds[id].persist === false) return
    try { this.storage.setItem(this._storageKey(id), JSON.stringify({ key: e.key, data: e.data, at: e.at, build: this.build })) } catch (err) { /* quota, private mode */ }
  }

  keyFor(id) {
    const f = this.feeds[id]
    return f.key ? f.key(this.env) : 'live'
  }

  /** The entry, if its key is still current. A copy for another date or
   *  another place is not data about this one. */
  get(id) {
    const e = this.entries.get(id)
    if (!e) return null
    const key = this.keyFor(id)
    if (e.data && e.key !== key) return { ...e, data: null, at: 0 }
    return e
  }

  /** 'none' | 'loading' | 'fresh' | 'stale' | 'error' */
  status(id) {
    const e = this.get(id)
    if (!e) return 'none'
    if (e.data) return isStale(this.feeds[id], e, this.now()) ? 'stale' : 'fresh'
    if (e.loading) return 'loading'
    if (e.error) return 'error'
    return 'none'
  }

  /**
   * Start a fetch if this feed is due and none is running. Resolves when
   * that fetch settles (or at once when nothing was due). Never rejects.
   *
   * 2026-10-01, two holes closed. A fetch had no deadline, so one that
   * stalled (a captive portal, a dropped connection the browser never
   * reported) left the feed `loading` for good and it was never asked again:
   * now it fails after `timeoutMs` and backs off like any failure. The fetch
   * is given the signal, so a real one is aborted; the race is for a fetch
   * (or a test's fake) that ignores it. And the backoff belonged to the feed,
   * not the key, so after a night of failures the new day's dated key waited
   * up to thirty minutes for its first try: a streak is now forgotten when
   * the key it was against changes.
   */
  ensure(id, { force = false } = {}) {
    const f = this.feeds[id], e = this.entries.get(id)
    if (!f || !e) return Promise.resolve()
    if (e.loading) return e.loading
    const key = this.keyFor(id)
    if (key === null) return Promise.resolve()
    if (e.failures && e.failKey !== key) Object.assign(e, { failures: 0, retryAt: 0, error: null })
    const now = this.now()
    const current = e.data && e.key === key
    const every = f.liveRefreshMs && f.isLive?.(e.data, now) ? f.liveRefreshMs : f.refreshMs
    const future = e.at > now + MIN
    if (!force && current && !e.reparse && !future && now - e.at < every) return Promise.resolve()
    if (!force && e.retryAt > now) return Promise.resolve()
    const p = (async () => {
      try {
        const signal = deadline(this.timeoutMs)
        const fetchImpl = this.fetch && ((url, opts = {}) => this.fetch(url, { ...opts, signal }))
        const gaveUp = new Promise((_, reject) => signal.addEventListener('abort',
          () => reject(new Error(`no answer in ${Math.round(this.timeoutMs / 1000)}s`)), { once: true }))
        const data = await Promise.race([f.load(fetchImpl, this.env), gaveUp])
        Object.assign(e, { key, data, at: this.now(), error: null, failures: 0, retryAt: 0, reparse: false, failKey: null })
        this._persist(id, e)
      } catch (err) {
        e.failures++
        Object.assign(e, { error: String(err?.message ?? err), retryAt: this.now() + backoffMs(e.failures), failKey: key })
      } finally {
        e.loading = false
        this.onChange(id)
      }
    })()
    e.loading = p
    this.onChange(id)
    return p
  }
}
