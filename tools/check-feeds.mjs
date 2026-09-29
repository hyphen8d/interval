// INTERVAL -- probe every live source the pages are built from. `npm run
// health`. Network.
//
// The counterpart to SIGNAL's check-roster: there, tracks rot (a video gets
// age-gated, a licence narrows); here, sources rot. They go down, they stop
// sending CORS headers, or -- the one that bites -- they keep answering 200
// with a different shape, and the page quietly goes blank. That last one is
// not hypothetical: the pitch for this service had "In the news" coming from
// Wikipedia's featured feed, which turned out to have dropped the field
// entirely. So each probe runs the source through the SAME parser the set
// uses (feeds.js); "ok" means the page could be drawn, not that a URL
// answered.
//
// Also checked: that every request carries access-control-allow-origin. A
// browser refuses a response without it, so a source can be up, well-formed
// and useless. Node's fetch shows CORS headers only when the request carries
// an Origin (SIGNAL's weather.js has the note), so every probe sends one.
//
// Writes tools/feed-health.json: the last result per source and `strikes`,
// the count of consecutive failed probes. tools/feed-watch.mjs reads it.
//
//   node tools/check-feeds.mjs            # all sources, human output
//   node tools/check-feeds.mjs --json     # summary on stdout
//   node tools/check-feeds.mjs --only=itn

import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { MARKETS_LIVE_URL } from '../feeds.js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const HEALTH_FILE = path.join(ROOT, 'tools/feed-health.json')
export const PROBE_ORIGIN = 'https://hyphen8d.github.io'
/** Where the weather probe asks about: Greenwich, a place nobody lives at. */
export const PROBE_LOCATION = { lat: 51.48, lon: 0.0 }
export const TIMEOUT_MS = 20000

const argv = process.argv.slice(2)
const flag = (n) => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3)

/** How many items a parsed source carried, for the record: an empty list is
 *  a finding even when it parses. */
export function summarise(id, data) {
  switch (id) {
    case 'itn': return { items: data.stories.length, detail: `${data.stories.length} stories, ${data.deaths.length} deaths` }
    case 'events': return { items: data.items.length, detail: `${data.items.length} current events, today and yesterday` }
    case 'otd': return { items: data.selected.length + data.events.length, detail: `${data.selected.length} selected, ${data.events.length} events` }
    case 'weather': return { items: data.days.length, detail: `${data.days.length} days` }
    case 'cities': return { items: data.cities.length, detail: `${data.cities.length} cities, ${data.cities[0].name} ${data.cities[0].temp}${data.units}` }
    case 'markets': {
      const age = (Date.now() - Date.parse(data.at)) / 3600e3
      return { items: data.series.length, detail: `${data.series.length} series, built ${Math.round(age)}h ago`, staleHours: Math.round(age) > 96 ? Math.round(age) : 0 }
    }
    default: return { items: null, detail: '' }
  }
}

/** Probe one source. Never throws. */
export async function probe(id, feed, { fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const requests = []
  const probeFetch = async (url) => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      const res = await fetchImpl(url, { headers: { Origin: PROBE_ORIGIN }, signal: ctl.signal })
      const acao = res.headers?.get?.('access-control-allow-origin') ?? null
      requests.push({ url: String(url), status: res.status, acao })
      return res
    } finally { clearTimeout(timer) }
  }
  const env = {
    date: () => now, location: PROBE_LOCATION, units: 'C',
    // markets.json is built by the deploy workflow, so the probe checks the
    // live copy: "ok" means the workflow is producing it.
    marketsUrl: MARKETS_LIVE_URL,
  }
  const t0 = Date.now()
  const out = { id, title: feed.title, checkedAt: new Date().toISOString() }
  try {
    const data = await feed.load(probeFetch, env)
    Object.assign(out, summarise(id, data))
    out.ok = true
  } catch (e) {
    out.ok = false
    out.error = String(e?.message ?? e)
  }
  out.ms = Date.now() - t0
  out.requests = requests.length
  out.status = requests[0]?.status ?? null
  const noCors = requests.filter(r => r.status < 400 && r.acao !== '*' && r.acao !== PROBE_ORIGIN)
  out.cors = requests.length ? noCors.length === 0 : null
  if (out.ok && out.cors === false) {
    out.ok = false
    out.error = `no access-control-allow-origin on ${noCors[0].url} -- a browser would refuse it`
  }
  if (out.ok && out.items === 0) { out.ok = false; out.error = 'answered, but with nothing in it' }
  if (out.ok && out.staleHours > 12) { out.ok = false; out.error = id === 'markets' ? `markets.json was last built ${out.staleHours}h ago: is the deploy workflow's schedule running?` : `latest reading is ${out.staleHours}h old` }
  return out
}

export function readHealth() {
  try { return JSON.parse(readFileSync(HEALTH_FILE, 'utf8')) } catch (e) { return { checkedAt: null, feeds: {} } }
}

/** Fold a probe into the record: strikes count consecutive failures. */
export function record(health, result) {
  const prev = health.feeds[result.id] || {}
  const strikes = result.ok ? 0 : (prev.strikes || 0) + 1
  const lastOk = result.ok ? result.checkedAt : prev.lastOk ?? null
  health.feeds[result.id] = { ...result, strikes, lastOk }
  health.checkedAt = result.checkedAt
  return health
}

function writeHealth(health) {
  const tmp = path.join(path.dirname(HEALTH_FILE), `.feed-health.json.tmp-${process.pid}`)
  writeFileSync(tmp, JSON.stringify(health, null, 2) + '\n')
  renameSync(tmp, HEALTH_FILE)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { FEEDS } = await import('../feeds.js')
  const only = flag('only')
  const ids = Object.keys(FEEDS).filter(id => !only || id === only)
  if (!ids.length) { console.error(`no source "${only}". Sources: ${Object.keys(FEEDS).join(', ')}`); process.exit(2) }
  const json = argv.includes('--json')
  const health = readHealth()
  const results = []
  for (const id of ids) {
    const r = await probe(id, FEEDS[id])
    record(health, r)
    results.push(health.feeds[id])
    if (!json) console.error(`${r.ok ? 'ok  ' : 'FAIL'} ${id.padEnd(9)} ${String(r.ms).padStart(5)}ms  ${r.ok ? r.detail : r.error}`)
  }
  writeHealth(health)
  const failed = results.filter(r => !r.ok)
  if (json) console.log(JSON.stringify({ checkedAt: health.checkedAt, results, failed: failed.map(r => r.id) }, null, 2))
  else console.error(failed.length ? `${failed.length} source(s) failing.` : 'every source answered, open to browsers, in the shape the pages expect.')
  process.exit(failed.length ? 1 : 0)
}
