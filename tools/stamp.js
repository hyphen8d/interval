// Bumps build.json, the stamp main.js reads on every load. RUN BEFORE EVERY
// DEPLOY (SHIP in the admin dashboard does it for you). Every app module is
// imported as ?v=<stamp>, so without a bump GitHub Pages' ten-minute cache
// can hand a returning visitor the old build. See SIGNAL's tools/stamp.js
// for the history of the scheme; this is the same file.
//
// Format: YYYY-MM-DD.N, N counting up within a day. Nothing parses it.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build.json')
let prev = ''
try { prev = JSON.parse(readFileSync(file, 'utf8')).build || '' } catch (e) {}
const today = new Date().toISOString().slice(0, 10)
const [prevDay, prevN] = prev.split('.')
const build = `${today}.${prevDay === today ? Number(prevN || 0) + 1 : 1}`
writeFileSync(file, JSON.stringify({ build }) + '\n')
console.log(`build.json: ${prev || '(none)'} -> ${build}`)
