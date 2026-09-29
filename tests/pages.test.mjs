// Every page on the service, drawn from the captured fixtures, held to the
// layout contract in pages.js's header.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as F from '../feeds.js'
import { PAGES, pageDef, pageOrder, stationPages, INDEX, MAGAZINES } from '../pages.js'
import { KEYS } from '../constants.js'
import { validPage } from '../carousel.js'
import { COLS } from '../teletext.js'

const fx = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'))
const editorial = JSON.parse(readFileSync(new URL('../editorial.json', import.meta.url), 'utf8'))
const NOW = new Date(2026, 8, 28, 20, 0).getTime()

function allData() {
  return {
    itn: F.parseITN(fx('wiki-itn.json')), otd: F.parseOnThisDay(fx('wiki-onthisday.json')),
    featured: F.parseFeatured(fx('wiki-featured.json')), quakes: F.parseQuakes(fx('usgs-4.5-day.json')),
    hn: { stories: Array(10).fill(F.parseHnItem(fx('hn-item.json'))) }, kp: F.parseKp(fx('swpc-kp.json')),
    weather: F.parseForecast(fx('open-meteo.json')), signal: F.parseSignalRoster(fx('signal-stations.json')),
  }
}
function ctxWith(data = allData(), env = {}, { errors = {}, at = NOW - 60000 } = {}) {
  return {
    entry: (id) => data[id] ? { data: data[id], at } : errors[id] ? { data: null, error: errors[id], loading: false } : null,
    now: NOW, date: new Date(NOW), editorial,
    env: { locationState: 'granted', overnight: { on: false }, game: { i: 0, score: 0, answered: null, best: 0 }, ...env },
  }
}
const everyPage = (ctx) => [...pageOrder(ctx), ...[...PAGES.values()].filter(d => d.hidden).map(d => d.num)]

test('every page renders, fits, and leaves row 0 to the set', () => {
  const ctx = ctxWith()
  for (const num of everyPage(ctx)) {
    const subs = pageDef(num, ctx).render(ctx)
    assert.ok(Array.isArray(subs) && subs.length, `${num} renders`)
    subs.forEach((p, i) => {
      assert.deepEqual(p.issues, [], `${num} subpage ${i + 1} writes nothing off the page`)
      assert.equal(p.lines()[0], '', `${num} leaves the header row alone`)
    })
  }
})

test('every fastext link goes somewhere the set can follow', () => {
  const ctx = ctxWith()
  const special = /^(overnight|locate|sub:next|signal:[\w-]+|game:(\d|next|reset))$/
  for (const num of everyPage(ctx)) {
    for (const p of pageDef(num, ctx).render(ctx)) {
      for (const f of p.fastext) {
        if (!f) continue
        const [label, target] = f
        if (special.test(target)) continue
        assert.ok(validPage(target) && pageDef(target, ctx), `${num}: "${label}" -> ${target} is a page`)
      }
    }
  }
})

test('the index lists only pages that exist', () => {
  const ctx = ctxWith()
  for (const [label, num] of INDEX) assert.ok(pageDef(num, ctx), `${label} ${num}`)
})

test('a page waits while its source has not answered, and goes off air when it fails', () => {
  const none = ctxWith({})
  assert.equal(pageDef('101', none).render(none), null, 'not on air yet: the set keeps searching')
  const failed = ctxWith({}, {}, { errors: { itn: 'HTTP 503' } })
  const [p] = pageDef('101', failed).render(failed)
  const text = p.lines().join(' ').replace(/\s+/g, ' ')
  assert.ok(text.includes('OFF AIR'))
  assert.ok(text.includes('HTTP 503'), 'and says why')
  const local = ctxWith({})
  assert.ok(pageDef('310', local).render(local), 'the sky page needs no source at all')
})

test('stale data is shown with its age, never hidden', () => {
  const old = ctxWith(allData(), {}, { at: NOW - 6 * 3600 * 1000 })
  const [p] = pageDef('400', old).render(old)
  assert.match(p.lines()[23], /NOT UPDATED SINCE 14:00/)
  const fresh = ctxWith()
  assert.match(pageDef('400', fresh).render(fresh)[0].lines()[23], /UPDATED 19:59/)
})

test("SIGNAL's stations get a page each, per band, and the secrets none", () => {
  const ctx = ctxWith()
  const pages = stationPages(ctx.entry('signal').data)
  assert.equal(pages.length, 16)
  assert.ok(pages.every(p => /^5[12][1-9]$/.test(p.num)))
  const secrets = fx('signal-stations.json').SECRET_STATIONS.map(s => s.callsign)
  const listing = pageDef('500', ctx).render(ctx).map(p => p.lines().join('\n')).join('\n')
  for (const name of secrets) assert.ok(!listing.includes(name), `${name} is not listed`)
  const [cipher] = pageDef('511', ctx).render(ctx)
  assert.deepEqual(cipher.fastext[0], ['Tune in', 'signal:cipher'])
  assert.equal(pageDef('519', ctx), null, 'a number with no station behind it is not carried')
})

test('the weather pages ask before they know where you are', () => {
  for (const state of ['unknown', 'denied', 'insecure', 'unsupported']) {
    const ctx = ctxWith(allData(), { locationState: state })
    const [p] = pageDef('300', ctx).render(ctx)
    const text = p.lines().join('\n')
    assert.ok(!text.includes('SUNRISE'), `${state}: no forecast shown`)
    const offers = p.fastext[0]?.[1] === 'locate'
    assert.equal(offers, state === 'unknown' || state === 'denied', `${state}: red asks only where asking can work`)
  }
  const ctx = ctxWith()
  assert.match(pageDef('300', ctx).render(ctx)[0].lines().join('\n'), /SUNRISE 06:49/)
})

test('the quiz hides its answers until REVEAL', () => {
  const ctx = ctxWith()
  const [p] = pageDef('600', ctx).render(ctx)
  const hidden = p.lines().join('\n'), shown = p.lines({ reveal: true }).join('\n')
  assert.ok(!hidden.includes('LINE 21'))
  assert.ok(shown.includes('LINE 21'))
})

test('the help page lists every key the set answers', () => {
  const ctx = ctxWith()
  const text = pageDef('199', ctx).render(ctx)[0].lines().join('\n')
  for (const k of KEYS) assert.ok(text.includes(k.label), k.label)
})

test('index.html tells a screen reader about every key too', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const about = html.slice(html.indexOf('id="about"'), html.indexOf('id="announce"')).replace(/\s+/g, ' ')
  const words = { digits: 'page number', updown: 'Up and down', leftright: 'left and right', fastext: 'F1', index: 'I goes', reveal: 'R reveals', hold: 'H holds', size: 'S changes', colour: 'C changes', overnight: 'N turns', mute: 'M mutes', fullscreen: 'F is', cancel: 'Escape', power: 'P switches' }
  for (const k of KEYS) assert.ok(about.includes(words[k.id]), `${k.id} is described`)
})

test('the magazines cover every first digit a page can have', () => {
  for (let m = 1; m <= 8; m++) assert.ok(MAGAZINES[m], `magazine ${m}`)
})

test('the subtitles page says what is playing overnight, and nothing otherwise', () => {
  const on = ctxWith(allData(), { overnight: { on: true, track: { title: 'Teardrop', artist: 'Massive Attack' } } })
  assert.match(pageDef('888', on).render(on)[0].lines().join('\n'), /Teardrop/)
  const off = ctxWith()
  assert.match(pageDef('888', off).render(off)[0].lines().join('\n'), /No subtitles/)
})

test('rows stay within forty columns everywhere', () => {
  const ctx = ctxWith()
  for (const num of everyPage(ctx)) {
    for (const p of pageDef(num, ctx).render(ctx)) {
      assert.ok(p.cells.every(r => r.length === COLS))
    }
  }
})
