# Claritas Architecture Docs

This directory contains architecture and product design references that should evolve with the repository.

## Documents

- [UI Architecture and Cross-Device Design](cross-device-design.md): the analytics-first operational workspace, page archetypes, component contracts, adaptive rules, and implemented layouts for web, iPhone, iPad, and Apple Watch.
- [Business Capabilities](capabilities.md): business capability map for the Claritas platform.
- [Cloud SQL capacity and transport load](../operations/cloud-sql-capacity.md): production sizing, connection budgets, bounded transport retention, and incident controls.
- [Cost-optimized production baseline](../operations/cost-baseline.md): resource shape, expected trade-offs, and scale-up triggers.
- [Data-source governance](../data-source-governance.md): active providers, attribution requirements, and reviewed exclusions.
- [Unified Signal Desk, event correlation and Earth Observation](event-earth-observation.md): domain envelopes, auditable anchored correlation, EO/GIBS/vision boundaries, APNs semantics and client contract.
- [Unified Signal Desk and Earth Observation administrator setup](../operations/earth-observation-admin-setup.md): exact secrets, active flags, readiness checks, cost guardrails and safe rollback.
- [Incremental event/EO cost model](../operations/event-earth-observation-cost-model.md): small, 10× and 100× planning ranges plus exact enforced-versus-operational ceiling semantics.

## UI Architecture Decisions

- [ADR-0001: Analytics-first UI shell and hierarchy](../ADRs/0001-analytics-first-ui-shell.md)
- [ADR-0002: Multi-device adaptive strategy](../ADRs/0002-multi-device-adaptive-strategy.md)
- [ADR-0003: Semantic tokens and component taxonomy](../ADRs/0003-semantic-ui-system.md)
- [ADR-0005: Transactional event backbone](../ADRs/0005-transactional-event-backbone.md)
- [ADR-0006: PostGIS location and physical-asset graph](../ADRs/0006-postgis-location-graph.md)
- [ADR-0007: Provider-neutral Earth Observation, contextual imagery and private assets](../ADRs/0007-earth-observation-provider-assets.md)

## Documentation Rules

- Prefer Markdown and Mermaid diagrams so changes can be reviewed in pull requests.
- Keep design decisions close to implementation paths.
- Update the cross-device design spec when adding or materially changing a screen on web, mobile, iPad, or watch.
