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

/** Today's featured article and the most-read list. */
export function parseFeatured(json) {
  if (!json || (!json.tfa && !json.mostread)) throw new Error('no featured content in the response')
  const tfa = json.tfa ? {
    title: fold(json.tfa.titles?.normalized ?? json.tfa.title ?? '').replace(/_/g, ' '),
    description: fold(json.tfa.description ?? ''),
    extract: fold(json.tfa.extract ?? ''),
  } : null
  const mostread = (json.mostread?.articles || []).map(a => ({
    title: fold(a.titles?.normalized ?? a.normalizedtitle ?? a.title ?? '').replace(/_/g, ' '),
    views: a.views ?? null,
    description: fold(a.description ?? ''),
  })).filter(a => a.title)
  return { tfa, mostread, date: json.mostread?.date ?? null }
}

/** "2 km SW of Sakai, Japan" -> "Sakai, Japan". The distance and bearing are
 *  from the nearest named place and mean nothing on a 40-column row. */
export function shortPlace(place) {
  const p = String(place ?? '')
  const at = p.search(/\bof\s/)
  return fold(at >= 0 && /^\d/.test(p) ? p.slice(at + 3) : p).trim()
}

/** USGS earthquake GeoJSON: newest first. */
export function parseQuakes(json) {
  if (!json || !Array.isArray(json.features)) throw new Error('no features in the response')
  return json.features
    .map(f => ({
      mag: Number(f.properties?.mag),
      place: shortPlace(f.properties?.place),
      time: Number(f.properties?.time),
      tsunami: !!f.properties?.tsunami,
      alert: f.properties?.alert || null,
    }))
    .filter(q => Number.isFinite(q.mag) && Number.isFinite(q.time))
    .sort((a, b) => b.time - a.time)
}

/** A Hacker News item, as a row can carry it. */
export function parseHnItem(json) {
  if (!json || !json.title) return null
  let domain = ''
  try { domain = json.url ? new URL(json.url).hostname.replace(/^www\./, '') : '' } catch (e) { /* none */ }
  return { title: fold(json.title), score: json.score ?? 0, comments: json.descendants ?? 0, by: json.by || '', domain }
}

/** NOAA planetary K-index: 3-hourly readings, oldest first. */
export function parseKp(json) {
  if (!Array.isArray(json)) throw new Error('not an array')
  // The products endpoint once answered as rows of strings with a header row;
  // it now answers as objects. Accept both, since both have been live.
  const rows = json[0] && Array.isArray(json[0])
    ? json.slice(1).map(r => ({ time: String(r[0]).replace(' ', 'T'), kp: Number(r[1]) }))
    : json.map(r => ({ time: r.time_tag, kp: Number(r.Kp ?? r.kp_index ?? r.kp) }))
  const readings = rows.filter(r => r.time && Number.isFinite(r.kp))
  if (!readings.length) throw new Error('no K-index readings')
  return { readings, latest: readings[readings.length - 1] }
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

/** SIGNAL's roster, from its own stations.js module. Public stations only:
 *  the listings keep the secrets the way the dial does. */
export function parseSignalRoster(mod) {
  const list = mod?.STATIONS
  if (!Array.isArray(list) || !list.length) throw new Error('no STATIONS export')
  return {
    stations: list.filter(s => s && !s.secret && s.id && s.callsign).map(s => ({
      id: s.id,
      callsign: fold(s.callsign),
      freq: Number(s.freq),
      band: s.band || 'ym',
      tagline: fold(s.tagline || ''),
      desc: fold(s.desc || ''),
      tracks: (s.tracks || []).map(t => ({ youtubeId: t.youtubeId || t.id, title: fold(t.title || ''), artist: fold(t.artist || '') }))
        .filter(t => t.youtubeId),
    })).sort((a, b) => a.freq - b.freq),
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
const ymd = (d) => `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`

export const ITN_URL = 'https://en.wikipedia.org/w/api.php?action=parse&page=Template:In_the_news&prop=text&format=json&formatversion=2&origin=*'
export const QUAKES_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson'
export const HN_TOP_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json'
export const hnItemUrl = (id) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`
export const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'
export const SIGNAL_ROSTER_URL = 'https://hyphen8d.github.io/signal/stations.js'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** The portal is dated in UTC: that is when Wikipedia's day turns over. */
export const currentEventsTitle = (d) => `${d.getUTCFullYear()}_${MONTHS[d.getUTCMonth()]}_${d.getUTCDate()}`
export const currentEventsUrl = (d) => `https://en.wikipedia.org/w/api.php?action=parse&page=Portal:Current_events/${currentEventsTitle(d)}&prop=text&format=json&formatversion=2&origin=*`
export const onThisDayUrl = (d) => `https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/${mmdd(d)}`
export const featuredUrl = (d) => `https://en.wikipedia.org/api/rest_v1/feed/featured/${ymd(d)}`
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
  featured: {
    label: 'WIKIPEDIA', title: 'Wikipedia: featured article and most read', refreshMs: 60 * MIN,
    key: (env) => ymd(env.date()),
    url: (env) => featuredUrl(env.date()),
    load: async (f, env) => parseFeatured(await getJSON(f, featuredUrl(env.date()))),
  },
  otd: {
    label: 'WIKIPEDIA', title: 'Wikipedia: On this day', refreshMs: 6 * 60 * MIN,
    key: (env) => mmdd(env.date()),
    url: (env) => onThisDayUrl(env.date()),
    load: async (f, env) => parseOnThisDay(await getJSON(f, onThisDayUrl(env.date()))),
  },
  quakes: {
    label: 'USGS', title: 'USGS: earthquakes M4.5+, past day', refreshMs: 5 * MIN,
    url: () => QUAKES_URL,
    load: async (f) => parseQuakes(await getJSON(f, QUAKES_URL)),
  },
  hn: {
    label: 'HACKER NEWS', title: 'Hacker News: top stories', refreshMs: 15 * MIN,
    url: () => HN_TOP_URL,
    load: async (f) => {
      const ids = (await getJSON(f, HN_TOP_URL)).slice(0, 10)
      const items = await Promise.all(ids.map(id => getJSON(f, hnItemUrl(id)).then(parseHnItem).catch(() => null)))
      const stories = items.filter(Boolean)
      if (!stories.length) throw new Error('no stories could be read')
      return { stories }
    },
  },
  kp: {
    label: 'NOAA SWPC', title: 'NOAA: planetary K-index', refreshMs: 30 * MIN,
    url: () => KP_URL,
    load: async (f) => parseKp(await getJSON(f, KP_URL)),
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
  signal: {
    label: 'SIGNAL', title: "SIGNAL's roster (stations.js)", refreshMs: 6 * 60 * MIN,
    url: (env) => env.signalUrl || SIGNAL_ROSTER_URL,
    // A module, not JSON: SIGNAL's roster is pure data with no imports, so it
    // can be imported from another origin as it stands, and INTERVAL lists
    // exactly what SIGNAL plays rather than a copy that drifts from it.
    // GitHub Pages serves it with access-control-allow-origin: *.
    load: async (f, env) => parseSignalRoster(await env.importModule(env.signalUrl || SIGNAL_ROSTER_URL)),
  },
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

/** How old a copy has to be before its page says so. */
export const staleAfter = (feed) => feed.refreshMs * 3

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
   */
  constructor({ fetch, now, env, storage = null, onChange = () => {}, feeds = FEEDS }) {
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

  _restore(id) {
    const blank = { key: null, data: null, at: 0, error: null, loading: false, failures: 0, retryAt: 0 }
    if (!this.storage || this.feeds[id].persist === false) return blank
    try {
      const raw = this.storage.getItem(this._storageKey(id))
      if (!raw) return blank
      const saved = JSON.parse(raw)
      return { ...blank, key: saved.key ?? null, data: saved.data ?? null, at: saved.at || 0 }
    } catch (e) { return blank }
  }

  _persist(id, e) {
    if (!this.storage || this.feeds[id].persist === false) return
    try { this.storage.setItem(this._storageKey(id), JSON.stringify({ key: e.key, data: e.data, at: e.at })) } catch (err) { /* quota, private mode */ }
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
    if (e.data) return this.now() - e.at > staleAfter(this.feeds[id]) ? 'stale' : 'fresh'
    if (e.loading) return 'loading'
    if (e.error) return 'error'
    return 'none'
  }

  /** Start a fetch if this feed is due and none is running. Resolves when
   *  that fetch settles (or at once when nothing was due). Never rejects. */
  ensure(id, { force = false } = {}) {
    const f = this.feeds[id], e = this.entries.get(id)
    if (!f || !e) return Promise.resolve()
    if (e.loading) return e.loading
    const key = this.keyFor(id)
    if (key === null) return Promise.resolve()
    const now = this.now()
    const current = e.data && e.key === key
    if (!force && current && now - e.at < f.refreshMs) return Promise.resolve()
    if (!force && e.retryAt > now) return Promise.resolve()
    const p = (async () => {
      try {
        const data = await f.load(this.fetch, this.env)
        Object.assign(e, { key, data, at: this.now(), error: null, failures: 0, retryAt: 0 })
        this._persist(id, e)
      } catch (err) {
        e.failures++
        Object.assign(e, { error: String(err?.message ?? err), retryAt: this.now() + backoffMs(e.failures) })
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
