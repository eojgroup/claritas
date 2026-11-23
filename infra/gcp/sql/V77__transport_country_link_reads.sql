-- Country filters combine location, origin, destination and registration links.
-- Without an index for every branch PostgreSQL falls back to the broad live
-- overview index, reading thousands of snapshot heap rows for a small country.
-- The existing location and origin indexes cover the first two branches.
CREATE INDEX CONCURRENTLY IF NOT EXISTS transport_snapshot_destination_country_idx
  ON transport_snapshot (destination_country_iso2, mode, observed_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS transport_snapshot_registration_country_idx
  ON transport_snapshot (registration_country_iso2, mode, observed_at DESC);
ANALYZE transport_snapshot;
