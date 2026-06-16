-- V12: Durable status tracking for daily briefing generation jobs

CREATE TABLE IF NOT EXISTS daily_signal_briefing_generation_job (
  id             TEXT PRIMARY KEY,
  briefing_date  DATE NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued',
  options        JSONB NOT NULL DEFAULT '{}'::jsonb,
  briefing_id    BIGINT REFERENCES daily_signal_briefing(id) ON DELETE SET NULL,
  generation     JSONB,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('queued', 'running', 'success', 'failed')),
  CHECK (jsonb_typeof(options) = 'object'),
  CHECK (generation IS NULL OR jsonb_typeof(generation) = 'object')
);

CREATE INDEX IF NOT EXISTS daily_signal_briefing_generation_job_status_idx
  ON daily_signal_briefing_generation_job (status, created_at DESC);

CREATE INDEX IF NOT EXISTS daily_signal_briefing_generation_job_date_idx
  ON daily_signal_briefing_generation_job (briefing_date DESC, created_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_daily_signal_briefing_generation_job'
  ) THEN
    CREATE TRIGGER set_updated_at_daily_signal_briefing_generation_job
      BEFORE UPDATE ON daily_signal_briefing_generation_job
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
