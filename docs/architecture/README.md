# Claritas Architecture Docs

This directory contains architecture and product design references that should evolve with the repository.

## Documents

- [UI Architecture and Cross-Device Design](cross-device-design.md): the analytics-first operational workspace, page archetypes, component contracts, adaptive rules, and implemented layouts for web, iPhone, iPad, and Apple Watch.
- [Business Capabilities](capabilities.md): business capability map for the Claritas platform.
- [Postal Email Delivery](postal-email-delivery.md): dedicated GCP mail-server topology, DNS and trust boundaries, Terraform ownership, and activation gates.

## UI Architecture Decisions

- [ADR-0001: Analytics-first UI shell and hierarchy](../ADRs/0001-analytics-first-ui-shell.md)
- [ADR-0002: Multi-device adaptive strategy](../ADRs/0002-multi-device-adaptive-strategy.md)
- [ADR-0003: Semantic tokens and component taxonomy](../ADRs/0003-semantic-ui-system.md)

## Documentation Rules

- Prefer Markdown and Mermaid diagrams so changes can be reviewed in pull requests.
- Keep design decisions close to implementation paths.
- Update the cross-device design spec when adding or materially changing a screen on web, mobile, iPad, or watch.
