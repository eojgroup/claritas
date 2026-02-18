-- V8: Add ingestion observability metadata and durable run logs

ALTER TABLE ingestion_run
  ADD COLUMN IF NOT EXISTS pipeline TEXT,
  ADD COLUMN IF NOT EXISTS trigger_mode TEXT,
  ADD COLUMN IF NOT EXISTS requested_by_user_id BIGINT REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_by_email TEXT,
  ADD COLUMN IF NOT EXISTS request_payload JSONB;

UPDATE ingestion_run r
SET pipeline = CASE
  WHEN s.name = 'newsapi' THEN 'news'
  WHEN s.name = 'openweather' THEN 'weather'
  ELSE COALESCE(r.pipeline, s.name, 'unknown')
END
FROM source s
WHERE r.source_id = s.id
  AND (r.pipeline IS NULL OR r.pipeline = '');

UPDATE ingestion_run
SET trigger_mode = COALESCE(trigger_mode, 'legacy')
WHERE trigger_mode IS NULL;

ALTER TABLE ingestion_run
  ALTER COLUMN pipeline SET DEFAULT 'unknown';

ALTER TABLE ingestion_run
  ALTER COLUMN trigger_mode SET DEFAULT 'admin_ui';

CREATE INDEX IF NOT EXISTS ingestion_run_pipeline_started_idx
  ON ingestion_run (pipeline, started_at DESC);

CREATE INDEX IF NOT EXISTS ingestion_run_requested_by_idx
  ON ingestion_run (requested_by_user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ingestion_run_log (
  id          BIGSERIAL PRIMARY KEY,
  run_id       BIGINT NOT NULL REFERENCES ingestion_run(id) ON DELETE CASCADE,
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  level        TEXT NOT NULL DEFAULT 'info',
  message      TEXT NOT NULL,
  context      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingestion_run_log_run_id_id_idx
  ON ingestion_run_log (run_id, id);

CREATE INDEX IF NOT EXISTS ingestion_run_log_logged_at_idx
  ON ingestion_run_log (logged_at DESC);
