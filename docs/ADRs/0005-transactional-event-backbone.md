# ADR-0005: Transactional event backbone

## Status

Accepted

## Context

News, weather, transport, markets, disaster observations and imagery arrive on independent schedules. Direct synchronous coupling would make ingestion availability depend on every downstream correlation and EO provider.

## Decision

Source writes emit versioned domain envelopes through PostgreSQL triggers into `event_outbox` in the same transaction. A leased dispatcher publishes to Pub/Sub when configured and otherwise consumes locally. Consumers claim `(consumer_name, event_id)` idempotency records, retry with bounded exponential delay, and move exhausted work to a durable dead-letter table. Pub/Sub has a separate dead-letter topic/subscription.

`intelligence_event` is the shared aggregate. Evidence retains domain, source record, relationship class, confidence, provenance, licence and attribution. Correlation is deterministic and requires a spatial, normalized-location or entity anchor; temporal coincidence alone is insufficient.

## Consequences

- Existing ingestion remains available when correlation or optional providers fail.
- At-least-once delivery is safe and auditable.
- Database and Pub/Sub backlog become operational signals.
- Outbox cleanup and dead-letter replay require routine operations.
