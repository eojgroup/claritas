# Cloud SQL capacity and transport load

Claritas runs PostgreSQL 15 on a dedicated-core `db-custom-2-7680` Cloud SQL
instance. The 2-vCPU, 7.5-GB shape is the production floor for the shared
application, Keycloak, briefing, market, and transport workloads.

## Connection budget

- Two API replicas each cap their node-postgres pool at five connections.
- The elected transport ingestion worker uses one connection from its replica's
  five-connection budget for the PostgreSQL advisory lock.
- Keycloak starts with one connection and caps its pool at ten.
- Migrations and operational access retain capacity outside the normal
  application pools. Do not raise PostgreSQL `max_connections` to address
  slow queries; inspect pool waiters and Query Insights first.

API pool pressure and queries exceeding 750 ms are emitted as structured logs.
Admin ingestion metrics include the current pool maximum, total, idle, and
waiting counts.

## Bounded transport workload

- AIS snapshot sampling: five minutes.
- ADS-B polling: five minutes.
- Raw track sampling: five minutes.
- Raw track retention: seven days.
- Stale current-snapshot retention: 30 days.
- Movement-event and hourly-aggregate retention: 90 days.
- Overview cache and single-flight window: 60 seconds.

Port transitions are written once to `transport_movement_event`; an insert
trigger maintains `transport_movement_hour`. Deduplicated vehicle/country
presence is stored in `transport_entity_activity_hour`. User-facing comparisons
read these compact structures rather than sorting raw tracks.

Web and iOS market polling runs once per minute. Quote refreshes are
single-flight and limited to one upstream/database write cycle per minute per
API replica; market-status polling uses its one-minute server cache. Explicit
user refresh actions can still bypass the read cache.

`AISSTREAM_ENABLED=false` and `ADSB_LOL_POLL_ENABLED=false` are the incident
safety switches. Prefer pausing transport ingestion over allowing it to impair
authentication, news, weather, market, or briefing requests.

## Monitoring

Terraform manages Cloud Monitoring alert policies for:

- memory utilization above 90% for five minutes;
- CPU utilization above 85% for ten minutes;
- backend connections above the reserved threshold for five minutes.

During an alert, inspect Cloud SQL System Insights and Query Insights, then
correlate with `database_pool_pressure`, `database_slow_query`,
`transport_overview_slow_refresh`, and `transport_retention_pruned` logs.
Healthy operation has zero pool waiters, no sustained memory/CPU alert, and
transport overview refreshes below the slow-query threshold.
