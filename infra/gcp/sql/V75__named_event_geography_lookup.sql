-- Narrow named-place geography audits without combining a location lookup
-- with the entire global observation geography index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS intelligence_event_named_geography_idx
  ON intelligence_event (primary_location_id, id)
  WHERE primary_location_id IS NOT NULL AND geography IS NOT NULL;
