-- V2: Add weather_snapshot table and index for OpenWeather integration
CREATE TABLE IF NOT EXISTS weather_snapshot (
  id             BIGSERIAL PRIMARY KEY,
  source_id      BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  country_iso2   CHAR(2) NOT NULL REFERENCES country(iso2),
  coord_lat      DOUBLE PRECISION,
  coord_lon      DOUBLE PRECISION,
  temp_c         DOUBLE PRECISION,
  feels_like_c   DOUBLE PRECISION,
  temp_min_c     DOUBLE PRECISION,
  temp_max_c     DOUBLE PRECISION,
  humidity       INTEGER,
  pressure       INTEGER,
  wind_speed     DOUBLE PRECISION,
  weather_main   TEXT,
  weather_desc   TEXT,
  observed_at    TIMESTAMPTZ NOT NULL,
  payload        JSONB NOT NULL,
  dedupe_hash    TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_id, country_iso2)
);

CREATE INDEX IF NOT EXISTS weather_snapshot_country_idx ON weather_snapshot (country_iso2);

