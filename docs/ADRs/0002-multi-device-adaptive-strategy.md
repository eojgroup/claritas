# ADR-0002: Multi-Device Adaptive Strategy

- Status: Accepted
- Date: 2026-07-20

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

Desktop keeps comparison, charts, maps, dense feeds, and full admin configuration. Its dashboard overview pairs the map with podcast and leadership context after the briefing synthesis. Tablet shows one major stage at a time and uses 44-point touch targets. Mobile prioritizes KPI subset, compact briefing, evidence/context rows, alerts, live rows, saved/current scope, and drill-in. Mobile web retains a reduced-control map preview; the native iPhone map remains behind intentional disclosure. Watch shows freshness, threshold count, top mover, affected weather, headline alerts, a short briefing, and phone handoff.

Maps, full charts, configuration-heavy forms, admin mutations, profile editing, policies, podcast evidence exploration, and leadership exploration are unavailable on watch.

## Consequences

- Components adapt by device role, not only by available width.
- Some content is intentionally omitted rather than stacked.
- Watch-to-phone navigation uses `WatchConnectivity`.
- Device-specific reductions must be documented when a new screen is added.
