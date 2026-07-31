-- V24: keep live transport and briefing reads on bounded, covering query paths

-- Global aviation trends filter by mode and a 48-hour bucket window before
-- grouping by country/entity. The previous index put country before bucket,
-- which forced a much wider history scan for an unscoped overview.
CREATE INDEX IF NOT EXISTS transport_entity_activity_mode_bucket_country_entity_idx
  ON transport_entity_activity_hour (
    mode,
    bucket DESC,
    country_iso2,
    entity_id
  );

-- No application query filters activity by last_observed_at after V24. Avoid
-- maintaining that high-churn index on every hourly presence update.
DROP INDEX IF EXISTS transport_entity_activity_last_observed_idx;

-- Current overview aggregates all use the same freshness predicate and these
-- compact linkage fields. Replacing the original key-only index lets
-- PostgreSQL satisfy aggregate refreshes without reading the large JSON
-- payload stored in each current snapshot.
CREATE INDEX IF NOT EXISTS transport_snapshot_overview_idx
  ON transport_snapshot (mode, observed_at DESC)
  INCLUDE (
    id,
    entity_id,
    current_country_iso2,
    origin_country_iso2,
    destination_country_iso2,
    registration_country_iso2,
    is_alert,
    flight_number,
    callsign,
    display_name
  );

DROP INDEX IF EXISTS transport_snapshot_mode_observed_idx;

ANALYZE transport_entity_activity_hour;
ANALYZE transport_snapshot;
