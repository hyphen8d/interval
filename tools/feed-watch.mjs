// INTERVAL -- the scheduled feed check. `npm run watch`; installed (if you
// choose to) as a systemd user timer, tools/interval-feeds.{service,timer}.
//
// Runs check-feeds once and speaks up ONLY when a person is needed. Two of
// SIGNAL's roster-watch lessons, applied here from the start rather than
// learned again:
//
//   - A notification that fires every day is wallpaper inside a week, so a
//     clean run says nothing.
//   - A finding has to be seen twice. One failed probe is a source having a
//     bad minute -- the network, a deploy, a rate limit -- and the next run
//     usually clears it. SIGNAL's watch cried wolf for five days over a
//     track that had already come back. So a failure notifies only when its
//     `strikes` (consecutive failed probes, in feed-health.json) reach
//     CONFIRM_STRIKES.
//
// Local run state -- when this last ran on THIS machine -- is in
// tools/feed-watch-state.json, gitignored. feed-health.json is shared.
//
//   node tools/feed-watch.mjs              # one run
//   node tools/feed-watch.mjs --status     # when it last ran, what it found
//   node tools/feed-watch.mjs --status --json
//   node tools/feed-watch.mjs --dry-run    # run, but notify nobody

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STATE_FILE = path.join(ROOT, 'tools/feed-watch-state.json')
export const CONFIRM_STRIKES = 2
/** A watch that has not run for this long is LATE: the timer is off, or the
 *  machine has been asleep. The dashboard says so. */
export const LATE_AFTER_H = 36

export function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch (e) { return { runs: [] } }
}

/** Which failing sources are worth a person's attention now. */
export function confirmed(results) {
  return results.filter(r => !r.ok && (r.strikes || 0) >= CONFIRM_STRIKES)
}

export function status(state = readState(), now = Date.now()) {
  const last = state.runs[state.runs.length - 1] || null
  const ageH = last ? (now - Date.parse(last.at)) / 3600e3 : null
  return {
    lastRun: last,
    ageHours: ageH === null ? null : Math.round(ageH * 10) / 10,
    late: ageH === null || ageH > LATE_AFTER_H,
    runs: state.runs.length,
  }
}

function notify(title, body) {
  const r = spawnSync('notify-send', ['--app-name=INTERVAL', title, body], { encoding: 'utf8' })
  return r.status === 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  if (argv.includes('--status')) {
    const s = status()
    if (argv.includes('--json')) console.log(JSON.stringify(s, null, 2))
    else if (!s.lastRun) console.log('The feed watch has never run on this machine.')
    else console.log(`Last run ${s.lastRun.at} (${s.ageHours}h ago): ${s.lastRun.outcome}${s.late ? '  -- LATE' : ''}`)
    process.exit(0)
  }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/check-feeds.mjs'), '--json'], { cwd: ROOT, encoding: 'utf8' })
  let summary = null
  try { summary = JSON.parse(r.stdout) } catch (e) { /* below */ }
  const state = readState()
  const at = new Date().toISOString()
  let outcome
  if (!summary) {
    outcome = 'broken'
    // The checker itself failing is always worth saying: nothing else will.
    if (!argv.includes('--dry-run')) notify('INTERVAL feed check is broken', (r.stderr || 'check-feeds produced no summary').slice(0, 300))
  } else {
    const found = confirmed(summary.results)
    const unconfirmed = summary.results.filter(x => !x.ok && !found.includes(x))
    outcome = found.length ? `failing: ${found.map(x => x.id).join(', ')}` : unconfirmed.length ? `unconfirmed: ${unconfirmed.map(x => x.id).join(', ')}` : 'clean'
    if (found.length && !argv.includes('--dry-run')) {
      notify(`INTERVAL: ${found.length} source(s) failing`, found.map(x => `${x.id}: ${x.error}`).join('\n').slice(0, 400))
    }
  }
  state.runs.push({ at, outcome })
  state.runs = state.runs.slice(-20)
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n')
  console.log(`${at} ${outcome}`)
  // Findings are a correct outcome of a run that worked: exit 0 unless the
  // machinery broke, so the unit going red means the checker, not a source.
  process.exit(outcome === 'broken' ? 1 : 0)
}
