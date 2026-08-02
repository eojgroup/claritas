# ADR-0004: News-led leadership signals

## Status

Accepted

## Context

The dashboard previously exposed current country leadership as a map layer, country-profile metric, and context card. A current officeholder record is useful reference data, but it does not describe a change and should not compete with event-driven news, weather, market, podcast, or transport signals.

## Decision

Leadership is no longer a standalone client-facing signal or map domain. The dashboard, country profile, context band, and saved map-layer preference expose Signals, News, and Weather only. Leadership names are not used to infer podcast-to-country linkage or to increase cross-source relevance. Within the shared news stream, a high-precision title/summary classifier adds a “Leadership change” annotation only when the story text explicitly describes a transition; the underlying item remains news and retains its publisher provenance.

Daily briefing collection may retain bounded leadership records as reference context. The briefing prompt must not surface current officeholders, government type, or a changed reference record as an update. It may mention a leadership transition only when supplied news directly reports the change, and the transition remains part of the news narrative.

Leadership ingestion and administration remain available because they maintain the reference dataset and may support future news-entity corroboration.

## Consequences

- Users see leadership changes where they have event evidence: in news and news-led briefings.
- Routine officeholder records no longer create visual prominence or apparent urgency.
- Podcast country linkage uses explicit country metadata, names, and aliases rather than current leader names.
- Existing leadership data and ingestion operations remain backward-compatible at the API and database layers.

This decision supersedes the standalone leadership-layer and leadership-context portions of ADR-0001 and ADR-0002.
