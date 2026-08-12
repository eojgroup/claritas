# Cloud SQL capacity and transport load

Claritas runs PostgreSQL 15 on a dedicated-core `db-custom-1-3840` Cloud SQL
instance. The one-vCPU, 3.75-GB shape is the cost-optimized baseline for the
shared application, Keycloak, briefing, market, and transport workloads.

## Connection budget

- One API replica caps its node-postgres pool at five connections.
- The elected transport ingestion worker uses one connection from that
  five-connection budget for the PostgreSQL advisory lock. Four connections
  remain available for request and background work.
- Ingestion automation and the daily briefing scheduler coordinate through
  renewable rows in `background_worker_lease`. They no longer hold a pool
  connection while running queries through the same pool.
- Keycloak starts with one connection and caps its pool at five.
- Migrations and operational access retain capacity outside the normal
  application pools. Do not raise PostgreSQL `max_connections` to address
  slow queries; inspect pool waiters and Query Insights first.

API pool pressure and queries exceeding 750 ms are emitted as structured logs.
Admin ingestion metrics include the current pool maximum, total, idle, and
waiting counts.

## Bounded transport workload

- AIS snapshot sampling: ten minutes.
- ADS-B polling: ten minutes.
- Raw track sampling: ten minutes.
- Raw track retention: three days.
- Stale current-snapshot retention: 14 days.
- Movement-event and per-entity hourly country-presence retention: 60 days.
- Compact monitored-port hourly aggregate retention: 100 days.
- Capped daily corridor-aggregate retention: 100 days (90-day product window plus a ten-day maintenance buffer).
- Overview cache and single-flight window: 120 seconds.

Port transitions are written once to `transport_movement_event`; an insert
trigger maintains `transport_movement_hour`. Deduplicated vehicle/country
presence is stored in `transport_entity_activity_hour`. Resolved origin and
destination activity is summarized into one daily row per mode/country pair in
`transport_corridor_activity_day`, without vehicle identifiers or raw provider
payload. `transport_country_activity_day` adds at most one row per country,
mode and day. The default admits the first 1,000 encountered corridor pairs per
mode/day, prioritising volume only within each ingestion flush. Later pairs may
be omitted regardless of volume, so the result has an explicit early-cycle
sampling bias and is not a complete ranking. It retains both daily tables
for 100 days: a hard application bound below 250,000
rows (200,000 corridor rows plus fewer than 50,000 ISO-country rows). Even the
permitted maximum configuration (2,000 pairs and 120 days) stays below 540,000
daily rows. User-facing 7/30/90-day
comparisons read these compact structures rather than sorting raw tracks. V44
begins corridor retention prospectively and deliberately does not scan the live
raw-track table during rollout.

Web and iOS market reads can poll frequently without forcing ingestion. Scheduled
market ingestion runs at most every four hours by default, while explicit admin
runs remain available for fresh data. The admin control room refreshes run and
automation state every 20 seconds but reloads historical metrics only on entry,
filter changes, explicit refresh, or a completed mutation.

`AISSTREAM_ENABLED=false` and `ADSB_LOL_POLL_ENABLED=false` are the incident
safety switches. Prefer pausing transport ingestion over allowing it to impair
authentication, news, weather, market, or briefing requests.

Retention catch-up shares a global ten-batch and 30-second budget across all
transport tables. A single pass never overlaps another; unfinished tables
rotate to the front and remain explicit in internal runtime health until a
later pass clears them.

AISstream uses one documented global bounding-box subscription and a single
bounded queue drain. The provider is beta/no-SLA and its terrestrial station
network reports roughly 200 km of coastal reception, so this is not complete
ocean coverage. Its five-second flush never overlaps a previous flush and writes at most
500 vessel snapshots per cycle with the production defaults. The keyless
Digitraffic fallback adds two compressed HTTP requests per minute for its
Finland/Baltic region and feeds the same bounded queue; it is not a global
fallback and does not create a second database writer. Marinesia is not used:
its current service requires an API key and its free access cannot provide a
global bulk feed.

## Monitoring

Terraform manages Cloud Monitoring alert policies for:

- memory utilization above 90% for five minutes;
- CPU utilization above 85% for ten minutes;
- backend connections above the reserved threshold for five minutes.

The deployment identity receives only the Monitoring AlertPolicy Editor role
needed to manage these policies.

During an alert, inspect Cloud SQL System Insights and the bounded Query Insights sample, then
correlate with `database_pool_pressure`, `database_slow_query`,
`transport_overview_slow_refresh`, `aisstream_ingestion_progress`,
`aisstream_idle_reconnect`, `digitraffic_maritime_refresh`, and
`transport_retention_pruned` logs.
Healthy operation has zero pool waiters, no sustained memory/CPU alert, and
transport overview refreshes below the slow-query threshold.

See [the cost baseline](cost-baseline.md) for availability trade-offs and
measured scale-up triggers.
