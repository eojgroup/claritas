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
- Movement-event and hourly-aggregate retention: 60 days.
- Overview cache and single-flight window: 120 seconds.

Port transitions are written once to `transport_movement_event`; an insert
trigger maintains `transport_movement_hour`. Deduplicated vehicle/country
presence is stored in `transport_entity_activity_hour`. User-facing comparisons
read these compact structures rather than sorting raw tracks.

Web and iOS market reads can poll frequently without forcing ingestion. Scheduled
market ingestion runs at most every four hours by default, while explicit admin
runs remain available for fresh data. The admin control room refreshes run and
automation state every 20 seconds but reloads historical metrics only on entry,
filter changes, explicit refresh, or a completed mutation.

`AISSTREAM_ENABLED=false` and `ADSB_LOL_POLL_ENABLED=false` are the incident
safety switches. Prefer pausing transport ingestion over allowing it to impair
authentication, news, weather, market, or briefing requests.

AISstream uses rotating geographic subscriptions and a single bounded queue
drain. Its five-second flush never overlaps a previous flush and writes at most
500 vessel snapshots per cycle with the production defaults.

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
`aisstream_idle_reconnect`, and `transport_retention_pruned` logs.
Healthy operation has zero pool waiters, no sustained memory/CPU alert, and
transport overview refreshes below the slow-query threshold.

See [the cost baseline](cost-baseline.md) for availability trade-offs and
measured scale-up triggers.
