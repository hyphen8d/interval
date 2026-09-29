// INTERVAL -- the admin backend. No dependencies.
//
//   node tools/admin-server.mjs [port]          # default 8081, loopback
//   node tools/admin-server.mjs --host=tailscale  # bind the tailnet address
//   then open http://127.0.0.1:8081/admin
//
// Serves the app AND the dashboard (tools/admin.html), with the same
// no-store headers as tools/dev-server.py, so for an admin session it
// replaces that server rather than running beside it. Port 8081 because
// SIGNAL's admin holds 8080 on the development box.
//
// It owns the filesystem, child processes and git: the editorial store,
// the toolchain (lint, suite, stamp, feed probe), and SHIP. It owns no page
// logic -- the dashboard imports pages.js, teletext.js and feeds.js itself
// and draws previews in the browser, so there is one copy of how a page
// looks, the same one the set uses.
//
// This process can run `git push`, so it is guarded the way SIGNAL's is, for
// the reasons SIGNAL's CLAUDE.md sets out at length:
//   - it binds loopback unless told otherwise (--host=), and an empty
//     --host= is an error, not "every interface";
//   - it answers only to a Host header naming an address this machine has
//     (DNS rebinding sends someone else's hostname);
//   - every mutating route needs an X-Interval-Admin header, which a
//     cross-origin page cannot send without a CORS preflight this server
//     never answers;
//   - static files come from an ALLOWLIST (servable() below), not the repo
//     root. SIGNAL served its API key over HTTP from a working directory
//     before it had one. dev-server.py holds the second copy of the rule;
//     tests/admin-server.test.mjs runs the same lists against both.

import http from 'node:http'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, renameSync, statSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '..')

const argv = process.argv.slice(2)
const flag = (name, dflt = null) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const PORT = +(argv.find(a => !a.startsWith('--')) || process.env.INTERVAL_ADMIN_PORT || 8081)

function resolveHost(want) {
  if (want !== 'tailscale') return want
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (!name.startsWith('tailscale')) continue
    const v4 = (list || []).find(ni => ni.family === 'IPv4' || ni.family === 4)
    if (v4) return v4.address
  }
  console.error('--host=tailscale: no tailscale0 IPv4 yet (is tailscaled up?). systemd Restart= will retry.')
  process.exit(1)
}
const HOST = resolveHost(flag('host', '127.0.0.1'))
if (!HOST) {
  console.error('--host= needs a value (an address, or "tailscale"). An empty one would bind every interface.')
  process.exit(1)
}
const LOOPBACK = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1'

function localAddresses() {
  const out = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) { out.add(ni.address); out.add(`[${ni.address}]`) }
  }
  return out
}
const ALLOWED_HOSTS = localAddresses()

// ---------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------
const WRITABLE = new Set(['editorial.json'])
const abs = (rel) => path.resolve(ROOT, rel)
const inRepo = (p) => p === ROOT || p.startsWith(ROOT + path.sep)

/** Dot-prefixed, so the static allowlist never serves a half-written file,
 *  and matched by *.tmp-* in .gitignore, so SHIP's `git add -A` never
 *  commits one a crash left behind (SIGNAL 2026-09-12, M9). */
export const tmpPathFor = (p) => path.join(path.dirname(p), `.${path.basename(p)}.tmp-${process.pid}`)

function writeRepoFile(rel, text) {
  if (!WRITABLE.has(rel)) throw new Error(`refusing to write "${rel}": not in the writable set`)
  const p = abs(rel)
  const tmp = tmpPathFor(p)
  writeFileSync(tmp, text)
  renameSync(tmp, p)
}
const readJson = (rel, fallback) => { try { return JSON.parse(readFileSync(abs(rel), 'utf8')) } catch (e) { return fallback } }

// ---------------------------------------------------------------------
// Child processes
// ---------------------------------------------------------------------
// Listed, not globbed: spawn() has no shell to expand tests/*.test.mjs, and
// `node --test tests/` does not find them on the Node this box runs.
const testFiles = () => readdirSync(abs('tests')).filter(f => f.endsWith('.test.mjs')).sort().map(f => `tests/${f}`)
export const TASKS = {
  lint: { label: 'lint pages', cmd: () => ['node', ['tools/lint-pages.mjs']] },
  test: { label: 'test suite', cmd: () => ['node', ['--test', '--test-reporter=spec', ...testFiles()]] },
  stamp: { label: 'bump build stamp', cmd: () => ['node', ['tools/stamp.js']] },
  health: { label: 'probe every source', network: true, cmd: () => ['node', ['tools/check-feeds.mjs']] },
  capture: { label: 'recapture test fixtures', network: true, cmd: () => ['node', ['tools/capture-fixtures.mjs']] },
  markets: { label: 'fetch market closes (markets.json)', network: true, cmd: () => ['node', ['tools/fetch-markets.mjs']] },
}

function run(cmd, args, emit) {
  return new Promise((resolve) => {
    emit({ type: 'cmd', text: `$ ${cmd} ${args.join(' ')}` })
    let child
    try { child = spawn(cmd === 'node' ? process.execPath : cmd, args, { cwd: ROOT, env: process.env }) } catch (err) {
      emit({ type: 'err', text: String(err?.message ?? err) }); resolve(1); return
    }
    const pump = (stream, type) => {
      let buf = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => {
        buf += chunk
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) emit({ type, text: line })
      })
      stream.on('end', () => { if (buf) emit({ type, text: buf }) })
    }
    pump(child.stdout, 'out')
    pump(child.stderr, 'err')
    child.on('error', (err) => { emit({ type: 'err', text: String(err?.message ?? err) }); resolve(1) })
    child.on('close', (code) => resolve(code ?? 0))
  })
}
function capture(cmd, args) {
  let stdout = '', stderr = ''
  return run(cmd, args, (ev) => {
    if (ev.type === 'out') stdout += ev.text + '\n'
    else if (ev.type === 'err') stderr += ev.text + '\n'
  }).then((code) => ({ code, stdout, stderr }))
}

function git(args) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd: ROOT })
    let out = '', err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', () => resolve({ code: 1, out: '', err: 'git not found', raw: '' }))
    // `raw` untrimmed: porcelain is fixed-width, and trimming the leading
    // space of " M file" shifts every column (SIGNAL's "ools/network.html").
    child.on('close', (code) => resolve({ code: code ?? 0, out: out.trim(), err: err.trim(), raw: out }))
  })
}

export async function gitState() {
  const [branch, status, last, upstream, remote] = await Promise.all([
    git(['rev-parse', '--abbrev-ref', 'HEAD']),
    git(['status', '--porcelain']),
    git(['log', '-1', '--format=%h %s']),
    git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    git(['remote']),
  ])
  let ahead = null
  if (upstream.code === 0) {
    const c = await git(['rev-list', '--count', `${upstream.out}..HEAD`])
    if (c.code === 0) ahead = +c.out
  }
  const dirty = (status.raw || '').split('\n').filter(Boolean).map((l) => {
    let file = l.slice(3)
    const arrow = file.indexOf(' -> ')
    if (arrow !== -1) file = file.slice(arrow + 4)
    if (file.startsWith('"') && file.endsWith('"')) { try { file = JSON.parse(file) } catch (e) {} }
    return { code: l.slice(0, 2).trim(), file }
  })
  return {
    branch: branch.code === 0 ? branch.out : '(unknown)',
    lastCommit: last.code === 0 ? last.out : '',
    upstream: upstream.code === 0 ? upstream.out : null,
    hasRemote: !!remote.out,
    ahead,
    dirty,
  }
}

// ---------------------------------------------------------------------
// Editorial
// ---------------------------------------------------------------------
/** The mtime-keyed import SIGNAL's bootState() uses: an edited tool is seen
 *  on the next request without restarting the server. Route code still
 *  needs a restart; data and the lint rules do not. */
const mt = (rel) => { try { return Math.floor(statSync(abs(rel)).mtimeMs) } catch (e) { return 0 } }
async function lintEditorial(editorial) {
  const { lint } = await import(`./lint-pages.mjs?v=admin-${mt('tools/lint-pages.mjs')}-${mt('pages.js')}`)
  return lint({ editorial })
}

/** The shape the set reads. Anything else in the body is dropped, so a
 *  dashboard bug cannot add keys the app would then carry forever. */
export function normaliseEditorial(e) {
  const str = (x) => String(x ?? '')
  return {
    notices: (e?.notices || []).map(n => ({ page: str(n.page).toUpperCase(), title: str(n.title), lines: (n.lines || []).map(str) })),
    quiz: (e?.quiz || []).map(q => ({ q: str(q.q), a: str(q.a) })),
    fourkeys: (e?.fourkeys || []).map(q => ({ q: str(q.q), options: (q.options || []).map(str), answer: Number(q.answer) })),
    thoughts: (e?.thoughts || []).map(t => ({ text: str(t.text), by: str(t.by) })),
    facts: (e?.facts || []).map(f => ({ tag: str(f.tag).toUpperCase(), text: str(f.text) })),
  }
}

export async function saveEditorial(body) {
  const next = normaliseEditorial(body)
  const result = await lintEditorial(next)
  if (result.errors.length) return { saved: false, ...result }
  const text = JSON.stringify(next, null, 2) + '\n'
  JSON.parse(text)
  const before = existsSync(abs('editorial.json')) ? readFileSync(abs('editorial.json'), 'utf8') : ''
  if (before === text) return { saved: false, unchanged: true, ...result }
  writeRepoFile('editorial.json', text)
  return { saved: true, ...result }
}

// ---------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.bdf': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.gif': 'image/gif', '.mp4': 'video/mp4',
}
const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache', Expires: '0' }

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE })
  res.end(JSON.stringify(body))
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', d => { buf += d; if (buf.length > 2e6) { reject(new Error('request body too large')); req.destroy() } })
    req.on('end', () => { if (!buf) return resolve({}); try { resolve(JSON.parse(buf)) } catch (e) { reject(new Error('invalid JSON body')) } })
    req.on('error', reject)
  })
}
function openStream(res) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', ...NO_STORE })
  return {
    emit: (obj) => { if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n') },
    end: () => { if (!res.writableEnded) res.end() },
  }
}

async function health() {
  const { readHealth } = await import(`./check-feeds.mjs?v=admin-${mt('tools/check-feeds.mjs')}`)
  const { status } = await import(`./feed-watch.mjs?v=admin-${mt('tools/feed-watch.mjs')}`)
  let watch = null
  try { watch = status() } catch (e) { /* the record is still worth showing */ }
  return { ...readHealth(), watch }
}

async function bootState() {
  const editorial = readJson('editorial.json', {})
  return {
    build: readJson('build.json', null),
    git: await gitState(),
    editorial,
    lint: await lintEditorial(editorial),
    health: await health(),
    tasks: Object.fromEntries(Object.entries(TASKS).map(([k, v]) => [k, { label: v.label, network: !!v.network }])),
  }
}

async function pipeline(s, steps) {
  for (const task of steps) {
    s.emit({ type: 'step', task, label: TASKS[task].label })
    const [cmd, args] = TASKS[task].cmd()
    const code = await run(cmd, args, s.emit)
    s.emit({ type: 'step-done', task, code })
    if (code !== 0) return task
  }
  return null
}

async function handleApi(req, res, url) {
  const route = url.pathname.replace(/^\/api\//, '')
  if (req.method !== 'GET' && req.headers['x-interval-admin'] !== '1') {
    return sendJson(res, 403, { error: 'missing X-Interval-Admin header' })
  }

  if (route === 'state' && req.method === 'GET') return sendJson(res, 200, await bootState())
  if (route === 'git' && req.method === 'GET') return sendJson(res, 200, await gitState())
  if (route === 'health' && req.method === 'GET') return sendJson(res, 200, await health())

  if (route === 'editorial/check' && req.method === 'POST') {
    const body = await readBody(req)
    return sendJson(res, 200, await lintEditorial(normaliseEditorial(body.editorial)))
  }
  if (route === 'editorial' && req.method === 'POST') {
    const body = await readBody(req)
    const r = await saveEditorial(body.editorial)
    return sendJson(res, r.saved || r.unchanged ? 200 : 409, r)
  }

  if (route === 'run' && req.method === 'POST') {
    const { task } = await readBody(req)
    const spec = TASKS[task]
    if (!spec) return sendJson(res, 400, { error: `unknown task "${task}"` })
    const s = openStream(res)
    const [cmd, args] = spec.cmd()
    const code = await run(cmd, args, s.emit)
    s.emit({ type: 'exit', code, task })
    return s.end()
  }

  if (route === 'preflight' && req.method === 'POST') {
    const { includeNetwork } = await readBody(req)
    const s = openStream(res)
    const failed = await pipeline(s, ['lint', 'test', ...(includeNetwork ? ['health'] : [])])
    s.emit({ type: 'exit', code: failed ? 1 : 0, failed })
    return s.end()
  }

  // SHIP: stamp -> lint -> suite (-> probe) -> add -> commit -> push, stopping
  // at the first failure with nothing committed. The stamp is the step most
  // easily forgotten by hand, which is the argument for this route.
  if (route === 'ship' && req.method === 'POST') {
    const { message, confirm, includeNetwork } = await readBody(req)
    if (confirm !== true) return sendJson(res, 400, { error: 'ship requires confirm:true' })
    if (!message || !String(message).trim()) return sendJson(res, 400, { error: 'a commit message is required' })
    const s = openStream(res)
    const before = await gitState()
    s.emit({ type: 'info', text: `branch ${before.branch}${before.upstream ? ` -> ${before.upstream}` : ' (no upstream)'}` })
    const failed = await pipeline(s, ['stamp', 'lint', 'test', ...(includeNetwork ? ['health'] : [])])
    if (failed) {
      s.emit({ type: 'err', text: `${TASKS[failed].label} failed -- nothing committed, nothing pushed.` })
      s.emit({ type: 'exit', code: 1, failed })
      return s.end()
    }
    const steps = [['staging', ['add', '-A']], ['committing', ['commit', '-m', String(message).trim()]]]
    if (before.upstream) steps.push(['pushing', ['push']])
    for (const [label, args] of steps) {
      s.emit({ type: 'step', task: label, label })
      const code = await run('git', args, s.emit)
      s.emit({ type: 'step-done', task: label, code })
      if (code !== 0) {
        s.emit({ type: 'err', text: `${label} failed -- stopping here.` })
        s.emit({ type: 'exit', code: 1, failed: label })
        return s.end()
      }
    }
    if (!before.upstream) s.emit({ type: 'info', text: 'Committed locally. This branch has no upstream, so nothing was pushed.' })
    s.emit({ type: 'git', state: await gitState() })
    s.emit({ type: 'exit', code: 0 })
    return s.end()
  }

  return sendJson(res, 404, { error: `no route ${req.method} /api/${route}` })
}

// The static allowlist: what the app and the dashboard actually fetch,
// derived by enumerating their requests. The second copy is servable() in
// tools/dev-server.py. Change one, change both.
const STATIC_DIRS = new Set(['fonts', 'src', 'screenshots'])
const STATIC_TOP_EXT = new Set(['.js', '.json', '.html', '.md', '.ico', '.png', '.jpg', '.svg'])
export function servable(rel) {
  const parts = rel.split('/')
  if (parts.some((seg) => seg.startsWith('.'))) return false
  if (parts.length === 1) return STATIC_TOP_EXT.has(path.extname(rel).toLowerCase())
  if (parts[0] === 'tools') {
    if (parts.length === 2 && parts[1].endsWith('.html')) return true
    return parts.length === 3 && parts[1] === 'lib' && parts[2].endsWith('.mjs')
  }
  return STATIC_DIRS.has(parts[0])
}

function serveStatic(req, res, url) {
  let rel
  try { rel = decodeURIComponent(url.pathname.replace(/^\/+/, '')) } catch (e) { rel = '\0' }
  if (rel === '') rel = 'index.html'
  if (rel === 'admin' || rel === 'admin/') rel = 'tools/admin.html'
  const p = path.resolve(ROOT, rel)
  let isFile = false
  try { isFile = statSync(p).isFile() } catch (e) {}
  if (!servable(rel) || !inRepo(p) || !isFile) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...NO_STORE })
    return res.end('not found')
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream', ...NO_STORE })
  res.end(readFileSync(p))
}

export const server = http.createServer(async (req, res) => {
  const raw = req.headers.host || ''
  const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.split(':')[0]
  if (!host || !ALLOWED_HOSTS.has(host)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' })
    return res.end(host ? `this server does not answer to the host "${host}"` : 'this server requires a Host header')
  }
  const url = new URL(req.url, `http://${raw}`)
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
    return serveStatic(req, res, url)
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: String(err?.message ?? err) })
    else res.end()
    console.error('admin-server:', err)
  }
})

server.on('error', (err) => {
  if (err.code === 'EADDRNOTAVAIL') { console.error(`Cannot bind ${HOST}: no interface has that address.`); process.exit(1) }
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is in use. If this is the systemd unit, restart it rather than starting another:`)
    console.error('  systemctl --user restart interval-admin')
    process.exit(1)
  }
  throw err
})

if (!process.env.INTERVAL_ADMIN_IMPORT) server.listen(PORT, HOST, () => {
  const shown = LOOPBACK ? '127.0.0.1' : HOST
  console.log(`INTERVAL admin  ->  http://${shown}:${PORT}/admin`)
  console.log(`the app         ->  http://${shown}:${PORT}/  (no-store)`)
  if (process.env.SSH_CONNECTION && LOOPBACK) {
    const reachable = process.env.SSH_CONNECTION.split(' ')[2] || os.hostname()
    console.log('')
    console.log('SSH session: those URLs name YOUR machine, not this one. Tunnel, exposing nothing:')
    console.log(`  ssh -N -L ${PORT}:127.0.0.1:${PORT} ${os.userInfo().username}@${reachable}`)
    console.log(`or bind an address you can reach:  npm run admin -- --host=tailscale ${PORT}`)
  }
  if (!LOOPBACK) {
    console.log('')
    console.log(`!! Bound to ${HOST}, not loopback. Anything that can reach it can edit pages,`)
    console.log('   run the toolchain, and commit and push. There is no password on it.')
  }
})
