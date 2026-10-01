# Fixtures

Captured from the live services on 2026-09-28, with an `Origin` header, by
curl -- not written from their documentation. SIGNAL's rule, from the
STATION BREAK that shipped twice: a fake built from what you assume a service
returns proves only that you read your own assumption correctly. These are
what the services actually returned, trimmed for size (long lists cut short,
unused fields dropped) and otherwise untouched.

| file | source |
| --- | --- |
| wiki-itn.json | en.wikipedia.org action API, parse of Template:In_the_news |
| wiki-current-events.json | en.wikipedia.org action API, parse of Portal:Current_events for 2026_September_28 and _27, keyed by title |
| wiki-onthisday.json | en.wikipedia.org REST, feed/onthisday/all/09/28 (trimmed) |
| open-meteo-cities.json | api.open-meteo.com forecast, twelve US cities in one request |
| open-meteo.json | api.open-meteo.com forecast, 5 days, New York |
| markets.json | tools/fetch-markets.mjs's own output: FRED daily closes, eight series, plus the five household series for 402. One hand repair (2026-10-01): the capture's Nikkei history held three zeros, the fetcher reading FRED's empty holiday values as closes; they were replaced with the three earlier closes FRED gives for that window, so the row is what the fixed fetcher makes of the same day. |
| espn-*.json | site.api.espn.com scoreboards, one per league on 601-606 (unofficial, undocumented API) |
| launches.json | ll.thespacedevs.com 2.2.0, upcoming launches, limit 6 |
| holidays-us.json | date.nager.at v3, NextPublicHolidays/US |

Refresh them with `node tools/capture-fixtures.mjs` when a source changes
shape -- and then read the diff, because a changed shape is the finding.

Worth knowing from the capture: the featured feed has had no `news` key on
any date sampled back to 2025, which is why page 101 reads the parse API
instead (see feeds.js).
