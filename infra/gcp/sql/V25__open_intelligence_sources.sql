-- V25: open intelligence sources (GDELT, SEC EDGAR, ECB, Open-Meteo)

-- Standardized news metadata used for multilingual filtering and tone analysis.
ALTER TABLE item
  ADD COLUMN IF NOT EXISTS language_code TEXT,
  ADD COLUMN IF NOT EXISTS source_country_iso2 CHAR(2),
  ADD COLUMN IF NOT EXISTS tone DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS item_language_time_idx
  ON item (language_code, event_time DESC)
  WHERE language_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS item_source_country_time_idx
  ON item (source_country_iso2, event_time DESC)
  WHERE source_country_iso2 IS NOT NULL;

-- Structured GDELT event stream. Events stay separate from publisher stories so
-- they can drive maps and risk analytics without polluting the news feed.
CREATE TABLE IF NOT EXISTS global_event (
  id                  BIGSERIAL PRIMARY KEY,
  source_id           BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  external_id         TEXT NOT NULL,
  event_code          TEXT,
  event_root_code     TEXT,
  quad_class          SMALLINT,
  goldstein_scale     DOUBLE PRECISION,
  avg_tone            DOUBLE PRECISION,
  actor1_name         TEXT,
  actor1_country_code TEXT,
  actor2_name         TEXT,
  actor2_country_code TEXT,
  action_country_iso2 CHAR(2) REFERENCES country(iso2),
  action_geo_name     TEXT,
  action_lat          DOUBLE PRECISION,
  action_lon          DOUBLE PRECISION,
  mention_count       INTEGER,
  source_count        INTEGER,
  article_count       INTEGER,
  event_time          TIMESTAMPTZ NOT NULL,
  url                 TEXT,
  payload             JSONB NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS global_event_country_time_idx
  ON global_event (action_country_iso2, event_time DESC);
CREATE INDEX IF NOT EXISTS global_event_time_idx
  ON global_event (event_time DESC);
CREATE INDEX IF NOT EXISTS global_event_payload_gin
  ON global_event USING GIN (payload jsonb_path_ops);

-- GDELT Global Knowledge Graph document-level enrichment.
CREATE TABLE IF NOT EXISTS news_signal (
  id                  BIGSERIAL PRIMARY KEY,
  source_id           BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  external_id         TEXT NOT NULL,
  url                 TEXT,
  domain              TEXT,
  language_code       TEXT,
  source_country_iso2 CHAR(2),
  tone                DOUBLE PRECISION,
  positive_score      DOUBLE PRECISION,
  negative_score      DOUBLE PRECISION,
  polarity            DOUBLE PRECISION,
  themes              JSONB NOT NULL DEFAULT '[]'::jsonb,
  persons             JSONB NOT NULL DEFAULT '[]'::jsonb,
  organizations       JSONB NOT NULL DEFAULT '[]'::jsonb,
  locations           JSONB NOT NULL DEFAULT '[]'::jsonb,
  event_time          TIMESTAMPTZ NOT NULL,
  payload             JSONB NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS news_signal_time_idx ON news_signal (event_time DESC);
CREATE INDEX IF NOT EXISTS news_signal_url_idx ON news_signal (url) WHERE url IS NOT NULL;
CREATE INDEX IF NOT EXISTS news_signal_themes_gin ON news_signal USING GIN (themes);

-- Market-moving primary-source events such as SEC filings.
CREATE TABLE IF NOT EXISTS market_event (
  id             BIGSERIAL PRIMARY KEY,
  source_id      BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  external_id    TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  symbol         TEXT,
  company_name   TEXT,
  country_iso2   CHAR(2) REFERENCES country(iso2),
  title          TEXT NOT NULL,
  summary        TEXT,
  url            TEXT,
  event_time     TIMESTAMPTZ NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS market_event_symbol_time_idx
  ON market_event (symbol, event_time DESC);
CREATE INDEX IF NOT EXISTS market_event_type_time_idx
  ON market_event (event_type, event_time DESC);

-- Reusable numeric series for SEC company facts and ECB FX/rate observations.
CREATE TABLE IF NOT EXISTS market_indicator (
  id             BIGSERIAL PRIMARY KEY,
  source_id      BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  external_id    TEXT NOT NULL,
  category       TEXT NOT NULL,
  series_key     TEXT NOT NULL,
  symbol         TEXT,
  country_iso2   CHAR(2) REFERENCES country(iso2),
  name           TEXT NOT NULL,
  unit           TEXT,
  frequency      TEXT,
  period_start   DATE,
  period_end     DATE NOT NULL,
  value          DOUBLE PRECISION NOT NULL,
  observed_at    TIMESTAMPTZ NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS market_indicator_category_period_idx
  ON market_indicator (category, period_end DESC);
CREATE INDEX IF NOT EXISTS market_indicator_series_period_idx
  ON market_indicator (series_key, period_end DESC);
CREATE INDEX IF NOT EXISTS market_indicator_symbol_period_idx
  ON market_indicator (symbol, period_end DESC)
  WHERE symbol IS NOT NULL;

-- Open-Meteo adds model-derived current conditions beyond the legacy fields.
ALTER TABLE weather_snapshot
  ADD COLUMN IF NOT EXISTS apparent_temp_c DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS precipitation_mm DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS weather_code INTEGER,
  ADD COLUMN IF NOT EXISTS cloud_cover INTEGER,
  ADD COLUMN IF NOT EXISTS wind_direction INTEGER,
  ADD COLUMN IF NOT EXISTS wind_gust DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS is_day BOOLEAN,
  ADD COLUMN IF NOT EXISTS source_kind TEXT DEFAULT 'observation';

CREATE TABLE IF NOT EXISTS weather_forecast (
  id                        BIGSERIAL PRIMARY KEY,
  source_id                 BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  country_iso2              CHAR(2) NOT NULL REFERENCES country(iso2),
  granularity               TEXT NOT NULL CHECK (granularity IN ('hourly', 'daily')),
  forecast_time             TIMESTAMPTZ NOT NULL,
  temp_c                    DOUBLE PRECISION,
  apparent_temp_c           DOUBLE PRECISION,
  temp_min_c                DOUBLE PRECISION,
  temp_max_c                DOUBLE PRECISION,
  apparent_temp_min_c       DOUBLE PRECISION,
  apparent_temp_max_c       DOUBLE PRECISION,
  humidity                  INTEGER,
  precipitation_probability INTEGER,
  precipitation_mm          DOUBLE PRECISION,
  rain_mm                   DOUBLE PRECISION,
  snowfall_cm               DOUBLE PRECISION,
  weather_code              INTEGER,
  wind_speed                DOUBLE PRECISION,
  wind_gust                 DOUBLE PRECISION,
  uv_index                  DOUBLE PRECISION,
  visibility_m              DOUBLE PRECISION,
  sunrise_at                TIMESTAMPTZ,
  sunset_at                 TIMESTAMPTZ,
  payload                   JSONB NOT NULL,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_id, country_iso2, granularity, forecast_time)
);

CREATE INDEX IF NOT EXISTS weather_forecast_country_time_idx
  ON weather_forecast (country_iso2, granularity, forecast_time);

CREATE TABLE IF NOT EXISTS air_quality_snapshot (
  id              BIGSERIAL PRIMARY KEY,
  source_id       BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  country_iso2    CHAR(2) NOT NULL REFERENCES country(iso2),
  observed_at     TIMESTAMPTZ NOT NULL,
  european_aqi    DOUBLE PRECISION,
  us_aqi          DOUBLE PRECISION,
  pm10            DOUBLE PRECISION,
  pm2_5           DOUBLE PRECISION,
  carbon_monoxide DOUBLE PRECISION,
  nitrogen_dioxide DOUBLE PRECISION,
  sulphur_dioxide DOUBLE PRECISION,
  ozone           DOUBLE PRECISION,
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_id, country_iso2)
);

CREATE INDEX IF NOT EXISTS air_quality_country_idx
  ON air_quality_snapshot (country_iso2, observed_at DESC);

-- Add the keyless providers to existing automation rules without discarding
-- operator-customized payloads or provider choices.
UPDATE ingestion_automation_rule
SET default_payload = jsonb_set(
      COALESCE(default_payload, '{}'::jsonb),
      '{providers}',
      COALESCE(default_payload->'providers', '{}'::jsonb) || '{"gdelt": true}'::jsonb,
      true
    )
WHERE pipeline = 'news';

UPDATE ingestion_automation_rule
SET default_payload = jsonb_set(
      COALESCE(default_payload, '{}'::jsonb),
      '{providers}',
      COALESCE(default_payload->'providers', '{}'::jsonb) || '{"openmeteo": true}'::jsonb,
      true
    )
WHERE pipeline = 'weather';

UPDATE ingestion_automation_rule
SET default_payload = jsonb_set(
      COALESCE(default_payload, '{}'::jsonb),
      '{providers}',
      COALESCE(default_payload->'providers', '{}'::jsonb) || '{"secEdgar": true, "ecb": true}'::jsonb,
      true
    )
WHERE pipeline = 'market';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_global_event') THEN
    CREATE TRIGGER set_updated_at_global_event BEFORE UPDATE ON global_event
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_news_signal') THEN
    CREATE TRIGGER set_updated_at_news_signal BEFORE UPDATE ON news_signal
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_market_event') THEN
    CREATE TRIGGER set_updated_at_market_event BEFORE UPDATE ON market_event
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_market_indicator') THEN
    CREATE TRIGGER set_updated_at_market_indicator BEFORE UPDATE ON market_indicator
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_weather_forecast') THEN
    CREATE TRIGGER set_updated_at_weather_forecast BEFORE UPDATE ON weather_forecast
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_air_quality_snapshot') THEN
    CREATE TRIGGER set_updated_at_air_quality_snapshot BEFORE UPDATE ON air_quality_snapshot
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
