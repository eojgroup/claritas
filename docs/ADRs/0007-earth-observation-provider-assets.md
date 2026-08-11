# ADR-0007: Provider-neutral Earth Observation, contextual imagery and private assets

## Status

Accepted

## Context

Satellite search, processing, licences, quotas and output formats differ by provider. Clients must not receive provider credentials or unrestricted upstream proxy access.

## Decision

Provider adapters expose scene discovery, status and bounded rendering contracts. Copernicus CDSE/Sentinel Hub supplies optical/SAR discovery and processed imagery; NASA FIRMS supplies active-fire observations; USGS earthquake observations use their public GeoJSON feed. Feature activation and provider readiness are distinct: a credentialed adapter with an active flag reports `not_configured` and cannot fall back to a different or paid provider.

Scene ranking records recency, cloud, event timing, coverage, sensor and quality components. Automatic discovery requires a supported, sufficiently relevant canonical event with finite exact signal/event coordinates; canonical location metadata is optional. Exact event geography takes precedence over a broader location; missing or country-only geography is rejected rather than replaced with a country centroid or `(0,0)`. An explicit Admin location-only trigger remains a separate operator action.

Rendered previews and thumbnails are stored in a private GCS bucket and served only through authenticated, UUID-addressed API routes. Event type selects the requested true-colour, burn-index, SAR, NDWI or NDVI products, and compatible selected scenes render those products. Requests bound AOI, pixels, daily and monthly processing admission, concurrency, scene count, two 24-hour revisits and retention. Both admission checks add four estimated units to recorded usage before a request; this is not an atomic reservation, and actual units are recorded afterward, so provider quota remains the ultimate cost ceiling. Before/after comparisons disclose acquisition comparability and never imply causation.

NASA GIBS is a separate contextual contract. The authenticated event route returns only reviewed, date- and AOI-specific EPSG:4326 WMTS templates and bounded WMS preview URLs with provenance. The web client may load a preview directly from NASA, but the Claritas API does not fetch, proxy, persist or analyse it, so GIBS does not create scenes/assets and cannot trigger model interpretation.

Optional vision enrichment operates only on an available Copernicus preview. It uses the free OpenRouter route (or an exact catalog-validated zero-priced image model), records actual model and prompt version, produces strictly bounded `model_interpretation` evidence and never replaces the physical observation. A failed interpretation leaves the observation available.

## Consequences

- Web and Apple clients remain provider-neutral.
- The Signal Desk can connect reported news to physical evidence without presenting a source page or imagery library as a separate event system.
- Optional providers and model interpretation can be disabled independently without breaking core intelligence.
- Cached assets bound repeated provider cost but require lifecycle reconciliation.
- GIBS avoids Claritas storage/processing cost but requires clients to respect the attached NASA attribution and upstream service behaviour.
- Credentials remain server-side and attribution remains attached to observations.
- Operators must treat `enabled`, `configured` and `ready` as separate states and retain provider-side quota/billing controls.
