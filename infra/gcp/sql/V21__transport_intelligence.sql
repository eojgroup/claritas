-- V21: shared maritime and aviation tracking, routes, and country linkage

CREATE TABLE IF NOT EXISTS transport_snapshot (
  id                  BIGSERIAL PRIMARY KEY,
  mode                TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  display_name        TEXT,
  callsign            TEXT,
  flight_number       TEXT,
  registration        TEXT,
  vehicle_type        TEXT,
  latitude            DOUBLE PRECISION,
  longitude           DOUBLE PRECISION,
  heading             DOUBLE PRECISION,
  speed               DOUBLE PRECISION,
  altitude            DOUBLE PRECISION,
  vertical_rate       DOUBLE PRECISION,
  current_country_iso2 CHAR(2),
  origin_country_iso2 CHAR(2),
  destination_country_iso2 CHAR(2),
  registration_country_iso2 CHAR(2),
  origin_name         TEXT,
  destination_name    TEXT,
  origin_latitude     DOUBLE PRECISION,
  origin_longitude    DOUBLE PRECISION,
  destination_latitude DOUBLE PRECISION,
  destination_longitude DOUBLE PRECISION,
  route_label         TEXT,
  linkage_basis       TEXT[] NOT NULL DEFAULT '{}',
  linkage_confidence  TEXT NOT NULL DEFAULT 'low',
  status              TEXT,
  is_alert            BOOLEAN NOT NULL DEFAULT false,
  source_name         TEXT NOT NULL,
  observed_at         TIMESTAMPTZ NOT NULL,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mode, entity_id),
  CHECK (mode IN ('maritime', 'aviation')),
  CHECK (linkage_confidence IN ('high', 'medium', 'low', 'none'))
);

CREATE INDEX IF NOT EXISTS transport_snapshot_mode_observed_idx
  ON transport_snapshot (mode, observed_at DESC);

CREATE INDEX IF NOT EXISTS transport_snapshot_current_country_idx
  ON transport_snapshot (current_country_iso2, observed_at DESC);

CREATE INDEX IF NOT EXISTS transport_snapshot_origin_destination_idx
  ON transport_snapshot (origin_country_iso2, destination_country_iso2, observed_at DESC);

CREATE TABLE IF NOT EXISTS transport_track_point (
  id                  BIGSERIAL PRIMARY KEY,
  mode                TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  latitude            DOUBLE PRECISION NOT NULL,
  longitude           DOUBLE PRECISION NOT NULL,
  heading             DOUBLE PRECISION,
  speed               DOUBLE PRECISION,
  altitude            DOUBLE PRECISION,
  current_country_iso2 CHAR(2),
  origin_country_iso2 CHAR(2),
  destination_country_iso2 CHAR(2),
  observed_at         TIMESTAMPTZ NOT NULL,
  source_name         TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mode IN ('maritime', 'aviation'))
);

CREATE UNIQUE INDEX IF NOT EXISTS transport_track_point_sample_unique
  ON transport_track_point (mode, entity_id, observed_at);

CREATE INDEX IF NOT EXISTS transport_track_point_entity_time_idx
  ON transport_track_point (mode, entity_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS transport_track_point_time_idx
  ON transport_track_point (observed_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_transport_snapshot'
  ) THEN
    CREATE TRIGGER set_updated_at_transport_snapshot
      BEFORE UPDATE ON transport_snapshot
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

INSERT INTO source (name, api_base_url, auth_type, metadata)
VALUES
  (
    'aisstream',
    'wss://stream.aisstream.io/v0/stream',
    'api_key',
    '{"domain":"maritime","transport":"websocket","license":"provider terms"}'::jsonb
  ),
  (
    'adsb_lol',
    'https://api.adsb.lol',
    'none',
    '{"domain":"aviation","transport":"rest","license":"ODbL-1.0"}'::jsonb
  )
ON CONFLICT (name) DO UPDATE SET
  api_base_url = EXCLUDED.api_base_url,
  auth_type = EXCLUDED.auth_type,
  metadata = EXCLUDED.metadata;
