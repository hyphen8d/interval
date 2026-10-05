// Every page on the service, drawn from the captured fixtures, held to the
// layout contract in pages.js's header.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as F from '../feeds.js'
import { PAGES, pageDef, pageOrder, INDEX, MAGAZINES, SECTIONS } from '../pages.js'
import { fixtureData } from '../tools/lib/fixture-ctx.mjs'
import { KEYS } from '../constants.js'
import { validPage } from '../carousel.js'
import { COLS, fold } from '../teletext.js'

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
  const words = { digits: 'page number', updown: 'Up and down', leftright: 'left and right', fastext: 'F1', index: 'I goes', help: 'question mark to help', reveal: 'R reveals', hold: 'H holds', size: 'S changes', colour: 'C changes', cycle: 'N turns cycling', fullscreen: 'F is', cancel: 'Escape', power: 'P switches' }
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

test('cities: twelve US cities, then twelve world cities, no location needed', () => {
  const ctx = ctxWith(allData(), { locationState: 'unknown' })
  const [us, world, ...more] = pageDef('302', ctx).render(ctx).map(p => p.lines().join('\n'))
  assert.equal(more.length, 0, 'two screens')
  assert.match(us, /US CITIES/)
  assert.match(us, /NEW YORK\s+\d+F/)
  assert.match(us, /SEATTLE/)
  assert.ok(!/LONDON/.test(us))
  assert.match(world, /WORLD CITIES/)
  for (const name of ['LONDON', 'TOKYO', 'SYDNEY', 'MEXICO CITY']) assert.match(world, new RegExp(`${name}\\s+-?\\d+F`), name)
  assert.ok(!/NEW YORK/.test(world))
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

test('the index: sections in page-number order, and no NOW line', () => {
  const firstNum = (s) => parseInt(s.pages[0][1], 16)
  const order = SECTIONS.map(firstNum)
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the index never reads 401, 601, 500')
  const ctx = ctxWith()
  const text = pageDef('100', ctx).render(ctx)[0].lines()
  assert.ok(!text.join('\n').includes('NOW'), 'the NOW line was removed 2026-10-01')
  assert.match(text[4], /^ NEWS/, 'the sections start under the masthead')
  assert.match(text.join('\n'), /SPORT\s+NFL 601\s+NBA 602\s+MLB 603\s*$/m)
  assert.ok(!/60[456]/.test(text.join('\n')), 'no NHL, EPL or CFB')
  assert.match(text.join('\n'), /CITIES\s+302/)
  assert.ok(!/\bTODAY\s+300/.test(text.join('\n')), '300 is LOCAL, not a second TODAY')
  // It needs no source, so it draws with nothing answered.
  const bare = ctxWith({})
  assert.deepEqual(pageDef('100', bare).render(bare)[0].lines(), text)
})

// -- 2026-10-01: the review's findings, each held ----------------------------

test('sport: a sixteenth game is not written over by the live line', () => {
  const base = DATA.sport_nfl.games[0]
  const games = Array.from({ length: 16 }, (_, i) => ({ ...base, state: i === 0 ? 'in' : 'post', detail: i === 0 ? 'Q3 4:21' : 'FINAL', date: NOW - i * 3600e3, away: { ...base.away, abbr: `A${String(i).padStart(2, '0')}` }, home: { ...base.home } }))
  const ctx = ctxWith({ ...allData(), sport_nfl: { ...DATA.sport_nfl, games } })
  const subs = pageDef('601', ctx).render(ctx)
  assert.equal(subs.length, 1)
  const lines = subs[0].lines()
  assert.match(lines[21], /^ A15/, 'the sixteenth game is on row 21')
  assert.match(lines[22], /LIVE: SCORES UPDATE EVERY MINUTE/)
  assert.match(lines[23], /ESPN/, 'and the credit keeps row 23')
})

test('the credit line always keeps its time, whatever the label', async () => {
  const { creditText } = await import('../pages.js')
  const fri = new Date(2026, 8, 25, 14, 2).getTime()
  for (const id of Object.keys(F.FEEDS)) {
    for (const at of [fri, NOW - 60000]) {
      const ctx = { ...ctxWith(), entry: () => ({ data: {}, at }) }
      const { text } = creditText(ctx, id)
      assert.ok(text.length <= 38, `${id}: "${text}" fits`)
      if (at === fri) assert.match(text, / NOT UPDATED SINCE FRI 14:02$/, `${id}: "${text}" keeps the age`)
      else assert.match(text, /UPDATED 19:59$/, `${id}: "${text}"`)
    }
  }
})

test('coming up keeps the rules: waits, goes off air, shows a failure and a stale age', () => {
  const none = ctxWith({})
  assert.equal(pageDef('203', none).render(none), null, 'neither source has answered: still searching')
  const both = ctxWith({}, {}, { errors: { holidays: 'HTTP 500', launches: 'HTTP 429' } })
  assert.match(pageDef('203', both).render(both)[0].lines().join(' '), /OFF AIR/)
  const data = allData(); delete data.launches
  const one = ctxWith(data, {}, { errors: { launches: 'HTTP 429' } })
  const text = pageDef('203', one).render(one)[0].lines().join('\n')
  assert.match(text, /OFF AIR: HTTP 429/, 'the failed section says so')
  assert.ok(!/WAITING FOR THE SCHEDULE/.test(text), 'and does not wait forever')
  assert.match(text, /Columbus Day/, 'the other section still shows')
  const old = ctxWith(allData(), {}, { at: NOW - 4 * 864e5 })
  const [p] = pageDef('203', old).render(old)
  assert.match(p.lines()[23], /NOT UPDATED SINCE/)
  assert.equal(p.cells[23][1].fg, 1, 'in red')
  const fresh = ctxWith()
  assert.match(pageDef('203', fresh).render(fresh)[0].lines()[23], /NAGER\.DATE & THE SPACE DEVS/)
})

test('coming up and the weather print no "undefined" or "NaN"', () => {
  const data = allData()
  data.launches = { launches: data.launches.launches.map(l => ({ ...l, provider: undefined, where: undefined })) }
  data.weather = { ...data.weather, current: { ...data.weather.current, temp: NaN }, days: data.weather.days.map((d, i) => (i === 1 ? { ...d, hi: NaN, lo: NaN } : d)) }
  data.cities = { ...data.cities, cities: data.cities.cities.map((c, i) => (i ? c : { ...c, temp: NaN, hi: NaN })) }
  const ctx = ctxWith(data)
  for (const num of ['203', '300', '301', '302', '100']) {
    for (const p of pageDef(num, ctx).render(ctx)) {
      const t = p.lines().join('\n')
      assert.ok(!/undefined|NaN/.test(t), `${num}: ${t.match(/.*(undefined|NaN).*/)?.[0]}`)
      assert.deepEqual(p.issues, [])
    }
  }
})

test('101\'s masthead is the day, without a comma', () => {
  const ctx = ctxWith()
  assert.match(pageDef('101', ctx).render(ctx)[0].lines()[1], /MONDAY$/)
})

test('facts and the thought change from December 31 to January 1', async () => {
  const { factsFor, thoughtFor } = await import('../pages.js')
  const eve = new Date(2026, 11, 31, 12).getTime(), day = new Date(2027, 0, 1, 12).getTime()
  assert.notDeepEqual(factsFor(editorial.facts, eve), factsFor(editorial.facts, day))
  assert.notEqual(thoughtFor(editorial.thoughts, eve), thoughtFor(editorial.thoughts, day))
  for (let i = 0; i < 400; i++) {
    const a = new Date(2026, 0, 1 + i, 12).getTime(), b = new Date(2026, 0, 2 + i, 12).getTime()
    assert.notEqual(thoughtFor(editorial.thoughts, a), thoughtFor(editorial.thoughts, b), `day ${i}`)
  }
})

test('every thought ends above the candle, and the lint says so of one that would not', async () => {
  const { thoughtRows, THOUGHT_TOP, CANDLE_ROW } = await import('../pages.js')
  for (const t of editorial.thoughts) assert.ok(THOUGHT_TOP + thoughtRows(t) <= CANDLE_ROW, t.text)
  const { lint } = await import('../tools/lint-pages.mjs')
  const long = { text: 'word '.repeat(38).trim(), by: 'Somebody' }
  assert.ok(long.text.length < 240, 'under the old limit, and still too long')
  const r = await lint({ editorial: { ...editorial, thoughts: [...editorial.thoughts, long] } })
  assert.ok(r.errors.some(e => /thought \d+: .* above the candle/.test(e)), r.errors.join('\n'))
  const quizless = await lint({ editorial: { ...editorial, quiz: [] } })
  assert.ok(!quizless.errors.some(e => /quiz/.test(e)), 'the quiz pages are gone; its questions are not required')
})

test('a source that answers with nothing still gets a page', () => {
  const data = allData()
  data.itn = { ...data.itn, stories: [] }
  data.events = { items: [] }
  data.otd = { ...data.otd, selected: [], events: [], births: [] }
  const ctx = ctxWith(data)
  for (const num of ['101', '200', '201']) {
    const subs = pageDef(num, ctx).render(ctx)
    assert.ok(Array.isArray(subs) && subs.length === 1, `${num} renders a page`)
    assert.deepEqual(subs[0].issues, [])
  }
})

test('every page renders something from every source state, never an empty list', () => {
  const states = [ctxWith(), ctxWith({}), ctxWith({}, {}, { errors: Object.fromEntries(Object.keys(F.FEEDS).map(id => [id, 'HTTP 500'])) })]
  for (const ctx of states) {
    for (const num of everyPage(ctx)) {
      const out = pageDef(num, ctx).render(ctx)
      assert.ok(out === null || out.length > 0, `${num}`)
    }
  }
})

test('money: a malformed row is skipped, and an unknown build time is not called fresh', () => {
  const data = allData()
  data.markets = {
    ...data.markets, at: null,
    series: [{ ...data.markets.series[0], date: undefined }, { name: 'BROKEN' }, ...data.markets.series.slice(1)],
    household: [{ ...data.markets.household[0], date: undefined }, { name: 'BROKEN' }, ...data.markets.household.slice(1)],
  }
  const ctx = ctxWith(data)
  const mk = pageDef('401', ctx).render(ctx)[0]
  assert.match(mk.lines()[4], /DOW JONES/)
  assert.match(mk.lines()[5], /CLOSE --/)
  assert.ok(!mk.lines().join(' ').includes('BROKEN'))
  assert.match(mk.lines()[21], /NO BUILD TIME/)
  assert.equal(mk.cells[21][1].fg, 1, 'in red')
  const hh = pageDef('402', ctx).render(ctx)[0].lines().join('\n')
  assert.ok(!hh.includes('BROKEN') && !/undefined|NaN/.test(hh))
})

test('the hidden game wears its own magazine, not sport\'s', () => {
  const ctx = ctxWith()
  const [p] = pageDef('1FF', ctx).render(ctx)
  assert.equal(p.cells[1][0].bg, MAGAZINES[1].band)
})

test('only pages that print page references link them: not "S&P 500", not a score', () => {
  const ctx = ctxWith()
  const linked = (num) => pageDef(num, ctx).render(ctx).some(p => p.links)
  for (const num of ['100', '190', '199', '1AF']) assert.ok(linked(num), `${num} links`)
  for (const num of ['101', '401', '602', '1FF', '203']) assert.ok(!linked(num), `${num} does not`)
  const [index] = pageDef('100', ctx).render(ctx)
  const r = index.lines().findIndex(l => /NFL 601/.test(l))
  assert.equal(index.pageNumberAt(r, index.lines()[r].indexOf('601')), '601')
  const [welcome] = pageDef('190', ctx).render(ctx)
  const w = welcome.lines().findIndex(l => /199 is help/.test(l))
  assert.equal(welcome.pageNumberAt(w, welcome.lines()[w].indexOf('199')), '199', 'a number before a full stop')
})

test('a live score that stops updating shows its age within minutes, not 45', async () => {
  const { creditText } = await import('../pages.js')
  const live = { games: [{ state: 'in', date: NOW - 3600e3, away: {}, home: {} }] }
  const ctx = (at) => ({ ...ctxWith(), entry: () => ({ data: live, at }) })
  assert.match(creditText(ctx(NOW - 10 * 60e3), 'sport_nfl').text, /NOT UPDATED SINCE/, 'ten minutes old, mid-game')
  assert.match(creditText(ctx(NOW - 60e3), 'sport_nfl').text, /^SOURCE: ESPN/, 'a minute old is fresh')
  const resting = { games: [{ state: 'post', date: NOW - 86400e3, away: {}, home: {} }] }
  const calm = { ...ctxWith(), entry: () => ({ data: resting, at: NOW - 10 * 60e3 }) }
  assert.match(creditText(calm, 'sport_nfl').text, /^SOURCE: ESPN/, 'no game on: the resting rule')
})

// -- 2026-10-01: the moving pictures, each on its page ------------------------

const inksIn = (p, rows, cols = [0, 39]) => {
  const out = new Set()
  for (const r of rows) for (let c = cols[0]; c <= cols[1]; c++) { const x = p.cells[r][c]; if (x.mos > 0) out.add(x.fg) }
  return out
}
const at = (h, m = 0) => new Date(2026, 8, 28, h, m).getTime()
const ctxAt = (ms, data, env) => ({ ...ctxWith(data, env), now: ms, date: new Date(ms) })

test('300: the sun on its arc by day, the moon across it at night', () => {
  const day = pageDef('300', ctxAt(at(13))).render(ctxAt(at(13)))[0]
  assert.ok(inksIn(day, [19, 20, 21]).has(3), 'a yellow sun on rows 19-21 at 1pm')
  const night = pageDef('300', ctxAt(at(23))).render(ctxAt(at(23)))[0]
  assert.ok(!inksIn(night, [19, 20, 21]).has(3), 'no sun at 11pm')
  assert.ok(inksIn(night, [19, 20, 21]).has(7), 'a white moon')
  assert.match(night.lines()[22], /CHANCE OF RAIN/, 'the key line is untouched')
})

test('302: a clear night is a star and says CLEAR, not SUN', () => {
  const data = allData()
  data.cities = { ...data.cities, cities: data.cities.cities.map((c, i) => (i === 0 ? { ...c, code: 0, isDay: false } : c)) }
  const p = pageDef('302', ctxWith(data)).render(ctxWith(data))[0]
  assert.match(p.lines()[6], /NEW YORK.*CLEAR/)
  assert.ok([27, 28].some(c => p.cells[6][c].mos > 0 && p.cells[6][c].fg === 7), 'a white star')
  // Every row has its sky: no row without a moving cell, whatever the code.
  for (let r = 6; r < 18; r++) assert.ok([27, 28].some(c => p.cells[r][c].mos > 0), `row ${r} has weather`)
})

test('201: a birthday cake under the words, candles lit', () => {
  const ctx = ctxWith()
  for (const p of pageDef('201', ctx).render(ctx)) {
    const inks = inksIn(p, [16, 17, 18, 19, 20, 21], [24, 37])
    if (!inks.size) { assert.ok(p.lines().slice(15, 22).some(l => l.trim()), 'only a page full of words goes without'); continue }
    assert.deepEqual([...inks].sort(), [3, 5, 6, 7], 'yellow flames, cyan candles, magenta cake, white icing')
  }
  assert.ok(pageDef('201', ctx).liveMs, 'and the flames move')
})

test('202: day and night round the world, the sun at noon', () => {
  const ctx = ctxAt(Date.UTC(2026, 8, 28, 12))
  const p = pageDef('202', ctx).render(ctx)[0]
  const papers = new Set([20, 21, 22].flatMap(r => p.cells[r].slice(1, 39).map(x => x.bg)))
  assert.ok(papers.has(4) && papers.has(0), 'blue day and black night')
  assert.equal(p.cells[20][20].bg, 4, 'Greenwich is in daylight at noon UTC')
  assert.equal(p.cells[20][1].bg, 0, 'the Pacific is in the dark')
  const sunCol = p.cells[19].findIndex(x => x.mos > 0)
  assert.ok(Math.abs(sunCol - 20) <= 1, `the sun is over Greenwich (column ${sunCol})`)
})

test('502: an hourglass beside the digits, its sand what is left', () => {
  const draw = (focus) => { const ctx = ctxWith(allData(), { focus }); return pageDef('502', ctx).render(ctx)[0] }
  const sand = (p, rows) => rows.reduce((n, r) => n + p.cells[r].filter((x, c) => c > 28 && x.mos > 0 && x.fg === 3).length, 0)
  const full = draw({ state: 'idle', mode: 'work', left: 25 * 60e3 })
  const half = draw({ state: 'paused', mode: 'work', left: 12.5 * 60e3 })
  assert.ok(sand(full, [5, 6, 7]) > sand(half, [5, 6, 7]), 'the top bulb empties')
  assert.ok(sand(half, [9, 10]) > sand(full, [9, 10]), 'the bottom fills')
})

test('sport: a game in progress has a marker that breathes', () => {
  const data = allData()
  data.sport_nfl = { ...data.sport_nfl, games: [{ ...data.sport_nfl.games[0], state: 'in', detail: 'Q2 1:00' }] }
  const draw = (ms) => pageDef('601', ctxAt(ms, data)).render(ctxAt(ms, data))[0].cells[6][20]
  assert.ok(draw(NOW).mos > 0 && draw(NOW).fg === 2, 'green, beside the live game')
  assert.notEqual(draw(NOW).mos, draw(NOW + 1000).mos, 'and changes each second')
  assert.ok(pageDef('601', ctxWith()).liveMs)
})

test('off air: the windmill turns beside OFF AIR, and the page says it moves', () => {
  const ctx = ctxWith({}, {}, { errors: { itn: 'HTTP 503', events: 'HTTP 503' } })
  const [a] = pageDef('101', ctx).render(ctx)
  assert.match(a.lines().join('\n'), /OFF AIR/)
  assert.equal(a.liveMs, 250)
  assert.equal(a.clone().liveMs, 250, 'and a copy keeps it')
  const later = { ...ctx, now: NOW + 2000 }
  const [b] = pageDef('101', later).render(later)
  const sails = (p) => p.cells.slice(3, 8).map(row => row.slice(27, 37).map(x => x.mos).join()).join('|')
  assert.notEqual(sails(a), sails(b), 'the sails have turned')
})

test('101 prints every "In the news" story whole', () => {
  // .map(brief) handed brief the index as its length limit: story 0 was
  // cut to "...", and the rest lost their endings (2026-10-05).
  const ctx = ctxWith()
  const text = pageDef('101', ctx).render(ctx).map(p => p.lines().join(' ')).join(' ').replace(/\s+/g, ' ')
  // Folded as the page folds it: the teletext set has no ç.
  for (const s of DATA.itn.stories) assert.ok(text.includes(fold(s)), `whole: ${s}`)
  assert.ok(!/(^| )\.\.\.( |$)/.test(text), 'no story reduced to "..."')
})
