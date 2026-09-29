// The admin backend's guards, from both ends: what must be refused IS
// refused, and what the app and the dashboard fetch still loads -- an
// allowlist that serves nothing passes the refusal half on its own. The same
// lists run against tools/dev-server.py, the rule's second copy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

process.env.INTERVAL_ADMIN_IMPORT = '1'
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const admin = await import('../tools/admin-server.mjs')

const MUST_SERVE = ['/', '/index.html', '/main.js', '/program.js', '/pages.js', '/teletext.js', '/editorial.json',
  '/build.json', '/src/crt.js', '/fonts/ter-u16b.bdf', '/tools/lib/fixture-ctx.mjs']
const MUST_REFUSE = ['/.gitignore', '/.git/config', '/tests/fixtures/hn-item.json', '/tools/admin-server.mjs',
  '/tools/feed-health.json', '/tools/../.gitignore', '/src/', '/fonts/.hidden', '/LICENSE', '/node_modules/x.js']

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}
// http.request, not fetch: fetch treats Host as a forbidden header and
// quietly sends its own, which would make the rebinding check pass vacuously.
function get(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, headers }, (res) => { res.resume(); resolve(res.statusCode) })
    req.on('error', reject)
    req.end()
  })
}

test('the admin server serves what the app needs and nothing else', async () => {
  const port = await listen(admin.server)
  try {
    for (const p of MUST_SERVE) assert.equal(await get(port, p), 200, `${p} is served`)
    for (const p of MUST_REFUSE) assert.equal(await get(port, p), 404, `${p} is refused`)
    assert.equal(await get(port, '/admin'), 200, 'the dashboard itself')
  } finally { admin.server.close() }
})

test('servable() refuses any dot-segment, which HTTP alone cannot show', () => {
  // Over HTTP a refused path and a missing one are the same 404, so this
  // asks the rule directly (SIGNAL 2026-09-12).
  assert.equal(admin.servable('.env'), false)
  assert.equal(admin.servable('src/.secret.js'), false)
  assert.equal(admin.servable('.editorial.json.tmp-123'), false)
  assert.equal(admin.servable('editorial.json'), true)
  assert.equal(admin.servable(path.basename(admin.tmpPathFor(path.join(root, 'editorial.json')))), false, 'its own temp files are dot-prefixed')
})

test('the admin server answers only to its own addresses, and mutates only with the header', async () => {
  const server = (await import(`../tools/admin-server.mjs?guard`)).server
  const port = await listen(server)
  try {
    assert.equal(await get(port, '/', { Host: 'evil.example' }), 403, 'DNS rebinding sends someone else\'s host')
    const res = await fetch(`http://127.0.0.1:${port}/api/run`, { method: 'POST', body: '{"task":"lint"}' })
    assert.equal(res.status, 403, 'no X-Interval-Admin, no action')
    const ok = await fetch(`http://127.0.0.1:${port}/api/state`)
    assert.equal(ok.status, 200, 'reads need no header')
  } finally { server.close() }
})

test('the dev server applies the same allowlist', async () => {
  const port = 18000 + Math.floor(Math.random() * 1000)
  const child = spawn('python3', ['tools/dev-server.py', String(port)], { cwd: root, stdio: 'ignore' })
  try {
    let up = false
    for (let i = 0; i < 50 && !up; i++) {
      try { await get(port, '/'); up = true } catch (e) { await new Promise(r => setTimeout(r, 100)) }
    }
    assert.ok(up, 'dev server came up')
    for (const p of MUST_SERVE) assert.equal(await get(port, p), 200, `dev-server serves ${p}`)
    for (const p of MUST_REFUSE) assert.equal(await get(port, p), 404, `dev-server refuses ${p}`)
  } finally { child.kill() }
})

test('editorial saves are linted first, and a failing one writes nothing', async () => {
  const file = path.join(root, 'editorial.json')
  const before = readFileSync(file, 'utf8')
  const good = JSON.parse(before)
  try {
    const bad = structuredClone(good)
    bad.notices[0].lines.push('[y]' + 'x'.repeat(60))
    const r = await admin.saveEditorial(bad)
    assert.equal(r.saved, false)
    assert.ok(r.errors.some(e => /wide/.test(e)))
    assert.equal(readFileSync(file, 'utf8'), before, 'untouched')
    const same = await admin.saveEditorial(good)
    assert.equal(same.unchanged, true, 'the committed file is already in the form the server writes')
    const next = structuredClone(good)
    next.quiz.push({ q: 'A test question?', a: 'YES' })
    const w = await admin.saveEditorial(next)
    assert.equal(w.saved, true)
    assert.ok(readFileSync(file, 'utf8').includes('A test question?'))
  } finally { writeFileSync(file, before) }
})

test('only the shape the set reads is ever written', () => {
  const n = admin.normaliseEditorial({ quiz: [{ q: 'q', a: 'a', extra: 1 }], evil: true, notices: [{ page: '19a', title: 't', lines: [1] }] })
  assert.deepEqual(Object.keys(n).sort(), ['facts', 'fourkeys', 'notices', 'quiz', 'thoughts'])
  assert.deepEqual(n.quiz, [{ q: 'q', a: 'a' }])
  assert.equal(n.notices[0].page, '19A')
  assert.deepEqual(n.notices[0].lines, ['1'])
})

test('the lint runs clean on the committed pages and editorial', async () => {
  const { lint } = await import('../tools/lint-pages.mjs')
  const r = await lint()
  assert.deepEqual(r.errors, [])
  assert.ok(r.pages > 50)
})

test('the published site is the app and nothing else', async () => {
  const { siteFiles } = await import('../tools/build-site.mjs')
  const files = siteFiles()
  for (const f of ['index.html', 'main.js', 'program.js', 'editorial.json', 'build.json', 'src/crt.js', 'fonts/ter-u16b.bdf']) assert.ok(files.includes(f), f)
  assert.ok(!files.some(f => f.startsWith('tools/') || f.startsWith('tests/') || f.split('/').some(s => s.startsWith('.'))), 'no tools, tests or dotfiles')
})
