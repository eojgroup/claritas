# ADR-0002: Multi-Device Adaptive Strategy

- Status: Accepted
- Date: 2026-07-20
- Note: The four-layer map contract is superseded by the news-led leadership treatment in [ADR-0004](0004-news-led-leadership-signals.md).

## Context

Responsive stacking alone produces a compressed desktop rather than a useful mobile or wearable product. Claritas already has web, universal iOS/iPadOS, and watchOS clients with different input, attention, and screen constraints.

## Decision

Define device roles:

| Device | Role |
| --- | --- |
| Desktop web (`>=1280px`) | Full analytics workspace |
| Tablet web/iPad (`768–1279px` or regular size class) | Reduced two-stage review workspace |
| Mobile web/iPhone (`<768px` or compact size class) | Triage and drill-in workspace |
| Apple Watch | Companion-only signal glance |

Desktop keeps comparison, charts, maps, dense feeds, and full admin configuration. Its dashboard overview pairs the map with podcast and leadership context. Tablet uses the map as the dominant review stage, retains compare/pin, and uses 44-point touch targets. Mobile opens with the same Signals, News, Weather, and Leadership map contract using compact layer and region controls before KPI, alert, and feed drill-ins. Watch retains a simplified interactive version of that map contract—layers, regional scope, rank, highest relevance, selection, and reset—plus freshness and phone handoff.

Full charts, comparison, configuration-heavy forms, admin mutations, profile editing, policies, and dense evidence exploration are unavailable on watch.

Personal briefing content remains newsletter-only and is not presented by the iPhone, iPad, watch, or their widgets. Daily briefing generation and scheduling may remain as backend/newsletter capabilities, but briefing cards are not part of the primary native app hierarchy.

## Consequences

- Components adapt by device role, not only by available width.
- The map interaction contract is shared while visual density and simultaneous controls adapt by device.
- Some content is intentionally omitted rather than stacked.
- Watch-to-phone navigation uses `WatchConnectivity`.
- Device-specific reductions must be documented when a new screen is added.
