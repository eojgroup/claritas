# ADR-0007: Provider-neutral Earth Observation and private assets

## Status

Accepted

## Context

Satellite search, processing, licences, quotas and output formats differ by provider. Clients must not receive provider credentials or unrestricted upstream proxy access.

## Decision

Provider adapters expose scene discovery, status and bounded rendering contracts. Copernicus CDSE/Sentinel Hub supplies optical/SAR discovery and processed imagery; NASA FIRMS supplies active-fire observations; NASA GIBS is restricted to a reviewed layer allowlist. USGS earthquake observations use their public GeoJSON feed.

Scene ranking records recency, cloud, event timing, coverage, sensor and quality components. Rendered previews and thumbnails are stored in a private GCS bucket and served only through authenticated, UUID-addressed API routes. Requests enforce AOI, pixel, daily processing-unit, concurrency and retention limits. Before/after comparisons disclose acquisition comparability and never imply causation.

## Consequences

- Web and Apple clients remain provider-neutral.
- Optional providers can be disabled without breaking core intelligence.
- Cached assets bound repeated provider cost but require lifecycle reconciliation.
- Credentials remain server-side and attribution remains attached to observations.
