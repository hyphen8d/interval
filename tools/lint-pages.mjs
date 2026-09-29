// INTERVAL -- the page lint. `npm run lint`. Offline: every page is drawn
// from the captured fixtures, so this needs no network and runs in a second.
//
// The rules a page has to keep, mechanically:
//   - nothing is written off the page (the page model records every write
//     past column 40 or into a row that is not there)
//   - every fastext link goes to a page the set can reach, or to one of the
//     set's own actions (overnight, locate, a SIGNAL station, the game)
//   - every index entry is a page that exists
//   - editorial.json: notice pages on free numbers, titles that fit the
//     masthead, lines that fit the page; quiz answers that fit their row;
//     four-keys questions with four options and a real answer; an overnight
//     station SIGNAL actually has
//   - the help page's labels fit its column
//
// Exported as lint() so the admin server and the suite run the same code the
// terminal does -- one copy of the rules, as SIGNAL's lint-roster is.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const MASTHEAD_TITLE_MAX = 26
export const QUIZ_ANSWER_MAX = 32
export const FOURKEYS_OPTION_MAX = 24
export const FASTEXT_LABEL_MAX = 9
export const HELP_LABEL_MAX = 28

const SPECIAL = /^(overnight|locate|sub:next|signal:[\w-]+|game:(\d|next|reset))$/

/**
 * @param {object} [o]
 * @param {object} [o.editorial] editorial content to check (default: the file)
 * @returns {Promise<{errors: string[], warnings: string[], pages: number}>}
 */
export async function lint({ editorial } = {}) {
  editorial ??= JSON.parse(readFileSync(path.join(ROOT, 'editorial.json'), 'utf8'))
  const { PAGES, pageDef, pageOrder, INDEX } = await import('../pages.js')
  const { validPage } = await import('../carousel.js')
  const { lintLines } = await import('../markup.js')
  const { KEYS } = await import('../constants.js')
  const { fixtureCtx } = await import('./lib/fixture-ctx.mjs')
  const ctx = await fixtureCtx(editorial)
  const errors = [], warnings = []

  // -- editorial --------------------------------------------------------
  const seen = new Set()
  for (const [i, n] of (editorial.notices || []).entries()) {
    const num = String(n.page ?? '').toUpperCase()
    const where = `notice ${num || `#${i + 1}`}`
    if (!validPage(num)) { errors.push(`${where}: "${n.page}" is not a page number (1-8 then two hex digits)`); continue }
    if (PAGES.has(num)) errors.push(`${where}: ${num} is already a fixed page (${PAGES.get(num).title})`)
    if (/^5[12]\d$/.test(num)) errors.push(`${where}: 511-529 belong to SIGNAL's station pages`)
    if (seen.has(num)) errors.push(`${where}: two notices on the same page`)
    seen.add(num)
    if (!n.title) warnings.push(`${where}: no title; the masthead will say NOTICES`)
    if ((n.title || '').length > MASTHEAD_TITLE_MAX) errors.push(`${where}: title is ${n.title.length} long; ${MASTHEAD_TITLE_MAX} fit the masthead`)
    for (const e of lintLines(n.lines || [], { top: 4, bottom: 22, col: 1 })) errors.push(`${where}: ${e}`)
  }
  if (!seen.has('190')) errors.push('editorial: page 190 (NOTICES) is on the index and has no notice')

  const quiz = editorial.quiz || []
  if (!quiz.length) errors.push('editorial: the quiz (600) has no questions')
  quiz.forEach((q, i) => {
    if (!q.q || !String(q.q).trim()) errors.push(`quiz ${i + 1}: no question`)
    if (!q.a || !String(q.a).trim()) errors.push(`quiz ${i + 1}: no answer`)
    else if (String(q.a).length > QUIZ_ANSWER_MAX) errors.push(`quiz ${i + 1}: answer is ${q.a.length} long; ${QUIZ_ANSWER_MAX} fit`)
  })

  const fk = editorial.fourkeys || []
  if (!fk.length) warnings.push('editorial: four keys (1FF) has no questions')
  fk.forEach((q, i) => {
    const where = `four keys ${i + 1}`
    if (!q.q) errors.push(`${where}: no question`)
    if (!Array.isArray(q.options) || q.options.length !== 4) errors.push(`${where}: needs exactly four options, one per coloured key`)
    else q.options.forEach((o, k) => {
      if (!String(o).trim()) errors.push(`${where}: option ${k + 1} is empty`)
      if (String(o).length > FOURKEYS_OPTION_MAX) errors.push(`${where}: option ${k + 1} is ${o.length} long; ${FOURKEYS_OPTION_MAX} fit`)
      else if (String(o).length > FASTEXT_LABEL_MAX) warnings.push(`${where}: option ${k + 1} "${o}" is cut to ${FASTEXT_LABEL_MAX} on the fastext row`)
    })
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) errors.push(`${where}: answer must be 0-3 (red, green, yellow, cyan)`)
  })

  const o = editorial.overnight || {}
  for (const k of ['startHour', 'endHour']) {
    if (!Number.isInteger(o[k]) || o[k] < 0 || o[k] > 23) errors.push(`overnight: ${k} must be a whole hour, 0-23`)
  }
  if (!(o.idleMinutes >= 1)) errors.push('overnight: idleMinutes must be at least 1')
  const roster = ctx.entry('signal').data
  if (!roster.stations.some(s => s.id === o.stationId)) {
    errors.push(`overnight: SIGNAL has no public station "${o.stationId}" (in the fixture roster -- if it is new, refresh tests/fixtures/signal-stations.json)`)
  }

  // -- keys --------------------------------------------------------------
  for (const k of KEYS) if (k.label.length > HELP_LABEL_MAX) errors.push(`help: "${k.label}" is ${k.label.length} long; ${HELP_LABEL_MAX} fit`)

  // -- pages -------------------------------------------------------------
  const nums = [...new Set([...pageOrder(ctx), ...[...PAGES.values()].filter(d => d.hidden).map(d => d.num)])]
  let count = 0
  for (const num of nums) {
    const def = pageDef(num, ctx)
    let subs
    try { subs = def.render(ctx) } catch (e) { errors.push(`${num}: render threw: ${e.message}`); continue }
    if (!subs || !subs.length) { errors.push(`${num}: rendered nothing from the fixtures`); continue }
    subs.forEach((p, i) => {
      count++
      const where = subs.length > 1 ? `${num} (${i + 1}/${subs.length})` : num
      for (const issue of p.issues) errors.push(`${where}: ${issue}`)
      for (const f of p.fastext) {
        if (!f) continue
        const [label, target] = f
        const cut = `${num}: fastext "${label}" is cut to ${FASTEXT_LABEL_MAX}`
        if (label.length > FASTEXT_LABEL_MAX && !warnings.includes(cut)) warnings.push(cut)
        if (!SPECIAL.test(target) && !(validPage(target) && pageDef(target, ctx))) errors.push(`${where}: fastext "${label}" goes to ${target}, which is not a page`)
      }
    })
  }
  for (const [label, num] of INDEX) if (!pageDef(num, ctx)) errors.push(`index: ${label} points at ${num}, which is not a page`)

  return { errors, warnings, pages: count }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const json = process.argv.includes('--json')
  const r = await lint()
  if (json) console.log(JSON.stringify(r, null, 2))
  else {
    for (const w of r.warnings) console.log(`warn  ${w}`)
    for (const e of r.errors) console.log(`ERROR ${e}`)
    console.log(`${r.pages} pages drawn; ${r.errors.length} error(s), ${r.warnings.length} warning(s).`)
  }
  process.exit(r.errors.length ? 1 : 0)
}
