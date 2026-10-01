// INTERVAL -- the world's markets at the close, fetched at build time.
//
//   node tools/fetch-markets.mjs            # writes markets.json at the repo root
//   node tools/fetch-markets.mjs --out=_site/markets.json
//
// Why at build time, when every other page fetches in the viewer's browser:
// nothing that serves stock indices does so to a browser without a key
// (checked 2026-09-28: Yahoo's chart API and Nasdaq's both answer, but with
// no access-control-allow-origin, so a browser refuses them; the rest need
// keys). FRED, the St. Louis Fed's database, publishes the closes as keyless
// CSV -- also without CORS -- so the deploy workflow
// (.github/workflows/pages.yml) runs this on a schedule and publishes the
// result beside the site, where the set reads it from its own origin. The
// numbers are the previous close, and page 401 says so.
//
// What FRED does not carry: the FTSE and the DAX (their licences), so the
// page is the US indices, the Nikkei, and the numbers people watch beside
// them -- the VIX, the ten-year yield, oil.

import { writeFileSync, renameSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The series, in the order page 401 shows them. `kind` says how to print. */
export const SERIES = [
  { id: 'DJIA', name: 'DOW JONES', kind: 'index' },
  { id: 'SP500', name: 'S&P 500', kind: 'index' },
  { id: 'NASDAQCOM', name: 'NASDAQ', kind: 'index' },
  { id: 'NIKKEI225', name: 'NIKKEI 225', kind: 'index' },
  { id: 'VIXCLS', name: 'VIX (FEAR GAUGE)', kind: 'level' },
  { id: 'DGS10', name: 'US 10-YEAR YIELD', kind: 'percent' },
  { id: 'DCOILWTICO', name: 'OIL, WTI', kind: 'dollars' },
  { id: 'DCOILBRENTEU', name: 'OIL, BRENT', kind: 'dollars' },
]

/**
 * Page 402, "Your money" (2026-09-28): the numbers that reach a household.
 * Weekly and monthly series, so each looks back further than the markets
 * do. Inflation is the CPI's change over twelve months, worked out here from
 * the index, which is how it is reported: `kind: 'yoy'` asks for that.
 */
export const HOUSEHOLD = [
  { id: 'GASREGW', name: 'GAS, US AVERAGE', kind: 'gallon', days: 60 },
  { id: 'MORTGAGE30US', name: '30-YEAR MORTGAGE', kind: 'percent', days: 60 },
  // 2026-10-01: 700 days gave 21 or 22 monthly rows depending on the day of
  // the month and whether the latest CPI was out yet, and yoyFromCsv needs
  // 22. Twenty-six months' worth leaves margin for a late release.
  { id: 'CPIAUCSL', name: 'INFLATION', kind: 'yoy', days: 800 },
  { id: 'DFF', name: 'FED INTEREST RATE', kind: 'percent', days: 30 },
  { id: 'UNRATE', name: 'UNEMPLOYMENT', kind: 'percent', days: 120 },
]

/**
 * A FRED CSV's rows that carry a value. A day with none was "." when this was
 * written, and is now an EMPTY field ("2026-09-21,"). The first filter let
 * that through, because +'' is 0 and 0 is finite: the Nikkei's three
 * September holidays went into 401's chart as closes of zero.
 */
export function fredRows(text) {
  return String(text).trim().split(/\r?\n/).slice(1)
    .map(l => l.split(',').map(x => x.trim()))
    .filter(([d, v]) => /^\d{4}-\d\d-\d\d$/.test(d) && v !== undefined && v !== '' && v !== '.' && Number.isFinite(+v))
}

/** Twelve-month change from a monthly index's rows: the latest reading and
 *  the one before it, each against the same month a year earlier. Matched
 *  by DATE, not by counting back twelve rows: a month missing from the
 *  series would have made "twelve rows back" thirteen months back. */
export function yoyFromCsv(text) {
  const rows = fredRows(text)
  const byDate = new Map(rows.map(([d, v]) => [d, +v]))
  const yearBefore = (d) => `${+d.slice(0, 4) - 1}${d.slice(4)}`
  const changes = rows.filter(([d]) => byDate.has(yearBefore(d)))
    .map(([d, v]) => ({ date: d, pct: (+v / byDate.get(yearBefore(d)) - 1) * 100 }))
  const last = changes.at(-1)
  if (!last || last.date !== rows.at(-1)[0] || changes.length < 2) throw new Error('not enough months for a yearly change')
  const prev = changes.at(-2)
  return { date: last.date, value: last.pct, prevDate: prev.date, prev: prev.pct, history: changes.slice(-10).map(c => c.pct) }
}

export const fredUrl = (id, from) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${from}`

/** FRED's CSV: a header, then DATE,VALUE rows, with "." for a day with no
 *  value (a holiday). The last two real values, and their dates. */
export function parseFredCsv(text) {
  const rows = fredRows(text)
  if (!rows.length) throw new Error('no values')
  const [date, value] = rows[rows.length - 1]
  const prev = rows.length > 1 ? rows[rows.length - 2] : null
  // The last ten closes, oldest first: page 401 draws them as a small bar
  // chart, so a number has a shape beside it.
  const history = rows.slice(-10).map(([, v]) => +v)
  return { date, value: +value, prevDate: prev?.[0] ?? null, prev: prev ? +prev[1] : null, history }
}

/**
 * Every series, each in its own try. A series that fails is carried over
 * from `previous` (the markets.json the site is serving now) when it has
 * one, marked `carried`, with its own date, so 401 and 402 show it at its
 * real age instead of dropping the row. 2026-10-01: before this, a partial
 * failure published the file without that row (one bad FRED answer for the
 * CPI and 402 lost inflation until the next run), and the run still said ok.
 * Each request has a deadline, since a stalled one held the whole deploy.
 */
export async function fetchMarkets(fetchImpl = fetch, now = new Date(), { previous = null, timeoutMs = 30 * 1000 } = {}) {
  const from = new Date(now.getTime() - 24 * 864e5).toISOString().slice(0, 10)
  const failed = [], carried = []
  const get = async (url) => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  }
  const old = (list, id) => (Array.isArray(previous?.[list]) ? previous[list] : [])
    .find(x => x && x.id === id && Number.isFinite(x.value))
  const each = async (list, defs, read) => {
    const out = []
    for (const s of defs) {
      try { out.push({ ...s, ...(await read(s)) }) } catch (e) {
        failed.push(`${s.id}: ${e.message}`)
        const was = old(list, s.id)
        if (was) { out.push({ ...was, ...s, carried: true }); carried.push(s.id) }
      }
    }
    return out
  }
  const series = await each('series', SERIES, async (s) => parseFredCsv(await get(fredUrl(s.id, from))))
  const household = await each('household', HOUSEHOLD, async (s) => {
    const since = new Date(now.getTime() - s.days * 864e5).toISOString().slice(0, 10)
    const text = await get(fredUrl(s.id, since))
    return s.kind === 'yoy' ? yoyFromCsv(text) : parseFredCsv(text)
  })
  return { at: now.toISOString(), source: 'FRED, Federal Reserve Bank of St. Louis', series, household, failed, carried }
}

/** The markets.json being served now, from a URL or a path, or null. Only a
 *  file of the right shape counts: a 404 page is not a previous build. */
export async function readPrevious(where, fetchImpl = fetch) {
  if (!where) return null
  try {
    const json = /^https?:/.test(where)
      ? await (async () => { const r = await fetchImpl(where, { signal: AbortSignal.timeout(30 * 1000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })()
      : JSON.parse(readFileSync(where, 'utf8'))
    return Array.isArray(json?.series) && json.series.length ? json : null
  } catch { return null }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv.find(a => a.startsWith('--out='))?.slice(6) || path.join(ROOT, 'markets.json')
  // --previous=<url|path>: the copy being served now. The deploy workflow
  // passes the live site's, because Pages replaces the whole site: a run
  // that wrote no markets.json would DELETE the last good one, not keep it.
  const previous = await readPrevious(process.argv.find(a => a.startsWith('--previous='))?.slice(11))
  let m = await fetchMarkets(fetch, new Date(), { previous })
  const warn = (msg) => console.error(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg)
  for (const f of m.failed) warn(`failed ${f}`)
  if (m.carried.length) warn(`carried over from the previous markets.json: ${m.carried.join(', ')}`)
  if (![...m.series, ...m.household].some(s => !s.carried)) {
    // Nothing fresh at all. Republish the previous file untouched, so its
    // own `at` stays and 401 says how long since a build reached FRED.
    if (!previous) { console.error('no series could be fetched and no previous copy; markets.json left as it was'); process.exit(1) }
    warn('no series could be fetched; republishing the previous markets.json as it was')
    m = previous
  }
  const tmp = path.join(path.dirname(out), `.markets.json.tmp-${process.pid}`)
  writeFileSync(tmp, JSON.stringify(m) + '\n')
  renameSync(tmp, out)
  console.log(`markets.json: ${m.series.length} series, ${m.household?.length ?? 0} household, latest ${m.series.map(s => s.date).sort().at(-1)}`)
}
