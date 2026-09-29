// INTERVAL -- the set's own sounds. Few, on purpose: a television showing
// teletext made almost no sound at all. The switch, the degauss coil, the
// tube's whine and the click of the remote are all there is, and all of them
// are the MACHINE, not a broadcast -- so none of them go through a mute.
// (The overnight music is YouTube and has its own controls in program.js.)
//
// Adapted from SIGNAL's audio/sfx.js, which carries the long reasoning for
// each; the degauss is from Cyberspace TERMINAL via SIGNAL (see NOTICE).
// Every call is wrapped: there is no AudioContext in the test harness, and a
// browser that has not had a gesture yet hands back a suspended one.

let actx = null
export function audioCtx() {
  if (!actx) actx = new (globalThis.AudioContext || globalThis.webkitAudioContext)()
  if (actx.state === 'suspended') actx.resume().catch(() => {})
  return actx
}

function noiseBuffer(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n)
  return buf
}

/** A remote-control button: a rubbery thunk under a plastic tick -- the
 *  key going down, then the contact. 2026-09-28: the tick alone was thin
 *  enough to forget; this is still quiet, since it fires on every key. */
export function playKeyClick() {
  try {
    const ctx = audioCtx()
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(190, t)
    o.frequency.exponentialRampToValueAtTime(90, t + 0.035)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045)
    o.connect(g).connect(ctx.destination)
    o.start(t); o.stop(t + 0.05)
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx, 0.006)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'; hp.frequency.value = 2800
    const n = ctx.createGain()
    n.gain.value = 0.06
    src.connect(hp).connect(n).connect(ctx.destination)
    src.start(t + 0.006)
  } catch (e) {}
}

/** The decoder latching the page it was waiting for: a soft relay tick,
 *  so a page arriving has a sound and a keyed search has an end. Quieter
 *  than the key, and not played for a page simply coming round again. */
export function playPageTick() {
  try {
    const ctx = audioCtx()
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx, 0.01)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 2
    const g = ctx.createGain()
    g.gain.value = 0.05
    src.connect(bp).connect(g).connect(ctx.destination)
    src.start(t)
  } catch (e) {}
}

/** A line of the switch-on readout landing (from SIGNAL's sfx.js): a
 *  report is a low square blip, an [ OK ] a brighter triangle one, and the
 *  pitch creeps up through the sequence. A few cents of wobble each, since
 *  identical pitches in a row read as a synthesizer and not as hardware. */
export function playBootTick(kind, progress = 0) {
  try {
    const ctx = audioCtx()
    const t = ctx.currentTime
    const ok = kind === 'ok'
    const o = ctx.createOscillator()
    o.type = ok ? 'triangle' : 'square'
    o.frequency.setValueAtTime((ok ? 760 : 380) + (ok ? 180 : 90) * progress + (Math.random() * 14 - 7), t)
    const g = ctx.createGain()
    const len = ok ? 0.05 : 0.03
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(ok ? 0.06 : 0.035, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    o.connect(g).connect(ctx.destination)
    o.start(t); o.stop(t + len + 0.01)
  } catch (e) {}
}

/** The service's ident: three bell-ish notes rising, played as the logo
 *  assembles at switch-on. The one musical sound the set makes. */
export const CHIME_HZ = [784, 1047, 1319]
export function playChime() {
  try {
    const ctx = audioCtx()
    const t0 = ctx.currentTime + 0.02
    CHIME_HZ.forEach((f, i) => {
      const t = t0 + i * 0.16
      for (const [mult, gain] of [[1, 0.07], [2, 0.018], [3.01, 0.008]]) {
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = f * mult
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(gain, t + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1 - i * 0.15)
        o.connect(g).connect(ctx.destination)
        o.start(t); o.stop(t + 1.2)
      }
    })
  } catch (e) {}
}

function playClick(t) {
  try {
    const ctx = audioCtx()
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx, 0.012)
    const g = ctx.createGain()
    g.gain.value = 0.3
    src.connect(g).connect(ctx.destination)
    src.start(t)
  } catch (e) {}
}

// The degauss coil fires at switch-on and needs its thermistor to cool
// before it fires again -- see SIGNAL's sfx.js for the model and for why a
// suspended context must not arm the lock-out.
export const DEGAUSS_REARM_S = 30
let lastDegaussAt = -Infinity
export function degaussDue(state, t, lastAt) {
  if (state !== 'running') return false
  return !(t - lastAt < DEGAUSS_REARM_S)
}
function scheduleDegauss(ctx, t) {
  if (!degaussDue(ctx.state, t, lastDegaussAt)) return
  lastDegaussAt = t
  const o = ctx.createOscillator()
  o.frequency.setValueAtTime(78, t)
  o.frequency.exponentialRampToValueAtTime(50, t + 1.0)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.2, t + 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
  const beat = ctx.createOscillator()
  beat.frequency.setValueAtTime(38, t)
  beat.frequency.exponentialRampToValueAtTime(19, t + 1.0)
  const trem = ctx.createGain(); trem.gain.value = 1
  const beatG = ctx.createGain(); beatG.gain.value = 0.7
  beat.connect(beatG).connect(trem.gain)
  o.connect(trem).connect(g).connect(ctx.destination)
  o.start(t); beat.start(t); o.stop(t + 1.15); beat.stop(t + 1.15)
}
export function playDegauss(t0) {
  try {
    const ctx = audioCtx()
    if (ctx.state === 'running') return scheduleDegauss(ctx, t0 ?? ctx.currentTime)
    ctx.resume?.().then(() => scheduleDegauss(ctx, ctx.currentTime)).catch(() => {})
  } catch (e) {}
}

export function playPowerOn() {
  try {
    const ctx = audioCtx()
    const t = ctx.currentTime
    playClick(t)
    playDegauss(t + 0.05)
  } catch (e) {}
}

/** Switch-off: the click, and the high-voltage collapsing -- a short
 *  falling hiss rather than SIGNAL's radio sweep. */
export function playPowerOff() {
  try {
    const ctx = audioCtx()
    const t = ctx.currentTime
    playClick(t)
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx, 0.35)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(4000, t)
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.3)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.08, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34)
    src.connect(bp).connect(g).connect(ctx.destination)
    src.start(t)
  } catch (e) {}
}

// The line whistle. A 625-line set swept its beam 15,625 times a second and
// the flyback transformer sang at that pitch -- the sound anyone who grew up
// with a CRT television can hear in a silent room, and many adults over
// thirty no longer can. Kept very quiet, with a low transformer hum under
// it, and started and stopped only by the power switch.
export const WHISTLE_HZ = 15625
export const WHISTLE_GAIN = 0.0035
export const HUM_GAIN = 0.012
let hum = null
export function startHum() {
  if (hum) return
  try {
    const ctx = audioCtx()
    const t = ctx.currentTime
    const out = ctx.createGain()
    out.gain.setValueAtTime(0, t)
    out.gain.linearRampToValueAtTime(1, t + 1.2)
    const tone = (f, gain) => {
      const o = ctx.createOscillator()
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.value = gain
      o.connect(g).connect(out)
      o.start(t)
      return o
    }
    const oscs = [tone(WHISTLE_HZ, WHISTLE_GAIN), tone(50, HUM_GAIN), tone(100, HUM_GAIN * 0.4)]
    out.connect(ctx.destination)
    hum = { out, oscs }
  } catch (e) {}
}
export function stopHum() {
  if (!hum) return
  const { out, oscs } = hum
  hum = null
  try {
    const ctx = audioCtx()
    out.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25)
    setTimeout(() => { try { oscs.forEach(o => o.stop()) } catch (e) {} }, 400)
  } catch (e) {}
}
