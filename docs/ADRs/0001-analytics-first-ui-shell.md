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
- KPI strip followed by one dominant analytical surface;
- exception/insight rail as secondary context;
- dense table/feed rows for monitoring;
- separate control-room, settings, and document archetypes.

Daily briefing remains a cross-domain synthesis, but it does not displace primary comparison and monitoring surfaces. Bubble maps and charts are retained only where they answer spatial, time, comparison, correlation, mix, or ranking questions.

## Consequences

- Page implementations share visual contracts but may use different geometry.
- New analytical pages must identify one primary question and surface.
- Settings, documents, and admin configuration must not be implemented as dashboard-card grids.
- Existing data selection and drilldown behavior remains intact.
