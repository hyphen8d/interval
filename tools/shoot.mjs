// INTERVAL -- regenerate screenshots/ by driving a real headless Chrome over
// the DevTools Protocol. `npm run shoot`. Needs Chrome/Chromium and
// ImageMagick (`magick`). No npm dependencies: Node's WebSocket speaks CDP.
//
//   node tools/shoot.mjs                         # every shot
//   node tools/shoot.mjs hero phone              # some of them
//   node tools/shoot.mjs --url=http://127.0.0.1:8090/
//
// Points at the local admin server by default, NOT the deployed site: the
// reason to re-shoot is that a screen changed in this working tree, and
// SIGNAL once captured production -- the previous deploy -- and committed
// the stale shots as fresh.
//
// Adapted from SIGNAL's tools/shoot.mjs, whose header carries the three
// traps (software WebGL, persistence settling per FRAME not per second, a
// fixed debug port reconnecting to the previous Chrome). All three apply
// here unchanged; settleFrames() and the port-0 handshake are why.

import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d }
// --out=<dir> for a look that is not meant to be committed; --pages=a,b,c
// for the `pages` recipe.
const SHOTS = path.resolve(flag('out', path.join(here, '..', 'screenshots')))
const BASE = flag('url', 'http://127.0.0.1:8081/')
const W = 1200, H = 900, SCALE = 2

const CHROME = ['/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chrome'].find((p) => spawnSync('test', ['-x', p]).status === 0)
if (!CHROME) { console.error('No Chrome/Chromium binary found.'); process.exit(2) }

const KEYS = Object.fromEntries([
  ...'0123456789'.split('').map(d => [d, [`Digit${d}`, 48 + +d]]),
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map(c => [c, [`Key${c.toUpperCase()}`, c.toUpperCase().charCodeAt(0)]]),
])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function session(url, { mobile = false } = {}, fn) {
  const profile = mkdtempSync(path.join(tmpdir(), 'interval-shoot-'))
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--window-size=${W},${H}`, '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--mute-audio', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  chrome.stderr.on('data', () => {})
  try {
    const portFile = path.join(profile, 'DevToolsActivePort')
    let port
    for (let i = 0; i < 80 && !port; i++) { if (existsSync(portFile)) port = +readFileSync(portFile, 'utf8').split('\n')[0]; if (!port) await sleep(250) }
    let wsUrl
    for (let i = 0; i < 80 && port && !wsUrl; i++) {
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl } catch { }
      if (!wsUrl) await sleep(250)
    }
    if (!wsUrl) throw new Error('chrome exposed no page target')
    const ws = new WebSocket(wsUrl)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
    let seq = 0
    const pending = new Map()
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result) }
    }
    const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) })
    const api = {
      ev: async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value,
      async key(k) {
        const [code, vk] = KEYS[k]
        for (const type of ['keyDown', 'keyUp']) {
          await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === 'keyDown' ? { text: k } : {}) })
        }
      },
      async type(s) { for (const ch of s) await api.key(ch) },
      async settleFrames(n = 120) {
        await api.ev('window.__f = 0; (function t(){ window.__f++; requestAnimationFrame(t) })()')
        for (let i = 0; i < 300; i++) { if ((await api.ev('window.__f')) > n) return; await sleep(100) }
      },
      async until(expr, tries = 80, gap = 250) {
        for (let i = 0; i < tries; i++) { if (await api.ev(expr)) return true; await sleep(gap) }
        throw new Error(`timed out waiting for ${expr}`)
      },
      /** A real touch, down and up, at CSS pixel (x, y): what a phone sends.
       *  The set ignores the mouse (main.js), so phone checks need this. */
      async tap(x, y) { await api.swipe(x, y, x, y, 80) },
      /** A touch dragged from (x0, y0) to (x1, y1) over `ms`. */
      async swipe(x0, y0, x1, y1, ms = 200) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
        for (let i = 1; i <= 4; i++) {
          await sleep(ms / 5)
          await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 4, y: y0 + (y1 - y0) * i / 4 }] })
        }
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      },
      /** A real mouse click at CSS pixel (x, y). */
      async click(x, y) {
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
          await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
        }
      },
      async png(file) {
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(file, Buffer.from(shot.data, 'base64'))
        // Captured at 2x (the shadow mask resolves far better), stored at
        // 1200 wide: a 2x PNG of a noisy CRT is ~3MB and this is a repo.
        // JPEG, because the tube's grain does not compress as PNG (~750KB a
        // shot even downscaled). Recipes name .png; the stored file is .jpg.
        const jpg = file.replace(/\.png$/, '.jpg')
        spawnSync('magick', [file, '-resize', mobile ? '600x' : '1200x', '-strip', '-quality', '85', jpg])
        rmSync(file, { force: true })
      },
    }
    await send('Page.enable'); await send('Runtime.enable')
    // ESPN's scoreboards answer a real Chrome and refuse a headless one with
    // a 403 (bot screening on the "HeadlessChrome" UA and client hints;
    // checked 2026-09-28, real Chrome 153 from the Pages origin got all six).
    // Without this the sport pages are captured OFF AIR, which no visitor sees.
    const ua = (await send('Browser.getVersion')).userAgent.replace('HeadlessChrome', 'Chrome')
    const major = ua.match(/Chrome\/(\d+)/)?.[1] || '140'
    await send('Network.setUserAgentOverride', { userAgent: ua, userAgentMetadata: {
      brands: [{ brand: 'Chromium', version: major }, { brand: 'Google Chrome', version: major }, { brand: 'Not=A?Brand', version: '24' }],
      platform: 'Linux', platformVersion: '', architecture: 'x86', model: '', mobile: mobile,
    } })
    if (mobile) {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    } else await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false })
    await send('Page.navigate', { url })
    await api.until('!!(window.screen0 && window.screen0.program)')
    await fn(api)
    ws.close()
  } finally { chrome.kill(); try { rmSync(profile, { recursive: true, force: true }) } catch { } }
}

const onPage = (n) => `window.screen0.program.page === '${n}' && !window.screen0.program.want`
const RECIPES = {
  async hero() {
    await session(`${BASE}`, {}, async (a) => {
      // A switch-on lands on the welcome (190), after the ~5s boot; the
      // hero is the index, so go there the way a viewer would.
      await a.key('p'); await a.until(onPage('190')); await a.key('i')
      await a.until(onPage('100')); await a.settleFrames(150)
      await a.png(path.join(SHOTS, 'hero.png'))
    })
  },
  async searching() {
    await session(`${BASE}?page=101&power=on`, {}, async (a) => {
      await a.until(onPage('101')); await a.settleFrames(60)
      // A page the service does not carry: the set keeps searching, so the
      // rolling header is still rolling when the capture lands. Keying a real
      // page raced the capture on a software-rendered headless Chrome.
      await a.type('345'); await a.settleFrames(20)
      await a.png(path.join(SHOTS, 'searching.png'))
    })
  },
  async pages() {
    // Not 1AF or 1FF: the hidden pages stay unadvertised (CLAUDE.md).
    for (const n of flag('pages', '101,302,401,500,700').split(',')) {
      await session(`${BASE}?page=${n}&power=on`, {}, async (a) => {
        await a.until(onPage(n)); await a.settleFrames(120)
        await a.png(path.join(SHOTS, `page-${n.toLowerCase()}.png`))
      })
    }
  },
  async modes() {
    await session(`${BASE}?page=101&power=on`, {}, async (a) => {
      await a.until(onPage('101'))
      await a.key('c'); await a.settleFrames(150); await a.png(path.join(SHOTS, 'mode-bw.png'))
      await a.key('c'); await a.settleFrames(150); await a.png(path.join(SHOTS, 'mode-monitor.png'))
    })
  },
  async reception() {
    await session(`${BASE}?page=101&power=on&rx=0.3`, {}, async (a) => {
      await a.until(onPage('101')); await a.settleFrames(120)
      await a.png(path.join(SHOTS, 'reception.png'))
    })
  },
  async phone() {
    await session(`${BASE}?page=100&power=on`, { mobile: true }, async (a) => {
      await a.until(onPage('100')); await a.settleFrames(150)
      await a.png(path.join(SHOTS, 'phone.png'))
    })
  },
}

// Importable (for a one-off check against a real browser) without shooting.
if (process.argv[1] !== fileURLToPath(import.meta.url)) { /* imported */ } else {
mkdirSync(SHOTS, { recursive: true })
const want = args.filter(a => !a.startsWith('--'))
const names = want.length ? want : Object.keys(RECIPES)
for (const n of names) {
  if (!RECIPES[n]) { console.error(`no recipe "${n}"; have ${Object.keys(RECIPES).join(', ')}`); process.exit(2) }
  process.stdout.write(`${n}... `)
  await RECIPES[n]()
  console.log('ok')
}
// og.jpg: the hero fitted onto the 1200x630 card social scrapers crop to. A
// derived shot is written by the recipe it derives from, or it rots (SIGNAL,
// 2026-08-28).
if (names.includes('hero')) {
  const r = spawnSync('magick', [path.join(SHOTS, 'hero.jpg'), '-resize', '1200x630', '-background', 'black', '-gravity', 'center', '-extent', '1200x630', '-quality', '88', path.join(SHOTS, 'og.jpg')])
  console.log(r.status === 0 ? 'og.jpg ok' : 'og.jpg: magick failed')
}
}
