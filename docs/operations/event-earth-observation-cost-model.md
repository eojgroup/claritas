# Incremental event and Earth Observation cost model

These are planning ranges, not quotes. Actual GCP, data-provider and egress prices vary by region, allowance and contract. Recalculate against the relevant billing consoles before changing tiers or hard limits.

| Scale | Pub/Sub | GCS + image egress | Cloud SQL/GKE increment | EO processing | Expected incremental/month |
|---|---:|---:|---:|---:|---:|
| Current/small | free allowance to low single digits | 1–10 GB; low single digits before client egress | absorbed by current DB/node requests in normal load | free/provider allowance with 100 PU/day and 3000 PU/month local admission ceilings plus provider quota | roughly $0–$25 plus image egress |
| 10× events/users | low single to tens | 10–100 GB plus user egress | $25–$150 if a DB/node step-up becomes necessary | provider-plan dependent; cap before upgrade | roughly $50–$350 plus provider plan |
| 100× events/users | tens to low hundreds | 0.1–1 TB plus material egress | $250–$1,500 for HA/replicas/worker capacity | negotiated/provider-plan dependent | capacity plan required; $500+ likely |

## What is active now

The deployment defaults event correlation, alerts, EO, Copernicus, FIRMS, GIBS, USGS, free-only vision and APNs delivery to enabled. Credentialed capabilities remain inert and report `not_configured` until their secrets are complete. This lets keyless/open features work while preventing a missing credential from selecting a different provider or paid model.

| Capability | Direct external-charge posture | Claritas cost controls |
|---|---|---|
| USGS | Keyless public feed | 300-second poll, magnitude/significance filtering, idempotent events. |
| NASA FIRMS | Free key subject to provider transaction policy | 600-second poll, three rotating locations per poll, bounded ingestion. |
| NASA GIBS | Keyless browse service | Four reviewed layer records with WMTS templates and bounded WMS previews. The API does not download, render, proxy or store them; the web browser's direct preview request bears the upstream transfer. |
| Copernicus | Account allowance/plan dependent | Relevance- and exact-event-AOI-gated automatic jobs; 100 PU/day and 3000 PU/month admission ceilings with a four-PU estimate per render; event-family requested products; 25-square-degree AOI; 1024 × 1024 render; four selected scenes; up to two 24-hour revisits; two worker jobs/cycle; and 60-day assets by default. |
| OpenRouter vision | `openrouter/free` only; free-route availability is not guaranteed | Ten requests/UTC day by default, maximum configurable limit 50, 8 MiB source limit, 768 × 768 submission, strict structured output and non-zero reported-cost rejection. No paid fallback. |
| APNs | Not metered by Claritas; confirm current Apple terms, while ordinary API/DB/network operations remain | Entitled accounts and deliverable watchlist candidates only; recent 24-hour window; eight active devices/user; 64 retained rows/user; 500 materializations and ten sends/cycle by default; bounded retries and invalidation. |

OpenRouter vision runs only after a usable Copernicus preview has been rendered. It is not called for GIBS tile templates, raw news or missing imagery. The stored result is labelled `model_interpretation`, its confidence is capped at 0.75, and a failed interpretation does not invalidate the physical observation.

The free-router response is checked for reported non-zero cost, while an exact model override is checked against the OpenRouter catalogue for image support, structured output and zero pricing. The response check happens after the request, so it is a fail-closed data-path control rather than a substitute for an OpenRouter account-level zero-spend limit. Do not fund paid routing for this workload without explicit product and budget approval.

## Enforced and operational ceilings

| Setting | Committed value | Enforcement semantics |
|---|---:|---|
| `EO_MAX_DAILY_PROCESSING_UNITS` | 100 | Current UTC-day usage plus the render estimate is checked before each Copernicus call. An exhausted job becomes `budget_deferred` until the next UTC day and does not consume an attempt. `0` pauses processing. |
| `EO_MAX_MONTHLY_PROCESSING_UNITS` | 3000 | Current UTC-month usage plus the render estimate is checked before each Copernicus call. An exhausted job becomes `budget_deferred` until the next UTC month and does not consume an attempt. `0` pauses processing. |
| `EO_ESTIMATED_PROCESSING_UNITS_PER_RENDER` | 4 | Pessimistic pre-request estimate added to recorded usage for both ceiling checks; runtime bounds are 1–25. This is not an atomic provider-unit reservation. Provider-returned actual units are recorded afterward, so the provider quota remains the hard backstop. |
| `EO_MAX_REVISITS_PER_EVENT` | 2 | Schedules at most two follow-up discovery jobs after the initial event discovery; runtime bounds are 0–7. |
| `EO_REVISIT_INTERVAL_HOURS` | 24 | Delay between bounded event revisits; runtime bounds are 6–168 hours. |
| `EO_VISION_MAX_DAILY_REQUESTS` | 10 | Atomically reserved per UTC day; excess jobs are deferred to the next UTC day. Runtime normalization restricts it to 0–50. |
| `EO_MAX_AOI_SQUARE_DEGREES` | 25 | Enforced by AOI validation/cropping. Automatic event discovery additionally requires finite event coordinates and never uses a country-only null geometry. |
| `EO_RENDER_MAX_WIDTH` / `EO_RENDER_MAX_HEIGHT` | 1024 / 1024 | Runtime dimensions are bounded to 64–2048 pixels. |
| `EO_MAX_SCENES_PER_DISCOVERY` | 4 | Runtime bounds are 1–10. |
| `EO_ASSET_RETENTION_DAYS` | 60 | Runtime bounds are 1–60, never beyond the production bucket lifecycle. A reused immutable object retains its original lifecycle deadline, so database expiry cannot be extended past object deletion. |
| `EO_VISION_MAX_IMAGE_BYTES` | 8 MiB default | Runtime bounds are 256 KiB–12 MiB; the stored preview is checked before and after download. |
| `APNS_WORKER_BATCH_SIZE` | 10 | Runtime bounds are 1–50 per leased cycle. |

Image bandwidth can dominate storage. Lists should use thumbnails and investigation views should load previews only for the selected event. GIBS is different: the API provides provider URLs rather than Claritas assets, so do not include GIBS transfer in GCS estimates.

## Change-control rule

Implemented controls include event-family correlation windows, an anchored merge threshold, post-aggregation EO relevance, exact automatic event AOIs, event-family product selection, bounded revisits, dual-period processing admission, scene/cloud ranking, provider circuits, leased workers, retry/dead-letter state, private cached assets and status/usage reporting. Raising any limit requires reviewing all of the coupled effects: provider quota, Cloud SQL write/load, worker latency, object storage, image egress and user-facing freshness.

Pause and seek explicit budget approval before any of the following:

- adding a paid OpenRouter model or provider fallback;
- increasing Copernicus processing above the verified account allowance;
- funding a higher provider plan or enabling unrestricted scene/image replay;
- removing the daily/monthly/area/pixel/request bounds or increasing the revisit cadence;
- adding a GIBS tile cache or public asset proxy, which changes both egress and governance posture;
- increasing replicas or storage retention enough to leave the current planning band.

The narrow kill switches are `EO_VISION_ENRICHMENT_ENABLED`, `COPERNICUS_ENABLED`, `NASA_FIRMS_ENABLED`, `NASA_GIBS_ENABLED`, `USGS_EARTHQUAKES_ENABLED` and `APNS_DELIVERY_ENABLED`. Use `EARTH_OBSERVATION_ENABLED` only when Copernicus jobs, GIBS context and vision must all stop together.
