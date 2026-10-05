// The moving pictures added 2026-10-01: each is a pure function of time,
// so each is held by drawing it at two moments (or two states) and
// comparing. The rule they keep is the file's: they move SLOWLY.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as P from '../pictures.js'

const count = (px, ch) => px.join('').split(ch).length - 1

test('every sky moves: the sun glints, a star twinkles, cloud drifts, fog slides', () => {
  for (const kind of ['sun', 'cloud', 'part', 'fog']) {
    assert.notDeepEqual(P.skyCells(kind, 0), P.skyCells(kind, 1200), `${kind} changes in about a second`)
  }
  const frames = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(P.skyCells('star', i * 700))))
  assert.ok(frames.size > 1, 'a star twinkles')
  assert.deepEqual(P.skyCells('sun', 0), P.skyCells('sun', 1000), 'and slowly: the same for a whole second')
  assert.deepEqual(P.skyCells('rain', 660).map(([b]) => b), [0, 1].map(c => P.weatherCell('rain', 660, c)), 'rain is the rain it was')
})

test('a clear sky is a sun by day and a star by night; the falling kinds are the same either way', () => {
  assert.equal(P.skyKind(0, true), 'sun')
  assert.equal(P.skyKind(0, false), 'star')
  assert.equal(P.skyKind(2, false), 'partnight')
  assert.equal(P.skyKind(3), 'cloud')
  assert.equal(P.skyKind(45), 'fog')
  assert.equal(P.skyKind(61, false), 'rain')
  assert.equal(P.skyKind(4), null, 'a code with no sky')
  assert.ok(P.skyCells('sun', 0).every(([, ink]) => ink === 'Y'))
  assert.ok(P.skyCells('star', 0).every(([, ink]) => ink === 'W'))
})

test('the cake: the flames move, the cake does not', () => {
  const a = P.cakePixels(0), b = P.cakePixels(450)
  assert.notDeepEqual(a.slice(0, 6), b.slice(0, 6), 'the flames flicker')
  assert.deepEqual(a.slice(6), b.slice(6), 'candles, icing and cake stay put')
  assert.ok(count(a.slice(0, 6), 'Y') > 6, 'three flames')
  // Each part is whole cell rows: no cell row holds two colours.
  for (let r = 0; r < 6; r++) assert.ok(new Set(a.slice(r * 3, r * 3 + 3).join('').replace(/\./g, '')).size <= 1, `cell row ${r} is one colour`)
})

test('the sun crosses its arc with the day, and the moon replaces it at night', () => {
  const sunX = (px) => { for (let x = 0; x < px[0].length; x++) if (px.some(l => l[x] === 'Y')) return x }
  assert.ok(sunX(P.sunArcPixels(0.2, true, 0)) < sunX(P.sunArcPixels(0.8, true, 0)), 'morning is left of evening')
  const night = P.sunArcPixels(0.5, false, 0)
  assert.equal(count(night, 'Y'), 0, 'no sun after dark')
  assert.ok(count(night, 'W') >= 4, 'a moon (and stars)')
  assert.notDeepEqual(P.sunArcPixels(0.5, true, 0), P.sunArcPixels(0.5, true, 1000), 'the sun glints')
})

test('the hourglass holds what is left, and pours only while running', () => {
  const sand = (px, from, to) => count(px.slice(from, to), 'S')
  const full = P.hourglassPixels(1, false, 0), half = P.hourglassPixels(0.5, false, 0), empty = P.hourglassPixels(0, false, 0)
  assert.ok(sand(full, 3, 11) > sand(half, 3, 11) && sand(half, 3, 11) > 0, 'the top empties')
  assert.equal(sand(empty, 3, 11), 0)
  assert.equal(sand(full, 13, 21), 0, 'and the bottom fills')
  assert.equal(sand(empty, 13, 21), sand(full, 3, 11), 'with the same sand')
  const pouring = [0, 150].map(ms => P.hourglassPixels(0.5, true, ms))
  assert.notDeepEqual(pouring[0], pouring[1], 'the stream falls')
  assert.ok(count(pouring[0].slice(11, 13), 'S') + count(pouring[1].slice(11, 13), 'S') > 0, 'through the neck')
  assert.equal(count(half.slice(11, 13), 'S'), 0, 'paused: nothing falls')
})

test('the world: day where it is daytime, and the terminator moves', () => {
  const noonUTC = Date.UTC(2026, 9, 1, 12), midnightUTC = Date.UTC(2026, 9, 1, 0)
  assert.ok(Math.abs(P.sunLon(noonUTC)) < 1, 'the sun over Greenwich at noon UTC')
  assert.equal(P.dayAt(0, noonUTC), true)
  assert.equal(P.dayAt(179, noonUTC), false)
  assert.equal(P.dayAt(0, midnightUTC), false)
  assert.equal(P.dayAt(139, Date.UTC(2026, 9, 1, 3)), true, 'Tokyo at noon local')
  const a = P.worldPixels(noonUTC), b = P.worldPixels(noonUTC + 6 * 3600e3)
  assert.ok(count(a, 'G') > 0 && count(a, 'B') > 0, 'land in the day and in the dark')
  assert.notDeepEqual(a, b, 'six hours later the night has moved')
  assert.deepEqual(a.map(l => l.replace(/[GB]/g, 'L')), b.map(l => l.replace(/[GB]/g, 'L')), 'the land has not')
})

test('the windmill turns, slowly, and stands still while it does', () => {
  const a = P.windmillPixels(0), b = P.windmillPixels(2000)
  assert.notDeepEqual(a, b, 'the sails turn')
  assert.deepEqual(P.windmillPixels(600), a, 'each position holds for two-thirds of a second')
  assert.notDeepEqual(P.windmillPixels(700), a, 'then steps on')
  // Four sails: a quarter turn is the same picture, give or take a pixel
  // where a sail's edge rounds the other way.
  const diff = P.windmillPixels(4100).join('').split('').filter((ch, i) => ch !== a.join('')[i]).length
  assert.ok(diff <= 6, `a quarter turn is the same picture near enough (${diff} pixels differ)`)
  assert.deepEqual(a.slice(12), b.slice(12), 'the tower and the ground do not')
})

test('no sky lights its cell\'s top pixel row, so rows of it never join up', () => {
  // Bits 1 and 2 are a cell's top two pixels.
  for (const kind of ['sun', 'star', 'cloud', 'part', 'partnight', 'fog']) {
    for (let ms = 0; ms < 12000; ms += 150) {
      for (const [bits] of P.skyCells(kind, ms)) assert.equal(bits & 3, 0, `${kind} at ${ms}ms`)
    }
  }
})

test('a cloud is always in its cells, and a star keeps off the word before it', () => {
  for (let ms = 0; ms < 12000; ms += 150) {
    const [a, b] = P.skyCells('cloud', ms).map(([bits]) => bits)
    assert.ok(a || b, `a cloud at ${ms}ms`)
    // Bits 1, 4 and 16 are a cell's left column.
    assert.equal(P.skyCells('star', ms)[0][0] & (1 | 4 | 16), 0, `the star's left edge is dark at ${ms}ms`)
  }
})

test('the fact pictures move, slowly: the invader steps, the light and the cursor blink', () => {
  for (const pic of [P.invaderPixels, P.chipPixels, P.terminalPixels]) {
    assert.deepEqual(pic(0), pic(900), `${pic.name} holds for most of a second`)
    assert.notDeepEqual(pic(0), pic(1300), `${pic.name} then changes`)
  }
  // Each part in whole cells: no cell row-and-column holds two colours.
  for (const pic of [P.chipPixels(0), P.terminalPixels(0)]) {
    for (let r = 0; r * 3 < pic.length; r++) for (let c = 0; c * 2 < pic[0].length; c++) {
      const inks = new Set()
      for (let y = r * 3; y < r * 3 + 3; y++) for (let x = c * 2; x < c * 2 + 2; x++) if (pic[y]?.[x] && pic[y][x] !== '.') inks.add(pic[y][x])
      assert.ok(inks.size <= 1, `cell ${r},${c} is one colour`)
    }
  }
})
