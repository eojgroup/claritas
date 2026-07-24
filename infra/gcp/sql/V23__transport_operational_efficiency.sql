-- V23: precomputed transport activity, movement events, and bounded query paths

CREATE TABLE IF NOT EXISTS transport_movement_event (
  id                  BIGSERIAL PRIMARY KEY,
  mode                TEXT NOT NULL DEFAULT 'maritime',
  entity_id           TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  country_iso2        CHAR(2) NOT NULL,
  location_name       TEXT NOT NULL,
  vehicle_category    TEXT,
  observed_at         TIMESTAMPTZ NOT NULL,
  source_name         TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mode = 'maritime'),
  CHECK (event_type IN ('departure', 'arrival')),
  UNIQUE (mode, entity_id, event_type, location_name, observed_at)
);

CREATE INDEX IF NOT EXISTS transport_movement_event_time_idx
  ON transport_movement_event (observed_at DESC);

CREATE INDEX IF NOT EXISTS transport_movement_event_country_time_idx
  ON transport_movement_event (country_iso2, observed_at DESC);

CREATE INDEX IF NOT EXISTS transport_movement_event_port_time_idx
  ON transport_movement_event (country_iso2, location_name, observed_at DESC);

CREATE TABLE IF NOT EXISTS transport_movement_hour (
  bucket                    TIMESTAMPTZ NOT NULL,
  country_iso2              CHAR(2) NOT NULL,
  location_name             TEXT NOT NULL,
  departures                INTEGER NOT NULL DEFAULT 0,
  arrivals                  INTEGER NOT NULL DEFAULT 0,
  cargo_vessel_departures   INTEGER NOT NULL DEFAULT 0,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, country_iso2, location_name)
);

CREATE INDEX IF NOT EXISTS transport_movement_hour_country_time_idx
  ON transport_movement_hour (country_iso2, bucket DESC);

CREATE TABLE IF NOT EXISTS transport_entity_activity_hour (
  bucket              TIMESTAMPTZ NOT NULL,
  mode                TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  country_iso2        TEXT NOT NULL,
  first_observed_at   TIMESTAMPTZ NOT NULL,
  last_observed_at    TIMESTAMPTZ NOT NULL,
  source_name         TEXT NOT NULL,
  vehicle_category    TEXT,
  PRIMARY KEY (bucket, mode, entity_id, country_iso2),
  CHECK (mode IN ('maritime', 'aviation')),
  CHECK (country_iso2 = '*' OR country_iso2 ~ '^[A-Z]{2}$')
);

CREATE INDEX IF NOT EXISTS transport_entity_activity_scope_time_idx
  ON transport_entity_activity_hour (mode, country_iso2, bucket DESC);

CREATE INDEX IF NOT EXISTS transport_entity_activity_last_observed_idx
  ON transport_entity_activity_hour (last_observed_at DESC);

CREATE OR REPLACE FUNCTION record_transport_movement_event()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.mode <> 'maritime'
     OR NEW.observed_at <= OLD.observed_at
     OR OLD.current_location_name IS NOT DISTINCT FROM NEW.current_location_name THEN
    RETURN NEW;
  END IF;

  IF OLD.current_location_name IS NOT NULL
     AND OLD.current_country_iso2 IS NOT NULL THEN
    INSERT INTO transport_movement_event (
      mode,
      entity_id,
      event_type,
      country_iso2,
      location_name,
      vehicle_category,
      observed_at,
      source_name
    )
    VALUES (
      NEW.mode,
      NEW.entity_id,
      'departure',
      OLD.current_country_iso2,
      OLD.current_location_name,
      COALESCE(OLD.vehicle_category, NEW.vehicle_category),
      NEW.observed_at,
      NEW.source_name
    )
    ON CONFLICT DO NOTHING;
  END IF;

  IF NEW.current_location_name IS NOT NULL
     AND NEW.current_country_iso2 IS NOT NULL THEN
    INSERT INTO transport_movement_event (
      mode,
      entity_id,
      event_type,
      country_iso2,
      location_name,
      vehicle_category,
      observed_at,
      source_name
    )
    VALUES (
      NEW.mode,
      NEW.entity_id,
      'arrival',
      NEW.current_country_iso2,
      NEW.current_location_name,
      NEW.vehicle_category,
      NEW.observed_at,
      NEW.source_name
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS record_transport_movement_event ON transport_snapshot;
CREATE TRIGGER record_transport_movement_event
  AFTER UPDATE OF current_location_name, current_country_iso2, observed_at
  ON transport_snapshot
  FOR EACH ROW
  EXECUTE FUNCTION record_transport_movement_event();

CREATE OR REPLACE FUNCTION aggregate_transport_movement_hour()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO transport_movement_hour (
    bucket,
    country_iso2,
    location_name,
    departures,
    arrivals,
    cargo_vessel_departures,
    updated_at
  )
  VALUES (
    date_trunc('hour', NEW.observed_at),
    NEW.country_iso2,
    NEW.location_name,
    CASE WHEN NEW.event_type = 'departure' THEN 1 ELSE 0 END,
    CASE WHEN NEW.event_type = 'arrival' THEN 1 ELSE 0 END,
    CASE
      WHEN NEW.event_type = 'departure'
       AND NEW.vehicle_category IN ('cargo', 'tanker') THEN 1
      ELSE 0
    END,
    now()
  )
  ON CONFLICT (bucket, country_iso2, location_name) DO UPDATE SET
    departures = transport_movement_hour.departures + EXCLUDED.departures,
    arrivals = transport_movement_hour.arrivals + EXCLUDED.arrivals,
    cargo_vessel_departures =
      transport_movement_hour.cargo_vessel_departures +
      EXCLUDED.cargo_vessel_departures,
    updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS aggregate_transport_movement_hour ON transport_movement_event;
CREATE TRIGGER aggregate_transport_movement_hour
  AFTER INSERT ON transport_movement_event
  FOR EACH ROW
  EXECUTE FUNCTION aggregate_transport_movement_hour();
