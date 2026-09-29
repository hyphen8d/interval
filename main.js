// INTERVAL -- entry point. The same build-stamp scheme as SIGNAL's main.js:
// build.json is fetched fresh on every load and every app module is imported
// as `?v=<stamp>`, so GitHub Pages' ten-minute cache can never mix a new
// module with an old one, and a module is instanced exactly once (a module
// is keyed by its full URL, query string included -- a bare import of a
// sibling would make a second copy, which is how SIGNAL once broke its
// phosphor identity check). Keep the `?v=${V}` form in every import.

import { mount } from './src/screen.js'

async function buildStamp() {
  try {
    const res = await fetch(`./build.json?t=${Date.now()}`, { cache: 'no-store' })
    if (res.ok) {
      const { build } = await res.json()
      if (build) return String(build)
    }
  } catch (e) {}
  return String(Date.now())
}
const stamp = await buildStamp()
globalThis.INTERVAL_BUILD = stamp

const config = await import(`./config.js?v=${stamp}`)
const { default: program } = await import(`./program.js?v=${stamp}`)

const canvas = document.getElementById('tube')

function fault(text) {
  const el = document.getElementById('fault')
  el.style.display = 'block'
  el.textContent = text
}

// A GPU reset leaves every draw call a silent no-op while the loop runs on.
// Ask for the context back and reload when it comes: see SIGNAL's main.js
// (2026-09-02 audit, E1) for why a reload rather than a rebuild in place.
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault()
  if (window.screen0) window.screen0.stopped = true
  fault('THE PICTURE DROPPED -- GPU CONTEXT LOST\n\nThe set reloads itself when the driver hands it back.\nIf nothing happens in a few seconds, reload the page.')
})
canvas.addEventListener('webglcontextrestored', () => location.reload())

try {
  window.screen0 = await mount(canvas, program, config)
  // The on-screen remote (index.html) presses keys through the same path the
  // keyboard does, so there is one handler and the two cannot disagree.
  window.INTERVAL_PRESS = (key, extra = {}) => program.key(window.screen0, { key, code: extra.code || '', shiftKey: !!extra.shiftKey, preventDefault() {} })
  document.dispatchEvent(new Event('interval-ready'))
} catch (err) {
  fault('THE TUBE DID NOT COME UP\n\n' + String(err?.stack ?? err)
    + '\n\nServe the directory over http rather than opening the file directly:\n\n    python3 tools/dev-server.py 8000\n')
  canvas.style.display = 'none'
}
