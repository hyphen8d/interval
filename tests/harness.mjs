// Headless harness for program.js: the real set, the real page model and
// the real Term with the real font, in Node, on a FAKE CLOCK.
//
// performance.now(), Date.now() and every timer move only when a test calls
// advance(), which drives program.frame() in 16ms steps -- so a test can
// switch the set on, key a page, wait out the carousel and read the grid,
// deterministically, in milliseconds. fetch() answers from tests/fixtures
// (captured from the live services -- see its README), SIGNAL's roster
// arrives through the program's import hook, and there is no AudioContext
// at all, which is also what the sound code must survive.
//
// Every boot gets a fresh module graph (a unique ?v=), because program.js
// and the modules under it keep module-level state.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = (f) => JSON.parse(readFileSync(path.join(root, 'tests/fixtures', f), 'utf8'))

/** 2026-09-28 20:00 local: a Monday evening, inside no overnight window. */
export const BASE_TIME = new Date(2026, 8, 28, 20, 0, 0).getTime()

let bootCount = 0
let fontCache = null

/** What each source answers with, by URL. */
export function fixtureFetch(url) {
  const u = String(url)
  if (u.includes('Template:In_the_news')) return fixture('wiki-itn.json')
  if (u === 'markets.json' || u.endsWith('/markets.json')) return fixture('markets.json')
  const espn = u.match(/site\.api\.espn\.com\/apis\/site\/v2\/sports\/([\w.-]+)\/([\w.-]+)\/scoreboard/)
  if (espn) return fixture(`espn-${espn[1]}-${espn[2]}.json`)
  if (u.includes('thespacedevs.com')) return fixture('launches.json')
  if (u.includes('date.nager.at')) return fixture('holidays-us.json')
  if (u.includes('wheretheiss.at')) return fixture('iss.json')
  // Keyed by the portal's own title; a day not captured is a 404, which is
  // how the harness's own boot time (00:00 UTC on the 29th) exercises the
  // fall-back to yesterday.
  const ce = u.match(/Portal:Current_events\/(\w+)&/)
  if (ce) return fixture('wiki-current-events.json')[ce[1]] ?? null
  if (u.includes('/feed/onthisday/')) return fixture('wiki-onthisday.json')
  // Twelve comma-separated latitudes is the cities request; one is local.
  if (u.includes('api.open-meteo.com')) return /latitude=[^&]*%2C|latitude=[^&]*,/.test(u) ? fixture('open-meteo-cities.json') : fixture('open-meteo.json')
  return null
}

/**
 * @param {object} o
 * @param {'fixtures'|'fail'|'never'|Function} [o.feeds] how sources answer:
 *   fixtures, every request failing, never answering at all, or a function
 *   of the URL returning JSON (or null for a 404, or throwing for a failure)
 * @param {object} [o.saved] persisted state to start from
 * @param {string} [o.query] location.search, e.g. '?page=300'
 * @param {false|'grant'|'deny'} [o.location] geolocation, if any
 * @param {boolean} [o.secure] isSecureContext
 * @param {boolean} [o.power] switch on straight away (default true)
 */
export async function boot({ feeds = 'fixtures', saved = null, query = '', location = false, secure = true, power = true, startAt = BASE_TIME } = {}) {
  const tag = `test${++bootCount}`
  let now = 0
  const timers = []
  let timerId = 0
  const store = new Map()
  if (saved) store.set('interval:state:v1', JSON.stringify(saved))

  const realPerformance = globalThis.performance
  const RealDate = Date
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(startAt + now) }
    static now() { return startAt + now }
  }
  globalThis.Date = FakeDate
  Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true, writable: true })
  globalThis.setTimeout = (fn, ms = 0) => { timers.push({ id: ++timerId, at: now + ms, fn }); return timerId }
  globalThis.clearTimeout = (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1) }
  globalThis.setInterval = (fn, ms) => { const t = { id: ++timerId, at: now + ms, fn, every: ms }; timers.push(t); return t.id }
  globalThis.clearInterval = globalThis.clearTimeout

  const announced = []
  const live = { set textContent(v) { this._t = v; if (v) announced.push(v) }, get textContent() { return this._t ?? '' } }
  const opened = []
  globalThis.window = globalThis
  globalThis.open = (url) => { opened.push(url); return null }
  globalThis.document = {
    title: '',
    getElementById: (id) => (id === 'announce' ? live : null),
    documentElement: { requestFullscreen: () => Promise.resolve() },
    fullscreenElement: null,
  }
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  globalThis.matchMedia = () => ({ matches: false })
  globalThis.location = { search: query, reload() { reloads.push(now) } }
  const reloads = []
  globalThis.isSecureContext = secure
  const geoCalls = []
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      language: 'en-US',
      geolocation: location ? {
        getCurrentPosition(ok, err) {
          geoCalls.push(now)
          if (location === 'deny') err({ code: 1 })
          else ok({ coords: { latitude: 40.7, longitude: -74.0 } })
        },
      } : undefined,
    },
    configurable: true, writable: true,
  })

  const requests = []
  globalThis.fetch = (url) => {
    requests.push(String(url))
    if (String(url).includes('build.json')) return Promise.resolve({ ok: true, json: async () => ({ build: servedBuild }) })
    if (feeds === 'never') return new Promise(() => {})
    if (feeds === 'fail') return Promise.resolve({ ok: false, status: 503, json: async () => ({}) })
    let body
    try { body = typeof feeds === 'function' ? feeds(String(url)) : fixtureFetch(url) } catch (e) { return Promise.reject(e) }
    if (body === undefined && typeof feeds === 'function') body = fixtureFetch(url)
    if (body == null) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) })
  }
  let servedBuild = tag
  const fastextLabels = []
  globalThis.INTERVAL_FASTEXT = (labels) => fastextLabels.push(labels)
  globalThis.INTERVAL_BUILD = tag
  delete globalThis.INTERVAL_FORCE_RX

  const { parseBDF } = await import('../src/bdf.js')
  const { Term } = await import('../src/term.js')
  if (!fontCache) fontCache = parseBDF(readFileSync(path.join(root, 'fonts/ter-u16b.bdf'), 'utf8'))
  const config = await import(`../config.js?v=${tag}`)
  const { default: program } = await import(`../program.js?v=${tag}`)
  const term = new Term(fontCache, 40, 25, 6, 5)
  term.setPalette(config.PALETTE)
  const crt = {
    params: { ...config.SCREEN },
    phosphor: config.PHOSPHOR,
    setPhosphor(name) { if (config.PHOSPHORS[name]) this.phosphor = name },
  }
  const s = { term, crt, program }

  const h = {
    program, term, crt, s, announced, requests, opened, geoCalls, reloads, store, fastextLabels,
    get now() { return now },
    /** Move the clock, driving frames and timers. */
    advance(ms) {
      const end = now + ms
      while (now < end) {
        now = Math.min(end, now + 16)
        for (;;) {
          timers.sort((a, b) => a.at - b.at)
          const t = timers[0]
          if (!t || t.at > now) break
          if (t.every) t.at += t.every; else timers.shift()
          try { t.fn() } catch (e) { console.error(e) }
        }
        program.frame(s, now / 1000)
      }
    },
    /** Let pending promises (feed loads) settle. */
    async flush() { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)) },
    /** Advance and flush, repeatedly: for anything waiting on a feed. */
    async settle(ms = 4000, step = 250) {
      for (let t = 0; t < ms; t += step) { this.advance(step); await this.flush() }
    },
    key(key, opts = {}) {
      program.key(s, { key, code: opts.code || '', shiftKey: !!opts.shiftKey, preventDefault() {} })
    },
    /** Key a page number and wait for it to arrive. */
    async go(num, ms = 4000) {
      for (const ch of String(num)) this.key(ch)
      await this.settle(ms)
    },
    row(y) {
      let out = ''
      for (let x = 0; x < term.cols; x++) {
        const i = y * term.cols + x
        out += term.gfx[i] ? '#' : String.fromCharCode(term.chars[i])
      }
      return out.replace(/\s+$/, '')
    },
    text() { return Array.from({ length: term.rows }, (_, y) => this.row(y)).join('\n') },
    /** The page as the set received it, as text -- double-height titles
     *  included, which the grid holds as bitmaps and row() shows as '#'. */
    page() { return program.truth ? program.truth.lines({ reveal: program.reveal }).join('\n') : '' },
    find(str) { return this.text().includes(str) },
    /** Click grid cell (row, col) as the pointer would land on it. */
    clickCell(row, col) { return program.followLink(program.linkAtCell(row, col)) },
    colourAt(x, y) { const c = term.colors[y * term.cols + x]; return { fg: c & 15, bg: c >> 4 } },
    deploy(build) { servedBuild = build },
    shutdown() {
      clearInterval(program.fallback); clearInterval(program.buildCheck)
      globalThis.Date = RealDate
      Object.defineProperty(globalThis, 'performance', { value: realPerformance, configurable: true, writable: true })
    },
  }
  program.init(s)
  // Switching on runs the ident (program.js BOOT_MS) before the page is
  // asked for; 4.5s covers that and the page's wait.
  if (power) { h.key('p'); await h.settle(4500) }
  return h
}
