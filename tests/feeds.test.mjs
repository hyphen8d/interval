// The parsers against what the services really returned (tests/fixtures,
// captured 2026-09-28), and the cache's rules about age and dates.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseITN, parseOnThisDay, parseForecast, parseMarkets, parseCities,
  parseWorldBank, decodeEntities, FeedCache, backoffMs, staleAfter, FEEDS, forecastUrl,
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

test('markets and the World Bank: a close each, a value and year each', () => {
  const m = parseMarkets(fx('markets.json'))
  assert.equal(m.series[0].name, 'DOW JONES')
  assert.ok(m.series.every(s => Number.isFinite(s.value) && /^\d{4}-\d\d-\d\d$/.test(s.date)))
  assert.throws(() => parseMarkets({ series: [] }))
  const w = parseWorldBank(fx('worldbank-world.json'))
  assert.equal(w['SP.POP.TOTL'].year, 2025)
  assert.ok(w['FP.CPI.TOTL.ZG'].value > 0)
  assert.throws(() => parseWorldBank([{}, []]))
})

test('FRED CSV: the last two real values, skipping holidays', async () => {
  const { parseFredCsv } = await import('../tools/fetch-markets.mjs')
  const r = parseFredCsv('observation_date,DJIA\n2026-09-24,100\n2026-09-25,101.5\n2026-09-28,.\n')
  assert.deepEqual(r, { date: '2026-09-25', value: 101.5, prevDate: '2026-09-24', prev: 100 })
  assert.throws(() => parseFredCsv('observation_date,DJIA\n'))
})

test('US cities: twelve, in the order asked, units from the answer', () => {
  const c = parseCities(fx('open-meteo-cities.json'))
  assert.equal(c.cities.length, 12)
  assert.equal(c.cities[0].name, 'NEW YORK')
  assert.equal(c.cities[11].name, 'SEATTLE')
  assert.equal(c.units, 'F')
  assert.ok(c.cities.every(x => Number.isFinite(x.temp) && Number.isFinite(x.hi)))
  assert.throws(() => parseCities([{}]), /asked for 12/)
})
