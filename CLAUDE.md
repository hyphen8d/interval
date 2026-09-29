# CLAUDE.md

Guidance for Claude Code (and anyone) working in this repository.

## What this is

INTERVAL is a teletext service for the SIGNAL network, on a simulated colour
CRT. It's a sibling of SIGNAL (`~/Work/signal`, hyphen8d/signal), built on
the same vendored engine and the same habits. Read `README.md` for what a
viewer sees. The governing design test is SIGNAL's, translated: **"Would a
real teletext set have this?"** Remote-control keys, a carousel you wait
on, fastext, REVEAL, HOLD, SIZE, a black-and-white set: yes. A search box, a
scroll bar, a loading spinner: no.

## Commands

No build step, no dependencies.

```bash
python3 tools/dev-server.py 8000   # dev server, no-store; http://localhost:8000
npm test                           # node --test tests/*.test.mjs -- ~16s, no network
npm run lint                       # tools/lint-pages.mjs -- draws every page from fixtures
npm run admin                      # tools/admin-server.mjs -- app + dashboard, port 8081
npm run health                     # tools/check-feeds.mjs -- probe every live source (network)
npm run watch                      # tools/feed-watch.mjs -- one scheduled check; --status
npm run capture                    # tools/capture-fixtures.mjs -- recapture fixtures (network)
npm run stamp                      # tools/stamp.js -- RUN BEFORE EVERY DEPLOY
npm run shoot                      # tools/shoot.mjs -- regenerate screenshots/ (headless Chrome)
```

`node --test tests/` (a directory) finds nothing on this box's Node. List the
files: the npm script uses the shell's glob, and the admin server lists them
itself because `spawn` has no shell.

Useful URL parameters: `?page=NNN` opens a page, `?power=on` switches on
without a keypress (silently: no gesture, no sound), `?rx=0.3` forces
reception, `?remote=1` shows the phone remote on a desktop, `?signal=<url>`
reads a different SIGNAL roster.

## Architecture

`index.html` -> `main.js` (fetches `build.json`, imports everything as
`?v=<stamp>`) -> `src/screen.js` `mount()` -> `program.js` every frame.

**Module identity.** Every app module imports its siblings as
`` await import(`./x.js?v=${V}`) `` with `V = globalThis.INTERVAL_BUILD`. A
bare `import './x.js'` isn't just a second module instance. In the browser it's
cached across a deploy, so a fresh `pages.js` could run against a stale
`teletext.js`. The engine (`src/`) is the exception: it's vendored and
imported bare throughout, as in SIGNAL.

| file | what it is |
| --- | --- |
| `teletext.js` | The page model. `Page` (40x25 cells: char or mosaic, fg/bg of 8 colours, double height, conceal, flash, separated), text folding and wrapping, the palettes, and the bitmaps the engine draws mosaics and double height with. Pure. |
| `carousel.js` | When a page arrives (`nextTransmission`: a fixed slot in a fixed loop per magazine, so the wait depends on where the loop is) and what reception does to it (`receive`). Pure. |
| `feeds.js` | Every source's URL, parser and refresh period, and `FeedCache` (dated keys, stale-after, backoff, warm start from localStorage except weather). Pure apart from `fetch`. |
| `pages.js` | The page map: every page, its magazine, its sources, and `render(ctx) -> Page[]` (one per subpage). This is the equivalent of SIGNAL's `stations.js`. |
| `markup.js` | The `[y]colour [?]hidden[/?] [dh]` markup editorial pages are written in. |
| `editorial.json` | Hand-written content: notice pages, the quiz, the four-keys game, overnight settings. The admin dashboard edits it. |
| `program.js` | The set: power, keys, the carousel wait, reception, overnight, drawing a page onto the tube. |
| `sky.js` | The moon, from the date. |
| `pointer.js` | Touch: screen position to page cell through the CRT's curve, and tap/swipe classification. Pure. |
| `constants.js` | `KEYS` (read by page 199, the tests and `index.html`'s summary) and the colour modes. |
| `sfx.js`, `a11y.js` | The machine's own sounds; the screen-reader live region. |

### The engine's colour plane (2026-09-28)

SIGNAL's tube has one colour at a time: `crt.js` tints the whole screen with a
phosphor uniform, and the per-cell attribute byte is full (BRIGHT through
BG). Teletext needs a foreground and a background per cell, so INTERVAL adds
**one plane** to the vendored engine: `CellGrid.colors`, a byte per cell (fg
low nibble, bg high). `Term.setPalette()` switches the framebuffer to RGBA,
and `CRT({ color: true })` carries RGBA through every pass. Each change is
marked `2026-09-28, INTERVAL` in `src/`. A config without `PALETTE` gets the
monochrome engine byte for byte (`tests/engine.test.mjs` holds both), which
is what makes it offerable upstream. Nothing else needed engine work: mosaics
and double height are `putGlyph()` bitmaps (Terminus has no sextants).

The black-and-white and monitor modes swap to `MONO_PALETTE` (the broadcast
primaries at their luma, so blue on black is ~11%, as it was) and change the
phosphor tint. Mode switches stay within colour mode, so the CRT is never
rebuilt.

### Things that only make sense across files

- **Row 0 belongs to the set.** Pages draw rows 1-24; `program.header()`
  writes row 0 every frame. Reception never garbles it, because real
  headers were Hamming-coded while body text had one parity bit.
- **A page with no data is not on air.** `render()` returns `null` while a
  source has never answered, and the set keeps searching (as a real one did
  for a page the broadcaster wasn't sending). Once a source has *failed*
  with nothing cached, the page is the off-air page, which says why. Stale
  data is always shown, with its age on row 23 in red. Never hide it.
- **Pages are re-sent.** Each time a page's slot comes round, `retransmit()`
  re-renders it (fresh data, the broadcaster's next subpage) and runs one
  reception pass, which repairs some of the damage. HOLD freezes the subpage.
  LEFT/RIGHT step it and hold.
- **Reception is one number** driving both the text errors and the tube
  (noise, snow, beam width, roll): SIGNAL's tuning distance, as reception. It
  comes from the weather at the viewer's location (storms and rain), rare
  interference bursts, or `?rx=`.
- **Station pages are generated.** 511-519 for YM and 521-529 for ZM, in
  frequency order, from SIGNAL's roster. That roster is imported live from
  `https://hyphen8d.github.io/signal/stations.js` (pure data, CORS-open), so
  the listings can't drift from what SIGNAL plays. The secret stations are
  in `SECRET_STATIONS`, not `STATIONS`, and are never listed.
- **Keyboard on a desktop, touch on a phone. No mouse** (2026-09-28). The
  fastext row wasn't read as something to press, so the keys are drawn as
  filled **caps** (`Page.fast`: 9 cells plus a 1-cell gap, dark text, white on
  red), and the index says how to use them. Mouse clicking on the tube was
  built and then removed, because driving the set from the keys is SIGNAL's
  character and a cursor on the picture breaks it. `main.js` ignores
  `pointerType === 'mouse'`. On touch, a tap on a printed page number
  (`Page.pageNumberAt`: a lone `[1-8][0-9A-F]{2}`, so "2026" and "4.5" are not
  links, and nor is a page that isn't carried) or on a coloured key follows it.
  A tap on a set in standby switches it on. A sideways swipe turns the
  subpage, and a vertical one steps the page (`pointer.js` `gesture`).
  `pointer.js` `cellAt` inverts the CRT composite's geometry (fill, aspect,
  barrel curve), and `tests/pointer.test.mjs` runs the warp forwards to check
  the corners. The phone remote's colour buttons carry the current labels
  through the `INTERVAL_FASTEXT` hook (`program.publishFastext`).
- **Subpage timing is per page** (`subpageMs`): 9s by default, and 12-16s on
  pages of running text.
- **Notice pages come from `editorial.json`.** Any free page number works;
  the lint refuses a number a fixed page or a station page uses.
- **The effects queue** (`fxAfter`/`fxTween`) holds everything deferred.
  `powerDown` clears it, and `always` effects (the collapse to standby)
  survive. A 250ms fallback ticker drains it when animation frames stop (a
  covered window reports visible and gets 0fps, as in SIGNAL).
- **Location is never stored.** Only the *answer* (`weatherConsent`) persists.
  The position lives in memory, and the weather feed is `persist: false`. An
  insecure origin is not a refusal (`locationState: 'insecure'`); see SIGNAL's
  `weather.js` for why that difference matters.
- **Overnight** (00:00-06:00, 10 idle minutes, settings in `editorial.json`)
  rotates `OVERNIGHT_PAGES` every 14s and plays the chosen SIGNAL station's
  tracks through the YouTube IFrame API, which is loaded only then. Page 888
  shows what's playing. Any page key stops it.
- **Hidden pages**: 1AF (engineering test card, all colours and mosaics) and
  1FF (FOUR KEYS, a quiz answered with the fastext keys). They're marked
  `hidden` in `pages.js`, so they're kept off the index and out of UP/DOWN. A
  remote can't key hex, and only a keyboard can. Keep them off the index and
  out of README specifics; the README says only that such pages exist.

## Sources

All keyless and CORS-open, checked live with an `Origin` header (Node only
shows CORS headers when a request carries one). **Measured before built on:**
the pitch had "In the news" coming from Wikipedia's featured feed, which has
had no `news` key on any date sampled back to 2025. Page 101 reads the
action API's parse of `Template:In_the_news` instead, and `parseITN` cuts
off the template's transcluded documentation.

**News is two full screens** (2026-09-28). "In the news" alone is four or five
short items, which made 101 one screen, or one screen plus a single story on a
second. So 101 leads with those, then fills out from Wikipedia's **Current
events portal** (feed `events`: today's page in UTC, then yesterday's, since
today's is thin early on). Each item becomes a brief of its first sentence,
anything telling the same story as a top item is dropped (`sameStory`: two
shared names), and briefs that had to be cut off with "..." go last.
`fillPages` packs exactly two subpages, letting a later block fill a gap an
earlier one couldn't. What doesn't fit is dropped, because a headline page is
a selection.

`tests/fixtures/` are real captures (see its README). A fake built from a spec
proves only that you read your own assumption. That's SIGNAL's STATION BREAK
lesson, and it's why the parsers are tested only against captures.
`npm run capture` refreshes them. Tests that assert captured content (a
headline, a sunrise time) will then fail, so update them from what the new
capture actually says, and read the diff first: a changed shape is the finding.

`tools/check-feeds.mjs` runs each live source through the **same parser the
set uses**, so "ok" means the page could be drawn. It also fails a source
that answers without `access-control-allow-origin` (a browser would refuse
it), an empty one, and a K-index more than 12h old. `tools/feed-health.json`
keeps the record (committed); `strikes` counts consecutive failures.
`tools/feed-watch.mjs` notifies only at 2 strikes, so a finding has to be
seen twice (SIGNAL's watch cried wolf for five days before it learned
that). Clean runs say nothing.

## The admin backend

`npm run admin` serves the app and the dashboard (`tools/admin.html`) at
`http://127.0.0.1:8081/admin`. Port 8081 because SIGNAL's admin holds 8080.
It uses SIGNAL's guards for SIGNAL's reasons: loopback by default
(`--host=tailscale` to bind the tailnet; an empty `--host=` is an error),
a Host-header allowlist, an `X-Interval-Admin` header on every mutating route,
and a **static allowlist** (`servable()`), with a second copy in
`dev-server.py`. Change one, change both: `tests/admin-server.test.mjs` runs
the same must-serve and must-refuse lists against both, and uses `http.request`,
because `fetch` silently drops a custom Host header. The only writable file is
`editorial.json`. Saves are linted first and refused on any error, written
via a dot-prefixed temp file and rename, and normalised to the shape the set
reads.

The dashboard imports `pages.js`/`teletext.js`/`feeds.js` itself and rasterises
previews cell for cell as `src/term.js` does, from the same font, so a preview
is what the tube shows minus the glass. Its live data is the browser's own
fetch, so the SOURCES tab's "this browser" column is a real CORS test. SHIP is
stamp -> lint -> suite (-> probe) -> `git add -A` -> commit -> push. With no
upstream it commits locally and says so.

A route-code change needs a server restart; `admin.html` and the lint rules
don't (the lint is imported mtime-keyed). `tools/interval-admin.service` and
`tools/interval-feeds.{service,timer}` are **reference copies, not
installed**. Their comments say how.

## Tests

`tests/harness.mjs` boots the real `program.js` against a real `Term` and font
on a fake clock (`h.advance`, `h.settle` for anything waiting on a promise),
with fixture-backed `fetch`, a fake YouTube player, and SIGNAL's roster from
`tests/fixtures/signal-stations.json`. `h.row(y)` reads the grid (bitmap cells,
including double-height text, read as `#`), and `h.page()` reads the page as
sent. `tests/keys.test.mjs` presses every entry in `KEYS` and fails if the
screen doesn't change.

**Mutate to check a test can fail.** Every behaviour above was broken on purpose
once (instant arrival, a garbled header, listed secrets, a stored position, no
overnight auto-start, stale data shown as fresh), and the right tests went red.
The first mutation script counted nothing, because Node's default reporter isn't
TAP here. Use `--test-reporter=tap` when parsing output.

## Conventions

- **Comments are the design record**, as in SIGNAL: what was tried, what broke,
  and why this shape won, next to the code it governs.
- Run `npm run stamp` before every deploy (SHIP does it).
- Fastext labels are at most 9 characters. At 10, a label runs into the next
  one, and the lint holds this.
- `screenshots/` comes from `npm run shoot` against the **local** admin server.
  Headless Chrome renders a few frames a second, so a page change or a subpage
  turn ghosts through the phosphor persistence. Settle on frames, and HOLD
  before capturing a page that has subpages.
- Verify feel in a real browser too, and count frames first (a covered window
  runs at 0fps and reports visible).
