# Simplified overview and release recovery

The home screen previously fetched optional country weather, markets and
transport alongside its overview. Production recorded more than twenty waiting
queries in a five-connection reader pool. Individual query benchmarks did not
represent that load. The simplified home requests authentication, the saved
overview and daily briefing; map pins and development rows share one cohort and
the same priority, country, topic and period filters.

Reader query admission now limits optional work and reserves connection room
for the overview and readiness probes. Shared responses remain available during
bounded background refreshes. Event detail returns its essentials first;
surrounding regional context requires `include_context=true`.

V71 builds a durable overview projection in bounded background batches, then
updates changed events through a durable queue. Full-window buckets and counts
are independent of the limited latest-development cards. All six global
snapshots must be complete before the release publishes the new reader/client.

Release `e58f101` passed all 53 Apple tests, compiled iPhone/iPad and Watch, and
distributed TestFlight build **1.0 (1000.0.55)**. Its GKE validation exposed an
acknowledgement bug: PostgreSQL queue timestamps contain microseconds, while
node-postgres converts timestamps to millisecond JavaScript Dates. Round-tripping
the claimed timestamp prevented processed work from being removed. Queue claims
now retain the exact timestamp as text, and acknowledge only the unchanged row.
Ordering still uses the indexed timestamp column. The regression explicitly
uses sub-millisecond queue entries and verifies their removal.

The numeric `coverage.sample_limit` field is retained for already-installed
clients; its value is the complete observed window size, with `full_window=true`
and `truncated=false`. No sampling is reintroduced. Integration tests sharing
the durable singleton/queue run serially to isolate their transaction fixtures.

Validation before the recovery release: 455 API unit tests passed; the corrected
PostGIS overview regression passed. The release pipeline runs the full database
and web suites again before building or deploying application images.

The next run passed validation and image builds but stopped while packaging
migrations: the client-side apply annotation exceeded Kubernetes' 262,144-byte
metadata limit. The run-scoped scripts ConfigMap now uses server-side apply,
avoiding an annotation that duplicated the complete SQL payload. The ConfigMap
data remains below its separate one-MiB limit. No application rollout or V71
execution occurred before this packaging failure.

## External discovery gate follow-up

Run `42892160465` then completed V71, backfilled 183,034 investigations and
published all six views. Live verification returned the priority overview in
391 ms during 24 optional reads, with readiness healthy and event detail in
273 ms. Complete 24-hour counts summed to 2,849 across all 12 buckets; seven-day
counts summed to 67,401 across all 14 buckets. Incremental refresh advanced the
generation timestamp with zero pending work. The release nevertheless rolled
back because both live GDELT discovery paths timed out and the four-hour market
story count was zero, despite verified publisher anchors and archived provenance.

Release readiness now has a distinct, narrow degraded-data decision. Strict
news runtime health remains unchanged. Only recognized upstream discovery
timeouts/429/5xx can permit the live-acquisition/market checks to be degraded;
the exact release-owned successful run, current assessed stories, publisher
diversity, publisher-time anchors, non-GB subject geography and healthy decoded
archive/canonical persistence path must still pass. Missing data, parser/SQL
errors, failed or mismatched runs and unknown failing checks still block release.
The workflow records the degraded condition as a warning and in its summary,
rather than describing the source feed as healthy or rolling back working readers.
