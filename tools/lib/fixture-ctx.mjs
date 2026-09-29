// A page-rendering context built from the captured fixtures, for the tools
// that need to draw every page without the network: the page lint, and the
// tests. Node only.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fx = (f) => JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures', f), 'utf8'))

/** The captured Current events days, dated the way the feed dates them. */
export function fixtureEvents(F) {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const iso = (title) => { const [y, mon, d] = title.split('_'); return `${y}-${String(MONTHS.indexOf(mon) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
  return { items: Object.entries(fx('wiki-current-events.json')).flatMap(([title, json]) => F.parseCurrentEvents(json).map(x => ({ ...x, date: iso(title) }))) }
}

export const FIXTURE_NOW = new Date(2026, 8, 28, 20, 0).getTime()

export async function fixtureData() {
  const F = await import('../../feeds.js')
  return {
    itn: F.parseITN(fx('wiki-itn.json')),
    otd: F.parseOnThisDay(fx('wiki-onthisday.json')),
    featured: F.parseFeatured(fx('wiki-featured.json')),
    quakes: F.parseQuakes(fx('usgs-4.5-day.json')),
    hn: { stories: Array(10).fill(F.parseHnItem(fx('hn-item.json'))) },
    kp: F.parseKp(fx('swpc-kp.json')),
    weather: F.parseForecast(fx('open-meteo.json')),
    signal: F.parseSignalRoster(fx('signal-stations.json')),
    events: fixtureEvents(F),
  }
}

/** @param {object} editorial the editorial.json to render with */
export async function fixtureCtx(editorial, env = {}) {
  const data = await fixtureData()
  return {
    entry: (id) => (data[id] ? { data: data[id], at: FIXTURE_NOW - 60000 } : null),
    now: FIXTURE_NOW,
    date: new Date(FIXTURE_NOW),
    editorial,
    env: { locationState: 'granted', overnight: { on: false }, game: { i: 0, score: 0, answered: null, best: 0 }, ...env },
  }
}
