# Event performance and retained imagery, 2 November 2026

## Production diagnosis

API and web were running release `15cd3ba5d916ed019db352d5731e0d8012bc0bfd`
with database migrations through V64. The event feed shown failing in the
screenshot reaches the 15-second statement timeout. In an eight-hour API log
sample, 27 slow event-feed queries averaged 14.1 seconds; the assessment
candidate scan averaged 7.8 seconds across 479 logged executions, with 69
assessment statement timeouts. Pool waiters reached 27. These observations
support reducing database work before increasing instance or pool sizes.

The API also had four restarts and readiness/liveness timeouts. Its last exit
was 137, reported as `Error`, rather than `OOMKilled`. This investigation does
not establish the cause of those restarts.

## Changes

- V65 maintains a narrow, transactionally synchronized event-feed projection.
  Ranking scans its scores, filter fields and two metadata keys; only the
  selected page reads full summaries, provider metadata and geometry. One
  correlated evidence aggregate supplies both eligibility and news priority.
  V68 adds a covering evidence index concurrently, with safe rebuild on retry.
- V67 replaces repeated historical assessment scans with indexed due work,
  small source/event invalidations, revision-checked completion, scheduled age
  boundaries and a resumable bounded methodology-backfill cursor. Event fan-out
  runs outside ingestion transactions.
- Web defers seven secondary requests, stops hidden-tab polling, coalesces
  polling and retains loaded event content during recoverable refresh failures.
  The detailed map atlas loads on demand; unused country-reference fields are
  removed at build time. Native image reads share downloads in a session-scoped
  16 MB memory cache for five minutes and decode/downsample off the main actor.
- Event detail returns up to three previously stored natural-colour satellite
  images and three publisher previews as `context_images`. Satellite reuse
  requires the retained render AOI to contain the event location. Article reuse
  requires the same specific canonical place; country-only matches are excluded.
  Dates, attribution, licence, original investigation and uncertainty notices
  remain visible. Reuse never adds evidence or changes event confidence.
- Image context reads fetch metadata only, perform no provider downloads, reuse
  existing bytes and preserve expiry. Article previews retain the existing
  14-day default; `NEWS_IMAGE_RETENTION_DAYS` optionally sets 1–30 days for new
  objects. Existing EO retention remains unchanged. Direct NASA GIBS browse
  imagery remains available through its existing route.

## Measurements and verification

A production benchmark used one repeatable-read, read-only snapshot and a
session-local temporary projection of 62,934 recent events. Returning 100 events
took **13,849 ms before and 1,325 ms after**, approximately 90% less query time.
Complete returned rows and ordering matched exactly. Creating the temporary
projection took 5,466 ms; that is separate from the reader measurement. The
new covering index was absent during this comparison. Warm caches and changing
load mean this result is not a promise of end-to-end latency or a production
rollout verification. No production schema, application data or deployment was
changed by the benchmark.

Real PostGIS validation uses a separate, ephemeral database with the complete
migration sequence. Coverage includes projection synchronization/deletion,
assessment revisions and invalidations, imagery AOI containment, expiry,
deduplication and unchanged evidence. Web regressions cover hidden-tab polling,
account/scope cancellation, refresh retention and context-image provenance.

All 68 migrations apply to a fresh PostGIS 16 database. All 423 API unit tests
and 24 integration tests pass on Node 20.20.2; API TypeScript compilation passes.
All 157 web tests, the production build and lint pass (two existing lint
warnings, no errors). The web's initial main/preloaded JavaScript decreases
from approximately 779 KB to 437 KB gzip, a 44% reduction.

Apple source syntax and project validation run locally. Full Xcode/device
validation is unavailable on this host; installed Swift package tooling also
fails before tests run. Browser automation reports its access host unavailable.
These checks do not establish device-wide smoothness.

## Rollout

These changes are prepared in the workspace; the live release remains
`15cd3ba5d916ed019db352d5731e0d8012bc0bfd`. No production migration or rollout
was performed during this investigation. The isolated validation pod is removed
after checks.

Release schema and API/web through the existing GKE pipeline. V65 executes
outside a surrounding transaction, committing its trigger installation before
the backfill so its table-level DDL lock does not cover the historical scan.
It bounds lock waits to five seconds and supports retry. Backfill locks copied
parent keys against deletion and keeps a racing trigger's newer projection.
V68 runs concurrently and recreates its owned index on retry. Reader rollout
must follow successful migrations.

Watch event-feed latency, statement timeouts, connection waiters, assessment
queue/backfill progress and probe failures after release. The temporary-table
benchmark is a comparison of query work, not an observation of the released
service. Build and distribute the Apple clients through their existing CI,
then check iPhone/iPad/Watch navigation, imagery, memory and scrolling on devices.
