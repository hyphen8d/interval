// INTERVAL -- what a screen reader gets. The set is one <canvas>, so without
// this an assistive technology sees an empty page. Teletext is text, which
// makes the fix better here than it can be in SIGNAL: the live region can
// read the PAGE itself, not just describe it.
//
// Same shape as SIGNAL's a11y.js: index.html carries the static half (what
// the service is, which keys do what), this is the live half, and it
// de-duplicates per kind so a repaint of the same page says nothing. A page
// is announced when it ARRIVES and when its subpage turns -- never on the
// clock ticking in the header, which changes every second and is not news.

let node
let last = ''
const said = new Map()

function region() {
  if (node !== undefined) return node
  try { node = globalThis.document?.getElementById?.('announce') ?? null } catch (e) { node = null }
  return node
}

export function announce(text, kind = 'other') {
  const say = String(text ?? '').trim()
  if (!say || said.get(kind) === say) return
  said.set(kind, say)
  last = say
  const el = region()
  if (!el) return
  el.textContent = ''
  el.textContent = say
}

export function lastAnnouncement() { return last }
export function resetAnnouncements() { last = ''; said.clear(); node = undefined }
