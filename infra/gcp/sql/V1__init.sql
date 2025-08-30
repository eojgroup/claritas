-- =====================================================================
-- Claritas DB: initial structure to support NewsAPI and future sources
-- =====================================================================

-- Utility trigger to maintain updated_at
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==================
-- Sources & ingestion
-- ==================
CREATE TABLE IF NOT EXISTS source (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT UNIQUE NOT NULL, -- logical name e.g. 'newsapi'
  api_base_url TEXT NOT NULL,
  auth_type    TEXT,                 -- e.g. 'api_key', 'oauth', etc.
  metadata     JSONB,                -- connector-specific static config
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Optional subdivision of a source (feed/endpoint + parameters)
CREATE TABLE IF NOT EXISTS source_feed (
  id         BIGSERIAL PRIMARY KEY,
  source_id  BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  feed_key   TEXT NOT NULL,      -- e.g. 'top-headlines', 'everything?q=ai'
  params     JSONB,              -- request params (category, query, country)
  cursor     JSONB,              -- last fetched position (e.g., publishedAt)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_id, feed_key)
);

CREATE TABLE IF NOT EXISTS ingestion_run (
  id          BIGSERIAL PRIMARY KEY,
  source_id   BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  feed_id     BIGINT REFERENCES source_feed(id) ON DELETE SET NULL,
  started_at  TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status      TEXT,   -- e.g. 'running' | 'success' | 'failed'
  error       TEXT,   -- error message if failed
  stats       JSONB,  -- counters (fetched/inserted/updated/skipped)
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- =========
-- Countries
-- =========
CREATE TABLE IF NOT EXISTS country (
  iso2      CHAR(2) PRIMARY KEY,
  iso3      CHAR(3) UNIQUE,
  name      TEXT NOT NULL,
  region    TEXT,
  centroid  TEXT,   -- swap to PostGIS later
  ext       JSONB
);

-- =====
-- Items
-- =====
CREATE TABLE IF NOT EXISTS item (
  id           BIGSERIAL PRIMARY KEY,
  source_id    BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  external_id  TEXT,                    -- provider's stable id or URL
  kind         TEXT,                    -- e.g. 'news_article'
  title        TEXT,
  summary      TEXT,
  url          TEXT,
  country_iso2 CHAR(2) REFERENCES country(iso2),
  event_time   TIMESTAMPTZ,            -- when the event/article happened
  payload      JSONB NOT NULL,         -- normalized, provider-agnostic
  dedupe_hash  TEXT,                   -- precomputed hash for idempotency
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Useful indexes and constraints
CREATE UNIQUE INDEX IF NOT EXISTS item_source_ext_idx ON item (source_id, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS item_dedupe_unique ON item (dedupe_hash) WHERE dedupe_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS item_country_time_idx ON item (country_iso2, event_time DESC);
CREATE INDEX IF NOT EXISTS item_kind_time_idx ON item (kind, event_time DESC);
CREATE INDEX IF NOT EXISTS item_source_time_idx ON item (source_id, event_time DESC);
CREATE INDEX IF NOT EXISTS item_payload_gin ON item USING GIN (payload jsonb_path_ops);

-- Triggers to maintain updated_at
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_source') THEN
    CREATE TRIGGER set_updated_at_source BEFORE UPDATE ON source
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_source_feed') THEN
    CREATE TRIGGER set_updated_at_source_feed BEFORE UPDATE ON source_feed
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_ingestion_run') THEN
    CREATE TRIGGER set_updated_at_ingestion_run BEFORE UPDATE ON ingestion_run
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_item') THEN
    CREATE TRIGGER set_updated_at_item BEFORE UPDATE ON item
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
