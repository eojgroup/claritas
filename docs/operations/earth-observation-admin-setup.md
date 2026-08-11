# Unified Signal Desk and Earth Observation administrator setup

Claritas presents news, official observations, transport, markets and satellite evidence as one event-centred Signal Desk. A source record is first attached to a canonical intelligence event; event-specific Earth Observation (EO) is then requested only when the event has a supported type, sufficient post-correlation relevance and finite exact event coordinates. A news report can therefore lead to satellite context, but Claritas does not substitute imagery from a country centroid or an unrelated nearby location.

The committed ConfigMap and both deployment workflows currently default all requested capabilities to enabled. **Enabled is not the same as ready:** credentialed providers report `not_configured` and do not silently fall back to a paid or unrelated provider. Inspect `GET /api/admin/intelligence/status` after every deployment before treating a capability as operational.

See the [architecture](../architecture/event-earth-observation.md), [cost model](event-earth-observation-cost-model.md) and [data-source governance register](../data-source-governance.md) before changing a limit or adding a provider.

## Activation and cost guardrails

| Capability | Active gate | Credential/readiness requirement | Current bounded behaviour |
|---|---|---|---|
| Event backbone and correlation | `EVENT_BACKBONE_ENABLED=true`, `EVENT_CORRELATION_ENABLED=true` | Pub/Sub in GKE; local mode is available for development | Stable source identity is idempotent. Candidate merges require a specific location, bounded spatial proximity or shared entity support; country and time alone cannot merge generic stories. Decisions and factors are audited. |
| USGS Earthquakes | `USGS_EARTHQUAKES_ENABLED=true` | None | Polls every 300 seconds by default and applies magnitude/significance filters before producing event evidence. |
| NASA FIRMS | `NASA_FIRMS_ENABLED=true` | `NASA_FIRMS_MAP_KEY` | Polls every 600 seconds and rotates three monitored locations per poll by default. FIRMS is a rapid event source and is not controlled by the EO umbrella flag. |
| NASA GIBS | `EARTH_OBSERVATION_ENABLED=true`, `NASA_GIBS_ENABLED=true` | None | Returns four reviewed, date-specific WMTS templates plus bounded WMS preview URLs for an event AOI. The web Signal Desk displays the first true-colour preview directly from NASA; the API does not download, persist, proxy or analyse it. |
| Copernicus discovery/render | `EARTH_OBSERVATION_ENABLED=true`, `COPERNICUS_ENABLED=true` | `COPERNICUS_CLIENT_ID`, `COPERNICUS_CLIENT_SECRET`, asset bucket access | Daily/monthly admission ceilings default to 100/3000 processing units and include four estimated units per render in each preflight check. AOI is limited to 25 square degrees, render to 1024 × 1024, discovery to four scenes, automatic follow-up to two 24-hour revisits and assets to 60 days. Compatible products requested for the event family are actually rendered. |
| OpenRouter vision interpretation | `EARTH_OBSERVATION_ENABLED=true`, `EO_VISION_ENRICHMENT_ENABLED=true` | `OPENROUTER_API_KEY` | Uses `openrouter/free`, at most 10 requests per UTC day by default (runtime maximum 50), and only after a Copernicus preview is available. The physical observation remains usable if interpretation fails. |
| APNs alert delivery | `EVENT_ALERTS_ENABLED=true`, `APNS_DELIVERY_ENABLED=true` | Complete APNs signing key, active registered installation and eligible watchlist alert | Leased worker polls every 15 seconds, materializes at most 500 rows and claims at most 10 deliveries per cycle by default. Missing signing credentials produce `not_configured`; locally valid but unproven credentials are `configured_unverified`. |

`EO_MAX_DAILY_PROCESSING_UNITS=100` and `EO_MAX_MONTHLY_PROCESSING_UNITS=3000` are enforced pre-request admission ceilings. Each check adds the pessimistic `EO_ESTIMATED_PROCESSING_UNITS_PER_RENDER=4` to recorded usage; an exhausted job becomes `budget_deferred`, has its attempt restored and is made available at the next UTC day or month. Set either ceiling to `0` to pause Copernicus processing. The estimate is not an atomic provider-unit reservation, and actual units arrive only in the provider response, so the provider account quota remains the ultimate hard ceiling. Likewise, the OpenRouter response-cost check is fail-closed but occurs after a request; retain a zero-spend account/provider limit and do not add credits intended for paid routing.

## Copernicus Data Space Ecosystem

1. Create or confirm a CDSE account and create an OAuth client suitable for Sentinel Hub APIs.
2. In GitHub, open **Settings → Secrets and variables → Actions** and create `COPERNICUS_CLIENT_ID` and `COPERNICUS_CLIENT_SECRET`.
3. Confirm the deployment creates Kubernetes secret `claritas-earth-observation` with both keys. Partial credentials are not ready.
4. Review the account's current processing-unit entitlement. Keep both Claritas ceilings and the four-unit admission estimate conservative relative to that entitlement, and retain provider-side quota/billing alerts as the hard backstop.
5. Deploy with `EARTH_OBSERVATION_ENABLED=true` and `COPERNICUS_ENABLED=true`. Retain the committed AOI, scene, pixel, worker and retention limits for the first monitored run.
6. Trigger one location and event from Admin. Verify the discovery job records `aoi_source=event_geography` when event coordinates exist, the chosen scene has provenance, requested compatible products are rendered, and assets retain “Contains modified Copernicus Sentinel data” attribution.
7. Confirm usage increments and that a deliberately exhausted daily or monthly processing budget produces `budget_deferred` with next-period availability, not an unbounded provider call.

The automatic event path is stricter than the Admin trigger: it requires exact finite signal/event coordinates, a supported observable event type and the post-aggregation relevance threshold; a canonical location is optional and country-only geography is never sufficient. The initial discovery key includes the event, optional location and UTC discovery day. Up to two follow-up discoveries are scheduled 24 hours apart with distinct revisit keys. The event family requests one or more compatible products—true colour, burn index, SAR, NDWI or NDVI—and the selected Sentinel-1/Sentinel-2 scenes render those requested products rather than a generic fallback. The Admin endpoint may still trigger an explicitly chosen location without an event for deliberate operator inspection.

## NASA FIRMS

1. Request a free MAP_KEY from NASA FIRMS.
2. Add GitHub Actions secret `NASA_FIRMS_MAP_KEY` and confirm the deployment adds it to `claritas-earth-observation`.
3. Deploy with `NASA_FIRMS_ENABLED=true`; the status endpoint must show configured/ready before relying on polling.
4. Run one Admin poll and verify the satellite/instrument, acquisition time, source version, location and NASA FIRMS attribution on the resulting evidence.
5. Check the bounded location rotation and upstream transaction usage. Do not raise `FIRMS_LOCATIONS_PER_POLL` or reduce the poll interval without a provider-quota and database-load review.

FIRMS detections are thermal anomalies. They may corroborate a wildfire event but do not prove cause, extent of damage or attribution.

## NASA GIBS and USGS

Neither provider needs a secret.

- GIBS readiness requires both the EO umbrella and `NASA_GIBS_ENABLED`. `GET /api/earth-observation/events/:eventId/gibs` returns an event-start-date and AOI-specific context containing the reviewed MODIS Terra/Aqua true-colour, VIIRS NOAA-20 true-colour and MODIS aerosol layers. Each record carries a WMTS tile template and a fixed-parameter WMS 1.3 `GetMap` preview URL bounded to 256–768 pixels, plus provenance. The web Signal Desk loads the first available true-colour preview directly from `gibs.earthdata.nasa.gov`; the API server does not fetch or proxy it. GIBS does not create `earth_observation` rows or GCS assets and does not feed vision enrichment. Apple clients currently show persisted observations rather than this GIBS preview.
- USGS readiness requires `USGS_EARTHQUAKES_ENABLED`. Keep `USGS_USER_AGENT` current and preserve the event URL and USGS attribution. USGS observations may establish shaking location/magnitude; they are not impact or casualty assessments.

Both paths reject the temptation to manufacture precision: event-specific GIBS context needs a resolvable AOI, and country-only generic news cannot become an EO job.

## Free-only OpenRouter vision

Vision enrichment is secondary, labelled model interpretation of an already-rendered Copernicus preview. It is not an EO provider, an independent observation or causal proof.

1. Add `OPENROUTER_API_KEY` to GitHub Actions secrets. The API receives it from `claritas-opencode`.
2. Keep `EO_VISION_MODEL=openrouter/free`. An exact model override is accepted only when the OpenRouter catalogue says it supports image input and structured output and all relevant prices are exactly zero.
3. Keep `EO_VISION_MAX_DAILY_REQUESTS=10` initially. `0` pauses requests; values are bounded to 50. Input previews are limited to 8 MiB by default and resized to a maximum 768 × 768 JPEG before submission.
4. Verify status reports `openrouter_vision` ready, then allow one Copernicus render to enqueue a `vision_enrichment` job.
5. Confirm evidence is labelled `model_interpretation`, records requested and actual model plus prompt version, caps stored confidence at 0.75, and retains the underlying scene attribution.

The default free router records the actual routed model and rejects a response that reports non-zero cost. Exact model overrides are revalidated from the provider catalogue. Invalid pricing, unexpected exact-model routing, non-image models, malformed structured output and missing credentials fail closed. A failed vision job must not change an available physical observation to failed.

## APNs delivery readiness

The device registration API and leased APNs delivery worker are implemented. APNs is outside the EO/provider processing budget, but activation still requires review of current Apple terms, Apple credentials, signing/provisioning and a real-device test.

1. Create an Apple Push Notification authentication key and store the complete P-256 `.p8` PEM as `APNS_PRIVATE_KEY`, with Apple's 10-character uppercase alphanumeric `APNS_KEY_ID` and `APNS_TEAM_ID`, in GitHub Actions secrets. Invalid formats are treated as not configured.
2. Confirm deployment creates `claritas-apns` only when all three values are present. Omitted GitHub values deliberately preserve an existing Kubernetes secret; they do not disable or erase it. Use `APNS_DELIVERY_ENABLED=false` or an explicit rotation/revocation to stop existing credentials. The committed topic is `APNS_BUNDLE_TOPIC=com.eojgroup.claritas`; it must exactly match the iOS bundle identifier and the device registration payload.
3. Keep `APNS_DELIVERY_ENABLED=true`. If credentials are incomplete, `/api/admin/intelligence/status` reports `not_configured`; syntactically valid credentials remain `configured_unverified` until the current credential fingerprint receives an HTTP 200, and a newer provider/authentication failure reports `degraded`.
4. Build Debug with the development entitlement and Release with the production entitlement. The server chooses the sandbox or production APNs host from each registered device's environment; there is no server-wide `APNS_ENVIRONMENT` switch.
5. On a signed-in paid-access account, grant notification permission and verify `POST /api/intelligence/devices` registers the hexadecimal token with a stable installation UUID. Token rotation retires the prior token for that installation. The default bounds are eight active and 64 retained device rows per user. An active token cannot be reassigned across accounts.
6. Device deletion requires an authenticated session but not current paid access. Logout revokes its saved device and can fall back to `DELETE /api/intelligence/devices` to revoke all account devices. Inactive accounts have their tokens cleared; lapsed accounts and muted, failed or expired candidates are suppressed before claim and immediately before send.
7. Create one eligible, unacknowledged watchlist alert less than 24 hours old. Verify its delivery progresses through `queued`/`sending` to `accepted`, or to a bounded retry/dead-letter/token-invalid/suppressed state. The worker rechecks account/access, device ownership, topic, candidate state, recency, eligibility and acknowledgement before sending; retries reuse the APNs request ID, honour numeric `Retry-After`, collapse by alert candidate and default to a one-hour APNs expiry.
8. Open the notification and confirm the app navigates to the exact Signal Desk event. Keep in-app acknowledgement distinct from transport acceptance.

`accepted` means APNs returned HTTP 200 for the request. It does **not** prove that the device displayed the alert or that the user saw it. User acknowledgement remains a separate application event. Never report APNs acceptance as read, seen or acted upon.

## GCP and Cloud SQL

Terraform enables Pub/Sub, Storage, Monitoring, Logging and required existing APIs; creates domain/alert/dead-letter topics, subscriptions, private EO storage, lifecycle and IAM. The existing GitHub Workload Identity principal must be allowed to apply Terraform. Cloud SQL's migration principal must be able to create the supported `postgis` and `pgcrypto` extensions. Verify both through `db-verify-job.yaml` after deployment.

Choose the existing application region for the bucket unless residency/egress policy requires another. Confirm `api-sa` maps to `claritas-sql-gsa` and has Pub/Sub publisher/subscriber plus Storage object-user access. EO assets remain private and are served through authenticated UUID-addressed API routes.

## Rollout and incident controls

The repository defaults the capabilities on, so use repository variables as kill switches rather than assuming a disabled initial state.

1. Deploy schema and infrastructure first. Confirm V36 is present, the event subscription is healthy and the API starts with missing optional credentials reported as `not_configured`.
2. Verify correlation with two corroborating records and one deliberately generic same-country story. The corroborating evidence should converge; the generic story should remain separate.
3. Verify keyless USGS and the GIBS context endpoint, then credentialed FIRMS and Copernicus with one bounded request each.
4. Enable usable vision only after a free OpenRouter route/key is available and the daily cap is visible in Admin. Do not configure a paid exact model.
5. Validate APNs first against a development-signed physical device, then production signing. Simulator success is not an APNs production-readiness check.
6. Watch Pub/Sub oldest-unacked age, dead letters, correlation decisions, EO failures, queue depth, circuit/rate-limit state, daily and monthly processing units, vision request count, APNs states and bucket size.
7. On repeated failures or unexpected usage, turn off the narrowest affected flag: `EO_VISION_ENRICHMENT_ENABLED`, `COPERNICUS_ENABLED`, `NASA_FIRMS_ENABLED`, `NASA_GIBS_ENABLED`, `USGS_EARTHQUAKES_ENABLED` or `APNS_DELIVERY_ENABLED`. Use the EO umbrella only when all EO jobs must stop. Core events, source lenses and in-app alerts must continue.
8. Retry only inspected failed jobs. There is deliberately no unguarded bulk replay.
