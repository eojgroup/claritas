-- V22: port geofencing and vehicle categories for defensible movement trends

ALTER TABLE transport_snapshot
  ADD COLUMN IF NOT EXISTS vehicle_category TEXT,
  ADD COLUMN IF NOT EXISTS current_location_name TEXT;

ALTER TABLE transport_track_point
  ADD COLUMN IF NOT EXISTS vehicle_category TEXT,
  ADD COLUMN IF NOT EXISTS current_location_name TEXT;

CREATE INDEX IF NOT EXISTS transport_track_point_country_location_time_idx
  ON transport_track_point (
    mode,
    current_country_iso2,
    current_location_name,
    observed_at DESC
  );

CREATE INDEX IF NOT EXISTS transport_track_point_category_time_idx
  ON transport_track_point (mode, vehicle_category, observed_at DESC);
