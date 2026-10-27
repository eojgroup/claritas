# Mobile performance and ingestion recovery, 27 October 2026

Production inspection found two connected failures behind the screenshots:

- Social runs failed with PostgreSQL `57014` after approximately 18 seconds.
  Acquisition ended by deleting every expired social post. Each deletion ran
  `expire_social_investigation_source`, whose canonical-evidence lookup had no
  matching expression index. There were 49,502 expired posts out of 61,242;
  the 15-second statement timeout rolled the whole cleanup back. The general
  automation worker retried the same cleanup every 30 seconds, contributing
  to database pool pressure and unrelated worker connection timeouts.
- The API container had restarted nine times. Its previous logs ended with
  an unhandled `TLSSocket` error, `EADDRNOTAVAIL`, while verifying a publisher
  page through a public IPv6 address. The verification DNS selector took the
  first public answer rather than preferring an available public IPv4 answer.
  A crashed process left its news run marked running until the three-hour
  automation timeout. Runs 19149 and 19155 show this failure pattern.

The fixes add a concurrent canonical-evidence index (V62), commit social
retention in batches of 100, and give maintenance failures a five-minute
backoff. Retention runs independently of provider acquisition, so a cleanup
problem cannot erase successful provider totals or misreport an HTTP failure.
Expired social records remain excluded by social read paths during backlog
draining. The retention trigger continues removing copied social evidence.

Publisher verification now prefers a vetted public IPv4 answer when present,
uses an asynchronous pinned lookup callback, and handles socket errors through
teardown. A failed publisher remains unavailable evidence. Runs whose
heartbeats stop recover after five minutes instead of waiting three hours.

Additional load reductions retain the existing event outbox and consumers:

- Institutional RSS stores ETag/Last-Modified validators in `source_feed`.
  A 304 skips item processing; validators advance only after persistence.
- Social acquisition has a shared two-minute budget, avoids repeatedly calling
  blocked AppViews, bounds individual AppView requests, and records sanitized
  per-query failure diagnostics. Bluesky passes the requested lookback as
  `since`, reducing already-out-of-window results.
- Scheduled news defaults to acquisition only. The independent translation
  worker discovers pending persisted items; explicit administrator translation
  settings remain supported. Event-specific social query discovery and
  correlation failures no longer discard available provider acquisition.

Validation includes a TypeScript build and behavioral tests covering the
publisher socket failure, public address selection, retention isolation and
batch bounds, AppView circuit breaking, and RSS validator safety. Production
verification after rollout should check API restart count, new social run
totals, the retention backlog, and the disappearance of repeated 15-second
social cleanup timeouts. GDELT DOC may still return upstream 429; its reviewed
rolling RSS fallback preserves degraded coverage rather than inventing a
successful DOC response.

## Reader experience and request load

Production logs also showed 15 queued database requests, event reads taking
approximately 3–5 seconds, weather reads taking 5.6 seconds and market reads
taking 8.6 seconds. These are baseline observations, not measurements of the
new code. Shared provider/event reads now coalesce concurrent work and use
bounded caches (10 seconds for events, 15 for news and 30 for other workspace
data). Authentication, roles and paid access are still checked for each
request. Session activity telemetry writes at most once per minute instead
of updating the same session row for every parallel read.

The iPhone and iPad startup publishes resources independently, allowing the
map, briefing, news and weather to appear before slower resources finish.
Concurrent identical native GETs share the in-flight request without caching
responses; requests from different authentication scopes remain separate.
Generation and request checks reject results from an old session or scope.

Both clients start news archives with one bounded page and offer an explicit
Load more action. The previous web archive path could issue 150 consecutive
requests and load 30,000 stories before displaying the result; the native
path waited for up to four pages. Pagination preserves counts and filters,
deduplicates appended records and keeps existing results when an append fails.

Overview retains a compact priority preview. Source lenses no longer repeat
the full priority queue; Investigate remains the full event workflow. Phone
news rows align publisher/time/place with the headline, use a small Related
signals action, and expand for summaries and original sources. Secondary
phone analytics, filters and evidence expand on demand; iPad retains its
expanded review layout. Admin shows recent runs first with bounded history.
The existing semantic palette is preserved across web, iPhone, iPad and Watch.

Web workspace code loads when its destination opens. The main JavaScript
bundle fell from 664.44 kB to 425.43 kB (about 36%); the gzip size fell from
157.27 kB to 102.89 kB. API and web builds pass, with 396 API tests and 144 web
tests passing. Five native resource-loading behavior checks pass; native
models/API client compile, the app model type-checks with temporary platform
adapters, and changed Swift sources pass syntax validation. Full Apple builds
and device layout verification require Xcode, which is unavailable locally.

These changes have not been deployed. Rollout requires V62, the API and web
release, and a new native build. After rollout, verify fresh social/news runs,
retention backlog reduction, stable API restart count, read latency under
concurrent load, and phone/tablet layouts with Dynamic Type and both themes.
