// INTERVAL -- assemble the public site into _site/ for GitHub Pages.
//
//   node tools/build-site.mjs [--out=_site]
//
// Run by .github/workflows/pages.yml. The site is the app's files and
// nothing else: the same allowlist the dev and admin servers serve from
// (tools/admin-server.mjs servable()), minus tools/ -- the dashboard has no
// backend on Pages, and the tools are not the site. A working tree is not a
// website: this is what keeps the next file dropped into the repo root off
// the public internet unless someone means it to be there.

import { readdirSync, statSync, mkdirSync, copyFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.resolve(ROOT, process.argv.find(a => a.startsWith('--out='))?.slice(6) || '_site')
process.env.INTERVAL_ADMIN_IMPORT = '1'
const { servable } = await import('./admin-server.mjs')

export function siteFiles(root = ROOT) {
  const out = []
  const walk = (rel) => {
    for (const name of readdirSync(path.join(root, rel))) {
      const r = rel ? `${rel}/${name}` : name
      if (name.startsWith('.') || name === 'node_modules' || name === '_site') continue
      const st = statSync(path.join(root, r))
      if (st.isDirectory()) { if (!rel && ['fonts', 'src', 'screenshots'].includes(name)) walk(r); continue }
      if (r.startsWith('tools/')) continue
      if (servable(r)) out.push(r)
    }
  }
  walk('')
  return out.sort()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  rmSync(OUT, { recursive: true, force: true })
  const files = siteFiles()
  for (const f of files) {
    mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true })
    copyFileSync(path.join(ROOT, f), path.join(OUT, f))
  }
  // No Jekyll: Pages would otherwise ignore anything it considers private.
  writeFileSync(path.join(OUT, '.nojekyll'), '')
  if (!existsSync(path.join(OUT, 'markets.json'))) console.warn('note: no markets.json in the site -- page 401 will be off air until one is built')
  console.log(`_site: ${files.length} files`)
}
