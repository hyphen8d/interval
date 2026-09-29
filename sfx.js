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

/** A remote-control button: a small plastic tick, quieter than SIGNAL's
 *  keyboard click because the thing being pressed is in your hand, not on
 *  the set. */
export function playKeyClick() {
  try {
    const ctx = audioCtx()
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx, 0.005)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'; hp.frequency.value = 3200
    const g = ctx.createGain()
    g.gain.value = 0.07
    src.connect(hp).connect(g).connect(ctx.destination)
    src.start()
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
