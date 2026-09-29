# INTERVAL

Teletext on a simulated colour television: bite-sized pages you can put on
and leave to cycle.

![Page 100, the index](screenshots/hero.jpg)

Seven sections, every page readable at a glance:

| | pages |
| --- | --- |
| **News** | 101 headlines, 102 did you know (tech, games, hacking) |
| **Today** | 200 on this day, 201 born today, 202 the clock, 203 coming up (the weekend, the next holiday, the next launch) |
| **Weather** | 300 today with sunrise and sunset, 301 five days (both for where you are), 302 twelve US cities |
| **Money** | 401 world markets at the close, 402 your money (gas, mortgages, inflation, rates, jobs) |
| **Sport** | 601 NFL, 602 NBA, 603 MLB, 604 NHL, 605 Premier League, 606 college football |
| **Pause** | 500 breathe, 501 a thought for today, 502 a focus timer, 503 decide for me (a d20 and a coin) |
| **Gallery** | 700: moonrise, a test card, the sea, a city at night, an aquarium, a lighthouse, the northern lights and a night train |

Press **N** and the set turns its own pages, section by section. **H** keeps
it in the section you're enjoying. Key any page number to go straight there,
and the set waits for your page to come round, the header counting through
the pages as they pass, the way a set did when every page was broadcast in a
loop.

## Using it

Press **P** (or tap, on a phone) to switch on. The set opens on 190, the
welcome page. Then:

| key | does |
| --- | --- |
| 0-9 | key a page number. 100 is the index, 199 is help |
| N | cycle through the sections |
| H | hold the page, or while cycling, the section |
| up / down | next or previous page |
| left / right | step through a page's subpages |
| F1-F4, or Shift+1-4 | the red, green, yellow and cyan links on the bottom row (Shift+1-4 is for keyboards whose F-keys need fn) |
| I | the index |
| C | colour, a black-and-white set, or a green monitor |
| F | full screen |
| Esc | clear a half-keyed number |

On a phone the set comes with a remote control, and you can tap a page
number or a coloured key on the screen, or swipe: sideways for subpages, up
and down for pages. There are pages the index doesn't list. A remote control
couldn't reach them, but a keyboard can.

![Searching: the header counts while the page comes round](screenshots/searching.jpg)

## Where the pages come from

Every source is keyless and open to browsers, because this is a static site
with no server behind it: Wikipedia (In the news, Current events, On this
day), Open-Meteo, ESPN's scoreboards, The Space Devs (launches) and Nager.Date
(holidays). Money is the exception: nothing serves it
to a browser, so the deploy workflow fetches it from FRED twice each weekday
and publishes it with the site. The breathing page, the timer and the dice
are worked out on the set. When a source is late the page says how old its copy is, and
when one fails the page says it's off air. The set never hides either.

The weather needs your location. The set asks when you press red on page
300. Your position is kept in memory for the session and never stored.

## Running it locally

No build step and no dependencies.

```bash
python3 tools/dev-server.py 8000     # then open http://localhost:8000
npm test                             # the suite, headless, no network
npm run admin                        # the admin dashboard, http://127.0.0.1:8081/admin
```

`file://` does not work: the font is fetched, and that needs an origin.

## Credits

The CRT engine is [cyberspace-crt](https://github.com/unremarkablegarden/cyberspace-crt)
(MIT), with a colour plane added here. The font is Terminus (SIL OFL). Page
content belongs to its sources; see NOTICE.
