// Every page on the service, drawn from the captured fixtures, held to the
// layout contract in pages.js's header.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as F from '../feeds.js'
import { PAGES, pageDef, pageOrder, INDEX, MAGAZINES, SECTIONS, nowItems } from '../pages.js'
import { fixtureData } from '../tools/lib/fixture-ctx.mjs'
import { KEYS } from '../constants.js'
import { validPage } from '../carousel.js'
import { COLS } from '../teletext.js'

const fx = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'))
const editorial = JSON.parse(readFileSync(new URL('../editorial.json', import.meta.url), 'utf8'))
const NOW = new Date(2026, 8, 28, 20, 0).getTime()

const DATA = await fixtureData()
const allData = () => ({ ...DATA })
function ctxWith(data = allData(), env = {}, { errors = {}, at = NOW - 60000 } = {}) {
  return {
    entry: (id) => data[id] ? { data: data[id], at } : errors[id] ? { data: null, error: errors[id], loading: false } : null,
    now: NOW, date: new Date(NOW), editorial,
    env: { locationState: 'granted', game: { i: 0, score: 0, answered: null, best: 0 }, ...env },
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
  const special = /^(locate|sub:next|game:(\d|next|reset)|focus:(start|reset|mode)|decide:(d20|coin))$/
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
  assert.ok(pageDef('102', local).render(local), 'the facts need no source at all')
})

test('stale data is shown with its age, never hidden', () => {
  const old = ctxWith(allData(), {}, { at: NOW - 6 * 3600 * 1000 })
  const [p] = pageDef('302', old).render(old)
  assert.match(p.lines()[23], /NOT UPDATED SINCE 14:00/)
  const fresh = ctxWith()
  assert.match(pageDef('302', fresh).render(fresh)[0].lines()[23], /UPDATED 19:59/)
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

test('the help page lists every key the set answers', () => {
  const ctx = ctxWith()
  const text = pageDef('199', ctx).render(ctx)[0].lines().join('\n')
  for (const k of KEYS) assert.ok(text.includes(k.label), k.label)
})

test('index.html tells a screen reader about every key too', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const about = html.slice(html.indexOf('id="about"'), html.indexOf('id="announce"')).replace(/\s+/g, ' ')
  const words = { digits: 'page number', updown: 'Up and down', leftright: 'left and right', fastext: 'F1', index: 'I goes', reveal: 'R reveals', hold: 'H holds', size: 'S changes', colour: 'C changes', cycle: 'N turns cycling', fullscreen: 'F is', cancel: 'Escape', power: 'P switches' }
  for (const k of KEYS) assert.ok(about.includes(words[k.id]), `${k.id} is described`)
})

test('the magazines cover every first digit a page can have', () => {
  for (let m = 1; m <= 8; m++) assert.ok(MAGAZINES[m], `magazine ${m}`)
})

test('rows stay within forty columns everywhere', () => {
  const ctx = ctxWith()
  for (const num of everyPage(ctx)) {
    for (const p of pageDef(num, ctx).render(ctx)) {
      assert.ok(p.cells.every(r => r.length === COLS))
    }
  }
})

test('news is two full screens of short bits: In the news first, then the day briefed', () => {
  const ctx = ctxWith()
  const subs = pageDef('101', ctx).render(ctx)
  assert.equal(subs.length, 2)
  const text = subs.map(p => p.lines().join(' ')).join(' ')
  assert.ok(text.indexOf('Brisbane Lions') < text.indexOf('Polish military'), 'the top stories lead')
  for (const p of subs) {
    const used = p.lines().slice(4, 22).filter(Boolean).length
    assert.ok(used >= 13, `a screen is filled (${used} of 18 rows carry text; the rest are gaps between items)`)
  }
})

test('a brief is a first sentence; the same story is not told twice; a gap takes a later block', async () => {
  const { brief, sameStory, fillPages } = await import('../pages.js')
  assert.equal(brief('Polish jets are scrambled. Individuals are urged to shelter.'), 'Polish jets are scrambled.')
  assert.ok(brief('x '.repeat(200)).endsWith('...'))
  assert.ok(sameStory('Hashim Thaci of Kosovo is sentenced', 'Kosovo court sentences Hashim Thaci'))
  assert.ok(!sameStory('Russian strikes on Kyiv', 'Floods in Nepal and India'))
  const rows = (h) => ({ height: h, draw() {} })
  const laid = fillPages([rows(5), rows(5), rows(9), rows(4), rows(6), rows(6), rows(6)], 2)
  assert.equal(laid.length, 2, 'never more than two')
  assert.deepEqual(laid[0].map(p => p.block.height), [5, 5, 4])
  assert.deepEqual(laid[1].map(p => p.block.height), [9, 6])
})

test('every page the sections cycle through exists, and each section is one magazine', () => {
  const ctx = ctxWith()
  assert.equal(SECTIONS.length, 7)
  for (const sec of SECTIONS) {
    for (const [label, num] of sec.pages) assert.ok(pageDef(num, ctx), `${sec.name}: ${label} ${num}`)
    assert.equal(new Set(sec.pages.map(([, n]) => n[0])).size, 1, `${sec.name} is one magazine`)
  }
})

test('facts, born today and a thought: one bite a screen', async () => {
  const ctx = ctxWith()
  const facts = pageDef('102', ctx).render(ctx)
  const { factsFor, FACTS_PER_DAY } = await import('../pages.js')
  assert.equal(facts.length, FACTS_PER_DAY)
  const today = factsFor(editorial.facts, NOW), tomorrow = factsFor(editorial.facts, NOW + 864e5)
  assert.notDeepEqual(today, tomorrow, 'a different eight each day')
  assert.ok(facts.every(p => ['TECH', 'GAMES', 'HACKING'].includes(p.lines()[5].trim())))
  const { pickBirths } = await import('../pages.js')
  const many = Array.from({ length: 200 }, (_, i) => ({ year: 2000 - i, text: `Person ${i}, someone` }))
  const picked = pickBirths(many)
  assert.equal(picked.length, 6)
  assert.ok(picked.at(-1).year < 1850, 'a spread of eras, not the first six')
  const born = pageDef('201', ctx).render(ctx)
  assert.ok(born.length > 1)
  const thought = pageDef('501', ctx).render(ctx)[0].lines().join(' ')
  assert.ok(editorial.thoughts.some(t => thought.includes(t.text.slice(0, 20))))
})

test('money: the markets at the close', async () => {
  const ctx = ctxWith()
  const mk = pageDef('401', ctx).render(ctx)[0].lines().join('\n')
  assert.match(mk, /DOW JONES\s+51,481\.51 ▼ 0\.67%/)
  assert.match(mk, /CLOSE SEP 28/)
  assert.match(mk, /US 10-YEAR YIELD\s+5\.17%/)
  const stale = { ...ctx, now: Date.parse(DATA.markets.at) + 5 * 864e5 }
  assert.match(pageDef('401', stale).render(stale)[0].lines().join(' '), /PRICES NOT REFRESHED SINCE/)
})

test('breathe: in four, hold four, out four, hold four -- and the circle follows the breath', async () => {
  const { breathAt, BREATH_CYCLE_MS } = await import('../pages.js')
  assert.equal(BREATH_CYCLE_MS, 16000)
  assert.deepEqual([0, 4000, 8000, 12000].map(t => breathAt(t).word), ['BREATHE IN', 'HOLD', 'BREATHE OUT', 'HOLD'])
  assert.ok(breathAt(3900).full > 0.9 && breathAt(100).full < 0.1)
  assert.equal(breathAt(5000).count, 2)
  const small = pageDef('500', { ...ctxWith(), now: 100 }).render({ ...ctxWith(), now: 100 })[0]
  const big = pageDef('500', { ...ctxWith(), now: 5000 }).render({ ...ctxWith(), now: 5000 })[0]
  const lit = (p) => p.cells.flat().filter(c => c.mos > 0).length
  assert.ok(lit(big) > lit(small) * 3)
})

test('news still shows the top stories when Current events is down', () => {
  const data = allData(); delete data.events
  const ctx = ctxWith(data, {}, { errors: { events: 'HTTP 503' } })
  const subs = pageDef('101', ctx).render(ctx)
  assert.ok(subs.length >= 1)
  assert.match(subs[0].lines().join(' '), /Brisbane Lions/)
})

test('US cities: twelve cities on one screen, no location needed', () => {
  const ctx = ctxWith(allData(), { locationState: 'unknown' })
  const text = pageDef('302', ctx).render(ctx)[0].lines().join('\n')
  assert.match(text, /NEW YORK\s+\d+F/)
  assert.match(text, /SEATTLE/)
})

test('on this day and born today are six screens, not eighteen', () => {
  const ctx = ctxWith()
  assert.equal(pageDef('200', ctx).render(ctx).length, 6)
  assert.ok(pageDef('201', ctx).render(ctx).length <= 6)
})

test('markets draw the last ten closes as a little bar chart', async () => {
  const { sparkline } = await import('../pages.js')
  const { Page } = await import('../teletext.js')
  const p = new Page()
  sparkline(p, 5, 1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2)
  // 1..10 scaled to heights 1-3, two a cell: (1,2)->1 1, (3,4)->1 2,
  // (5,6)->2 2, (7,8)->2 3, (9,10)->3 3.
  assert.deepEqual(p.cells[5].slice(1, 6).map(c => c.mos), [16 | 32, 16 | 40, 20 | 40, 20 | 42, 21 | 42])
})

test('countdowns: the weekend, and how much day is left', async () => {
  const { weekendIn, sunInfo, span } = await import('../pages.js')
  const mon8pm = new Date(2026, 8, 28, 20, 0).getTime()
  assert.equal(span(weekendIn(mon8pm)), '4D 4H')
  assert.equal(weekendIn(new Date(2026, 9, 3, 12).getTime()), null, 'Saturday is the weekend')
  assert.equal(sunInfo('06:49', '18:42', new Date(2026, 8, 28, 16, 30).getTime()), 'DAYLIGHT 11H 53M  SUNSET IN 2H 12M')
  assert.match(sunInfo('06:49', '18:42', mon8pm), /THE SUN IS DOWN/)
})

test('sport: a page a league, live games first, starts in the viewer\'s time', async () => {
  const { gameStatus } = await import('../pages.js')
  const ctx = ctxWith()
  const nfl = pageDef('601', ctx).render(ctx)
  assert.equal(nfl.length, 1, 'sixteen games on one screen')
  assert.match(nfl[0].lines().join('\n'), /PHI\s+7\s+CHI\s+27\s+FINAL/)
  assert.equal(gameStatus({ state: 'in', detail: 'Q3 4:21' }).text, 'Q3 4:21')
  assert.equal(gameStatus({ state: 'post', detail: 'FT' }).text, 'FINAL')
  assert.match(gameStatus({ state: 'pre', date: new Date(2026, 9, 3, 19, 0).getTime() }).text, /^SAT 7:00PM$/)
})

test('coming up draws from its sources, and a gallery draws only its current picture live', () => {
  const ctx = ctxWith()
  const c = pageDef('203', ctx).render(ctx)[0].lines().join('\n')
  assert.match(c, /Columbus Day \/ Indigenous Peoples' Day/)
  assert.match(c, /Crew-13/)
  assert.equal(pageDef('204', ctx), null, 'the ISS page is gone')
  const g = pageDef('700', ctx)
  const at = (now, sub) => g.render({ ...ctx, now, env: { ...ctx.env, sub } }).map(p => JSON.stringify(p.cells))
  const [a, b] = [at(1000, 5), at(3500, 5)]
  assert.equal(a.length, 8)
  assert.match(g.render({ ...ctx, env: { ...ctx.env, sub: 4 } })[4].lines().join('\n'), /AQUARIUM/)
  assert.notEqual(a[5], b[5], 'the picture on screen moves')
  assert.equal(a[6], b[6], 'the others hold still')
})

test('the index: sections in page-number order, a NOW line from whatever has answered', () => {
  const firstNum = (s) => parseInt(s.pages[0][1], 16)
  const order = SECTIONS.map(firstNum)
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the index never reads 401, 601, 500')
  const ctx = ctxWith()
  const text = pageDef('100', ctx).render(ctx)[0].lines()
  assert.match(text[3], /^ NOW DOW [▲▼]\d+\.\d%\s+(HERE|NYC) \d+[FC]\s+[A-Z]+ \d+ [A-Z]+ \d+/)
  assert.ok(text[3].length <= 40)
  assert.match(text.join('\n'), /SPORT\s+NFL 601\s+NBA 602\s+MLB 603/)
  assert.ok(!/\bTODAY\s+300/.test(text.join('\n')), '300 is LOCAL, not a second TODAY')
  // Nothing has answered: no NOW line, and the index draws anyway.
  const bare = ctxWith({})
  const none = pageDef('100', bare).render(bare)
  assert.ok(none && !none[0].lines()[3].includes('NOW'))
  assert.equal(nowItems(bare).length, 0)
})
