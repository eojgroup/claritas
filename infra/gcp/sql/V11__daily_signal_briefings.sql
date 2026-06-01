-- V11: Daily briefing space for ingestion-derived updates and takeaways

CREATE TABLE IF NOT EXISTS daily_signal_briefing (
  id                  BIGSERIAL PRIMARY KEY,
  briefing_date       DATE NOT NULL UNIQUE,
  title               TEXT NOT NULL DEFAULT 'Daily signal brief',
  update_text         TEXT NOT NULL DEFAULT '',
  key_takeaways       JSONB NOT NULL DEFAULT '[]'::jsonb,
  status              TEXT NOT NULL DEFAULT 'draft',
  source_window_start TIMESTAMPTZ,
  source_window_end   TIMESTAMPTZ,
  generated_by        TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('draft', 'published', 'archived')),
  CHECK (jsonb_typeof(key_takeaways) = 'array'),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS daily_signal_briefing_status_date_idx
  ON daily_signal_briefing (status, briefing_date DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_daily_signal_briefing'
  ) THEN
    CREATE TRIGGER set_updated_at_daily_signal_briefing
      BEFORE UPDATE ON daily_signal_briefing
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
