# CLAUDE.md

Guidance for Claude Code (and anyone) working in this repository.

## What this is

INTERVAL is teletext on a simulated colour CRT: **bite-sized pages you put on
and leave to cycle**. It's a sibling of SIGNAL (`~/Work/signal`,
hyphen8d/signal), built on the same vendored engine and the same habits, but
it no longer links to SIGNAL at all (2026-09-28). Read `README.md` for what a
viewer sees.

**The brief (2026-09-28, from the owner) outranks everything below:** every
page is glanceable, readable in about ten seconds; the set is something you
switch on and let cycle; and if you want more, you go and find it elsewhere.
A page that needs *reading* doesn't belong here. That's why story pages, the
most-read list, Hacker News, the article of the day and the SIGNAL listings
were all built and then removed the same day. Under that brief, SIGNAL's
design test still applies, translated: **"Would a real teletext set have
this?"**

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
npm run markets                    # tools/fetch-markets.mjs -- markets.json for local use (network)
npm run build                      # tools/build-site.mjs -- the public site into _site/
npm run shoot                      # tools/shoot.mjs -- regenerate screenshots/ (headless Chrome)
```

`node --test tests/` (a directory) finds nothing on this box's Node. List the
files: the npm script uses the shell's glob, and the admin server lists them
itself because `spawn` has no shell.

Useful URL parameters: `?page=NNN` opens a page, `?power=on` switches on
without a keypress (silently: no gesture, no sound), `?rx=0.3` forces
reception, and `?remote=1` shows the phone remote on a desktop.

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
| `feeds.js` | Every source's URL, parser and refresh period, and `FeedCache` (dated keys, stale-after, backoff, warm start from localStorage except weather; a copy saved by another build is shown but refetched at once, since an old parser made it). Pure apart from `fetch`. |
| `pages.js` | The page map: every page, its magazine, its sources, and `render(ctx) -> Page[]` (one per subpage). This is the equivalent of SIGNAL's `stations.js`. |
| `markup.js` | The `[y]colour [?]hidden[/?] [dh]` markup editorial pages are written in. |
| `editorial.json` | Hand-written content: notice pages (190, the welcome, among them), the quiz, the four-keys game, and the thoughts for 501. The admin dashboard edits it. |
| `program.js` | The set: power, keys, the carousel wait, reception, cycling, drawing a page onto the tube. |
| `pictures.js` | The moving pictures: the switch-on ident, the clock's digits, the candle, the living gallery (the aquarium among it), the launch arc, rain and snow. Pure functions of time. |
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
  `creditText` never clips the time; it drops "SOURCE:" and then the label
  first. A source that answers with nothing still gets a page that says so
  (`render()` never returns `[]`), and a render that throws is the set's
  `faultPage`, off air with the reason (2026-10-01).
- **Pages are re-sent.** Each time a page's slot comes round, `retransmit()`
  re-renders it (fresh data, the broadcaster's next subpage) and runs one
  reception pass, which repairs some of the damage. HOLD freezes the subpage.
  LEFT/RIGHT step it and hold.
- **Reception is one number** driving both the text errors and the tube
  (noise, snow, beam width, roll): SIGNAL's tuning distance, as reception. It
  comes from the weather at the viewer's location (storms and rain), rare
  interference bursts, or `?rx=`.
- **The seven sections** are `pages.js` `SECTIONS`: news (101-102), today
  (200-203), weather (300-302), money (401-402), pause (500-503), sport
  (601-603) and gallery (700, eight pictures), each a single magazine, in
  page-number order (the index once read 401, 601, 500). The index is drawn
  from the same list, and so is cycling.
- **Cycling is manual.** N starts it; the set never cycles by itself (a test
  holds that). It shows every page of a section, then the next section, round
  all seven. Each page stays up long enough for its subpages (12-36s,
  `cycleDwell`), and the breathing page for two full breaths. H while cycling
  holds the *section*; otherwise H holds the page. Keying a page, or a coloured
  key, or Escape on the search it made, stops it. A page whose source hasn't
  answered in `FEED_WAIT_MS` (15s) is passed over, and a section with nothing
  to show is skipped (`cycleFind`); with nothing anywhere, N says NO PAGES.
  While it runs, row 24 is a strip ("CYCLING NEWS  H HOLDS  N
  STOPS") and the coloured keys are hidden. The weather pages that would only
  ask for a location are skipped until the set has one, and so are pages
  marked `noCycle` (the focus timer and the decider, 502 and 503: pages you
  use, not watch) and a league
  with no games this week (`cyclePages`). There is no music;
  the SIGNAL-station soundtrack went with the overnight mode it came from.
- **Switching on** (2026-09-28): a bright line that widens and opens (the
  tube warming); the decoder reporting in a line at a time with a tick each
  (`bootLines`, `drawPost`, `sfx.playBootTick`, after SIGNAL's POST: values
  read from the real page store and sources, never typed in); then the
  INTERVAL ident assembling in block letters to a three-note chime
  (`sfx.playChime`), about 5s in all (`BOOT_MS`). The first cut skipped the
  readout and was over in 2.4s, before it registered. The sources are asked
  for from the first frame of it, so the wait is also a fetch. The ident stays
  up under the searching header until the first page lands. Any key skips it;
  a number keyed to wake the set skips it outright. A quiet start
  (`?power=on`) has no ident and no sound. Sounds: a rubbery remote thunk on
  every key, and a soft relay tick (`playPageTick`) when a page lands from a
  search, not when a page merely comes round again.
- **The wait is short** (`MAG_PERIOD_MS` 900: 0.3-1.2s). At 2.6s it read as
  slow rather than charming. Keep the count visible; never make it a wait.
- **Pages that move** declare `liveMs` and draw from `pictures.js`: breathe,
  the clock (202, big seven-segment digits and six cities' times), the
  candle under A thought (501), the gallery (700: the moon rises, windows go
  on and off, the sea rolls, fish swim, a lighthouse turns, the northern
  lights drift, a night train crosses every forty seconds), rain, snow and storms on the
  weather pages, and ten-close bar charts on 401 (built by the workflow into
  `markets.json` `history`). The rule: they move *slowly*. A candle drawn in
  three colours broke into fragments, because a cell holds one; two work.
  `cycleMs` overrides how long cycling stays on a page (breathe 32s).
  **The gallery draws only the picture on screen** (`ctx.env.sub`); the other
  seven are drawn once at a fixed moment and reused. All eight every 200ms was
  ~16ms a time in Node, most of a frame on the Mac mini. The pictures work
  around the one-ink-one-paper cell: the lighthouse's bands are whole cell
  rows, and the night train's black body is the cells' paper (`trainSpan`
  feeds the bgFor), because windows, body and valley are three colours.
- **The index (100)** is the map and nothing else: it needs no source and
  never moves. Its NOW line (the Dow, a temperature, a score) was removed
  2026-10-01 to clear space. Sections have a blank row between them; sport is three to a row
  (`perRow`). The masthead says INDEX, since the header already says
  INTERVAL. Any change to SECTIONS shows up here, so look at the page after.
- **Pages you hold** (2026-09-28, the owner's ask: "pages people hold
  because they are useful"). **502 Focus**: a 25/5-minute timer on the
  fastext keys (START/PAUSE, RESET, BREAK/WORK). It lives on the program
  (`this.focus`, `focusTick`), not the page, so it keeps running on other
  pages, and when it ends it chimes, says so in the header and announces it.
  Switching off pauses it, so it never runs out unseen and chimes at the next
  switch-on.
  **503 Decide**: red rolls a d20, green flips a coin; the result is fixed
  when the key is pressed and the tumble (`ROLL_MS`) is only a show of it.
  **203 Coming up** ticks three countdowns (the weekend, the next US holiday
  from nager.date, the next launch from thespacedevs). `countdown()` shows
  "4D 03:32:58": the first cut counted hours to 99, and "99:32:58" read as a
  clock. (An ISS tracker, 204, was built and removed the same day.) **300**
  carries a sunrise/sunset
  line (`sunInfo`). **402 Your money** is gas, the 30-year mortgage,
  inflation, the Fed rate and unemployment, from the same `markets.json`
  (`household`); up is red on every row, since up is bad news for all five.
- **Sport** (601-603: NFL, NBA, MLB; NHL, the Premier League and college
  football were dropped 2026-10-01, and their numbers are free)
  is one scoreboard page per league from ESPN's `site.api.espn.com`, which is
  **unofficial and undocumented** and could change without notice; the
  capture is the only spec (`tests/fixtures/espn-*.json`). A scoreboard with
  a game in progress refreshes every minute (`liveRefreshMs` + `isLive` on the
  feed), otherwise every 15; a game from 15 minutes before its start counts
  as live (`scoreboardLive`). A live copy goes stale on the live period
  (`staleAfter(feed, data)`, `isStale`), so a frozen score shows its age in
  minutes. Pages ask `isStale`; they never work the age out themselves.
  **ESPN refuses headless Chrome** with a 403 (bot
  screening on the `HeadlessChrome` user agent and client hints) while
  answering a real browser and curl; checked 2026-09-28 from the Pages origin
  in a real Chrome, all six answered. `tools/shoot.mjs` overrides the UA for
  that reason, so a headless OFF AIR is the capture tool, not the site.
- **Trimmed 2026-09-28:** the sky, space weather, earthquakes, currencies and
  the quiz pages. The quiz content stays in `editorial.json`. On this day and
  Born today are six screens each (`pickEvenly`). 302 is twelve US cities, then
  (subpage 2, 2026-10-01) twelve world cities, London to Tokyo, all in one
  Open-Meteo request (`CITIES`, `world` flag), so the weather section cycles
  without a location.
- **The set lands on 190, the welcome,** every time it's switched on (not the
  last page), off and on again included: `powerDown` forgets the page.
  `?page=` opens where it points on the first switch-on only.
- **Subpages count from arrival,** so a page always opens on its first screen.
  The first version followed the broadcaster's clock and opened a twelve-fact
  page at fact seven.
- **Moving pages** (`liveMs`: breathe, the clock, the candle and others) are
  re-drawn in place between transmissions, without a reception pass.
- **Keyboard on a desktop, touch on a phone. No mouse** (2026-09-28). The
  fastext row wasn't read as something to press, so the keys are drawn as
  filled **caps** (`Page.fast`: 9 cells plus a 1-cell gap, dark text, white on
  red), and the index says how to use them. Mouse clicking on the tube was
  built and then removed, because driving the set from the keys is SIGNAL's
  character and a cursor on the picture breaks it. `main.js` ignores
  `pointerType === 'mouse'`. On touch, a tap on a printed page number
  (`Page.pageNumberAt`: a `[1-8][0-9A-F]{2}` with a space or the row's edge
  each side, one closing punctuation mark allowed, so "2026", "4.5", "1,200"
  and "102/85" are not links, and nor is a page that isn't carried; pages
  drawn from data set `Page.links = false`, for "S&P 500" and a score of
  101, so only 100, 190, 199, 1AF and notices link) or on a coloured key follows it.
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

**News is short bits.** 101 is two screens of briefs: "In the news" first,
then Wikipedia's **Current events portal** (feed `events`: today's log in UTC,
then yesterday's), each item cut to its first sentence, anything retelling a
listed story dropped (`sameStory`), and politics before conflicts within a
day. `fillPages` packs exactly two screens. A second pass (a headline index
plus a page per story, 111-129) was built and removed the same day as "too
much": see the brief at the top.

**Money has no crypto, and its markets are built, not fetched.** Crypto was a
choice. Index levels have no source a browser can read (Yahoo and Nasdaq answer
without CORS; the rest need keys), so `tools/fetch-markets.mjs` fetches FRED's
daily closes (Dow, S&P 500, Nasdaq, Nikkei, VIX, 10-year yield, WTI, Brent;
no FTSE or DAX, which FRED can't carry) in the **deploy workflow** and
publishes `markets.json` beside the site. Page 401 reads it like any feed,
shows each row's own close date, and says so if the file hasn't been rebuilt
in three days. `check-feeds` probes the live copy, so a stopped schedule shows
up as a failing source. `markets.json` is gitignored: run `npm run markets`
for a local copy. FRED marks a day with no value with an empty field now
(once "."), and `+''` is 0, so `fredRows` drops both. A series that fails is
carried over from the live copy (`--previous`, `carried: true`, its own
date), and if nothing answers, the live file is republished as it was:
a Pages deploy replaces the whole site, so a run without markets.json would
delete the last good one. The same run builds 402's `household` series; inflation is
worked out from the CPI index as a twelve-month change (`yoyFromCsv`, which
matches each month to the same month a year before, by date). `parseMarkets` must carry `household` through:
the first cut dropped it and 402 said "not in the last build" against a
build that had it, since its page tests read around the parser.
**Did you know** (102) is a
curated list of short tech, gaming and hacking facts in `editorial.json`,
eight a day, a different eight each day. Wikipedia's own DYK was too deep and
can't be steered to a subject. **Pause** is local or editorial.

`tests/fixtures/` are real captures (see its README). A fake built from a spec
proves only that you read your own assumption. That's SIGNAL's STATION BREAK
lesson, and it's why the parsers are tested only against captures.
`npm run capture` refreshes them. Tests that assert captured content (a
headline, a sunrise time) will then fail, so update them from what the new
capture actually says, and read the diff first: a changed shape is the finding.

`tools/check-feeds.mjs` runs each live source through the **same parser the
set uses**, so "ok" means the page could be drawn. It also fails a source
that answers without `access-control-allow-origin` (a browser would refuse
it) and an empty one. `tools/feed-health.json`
keeps the record (committed); `strikes` counts consecutive failures,
and a source no longer in `FEEDS` is pruned on every write.
`tools/feed-watch.mjs` notifies only at 2 strikes, so a finding has to be
seen twice (SIGNAL's watch cried wolf for five days before it learned
that). Clean runs say nothing.

## Deploying

GitHub Pages, **built by Actions** (`.github/workflows/pages.yml`), not served
from a branch. The workflow runs on every push to main and twice each weekday
on a schedule. It fetches the market closes, assembles `_site/` with
`tools/build-site.mjs` (the servers' static allowlist minus `tools/`, so a
stray file in the working tree never goes public), and deploys it. Run
`npm run stamp` before pushing an app change (SHIP does it). A scheduled run
doesn't restamp, because only `markets.json` changed and the set fetches that
like a feed.

## The admin backend

`npm run admin` serves the app and the dashboard (`tools/admin.html`) at
`http://127.0.0.1:8081/admin`. Port 8081 because SIGNAL's admin holds 8080.
It uses SIGNAL's guards for SIGNAL's reasons: loopback by default
(`--host=tailscale` to bind the tailnet; an empty `--host=` is an error),
a Host-header allowlist, an `X-Interval-Admin` header on every mutating route,
and a **static allowlist** (`servable()`), with a second copy in
`dev-server.py`. Root JSON is allowed **by name** (build.json,
editorial.json, markets.json), never by extension: SHIP's `git add -A` and
the site build would otherwise carry a stray secrets file out. LICENSE and
NOTICE are allowed by name too. Change one, change both: `tests/admin-server.test.mjs` runs
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
with fixture-backed `fetch`. `h.row(y)` reads the grid (bitmap cells,
including double-height text, read as `#`), and `h.page()` reads the page as
sent. `tests/keys.test.mjs` presses every entry in `KEYS` and fails if the
screen doesn't change.

**Mutate to check a test can fail.** Every behaviour above was broken on purpose
once (instant arrival, a garbled header, listed secrets, a stored position, no
stale data shown as fresh), and the right tests went red.
The first mutation script counted nothing, because Node's default reporter isn't
TAP here. Use `--test-reporter=tap` when parsing output.

## Conventions

- **Comments are the design record**, as in SIGNAL: what was tried, what broke,
  and why this shape won, next to the code it governs.
- Run `npm run stamp` before every deploy (SHIP does it).
- Thoughts (501) must end above the candle: the lint measures each one as
  drawn (`thoughtRows`), not by a character count.
- Fastext labels are at most 9 characters. At 10, a label runs into the next
  one, and the lint holds this.
- `screenshots/` comes from `npm run shoot` against the **local** tree, never
  the deployed site. The default URL is the admin server on loopback; the
  running admin binds the tailnet, so on the dev box pass
  `--url=http://127.0.0.1:8090/` (the dev server). Every file there is made
  by a recipe; a shot no recipe makes is an orphan of a removed page and
  goes. Headless Chrome renders a few frames a second, so a page change or a subpage
  turn ghosts through the phosphor persistence. Settle on frames, and HOLD
  before capturing a page that has subpages.
- Verify feel in a real browser too, and count frames first (a covered window
  runs at 0fps and reports visible).
