// INTERVAL -- the page lint. `npm run lint`. Offline: every page is drawn
// from the captured fixtures, so this needs no network and runs in a second.
//
// The rules a page has to keep, mechanically:
//   - nothing is written off the page (the page model records every write
//     past column 40 or into a row that is not there)
//   - every fastext link goes to a page the set can reach, or to one of the
//     set's own actions (locate, the four-keys game, the focus timer, the
//     decider)
//   - every index entry is a page that exists
//   - editorial.json: notice pages on free numbers, titles that fit the
//     masthead, lines that fit the page; four-keys questions with four
//     options and a real answer; facts that fit; thoughts that end above
//     501's candle. The quiz pages are gone (2026-09-28) but their questions
//     stay in the file, so any there are still checked; none are required.
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
export const FASTEXT_LABEL_MAX = 8
export const FASTEXT_LABEL = /^[A-Z0-9&-]{1,8}$/
export const HELP_LABEL_MAX = 28
/** A fact is a glance too: four lines. */
export const FACT_MAX = 160
export const FACT_TAGS = ['TECH', 'GAMES', 'HACKING']

const SPECIAL = /^(locate|sub:next|game:(\d|next|reset)|focus:(start|reset|mode)|decide:(d20|coin))$/

/**
 * @param {object} [o]
 * @param {object} [o.editorial] editorial content to check (default: the file)
 * @returns {Promise<{errors: string[], warnings: string[], pages: number}>}
 */
export async function lint({ editorial } = {}) {
  editorial ??= JSON.parse(readFileSync(path.join(ROOT, 'editorial.json'), 'utf8'))
  const { PAGES, pageDef, pageOrder, INDEX, FACTS_PER_DAY, thoughtRows, THOUGHT_TOP, CANDLE_ROW } = await import('../pages.js')
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
    // 190 is the one fixed page drawn FROM a notice: the welcome.
    if (PAGES.has(num) && num !== '190') errors.push(`${where}: ${num} is already a fixed page (${PAGES.get(num).title})`)
    if (seen.has(num)) errors.push(`${where}: two notices on the same page`)
    seen.add(num)
    if (!n.title) warnings.push(`${where}: no title; the masthead will say NOTICES`)
    if ((n.title || '').length > MASTHEAD_TITLE_MAX) errors.push(`${where}: title is ${n.title.length} long; ${MASTHEAD_TITLE_MAX} fit the masthead`)
    for (const e of lintLines(n.lines || [], { top: 4, bottom: 22, col: 1 })) errors.push(`${where}: ${e}`)
  }
  if (!seen.has('190')) errors.push('editorial: page 190 (WELCOME), where the set lands, has no notice')

  const quiz = editorial.quiz || []
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
      else if (!FASTEXT_LABEL.test(String(o))) errors.push(`${where}: option ${k + 1} "${o}" is also its coloured key's label: one word in capitals, ${FASTEXT_LABEL_MAX} at most`)
    })
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) errors.push(`${where}: answer must be 0-3 (red, green, yellow, cyan)`)
  })

  const facts = editorial.facts || []
  if (facts.length < FACTS_PER_DAY) errors.push(`editorial: DID YOU KNOW (102) shows ${FACTS_PER_DAY} a day and has ${facts.length}`)
  facts.forEach((f, i) => {
    if (!FACT_TAGS.includes(f.tag)) errors.push(`fact ${i + 1}: tag "${f.tag}" is not one of ${FACT_TAGS.join(', ')}`)
    if (!f.text || !String(f.text).trim()) errors.push(`fact ${i + 1}: no text`)
    else if (String(f.text).length > FACT_MAX) errors.push(`fact ${i + 1}: ${f.text.length} long; ${FACT_MAX} read at a glance`)
  })
  const thoughts = editorial.thoughts || []
  if (!thoughts.length) errors.push('editorial: A THOUGHT (501) has no thoughts')
  thoughts.forEach((t, i) => {
    if (!t.text || !String(t.text).trim()) errors.push(`thought ${i + 1}: no text`)
    // Measured as drawn, every thought, not only the fixture day's: the
    // page lint below renders just the one 501 shows on that date.
    else if (THOUGHT_TOP + thoughtRows(t) > CANDLE_ROW) errors.push(`thought ${i + 1}: takes ${thoughtRows(t)} rows with its "by" line; ${CANDLE_ROW - THOUGHT_TOP} fit above the candle`)
    if ((t.by || '').length > 30) errors.push(`thought ${i + 1}: "by" is ${t.by.length} long; 30 fit`)
  })

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
        // One word, capitals, eight at most: the keys read as a set of
        // buttons only when every label has the same shape.
        if (!FASTEXT_LABEL.test(label)) {
          const bad = `${num}: fastext "${label}" must be one word in capitals, ${FASTEXT_LABEL_MAX} letters at most`
          if (!errors.includes(bad)) errors.push(bad)
        }
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
