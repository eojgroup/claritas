# Earth Observation administrator setup

All optional providers ship disabled. Deploy the schema/infrastructure first, inspect `/api/admin/intelligence/status`, then enable providers one at a time.

## Copernicus Data Space Ecosystem

1. Create or confirm a CDSE account and create an OAuth client suitable for Sentinel Hub APIs.
2. In GitHub, open **Settings → Secrets and variables → Actions** and create `COPERNICUS_CLIENT_ID` and `COPERNICUS_CLIENT_SECRET`.
3. Confirm the GKE deploy workflow creates Kubernetes secret `claritas-earth-observation` with keys `COPERNICUS_CLIENT_ID` and `COPERNICUS_CLIENT_SECRET`.
4. Review the account’s current processing-unit entitlement. Keep `EO_MAX_DAILY_PROCESSING_UNITS` below that ceiling.
5. Set repository variables `EARTH_OBSERVATION_ENABLED=true` and `COPERNICUS_ENABLED=true`; retain conservative AOI/pixel defaults for the first deployment.
6. Deploy, trigger a single monitored location from Admin, and verify scene provenance plus “Contains modified Copernicus Sentinel data” attribution.

## NASA FIRMS

1. Request a free MAP_KEY from the NASA FIRMS service.
2. Add GitHub Actions secret `NASA_FIRMS_MAP_KEY`.
3. Confirm deployment adds key `NASA_FIRMS_MAP_KEY` to `claritas-earth-observation`.
4. Set `NASA_FIRMS_ENABLED=true`, deploy, and run one Admin poll.
5. Check daily usage, bounded location rotation and NASA FIRMS attribution. The default poll/query sizes stay below the published transaction limit; do not raise them without a cost review.

## Keyless providers

- NASA GIBS: no secret. After governance review, set `NASA_GIBS_ENABLED=true`. Only layers in the code allowlist may be enabled.
- USGS Earthquakes: no secret. After governance review, set `USGS_EARTHQUAKES_ENABLED=true`; keep the existing identifying application contact current if provider guidance requests it.

## GCP and Cloud SQL

Terraform enables Pub/Sub, Storage, Monitoring, Logging and required existing APIs; creates domain/alert/dead-letter topics, subscriptions, private EO storage, lifecycle and IAM. The existing GitHub Workload Identity principal must be allowed to apply Terraform. Cloud SQL’s migration principal must be able to create the supported `postgis` and `pgcrypto` extensions. Verify both through `db-verify-job.yaml` after deployment.

Choose the existing application region for the bucket unless residency/egress policy requires another. Confirm `api-sa` maps to `claritas-sql-gsa` and has Pub/Sub publisher/subscriber plus Storage object-user access.

## Alerts and APNs

The release implements event watchlists, alert-candidate deduplication, user eligibility, and acknowledgeable in-app delivery. It does not claim APNs delivery. `EVENT_ALERTS_ENABLED=true` may be used for the implemented in-app channel after product review. To activate remote push later, create an Apple Push Notification key in the Apple Developer portal and provision GitHub secrets `APNS_PRIVATE_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_TOPIC`, plus repository variable `APNS_ENVIRONMENT` (`development` or `production`). Those names are reserved but intentionally not consumed until an APNs delivery worker and device-token registration API are implemented and security-reviewed. Never mark a candidate as push-delivered until that worker has received an APNs acceptance response.

## Rollout and checks

1. Keep all provider flags false and confirm API, web and existing domains are healthy.
2. Enable `EVENT_CORRELATION_ENABLED`; confirm outbox lag, consumer counts and event detail.
3. Enable USGS, then FIRMS, then GIBS/CDSE separately.
4. Watch Pub/Sub oldest-unacked age, dead letters, EO failure metric, queue depth, provider circuit state, daily processing units and bucket size.
5. Disable the affected provider flag on repeated failures; core intelligence and existing source views must continue.
6. Retry only inspected failed jobs. There is deliberately no unguarded bulk replay.
