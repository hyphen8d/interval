// Every key in the key table does something you can SEE. SIGNAL's
// dead-feedback rule: a key that clicks and changes nothing is a bug, and a
// control the help page advertises has to answer even where it cannot act
// (a NO LINK, a 1/1). Each key is pressed on a fresh set and the whole grid
// -- characters, colours and bitmaps -- compared against a moment before.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boot } from './harness.mjs'
import { KEYS } from '../constants.js'

function snapshot(h) {
  const t = h.term
  return Array.from(t.chars).join(',') + '|' + Array.from(t.colors).join(',') + '|' + t.gfx.map(g => (g ? 1 : 0)).join('')
}

// A representative press for each entry, and the page to press it on --
// chosen where the key has something to act on, since "answers even where
// it cannot act" is tested separately below.
const PRESS = {
  digits: { keys: ['3'] },
  updown: { keys: ['ArrowUp'] },
  leftright: { keys: ['ArrowRight'], on: '200' },
  fastext: { keys: ['F1'] },
  index: { keys: ['i'], on: '302' },
  help: { keys: ['?'] },
  hold: { keys: ['h'] },
  colour: { keys: ['c'] },
  cycle: { keys: ['n'] },
  fullscreen: { keys: ['f'] },
  cancel: { keys: ['1', 'Escape'] },
  power: { keys: ['p'], wait: 400 },
}

test('the table and this test cover the same keys', () => {
  assert.deepEqual(Object.keys(PRESS).sort(), KEYS.map(k => k.id).sort())
})

for (const k of KEYS) {
  test(`${k.keys} (${k.label}) changes what is on the screen`, async () => {
    const h = await boot()
    const { keys, on, wait = 120 } = PRESS[k.id]
    if (on) await h.go(on, 3500)
    h.advance(200)
    const before = snapshot(h)
    for (const key of keys) h.key(key)
    h.advance(wait)
    assert.notEqual(snapshot(h), before)
    h.shutdown()
  })
}

test('a key with nothing to act on still answers: subpages on a single page, a missing link', async () => {
  const h = await boot()
  await h.go('310', 3500)
  const before = snapshot(h)
  h.key('ArrowRight'); h.advance(100)
  assert.notEqual(snapshot(h), before, 'says 1/1')
  assert.match(h.row(0), /1\/1/)
  await h.go('199', 3500)
  h.key('F3'); h.advance(100)
  assert.match(h.row(0), /INTERVAL|NO LINK/)
  h.shutdown()
})

test('a first digit that cannot start a page says so', async () => {
  const h = await boot()
  h.key('9'); h.advance(100)
  assert.match(h.row(0), /NO 9XX/)
  h.shutdown()
})

test('every button on the phone remote does something you can see, help and clear among them', async () => {
  // 2026-10-05: help and Escape were keyboard-only, so a phone had no way to
  // 199 but the index, and no way to give up a search for a page not on air.
  const { readFileSync } = await import('node:fs')
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const remote = html.slice(html.indexOf('id="remote"'), html.indexOf('</div>', html.indexOf('id="remote"')))
  const keys = [...remote.matchAll(/data-key="([^"]+)"/g)].map(m => m[1])
  assert.ok(keys.includes('?') && keys.includes('Escape'), `the remote has HELP and CLEAR (${keys})`)
  for (const k of keys) {
    if (k === 'p') continue // power: its own test, and it ends the session
    const h = await boot()
    await h.go('200', 3500)
    if (k === 'Escape') h.key('1') // something for CLEAR to clear
    const before = snapshot(h)
    h.key(k)
    await h.settle(3000)
    assert.notEqual(snapshot(h), before, `the ${k} button changes the screen`)
    h.shutdown()
  }
})
