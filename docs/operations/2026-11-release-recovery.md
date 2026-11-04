# Reader isolation, overview and release recovery — 4 November 2026

## Incident and release blockers

The 3 November release (`199b4c3`) stopped in validation before building or
deploying application images. A workflow regression test used an API-container
log command as its section boundary. After ingestion moved to a worker, that
boundary disappeared and the test accidentally inspected unrelated later
release gates. The test now uses its containing workflow-step boundary.

Apple CI separately rejected Watch progressive-refresh callbacks whose closure
types lost main-actor isolation. Those fetch/apply callbacks now explicitly
retain `@MainActor`. The web build also required correcting archive test fixtures
to use the actual freshness enum. A stalled-body deadline regression now uses
immediate response headers rather than racing a short deadline against a local
TCP connection on a busy host.

Apple recovery commit: `3d56a5870f6ee8dabf337507b7da358a455ab207`.
GKE recovery commit: `0345d1f6d1b793c4facfa1f94f178f2bf69e5a96`.

The first recovery run passed validation and pushed the Keycloak image, then
exited during immutable-digest resolution before its retries. The resolver now
guards failed inspections, drains complete manifest output before parsing, and
retries invalid or failed results. A shell-level regression covers transient
exit 255, large manifest output and permanent failure. Registry inspection
confirmed that the previously pushed image was present with a valid digest.

- [GKE release](https://github.com/eojgroup/claritas/actions/runs/41799019189)
- [Apple build and distribution](https://github.com/eojgroup/claritas/actions/runs/41797247340)

## Runtime and reader experience

The release separates scheduled ingestion and HTTP readers into two processes,
with independent event loops and five-connection database pools. Development
retains the combined `all` role. Explicit operator ingestion requests can still
perform work in their receiving process; this separation concerns scheduled
workers and daily briefing dispatch.

Daily briefing jobs are durable, serially dispatched by a worker and protected
by a renewable lease. Client polling no longer starts generation on readers.
Queued work is not discarded after five minutes, and source collection admits
two reads at a time rather than queuing eleven behind the connection pool.

Web authentication can finish when the session is ready without waiting for
optional provider discovery. Bounded reads provide retry controls. The new
overview shares a cached response between the summary, map and update timeline.
Topic, location and 24-hour/3-day/7-day scopes retain source and image dates.
Archived events do not contribute to current map relevance. Watch useful
glances publish independently as their responses arrive.

Analytics use at most 300 latest-updated investigations per comparison window,
40 hydrated events and 24 timeline entries. Update times are not incident
occurrence times. When either sample is capped, directional comparisons and
percentage changes are unavailable rather than presented as complete activity
totals. Priority is an explained navigation score, not a probability of impact.

## Retention and capacity

Read-only diagnosis on 3 November found approximately 53 GB of raw transport
tracks and 24 GB of entity/hour history. Maintenance was still processing July
records. Its three-hour cadence could not keep up with continuing writes.

The retention candidate query no longer sorts an entire shared hour by physical
tuple address before its bounded limit. A read-only comparison visited 57,987
rows before returning 5,001 candidates in the old plan, versus 5,001 rows in
the new plan. Timings were 14.146 seconds and 0.133 seconds, respectively; cache
warming and concurrent load prevent interpreting that ratio as a guaranteed
deletion speedup. No production records were deleted by that comparison.

Maintenance now uses 2,000-row batches, at most 20 batches and a ten-second
admission budget every five minutes. A batch already running can exceed the
pass's admission deadline, subject to the database statement timeout. V69 lowers
autovacuum thresholds on the two large tables; V70 indexes overview windows.
Neither change shortens the established retention periods.

The first rollout replaces the larger combined API before creating the worker.
Later reader rollouts retain surge capacity on the existing small egress node.
Rollback removes a newly introduced worker and waits for its termination before
restoring the combined API. This releases its resource reservations and leases.
Current reservations fit the node, but memory headroom remains small and the
single Spot node is still a shared availability boundary.

For the next infrastructure change, prepare a time-partitioned transport-history
cutover and additional reader node capacity. PostgreSQL documents that dropping
or detaching expired partitions avoids row-by-row deletion and its vacuum
overhead. Preserve identities and retained-window results and validate a bounded
backfill before any cutover. See [PostgreSQL 15 partitioning](https://www.postgresql.org/docs/15/ddl-partitioning.html).

Move reader capacity to standard nodes with a second failure domain when
availability warrants the extra recurring capacity. Google provides no
availability guarantee for Spot VMs, so adding application replicas on the same
Spot node is insufficient. See [GKE Spot VM behavior](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/spot-vms).
No paid instance resize, node-pool replacement or historical-table cutover was
performed as part of this recovery.

## Verification

Local verification of the recovery commit passed all 434 API tests and 172 web
tests under Node 20.20.2, API/web builds, workflow lint and Apple project
contracts. The overloaded local host required bounded test concurrency;
production deadlines and test timeouts were not increased.

Before rollout, read-only inspection confirmed production still at V68 and the
previous application release. The 4 November daily briefing had already
published a provider-generated narrative at 05:31:54 UTC, after the previous
day's digest fallback. This establishes that provider recovery occurred; it is
not evidence of a deployed reader/worker split.

After the successful GKE release, API, web and worker revisions matched
`0345d1f` and migrations V69/V70 were successful. Direct runtime reads returned
the overview in 1.2 seconds and a 100-event feed in 1.6 seconds. An event detail
took 5.7 seconds, mainly in country transport context. Explicitly constraining
the two schema-supported transport modes lets that query use the existing
mode/country/time index. A same-snapshot read-only comparison returned identical
Egypt counts in 431 ms versus 22 ms; cache state and concurrent load affect
timings. Occasional reader pool timeouts remain a reason to continue monitoring
and address the infrastructure headroom described above.

## Translation follow-up

The overview and canonical event presentation previously bypassed the saved
`item_translation` records. Cached titles now flow through the overview, event
feed and investigation evidence using a bounded metadata read. Cache keys
include the display language. Original titles, source attribution, generation
dates and pending status remain available; a translated headline does not imply
that its source excerpt is translated.

On 4 November the shared OpenRouter key reported 75 free model requests used,
a daily limit of 50 and zero remaining. The translation worker had reserved six
requests that day, so its local request limit was not the binding constraint.
Queue priority now favours recent visible canonical headlines, retaining
language fairness and existing spending controls. A legacy midnight pause no
longer prevents a bounded five-minute capacity recheck when shared capacity
recovers. Reads never initiate model generation or provider quota requests.
