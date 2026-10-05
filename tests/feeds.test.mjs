// The parsers against what the services really returned (tests/fixtures,
// captured 2026-09-28), and the cache's rules about age and dates.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseITN, parseOnThisDay, parseForecast, parseMarkets, parseCities,
  decodeEntities, FeedCache, backoffMs, staleAfter, FEEDS, forecastUrl,
} from '../feeds.js'

const fx = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'))

test('In the news: stories, ongoing and recent deaths, without the photo asides or the template docs', () => {
  const itn = parseITN(fx('wiki-itn.json'))
  assert.equal(itn.stories.length, 4)
  assert.match(itn.stories[0], /^In Australian rules football/)
  assert.ok(!itn.stories.some(s => /pictured/i.test(s)), 'no "(X pictured)"')
  assert.deepEqual(itn.ongoing, ['Iran war (Lebanon war)', 'Russo-Ukrainian war'], 'the nested "timeline" link is dropped')
  assert.equal(itn.deaths.length, 6)
  assert.ok(!itn.deaths.some(d => /template|documentation|nominate/i.test(d)))
})

test('In the news refuses a response with no stories rather than drawing an empty page', () => {
  assert.throws(() => parseITN({ parse: { text: '<div>nothing</div>' } }))
  assert.throws(() => parseITN({}))
})

test('On this day: the editorial picks in year order, text tidied', () => {
  const o = parseOnThisDay(fx('wiki-onthisday.json'))
  assert.ok(o.selected.length >= 8)
  const years = o.selected.map(e => e.year)
  assert.deepEqual(years, [...years].sort((a, b) => a - b))
  assert.ok(!o.selected.some(e => /pictured|\n/.test(e.text)))
  assert.ok(o.births.length && o.deaths.length && o.holidays.length)
  assert.ok(!o.holidays.some(h => h.includes('\n')))
})

test('forecast: today in three parts, five days, units read from the response', () => {
  const w = parseForecast(fx('open-meteo.json'))
  assert.equal(w.days.length, 5)
  assert.deepEqual(w.parts.map(p => p.name), ['MORNING', 'AFTERNOON', 'EVENING'])
  assert.equal(w.units, 'F')
  assert.equal(w.days[0].sunrise, '06:49')
  assert.match(forecastUrl(1, 2, 'C'), /temperature_unit=celsius/)
})

test('entities decode, named and numeric', () => {
  assert.equal(decodeEntities('a&#58; b &amp; c&#160;d &#x41;'), 'a: b & c d A')
})

function cacheWith(loads, { now = () => clock.t, date = new Date(2026, 8, 28) } = {}) {
  const feeds = {
    live: { label: 'L', refreshMs: 60000, load: async () => loads.live() },
    dated: { label: 'D', refreshMs: 60000, key: (env) => env.date().toDateString(), load: async () => loads.dated() },
    secret: { label: 'S', refreshMs: 60000, persist: false, load: async () => 'x' },
  }
  const env = { date: () => clock.date }
  clock.date = date
  const storage = new Map()
  const cache = new FeedCache({
    fetch: null, now, env, feeds,
    storage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
  })
  return { cache, storage, feeds, env }
}
const clock = { t: 1_000_000, date: null }

test('cache: fresh, then stale after three refresh periods, with the age kept', async () => {
  const { cache } = cacheWith({ live: () => ({ n: 1 }) })
  await cache.ensure('live')
  assert.equal(cache.status('live'), 'fresh')
  clock.t += 60000 * 3 + 1
  assert.equal(cache.status('live'), 'stale')
  assert.deepEqual(cache.get('live').data, { n: 1 }, 'stale data is still there to show, with its age')
  clock.t = 1_000_000
})

test("cache: a copy for another date is not today's data", async () => {
  const { cache } = cacheWith({ dated: () => 'monday' })
  await cache.ensure('dated')
  assert.equal(cache.get('dated').data, 'monday')
  clock.date = new Date(2026, 8, 29)
  assert.equal(cache.get('dated').data, null)
  assert.equal(cache.status('dated'), 'none')
})

test('cache: failures back off and are reported, never thrown', async () => {
  let calls = 0
  const { cache } = cacheWith({ live: () => { calls++; throw new Error('HTTP 503') } })
  await cache.ensure('live')
  assert.equal(cache.status('live'), 'error')
  assert.equal(cache.get('live').error, 'HTTP 503')
  await cache.ensure('live')
  assert.equal(calls, 1, 'not retried inside the backoff')
  clock.t += backoffMs(1) + 1
  await cache.ensure('live')
  assert.equal(calls, 2)
  clock.t = 1_000_000
})

test('cache: persists for a warm start, except what is marked private', async () => {
  const { cache, storage } = cacheWith({ live: () => 'hello' })
  await cache.ensure('live')
  await cache.ensure('secret')
  assert.ok(storage.has('interval:feed:live'))
  assert.ok(!storage.has('interval:feed:secret'))
})

test('the weather feed is never persisted: a forecast is a coarse location', () => {
  assert.equal(FEEDS.weather.persist, false)
  assert.ok(staleAfter(FEEDS.cities) < staleAfter(FEEDS.otd))
})

test('Current events: the innermost items only, sources dropped, filed by section', async () => {
  const { parseCurrentEvents } = await import('../feeds.js')
  const all = fx('wiki-current-events.json')
  const today = parseCurrentEvents(all['2026_September_28'])
  assert.equal(today.length, 8)
  assert.ok(!today.some(e => /^(edit|history|watch)$/i.test(e.text)), 'not the navbar')
  assert.ok(!today.some(e => /\((Reuters|AP|AFP)[^)]*\)$/.test(e.text)), 'no trailing citations')
  assert.ok(!today.some(e => e.text === 'Somali Civil War'), 'not the topic headings the news hangs under')
  assert.equal(today[0].category, 'Armed conflicts and attacks')
  assert.equal(parseCurrentEvents(all['2026_September_27']).length, 18)
})

test('markets: a close each', () => {
  const m = parseMarkets(fx('markets.json'))
  assert.equal(m.series[0].name, 'DOW JONES')
  assert.ok(m.series.every(s => Number.isFinite(s.value) && /^\d{4}-\d\d-\d\d$/.test(s.date)))
  assert.throws(() => parseMarkets({ series: [] }))
})

test('FRED CSV: the last two real values, skipping holidays', async () => {
  const { parseFredCsv } = await import('../tools/fetch-markets.mjs')
  const r = parseFredCsv('observation_date,DJIA\n2026-09-24,100\n2026-09-25,101.5\n2026-09-28,.\n')
  assert.deepEqual(r, { date: '2026-09-25', value: 101.5, prevDate: '2026-09-24', prev: 100, history: [100, 101.5] })
  assert.throws(() => parseFredCsv('observation_date,DJIA\n'))
})

test('cities: twelve US then twelve world, in the order asked, units from the answer', () => {
  const c = parseCities(fx('open-meteo-cities.json'))
  assert.equal(c.cities.length, 24)
  assert.equal(c.cities[0].name, 'NEW YORK')
  assert.equal(c.cities[11].name, 'SEATTLE')
  assert.deepEqual(c.cities.map(x => x.world), [...Array(12).fill(false), ...Array(12).fill(true)])
  assert.equal(c.cities.find(x => x.name === 'LONDON')?.world, true)
  assert.equal(c.cities.at(-1).name, 'SYDNEY')
  assert.equal(c.units, 'F')
  assert.ok(c.cities.every(x => Number.isFinite(x.temp) && Number.isFinite(x.hi)))
  assert.throws(() => parseCities([{}]), /asked for 24/)
})

test('scoreboards: both teams, scores, and where the game is', async () => {
  const { parseScoreboard, anyLive } = await import('../feeds.js')
  const nfl = parseScoreboard(fx('espn-football-nfl.json'))
  assert.equal(nfl.games.length, 16)
  const g = nfl.games[0]
  assert.deepEqual([g.away.abbr, g.away.score, g.home.abbr, g.home.score, g.state], ['PHI', '7', 'CHI', '27', 'post'])
  assert.ok(g.home.winner && !g.away.winner)
  assert.equal(anyLive(nfl), false)
  assert.equal(anyLive({ games: [{ state: 'in' }] }), true)
})

test('a live game makes its scoreboard refresh every minute', async () => {
  const { FeedCache, FEEDS } = await import('../feeds.js')
  let loads = 0, now = 0, live = true
  const cache = new FeedCache({ fetch: null, now: () => now, env: {}, feeds: { s: { ...FEEDS.sport_nfl, load: async () => { loads++; return { games: [{ state: live ? 'in' : 'post' }] } } } } })
  await cache.ensure('s')
  now = 61000; await cache.ensure('s')
  assert.equal(loads, 2, 'live: again after a minute')
  live = false
  now = 130000; await cache.ensure('s')
  now = 200000; await cache.ensure('s')
  assert.equal(loads, 3, 'over: back to fifteen minutes')
})

test('launches and holidays', async () => {
  const { parseLaunches, parseHolidays } = await import('../feeds.js')
  const l = parseLaunches(fx('launches.json')).launches
  assert.equal(l[1].mission, 'Crew-13')
  assert.ok(l.every((x, i) => !i || x.net >= l[i - 1].net))
  const h = parseHolidays(fx('holidays-us.json')).holidays
  assert.deepEqual(h[0].names, ['Columbus Day', "Indigenous Peoples' Day"], 'one Monday, two names')
})

test('household money: inflation is a twelve-month change worked out from the index', async () => {
  const { yoyFromCsv } = await import('../tools/fetch-markets.mjs')
  const rows = ['observation_date,CPI', ...Array.from({ length: 24 }, (_, i) => `20${24 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-01,${100 + i}`)]
  const r = yoyFromCsv(rows.join('\n'))
  assert.equal(r.date, '2025-12-01')
  assert.ok(Math.abs(r.value - (123 / 111 - 1) * 100) < 1e-9)
  assert.equal(r.history.length, 10)
  const m = fx('markets.json')
  assert.deepEqual(m.household.map(s => s.id), ['GASREGW', 'MORTGAGE30US', 'CPIAUCSL', 'DFF', 'UNRATE'])
})

test('a copy saved by another build is shown, and fetched again at once', async () => {
  const { FeedCache } = await import('../feeds.js')
  const store = new Map()
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  const feeds = { m: { refreshMs: 60 * 60000, load: async () => ({ v: 'new' }) } }
  let now = 1000
  store.set('interval:feed:m', JSON.stringify({ key: 'live', data: { v: 'old' }, at: 900, build: 'A' }))
  const a = new FeedCache({ fetch: null, now: () => now, env: {}, storage, feeds, build: 'B' })
  assert.deepEqual(a.get('m').data, { v: 'old' }, 'the old copy warms the start')
  await a.ensure('m')
  assert.deepEqual(a.get('m').data, { v: 'new' }, 'and is replaced at once, not in an hour')
  let loads = 0
  feeds.m.load = async () => { loads++; return { v: 'newer' } }
  const b = new FeedCache({ fetch: null, now: () => now, env: {}, storage, feeds, build: 'B' })
  await b.ensure('m')
  assert.equal(loads, 0, 'a copy this build saved waits out its refresh as before')
})

test('a live score that stops updating reads stale after three minutes, not forty-five', async () => {
  const { FeedCache, FEEDS, staleAfter, isStale } = await import('../feeds.js')
  let now = 0
  const cache = new FeedCache({ fetch: null, now: () => now, env: {}, feeds: { s: { ...FEEDS.sport_nfl, load: async () => ({ games: [{ state: 'in', date: 0 }] }) } } })
  await cache.ensure('s')
  now = 3 * 60000 + 1
  assert.equal(cache.status('s'), 'stale', 'live: three missed minutes is stale')
  const e = cache.get('s')
  assert.equal(isStale(FEEDS.sport_nfl, e, now), true)
  assert.equal(staleAfter(FEEDS.sport_nfl, e.data, now), 3 * 60000)
  assert.equal(staleAfter(FEEDS.sport_nfl), 45 * 60000, 'the one-argument call still answers the resting figure')
  assert.equal(isStale(FEEDS.sport_nfl, { at: 0, data: { games: [{ state: 'post', date: 0 }] } }, now), false, 'a finished game keeps forty-five')
})

test('a scoreboard speeds up before kickoff, not fifteen minutes after it', async () => {
  const { FeedCache, FEEDS, scoreboardLive } = await import('../feeds.js')
  const kickoff = 60 * 60000
  let loads = 0, now = kickoff - 30 * 60000
  const cache = new FeedCache({ fetch: null, now: () => now, env: {}, feeds: { s: { ...FEEDS.sport_nfl, load: async () => { loads++; return { games: [{ state: 'pre', date: kickoff }] } } } } })
  await cache.ensure('s')
  now += 61000; await cache.ensure('s')
  assert.equal(loads, 1, 'half an hour out: the resting rate')
  now = kickoff - 10 * 60000; await cache.ensure('s')
  now += 61000; await cache.ensure('s')
  assert.equal(loads, 3, 'inside the window: every minute')
  assert.equal(scoreboardLive({ games: [{ state: 'pre', date: kickoff }] }, kickoff + 4 * 60 * 60000), false, 'a game stuck at pre for hours lets go')
})

test('a fetch that never answers fails after the deadline and backs off', { timeout: 5000 }, async () => {
  const { FeedCache, backoffMs } = await import('../feeds.js')
  let now = 0, calls = 0, seen = null
  const feeds = { x: { refreshMs: 60000, load: (f) => { calls++; f('u'); return new Promise(() => {}) } } }
  const cache = new FeedCache({ fetch: (u, o) => { seen = o?.signal; return new Promise(() => {}) }, now: () => now, env: {}, feeds, timeoutMs: 20 })
  await cache.ensure('x')
  assert.equal(cache.status('x'), 'error')
  assert.match(cache.get('x').error, /no answer/)
  assert.ok(seen?.aborted, 'the real fetch was given the signal and it fired')
  await cache.ensure('x')
  assert.equal(calls, 1, 'inside the backoff')
  now += backoffMs(1) + 1
  await cache.ensure('x')
  assert.equal(calls, 2, 'and asked again after it')
})

test("a failure streak is forgotten when the day's key changes", async () => {
  let calls = 0, ok = false
  const { cache } = cacheWith({ dated: () => { calls++; if (!ok) throw new Error('HTTP 503'); return 'tuesday' } })
  for (let i = 0; i < 5; i++) { if (i) clock.t += backoffMs(i) + 1; await cache.ensure('dated') }
  assert.equal(calls, 5)
  await cache.ensure('dated')
  assert.equal(calls, 5, 'still backing off for today')
  ok = true
  clock.date = new Date(2026, 8, 29)
  await cache.ensure('dated')
  assert.equal(calls, 6, "the new day's key is asked for at once")
  assert.equal(cache.get('dated').data, 'tuesday')
  clock.t = 1_000_000
})

test('a saved copy dated in the future reads stale and is fetched again', async () => {
  const { FeedCache } = await import('../feeds.js')
  const store = new Map([['interval:feed:m', JSON.stringify({ key: 'live', data: { v: 'old' }, at: 10 * 60 * 60000, build: 'B' })]])
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  let loads = 0
  const feeds = { m: { refreshMs: 60 * 60000, load: async () => { loads++; return { v: 'new' } } } }
  const cache = new FeedCache({ fetch: null, now: () => 1000, env: {}, storage, feeds, build: 'B' })
  assert.equal(cache.status('m'), 'stale')
  await cache.ensure('m')
  assert.equal(loads, 1)
  assert.equal(cache.status('m'), 'fresh')
})

test('FRED CSV: an empty value is a day with none, not a close of zero', async () => {
  const { parseFredCsv, yoyFromCsv } = await import('../tools/fetch-markets.mjs')
  const r = parseFredCsv('observation_date,NIKKEI225\n2026-09-18,65018.95\n2026-09-21,\n2026-09-22, \n2026-09-24,65513.99\n')
  assert.deepEqual(r.history, [65018.95, 65513.99])
  assert.equal(r.prev, 65018.95)
  const cpi = ['observation_date,CPI', ...Array.from({ length: 24 }, (_, i) => `20${24 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-01,${i === 23 ? '' : 100 + i}`)]
  assert.equal(yoyFromCsv(cpi.join('\n')).date, '2025-11-01', 'an empty month is skipped, never divided by')
  // The captured fixture had the Nikkei's September holidays as zeros.
  assert.ok(fx('markets.json').series.every(s => s.history.every(v => v > 0)))
})

test('inflation: matched to the same month a year before, by date, and fetched far enough back', async () => {
  const { yoyFromCsv, HOUSEHOLD } = await import('../tools/fetch-markets.mjs')
  // 2025-06 is missing: twelve rows back from 2026-03 would be 2025-02.
  const rows = ['observation_date,CPI']
  for (let i = 0; i < 27; i++) {
    const d = `20${24 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-01`
    if (d !== '2025-06-01') rows.push(`${d},${100 + i}`)
  }
  const r = yoyFromCsv(rows.join('\n'))
  assert.equal(r.date, '2026-03-01')
  assert.ok(Math.abs(r.value - (126 / 114 - 1) * 100) < 1e-9, 'March against March')
  assert.equal(r.prevDate, '2026-02-01')
  assert.throws(() => yoyFromCsv(rows.filter(l => !l.startsWith('2025-03')).join('\n')), 'the latest month with no year-earlier reading is refused, not guessed')
  const cpi = HOUSEHOLD.find(s => s.kind === 'yoy')
  assert.ok(cpi.days >= 24 * 31, `${cpi.days} days is under 24 months: 22 rows plus a late release need more`)
})

test('markets build: a failed series is carried from the live copy, each request has a deadline', async () => {
  const { fetchMarkets, SERIES, HOUSEHOLD } = await import('../tools/fetch-markets.mjs')
  const previous = fx('markets.json')
  const signals = []
  const csv = 'observation_date,X\n2026-09-29,10\n2026-09-30,11\n'
  const cpi = ['observation_date,CPI', ...Array.from({ length: 26 }, (_, i) => `20${24 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-01,${100 + i}`)].join('\n')
  const fetchImpl = async (url, o) => {
    signals.push(o?.signal)
    if (/id=(NIKKEI225|CPIAUCSL)&/.test(url)) return { ok: false, status: 503 }
    return { ok: true, text: async () => (/CPIAUCSL/.test(url) ? cpi : csv) }
  }
  const m = await fetchMarkets(fetchImpl, new Date('2026-10-01T13:30:00Z'), { previous })
  assert.ok(signals.length === SERIES.length + HOUSEHOLD.length && signals.every(s => s instanceof AbortSignal))
  assert.deepEqual(m.series.map(s => s.id), SERIES.map(s => s.id), 'every row, in order')
  const nk = m.series.find(s => s.id === 'NIKKEI225')
  assert.equal(nk.carried, true)
  assert.equal(nk.date, previous.series.find(s => s.id === 'NIKKEI225').date, 'at its own, older date')
  assert.ok(m.household.find(s => s.id === 'CPIAUCSL').carried, 'inflation is not dropped from 402')
  assert.deepEqual(m.carried, ['NIKKEI225', 'CPIAUCSL'])
  assert.equal(m.failed.length, 2)
  const bare = await fetchMarkets(fetchImpl, new Date('2026-10-01T13:30:00Z'))
  assert.ok(!bare.series.some(s => s.id === 'NIKKEI225'), 'with no previous copy there is nothing to carry')
})

test('health probe: a markets.json with no build time fails, not passes as fresh', async () => {
  const { probe } = await import('../tools/check-feeds.mjs')
  const { at, ...noAt } = fx('markets.json')
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => '*' }, json: async () => noAt })
  const r = await probe('markets', FEEDS.markets, { fetchImpl })
  assert.equal(r.ok, false)
  assert.match(r.error, /no readable build time/)
  const fresh = { ...noAt, at: new Date().toISOString() }
  const ok = await probe('markets', FEEDS.markets, { fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => '*' }, json: async () => fresh }) })
  assert.equal(ok.ok, true, ok.error)
})

test('health record: a removed source is pruned, and the committed file holds only current ones', async () => {
  const { prune, record } = await import('../tools/check-feeds.mjs')
  const h = record({ feeds: { hn: { ok: false, strikes: 7 }, itn: { ok: true, strikes: 0 } } }, { id: 'otd', ok: true, checkedAt: 'x' })
  assert.deepEqual(Object.keys(prune(h, ['itn', 'otd']).feeds).sort(), ['itn', 'otd'])
  const committed = JSON.parse(readFileSync(new URL('../tools/feed-health.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(committed.feeds).filter(id => !(id in FEEDS)), [])
})

test('402: a monthly series looks back far enough for its chart', async () => {
  // Unemployment at 120 days had three points to chart (2026-10-05).
  const { HOUSEHOLD } = await import('../tools/fetch-markets.mjs')
  const un = HOUSEHOLD.find(s => s.id === 'UNRATE')
  assert.ok(un.days >= 9 * 31, `${un.days} days is at least nine months back, for ten readings`)
})

test('scoreboards carry the season: its name, phase and dates, from the capture', async () => {
  const { parseScoreboard, parseSeason } = await import('../feeds.js')
  const mlb = parseScoreboard(fx('espn-baseball-mlb.json')).season
  assert.equal(mlb.phase, 'POSTSEASON')
  assert.equal(mlb.label, '2026')
  assert.ok(mlb.start < mlb.end)
  assert.equal(parseScoreboard(fx('espn-basketball-nba.json')).season.label, '2026-27')
  // Every field optional: an off-season answer has not been seen yet.
  assert.equal(parseSeason(undefined), null)
  assert.deepEqual(parseSeason({}), { label: '', phase: '', start: null, end: null })
  assert.equal(parseScoreboard({ events: [] }).season, null)
})
