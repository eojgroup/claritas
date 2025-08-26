-- sources & ingestion
CREATE TABLE IF NOT EXISTS source (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT UNIQUE NOT NULL,
  api_base_url TEXT NOT NULL,
  auth_type    TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingestion_run (
  id          BIGSERIAL PRIMARY KEY,
  source_id   BIGINT REFERENCES source(id),
  started_at  TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status      TEXT,
  stats       JSONB
);

-- countries
CREATE TABLE IF NOT EXISTS country (
  iso2      CHAR(2) PRIMARY KEY,
  iso3      CHAR(3) UNIQUE,
  name      TEXT NOT NULL,
  region    TEXT,
  centroid  TEXT,   -- swap to PostGIS later
  ext       JSONB
);

-- generic items
CREATE TABLE IF NOT EXISTS item (
  id           BIGSERIAL PRIMARY KEY,
  source_id    BIGINT REFERENCES source(id),
  external_id  TEXT,
  kind         TEXT,
  title        TEXT,
  summary      TEXT,
  url          TEXT,
  country_iso2 CHAR(2) REFERENCES country(iso2),
  event_time   TIMESTAMPTZ,
  payload      JSONB NOT NULL,
  dedupe_hash  TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS item_source_ext_idx ON item (source_id, external_id);
CREATE INDEX IF NOT EXISTS item_country_time_idx ON item (country_iso2, event_time DESC);
CREATE INDEX IF NOT EXISTS item_kind_time_idx ON item (kind, event_time DESC);
CREATE INDEX IF NOT EXISTS item_payload_gin ON item USING GIN (payload jsonb_path_ops);