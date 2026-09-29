// INTERVAL -- recapture tests/fixtures from the live sources. Network.
//
// The fixtures are the ground truth the parsers are tested against, so they
// come off the real services, never from a spec (tests/fixtures/README.md).
// Run this when check-feeds reports a source has changed shape, then READ
// THE DIFF before committing: the change in shape is the finding, and a
// test that now fails is telling you what a page would have shown.
//
// Trims each capture the same way the originals were trimmed, so a refresh
// is a diff of content, not of size. SIGNAL's roster comes from the sibling
// checkout (../signal) when there is one, else from the deployed site.

import { writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FX = path.join(ROOT, 'tests/fixtures')
const ORIGIN = { headers: { Origin: 'https://hyphen8d.github.io' } }
const F = await import('../feeds.js')

const get = async (url) => {
  const res = await fetch(url, ORIGIN)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json()
}
const save = (name, obj) => { writeFileSync(path.join(FX, name), JSON.stringify(obj)); console.log(`wrote ${name}`) }
const pick = (o, ks) => Object.fromEntries(ks.filter(k => k in o).map(k => [k, o[k]]))
const slimPage = (p) => pick(p, ['type', 'title', 'titles', 'description', 'extract', 'views', 'rank', 'normalizedtitle'])
const slimEv = (e) => ({ text: e.text, year: e.year, pages: (e.pages || []).slice(0, 1).map(slimPage) })

const d = new Date(2026, 8, 28) // the fixtures are for one fixed day; tests assume it
const steps = [
  ['wiki-itn.json', async () => get(F.ITN_URL)],
  ['wiki-onthisday.json', async () => {
    const o = await get(F.onThisDayUrl(d))
    return { selected: o.selected.slice(0, 12).map(slimEv), events: o.events.slice(0, 24).map(slimEv), births: o.births.slice(0, 16).map(slimEv), deaths: o.deaths.slice(0, 16).map(slimEv), holidays: o.holidays.slice(0, 6).map(e => ({ text: e.text, pages: (e.pages || []).slice(0, 1).map(slimPage) })) }
  }],
  ['wiki-featured.json', async () => {
    const f = await get(F.featuredUrl(d))
    return { tfa: slimPage(f.tfa), mostread: { date: f.mostread?.date, articles: (f.mostread?.articles || []).slice(0, 12).map(slimPage) } }
  }],
  ['usgs-4.5-day.json', async () => get(F.QUAKES_URL)],
  ['hn-topstories.json', async () => get(F.HN_TOP_URL)],
  ['hn-item.json', async () => get(F.hnItemUrl((await get(F.HN_TOP_URL))[0]))],
  ['swpc-kp.json', async () => get(F.KP_URL)],
  ['open-meteo.json', async () => get(F.forecastUrl(40.7, -74.0, 'F'))],
  ['signal-stations.json', async () => {
    const local = path.resolve(ROOT, '../signal/stations.js')
    const m = existsSync(local)
      ? await import(local)
      : await import(`data:text/javascript;base64,${Buffer.from(await (await fetch(F.SIGNAL_ROSTER_URL)).text()).toString('base64')}`)
    const slim = (s) => ({ id: s.id, callsign: s.callsign, freq: s.freq, band: s.band, tagline: s.tagline, desc: s.desc, tracks: (s.tracks || []).slice(0, 6).map(t => ({ youtubeId: t.youtubeId, title: t.title, artist: t.artist })) })
    return { STATIONS: m.STATIONS.map(slim), SECRET_STATIONS: (m.SECRET_STATIONS || []).map(slim) }
  }],
]

let failed = 0
for (const [name, fn] of steps) {
  try { save(name, await fn()) } catch (e) { failed++; console.error(`FAILED ${name}: ${e.message}`) }
}
console.log(failed ? `${failed} capture(s) failed; the old fixtures are untouched for those.` : 'Recaptured. Now run the suite and read `git diff tests/fixtures`.')
process.exit(failed ? 1 : 0)
