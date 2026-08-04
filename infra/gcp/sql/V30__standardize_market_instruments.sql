-- V30: standardize commercially reusable market and macro series.
-- Observations remain in market_indicator. This catalogue supplies stable
-- identity, provenance, scope, units, frequency, and ISO2 relationships.

CREATE TABLE IF NOT EXISTS market_instrument (
  id                   BIGSERIAL PRIMARY KEY,
  source_id            BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  provider_symbol      TEXT NOT NULL,
  canonical_symbol     TEXT NOT NULL,
  name                 TEXT NOT NULL,
  instrument_type      TEXT NOT NULL CHECK (instrument_type IN ('equity_index', 'commodity', 'macro', 'fx', 'rate')),
  asset_class          TEXT NOT NULL,
  exchange_code        TEXT,
  exchange_name        TEXT,
  currency             CHAR(3),
  unit                 TEXT,
  frequency            TEXT NOT NULL,
  scope                TEXT NOT NULL CHECK (scope IN ('country', 'regional', 'global')),
  primary_country_iso2 CHAR(2) REFERENCES country(iso2),
  region_code          TEXT,
  display_priority     INTEGER NOT NULL DEFAULT 100,
  active               BOOLEAN NOT NULL DEFAULT true,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, provider_symbol)
);

CREATE INDEX IF NOT EXISTS market_instrument_country_idx
  ON market_instrument (primary_country_iso2, instrument_type, active);
CREATE INDEX IF NOT EXISTS market_instrument_type_idx
  ON market_instrument (instrument_type, active, display_priority);

CREATE TABLE IF NOT EXISTS market_instrument_country (
  instrument_id BIGINT NOT NULL REFERENCES market_instrument(id) ON DELETE CASCADE,
  country_iso2  CHAR(2) NOT NULL REFERENCES country(iso2),
  relationship  TEXT NOT NULL CHECK (relationship IN (
    'primary_market', 'index_constituency', 'trading_venue',
    'source_jurisdiction', 'economic_indicator'
  )),
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instrument_id, country_iso2, relationship)
);

CREATE INDEX IF NOT EXISTS market_instrument_country_country_idx
  ON market_instrument_country (country_iso2, relationship, instrument_id);

ALTER TABLE market_indicator
  ADD COLUMN IF NOT EXISTS instrument_id BIGINT REFERENCES market_instrument(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS market_indicator_instrument_period_idx
  ON market_indicator (instrument_id, period_end DESC)
  WHERE instrument_id IS NOT NULL;

-- Yahoo Finance does not provide the blanket commercial redistribution grant
-- required by this product. Remove the source and every dependent record.
DELETE FROM source WHERE name = 'yahoo-finance-chart';

-- Backfill the existing OECD national share-price series into the catalogue.
INSERT INTO market_instrument (
  source_id, provider_symbol, canonical_symbol, name, instrument_type,
  asset_class, unit, frequency, scope, primary_country_iso2,
  display_priority, metadata
)
SELECT DISTINCT ON (mi.source_id, mi.series_key)
  mi.source_id,
  mi.series_key,
  'OECD-SHARE-' || upper(mi.country_iso2::text),
  mi.name,
  'equity_index',
  'equities',
  mi.unit,
  COALESCE(mi.frequency, 'monthly'),
  'country',
  mi.country_iso2,
  80,
  jsonb_build_object(
    'backfilled', true,
    'provider', 'oecd',
    'data_url', 'https://www.oecd.org/en/data/indicators/share-prices.html',
    'value_semantics', 'index_level'
  )
FROM market_indicator mi
JOIN source s ON s.id = mi.source_id
WHERE s.name = 'oecd'
  AND mi.category = 'country_equity_index'
  AND mi.country_iso2 IS NOT NULL
ON CONFLICT (source_id, provider_symbol) DO UPDATE SET
  name = EXCLUDED.name,
  unit = EXCLUDED.unit,
  frequency = EXCLUDED.frequency,
  primary_country_iso2 = EXCLUDED.primary_country_iso2,
  metadata = market_instrument.metadata || EXCLUDED.metadata,
  updated_at = now();

UPDATE market_indicator mi
SET instrument_id = instrument.id
FROM market_instrument instrument
WHERE mi.instrument_id IS NULL
  AND instrument.source_id = mi.source_id
  AND instrument.provider_symbol = mi.series_key;

INSERT INTO market_instrument_country (instrument_id, country_iso2, relationship, is_primary)
SELECT id, primary_country_iso2,
       CASE WHEN instrument_type = 'macro' THEN 'economic_indicator' ELSE 'primary_market' END,
       true
FROM market_instrument
WHERE primary_country_iso2 IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE ingestion_automation_rule
SET default_payload = jsonb_set(
      COALESCE(default_payload, '{}'::jsonb),
      '{providers}',
      (COALESCE(default_payload->'providers', '{}'::jsonb) - 'yahoo')
        || '{"worldBank": true, "fred": false}'::jsonb,
      true
    )
WHERE pipeline = 'market';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_market_instrument') THEN
    CREATE TRIGGER set_updated_at_market_instrument BEFORE UPDATE ON market_instrument
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
