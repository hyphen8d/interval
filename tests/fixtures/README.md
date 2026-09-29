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
| wiki-featured.json | en.wikipedia.org REST, feed/featured/2026/09/28 (tfa + mostread, trimmed) |
| usgs-4.5-day.json | earthquake.usgs.gov summary/4.5_day.geojson |
| hn-topstories.json, hn-item.json | hacker-news.firebaseio.com v0 |
| swpc-kp.json | services.swpc.noaa.gov products/noaa-planetary-k-index.json |
| open-meteo.json | api.open-meteo.com forecast, 5 days, New York |
| signal-stations.json | SIGNAL's stations.js (hyphen8d/signal), public and secret stations, tracks cut to six each |

Refresh them with `node tools/capture-fixtures.mjs` when a source changes
shape -- and then read the diff, because a changed shape is the finding.

Worth knowing from the capture: the featured feed has had no `news` key on
any date sampled back to 2025, which is why page 101 reads the parse API
instead (see feeds.js).
