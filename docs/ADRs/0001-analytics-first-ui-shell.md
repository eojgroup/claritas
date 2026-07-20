# ADR-0001: Analytics-First UI Shell and Information Hierarchy

- Status: Accepted
- Date: 2026-07-20

## Context

Claritas displayed many data and narrative modules as similarly weighted bordered cards. This made it difficult to identify the primary analytical task, current scope, and exceptions requiring action. Admin, account, and policy tasks also inherited dashboard presentation even though their interaction models differ.

## Decision

Adopt an **analytics-first operational workspace** shell:

- persistent grouped navigation and a shared page header;
- title, scope summary, freshness/live state, and global actions in the header;
- grouped sticky page controls on desktop/tablet;
- KPI strip followed by a deliberate overview stage: briefing synthesis, spatial map, and podcast/leadership context;
- one dominant detailed analytical surface after the overview stage;
- exception/insight rail as secondary context;
- dense table/feed rows for monitoring;
- separate control-room, settings, and document archetypes.

Daily briefing is the cross-domain synthesis entry point. On the dashboard it precedes, rather than replaces, the spatial map and detailed trend analysis. Podcast evidence and country leadership are exposed as actionable context beside the map: podcast signals route to timestamped evidence, while leadership routes to the officeholder map layer. Selecting a map polygon or bubble replaces that global context with a cross-domain country profile and links the primary trend to the same country. Bubble maps and charts are retained only where they answer spatial, time, comparison, correlation, mix, or ranking questions.

## Consequences

- Page implementations share visual contracts but may use different geometry.
- New analytical pages must identify one primary question and surface.
- Settings, documents, and admin configuration must not be implemented as dashboard-card grids.
- Existing data selection and drilldown behavior remains intact.
