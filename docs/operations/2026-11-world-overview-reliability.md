# World overview and ingestion reliability, 1 November 2026

## Experience

Investigations now open as event context in World overview. Web keeps the map
and event beside one another on desktop and stacks them at narrower widths.
iPad uses the same map/context arrangement when space permits. iPhone opens
event context in a detented sheet over the map. Watch starts on its World map,
shows country/region-scoped events and hands exact event IDs to iPhone.
Source links, alerts, imagery provenance and uncertainty labels are retained.

The web stream reuses the overview event request rather than loading a second
priority queue. It supports current/archive scope, more events, refresh and
selected-row state. Embedded detail reads only the selected event, its browse
imagery and optional watch state. Exact deep-linked events outside the bounded
overview list are included in map geometry after detail loads. A stream refresh
also refreshes the selected evidence and imagery; new activity from polling
invalidates that detail. The source connection graphic opens its corresponding
evidence records with pointer or keyboard input.

## Reproduced code defects and corrections

- Web map layers with omitted `points` created a new empty array every render.
  The fitting effect then wrote a new view state indefinitely. A stable default
  and unchanged-footprint guard prevent the loop and preserve pan/zoom across
  selection or count-only updates. Behavioral regressions cover both cases.
- An unlayered map `height: 100%` rule overrode explicit Tailwind viewport
  heights. Its default now lives in the components layer. Desktop column spans
  are responsive CSS rules, avoiding implicit columns on tablet web.
- Native progressive data refreshes removed and rebuilt every country polygon.
  Geometry is now reused and only its paint is updated. Country-coverage and
  event failures expose retry actions and retain previously loaded data.
- The shared country-statistics query carried full provider JSON through an
  assessment hash join. Eligibility now materializes narrow IDs before loading
  geographic fragments. Read-only production EXPLAIN ANALYZE reduced temporary
  writes from 20,051 to 953 blocks (95%) and reads from 32,726 to 2,060 blocks
  (94%). Same-snapshot results matched exactly: 81 countries, 19,229 distinct
  stories and 8,728 mapped stories. Runtime was 3.70 seconds for the current
  query versus 3.41 seconds for the candidate under changing worker load; the
  confirmed improvement is spill reduction, not a guaranteed latency ratio.
- The event feed also ranked full metadata, summaries and geometry before its
  page limit. It now ranks narrow rows and joins complete events after LIMIT.
  Same-snapshot production reads returned byte-equivalent results and ordering.
  A measured query fell from 1,256 to 776 ms; temporary writes fell from 2,375
  blocks to zero. These read-only measurements validate the query change; the
  deployed API still uses the old query until release.
- A legacy `GDELT_DOC_QUERY` environment default could bypass the incremental
  minute metadata primary. Only an explicit request query or targeted discovery
  now selects that path; environment defaults still configure DOC fallback.
- Up to 34 metadata objects were downloaded serially with individual eight-second
  timeouts under a 180-second acquisition budget. Three bounded readers leave
  time for persistence without unbounded provider concurrency.
- Every 500-URL lookup repeated canonical-history reconciliation. It now runs
  once per metadata acquisition. Parallel duplicate results retain the earliest
  first-seen timestamp. Record-level persistence failures mark the acquisition
  degraded and preserve the interval for replay.

The degraded state remains meaningful. Upstream failures, incomplete writes,
bounded sampling and absent event geography are not presented as complete or
verified coverage. Runtime diagnostics now expose the acquisition strategy,
primary health, interval/persistence counters and redacted errors; `--latest`
also includes scheduled runs.

## Validation and rollout limits

API TypeScript compilation and all 417 API tests pass, including the exact CI
Node 20.20.2 runtime without a database. The web production build, lint (zero
errors; two existing warnings) and all 150 web tests pass; all web tests also
pass on Node 20.20.2. Coverage includes exact-event context, keyboard source
selection, refresh, scoped stream, archive controls and map regressions. Changed
Swift sources pass syntax parsing. Full Apple builds and device layout checks
cannot run here because Xcode is absent. `swift test` also stops before tests
with a host PackageDescription linker error; syntax parsing is not a substitute
for a native build. Browser visual QA is unavailable because the browser access
host is offline.

## Authenticated production findings

After the user refreshed GCP authentication, read-only inspection confirmed API,
web and OpenCode still on `19b9b6c7174bf4d277127c7c010b2384d9c85ae1`; the latest
database migration is V62. V63/V64 and the incremental metadata primary in HEAD
`c90b39f` have not been released. The news schedule remains every 15 minutes with
the old 25-record limit. Runs 19811–19817 used `degraded_fallback`, with no primary
metadata result; five of six recorded DOC HTTP 429. Run 19817 finished in 76
seconds at 07:50 UTC: 25 publisher headlines plus 380 machine records, rather
than 405 publisher headlines.

[GKE run 40537426821](https://github.com/eojgroup/claritas/actions/runs/40537426821)
failed validation before build/deploy. On Node 20, tsx's ESM and CommonJS loaders
gave unit tests a different database Pool instance from the API. Four tests
escaped their mocks and attempted localhost PostgreSQL. Two test files now use
the API's CommonJS loader; reproducing the old failure and rerunning all 417
tests on CI's exact Node version verifies the repair without adding a database
dependency to unit tests.

Production also has real database work and intermittent queueing: recent event
reads reached 10.35 seconds, assessment scans took roughly 3.1–3.4 seconds and
pool waiting reached three connections. Assessment and event-outbox failures
include statement timeouts; event consumers also recorded deadlocks. This patch
does not replace the assessment worker with a durable queue. The existing HEAD
publisher lookup improvement is also absent from the old deployed release.

The API pod has restarted 20 times; the latest exit was code 137 at 05:09 UTC,
reported as `Error`, not `OOMKilled`. Kubernetes recorded repeated liveness and
readiness timeouts, but direct loopback `/healthz` probes returned 200 in 3 ms
after a 77 ms first probe. There is no evidence sufficient to attribute those
restarts to a specific parser or database query.

[Apple run 40537426840](https://github.com/eojgroup/claritas/actions/runs/40537426840)
compiled the earlier HEAD iPhone/iPad/Watch clients and uploaded its IPA, then
failed on an App Store Connect betaGroups HTTP 500. That does not validate the
new local UI changes or confirm TestFlight group availability.

These changes remain local; no production data, configuration or workloads
were mutated during diagnosis. Release through the existing pipeline, then
inspect the latest exact-release scheduled news run using
`infra/scripts/news-runtime-diagnostics.cjs --latest` from the API runtime.
Verify `incremental_gal_metadata`, recent intervals, accepted multilingual
headlines and absence of repeated canonical reconciliation. Compare country
statistics and event-read latency, query plans and pool waits under concurrent
reads. Release API/web through the existing pipeline and validate iPhone, iPad
and Watch builds through Apple CI; check event/source navigation, map loading,
Dynamic Type and both themes before claiming device-wide recovery.
