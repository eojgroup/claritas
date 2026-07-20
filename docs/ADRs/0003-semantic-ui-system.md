# ADR-0003: Semantic Tokens and Component Taxonomy

- Status: Accepted
- Date: 2026-07-20

## Context

Raw per-screen color, border, radius, and shadow choices created visual inconsistency and excessive decorative weight. Similar-looking cards were used for unrelated analytical, form, and document tasks.

## Decision

Use semantic tokens for shell planes, text, borders, accents, and signal states. Standardize spacing, control/panel radii, typography roles, and elevation. Use the following component taxonomy:

- page header;
- control bar;
- KPI strip;
- chart panel;
- map panel;
- table/feed;
- priority news stream;
- insights rail;
- form section;
- document section;
- compact watch card.

Numerical values use tabular numerals. Standard panels use subtle separators and little or no shadow. Large shadows are reserved for overlays. All-caps text is limited to supporting metadata.

Web tokens are CSS custom properties in `apps/web/src/index.css`. Native equivalents live in `ClaritasPalette`, `ClaritasLayout`, and `WatchPalette`.

## Consequences

- New components use semantic roles rather than raw colors.
- A component name describes its information contract, not merely its border treatment.
- Light and dark themes share the same semantic contract.
- Visual consistency can be changed centrally without forcing identical layouts across devices.
