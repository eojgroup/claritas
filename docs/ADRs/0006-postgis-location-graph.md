# ADR-0006: PostGIS location and physical-asset graph

## Status

Accepted

## Context

Country strings cannot reliably join stories, ports, airports, chokepoints, disasters, transport movement and Earth Observation areas.

## Decision

Cloud SQL enables PostGIS and stores canonical `intelligence_location` records with geometry, geography centre, bounding box, ISO country/admin metadata, monitoring tier and source governance. Aliases and external identifiers are separate tables. `physical_asset` and market-exposure relationships connect real infrastructure and instruments to those locations.

Resolution proceeds from stable identifiers to normalized aliases, then bounded nearest-neighbour matching, then conservative text matching. Unresolved evidence remains unresolved; the system does not manufacture a location. Seed data covers strategic chokepoints, major ports/airports and generalized energy/agricultural regions, with per-row provenance.

## Consequences

- All domains can share stable spatial keys and indexed distance queries.
- Large regions are deterministically cropped to configured provider AOI budgets.
- Catalogue additions are data administration, not code changes.
- Generalized or inferred geometries must remain labelled as such.
