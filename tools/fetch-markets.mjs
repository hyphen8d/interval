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

import { writeFileSync, renameSync } from 'node:fs'
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
  { id: 'CPIAUCSL', name: 'INFLATION', kind: 'yoy', days: 700 },
  { id: 'DFF', name: 'FED INTEREST RATE', kind: 'percent', days: 30 },
  { id: 'UNRATE', name: 'UNEMPLOYMENT', kind: 'percent', days: 120 },
]

/** Twelve-month change from a monthly index's rows: the latest reading and
 *  the one before it, each against the same month a year earlier. */
export function yoyFromCsv(text) {
  const rows = String(text).trim().split(/\r?\n/).slice(1).map(l => l.split(','))
    .filter(([d, v]) => /^\d{4}-\d\d-\d\d$/.test(d) && v !== '.' && Number.isFinite(+v))
  // Ten yearly changes need twenty-two months of the index.
  if (rows.length < 22) throw new Error('not enough months for a yearly change')
  const at = (i) => ({ date: rows[i][0], pct: (+rows[i][1] / +rows[i - 12][1] - 1) * 100 })
  const last = at(rows.length - 1), prev = at(rows.length - 2)
  const history = rows.slice(-10).map((_, k) => at(rows.length - 10 + k).pct)
  return { date: last.date, value: last.pct, prevDate: prev.date, prev: prev.pct, history }
}

export const fredUrl = (id, from) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${from}`

/** FRED's CSV: a header, then DATE,VALUE rows, with "." for a day with no
 *  value (a holiday). The last two real values, and their dates. */
export function parseFredCsv(text) {
  const rows = String(text).trim().split(/\r?\n/).slice(1)
    .map(l => l.split(','))
    .filter(([d, v]) => /^\d{4}-\d\d-\d\d$/.test(d) && v !== '.' && Number.isFinite(+v))
  if (!rows.length) throw new Error('no values')
  const [date, value] = rows[rows.length - 1]
  const prev = rows.length > 1 ? rows[rows.length - 2] : null
  // The last ten closes, oldest first: page 401 draws them as a small bar
  // chart, so a number has a shape beside it.
  const history = rows.slice(-10).map(([, v]) => +v)
  return { date, value: +value, prevDate: prev?.[0] ?? null, prev: prev ? +prev[1] : null, history }
}

export async function fetchMarkets(fetchImpl = fetch, now = new Date()) {
  const from = new Date(now.getTime() - 24 * 864e5).toISOString().slice(0, 10)
  const series = []
  const failed = []
  for (const s of SERIES) {
    try {
      const res = await fetchImpl(fredUrl(s.id, from))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      series.push({ ...s, ...parseFredCsv(await res.text()) })
    } catch (e) { failed.push(`${s.id}: ${e.message}`) }
  }
  const household = []
  for (const s of HOUSEHOLD) {
    try {
      const since = new Date(now.getTime() - s.days * 864e5).toISOString().slice(0, 10)
      const res = await fetchImpl(fredUrl(s.id, since))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      household.push({ ...s, ...(s.kind === 'yoy' ? yoyFromCsv(text) : parseFredCsv(text)) })
    } catch (e) { failed.push(`${s.id}: ${e.message}`) }
  }
  return { at: now.toISOString(), source: 'FRED, Federal Reserve Bank of St. Louis', series, household, failed }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv.find(a => a.startsWith('--out='))?.slice(6) || path.join(ROOT, 'markets.json')
  const m = await fetchMarkets()
  for (const f of m.failed) console.error(`failed ${f}`)
  if (!m.series.length) { console.error('no series could be fetched; markets.json left as it was'); process.exit(1) }
  const tmp = path.join(path.dirname(out), `.markets.json.tmp-${process.pid}`)
  writeFileSync(tmp, JSON.stringify(m) + '\n')
  renameSync(tmp, out)
  console.log(`markets.json: ${m.series.length} series, ${m.household.length} household, latest ${m.series.map(s => s.date).sort().at(-1)}`)
}
