// The parsers against what the services really returned (tests/fixtures,
// captured 2026-09-28), and the cache's rules about age and dates.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseITN, parseOnThisDay, parseFeatured, parseQuakes, parseHnItem, parseKp, parseForecast,
  parseSignalRoster, shortPlace, decodeEntities, FeedCache, backoffMs, staleAfter, FEEDS, forecastUrl,
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

test('featured: article of the day and the most-read list', () => {
  const f = parseFeatured(fx('wiki-featured.json'))
  assert.equal(f.tfa.title, 'Genshin Impact')
  assert.ok(f.tfa.extract.length > 100)
  assert.ok(f.mostread.length >= 10)
  assert.ok(f.mostread.every(a => a.title && Number.isFinite(a.views)))
})

test('earthquakes: newest first, places shortened to the named place', () => {
  const q = parseQuakes(fx('usgs-4.5-day.json'))
  assert.ok(q.length > 10)
  for (let i = 1; i < q.length; i++) assert.ok(q[i - 1].time >= q[i].time)
  assert.equal(shortPlace('2 km SW of Sakai, Japan'), 'Sakai, Japan')
  assert.equal(shortPlace('Mid-Atlantic Ridge'), 'Mid-Atlantic Ridge')
})

test('Hacker News item: title, score, comments and the bare domain', () => {
  const s = parseHnItem(fx('hn-item.json'))
  assert.equal(s.domain, 'github.com')
  assert.ok(s.score > 0 && s.comments >= 0)
  assert.equal(parseHnItem({}), null)
})

test('K-index: both shapes the endpoint has served', () => {
  const k = parseKp(fx('swpc-kp.json'))
  assert.ok(k.readings.length > 20)
  assert.equal(k.latest, k.readings[k.readings.length - 1])
  const old = parseKp([['time_tag', 'Kp'], ['2026-09-22 00:00:00.000', '2.33']])
  assert.equal(old.latest.kp, 2.33)
})

test('forecast: today in three parts, five days, units read from the response', () => {
  const w = parseForecast(fx('open-meteo.json'))
  assert.equal(w.days.length, 5)
  assert.deepEqual(w.parts.map(p => p.name), ['MORNING', 'AFTERNOON', 'EVENING'])
  assert.equal(w.units, 'F')
  assert.equal(w.days[0].sunrise, '06:49')
  assert.match(forecastUrl(1, 2, 'C'), /temperature_unit=celsius/)
})

test("SIGNAL's roster: public stations only, in frequency order", () => {
  const r = parseSignalRoster(fx('signal-stations.json'))
  assert.equal(r.stations.length, 16)
  const secret = fx('signal-stations.json').SECRET_STATIONS.map(s => s.id)
  assert.ok(!r.stations.some(s => secret.includes(s.id)), 'the listings keep the secrets')
  for (let i = 1; i < r.stations.length; i++) assert.ok(r.stations[i - 1].freq <= r.stations[i].freq)
  assert.ok(r.stations.every(s => s.tracks.every(t => /^[\w-]{11}$/.test(t.youtubeId))))
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
  assert.ok(staleAfter(FEEDS.quakes) < staleAfter(FEEDS.otd))
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
