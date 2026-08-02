# ADR-0001: Analytics-First UI Shell and Information Hierarchy

- Status: Accepted
- Date: 2026-07-20
- Note: The standalone leadership layer and context surface are superseded by [ADR-0004](0004-news-led-leadership-signals.md).

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

Daily briefing is the cross-domain synthesis entry point. On the dashboard it precedes, rather than replaces, the spatial map and detailed trend analysis. Podcast evidence and country leadership are exposed as actionable context beside the map: podcast signals retain feed, episode, and timestamp provenance, while leadership routes to the officeholder map layer. Briefing generation receives both attributed podcast evidence and current leadership context.

The default map layer is an explainable cross-source relevance view. It combines normalized news concentration, attributed podcast relevance, weather anomaly, market movement, and a cross-domain confirmation bonus. Leadership provides contextual names but does not create urgency. The highest-relevance country is visibly recommended and selection reveals each score driver in a cross-domain country profile.

Dashboard and News share one compact priority-news row contract. Priority, time, place, headline, and source remain visible while imagery and narrative detail are disclosed only for the selected row. Selecting a map polygon, bubble, podcast country link, or news row updates the same country selection. Bubble maps and charts are retained only where they answer spatial, time, comparison, correlation, mix, or ranking questions.

## Consequences

- Page implementations share visual contracts but may use different geometry.
- New analytical pages must identify one primary question and surface.
- Settings, documents, and admin configuration must not be implemented as dashboard-card grids.
- Existing data selection and drilldown behavior remains intact.
- Cross-source ranking must expose contributing domains and source provenance; it must not imply causal linkage.
