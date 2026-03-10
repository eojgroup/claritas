-- V9: Add market_snapshot table for Finnhub real-time quote ingestion
CREATE TABLE IF NOT EXISTS market_snapshot (
  id              BIGSERIAL PRIMARY KEY,
  source_id       BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  symbol          TEXT NOT NULL,
  company_name    TEXT,
  exchange        TEXT,
  country         TEXT,
  currency        TEXT,
  price           DOUBLE PRECISION,
  change          DOUBLE PRECISION,
  percent_change  DOUBLE PRECISION,
  high_price      DOUBLE PRECISION,
  low_price       DOUBLE PRECISION,
  open_price      DOUBLE PRECISION,
  previous_close  DOUBLE PRECISION,
  observed_at     TIMESTAMPTZ NOT NULL,
  payload         JSONB NOT NULL,
  dedupe_hash     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_id, symbol)
);

CREATE INDEX IF NOT EXISTS market_snapshot_symbol_idx
  ON market_snapshot (symbol);

CREATE INDEX IF NOT EXISTS market_snapshot_observed_idx
  ON market_snapshot (observed_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_market_snapshot'
  ) THEN
    CREATE TRIGGER set_updated_at_market_snapshot
      BEFORE UPDATE ON market_snapshot
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
