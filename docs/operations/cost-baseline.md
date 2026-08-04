# Cost-optimized production baseline

The August 2026 baseline favors low recurring cost over infrastructure-level high
availability. It is appropriate while traffic is light and the product can accept
a brief deployment or spot-node interruption.

## Resource shape

| Resource | Baseline | Previous shape | Cost effect |
|---|---|---|---|
| API static-egress pool | One private spot `e2-small` node in one zone | One node in each of two zones | Removes one continuously running API node |
| API | One replica with explicit 150m CPU / 256 MiB request | Two replicas without API resource bounds | Reduces steady compute and makes scheduling predictable |
| Web | One 50m CPU / 64 MiB replica | Two replicas | Halves steady web pod requests |
| Cloud SQL | `db-custom-1-3840`, zonal, PostgreSQL 15 | `db-custom-2-7680` | Halves vCPU and memory allocation |
| Database pools | API 3, Keycloak 5 | API 5 per replica, Keycloak 10 | Bounds connections and database memory |
| Artifact Registry | Keep at least five versions per image; delete versions older than 14 days | Unbounded | Bounds image storage growth |

The screenshot's largest visible categories are Kubernetes Engine and Compute
Engine, not Cloud SQL. The single-zone egress pool and replica reductions address
those first. The regional GKE control plane remains because replacing it with a
zonal cluster is a migration, not an in-place resize.

The roughly `kr23/day` Kubernetes Engine line is consistent with GKE's fixed
`$0.10/hour` cluster-management fee. Google's monthly `$74.40` free-tier credit
applies to one zonal Standard or Autopilot cluster, but not to a regional
Standard cluster. Eliminating that line therefore requires a separately planned
cluster migration and ingress cutover; changing the existing regional cluster
in place would destroy it. The current release does not take that destructive
step automatically.

## Workload controls

- Market automation runs at most every four hours by default; manual runs remain available.
- Dashboard demand signals are aggregated in memory and flushed at most once per pipeline per minute instead of writing on every read request.
- GDELT raw rows per run are capped at 500.
- AIS and ADS-B sampling is ten minutes, route enrichment is capped at 750 aircraft per refresh, and overview reads cache for two minutes.
- Raw transport tracks retain 3 days, movement aggregates 60 days and current snapshots 14 days.
- Successful ingestion audits retain 30 days; failed audits retain 90 days.
- Query Insights retains one plan per minute and omits client addresses and application tags.

## Availability and scale-up triggers

The baseline deliberately has single-node and single-replica failure domains.
Scale the API egress zones and API replicas back to two together when any of the
following is sustained:

- API CPU above 65% or memory above 70% during normal load;
- request latency or queueing breaches the product SLO;
- spot interruptions create unacceptable availability;
- Cloud SQL CPU above 70%, memory above 80%, or connection count above 20 after query optimization;
- contractual availability requires multi-zone application capacity.

Changing the Cloud SQL tier restarts the instance. Terraform applies the resize
during the infrastructure workflow, so schedule future tier changes as a short
maintenance event and verify backups before applying.
