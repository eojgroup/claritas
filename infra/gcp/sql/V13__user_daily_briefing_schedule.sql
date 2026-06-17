-- V13: Per-user daily briefing schedule preferences

CREATE TABLE IF NOT EXISTS user_daily_briefing_schedule (
  user_id             BIGINT PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  enabled             BOOLEAN NOT NULL DEFAULT true,
  scheduled_time      TIME NOT NULL DEFAULT TIME '07:00',
  schedule_timezone   TEXT NOT NULL DEFAULT 'UTC',
  last_scheduled_for  DATE,
  last_triggered_at   TIMESTAMPTZ,
  last_job_id         TEXT REFERENCES daily_signal_briefing_generation_job(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (schedule_timezone <> ''),
  CHECK (scheduled_time >= TIME '00:00' AND scheduled_time < TIME '24:00')
);

CREATE INDEX IF NOT EXISTS user_daily_briefing_schedule_due_idx
  ON user_daily_briefing_schedule (enabled, last_scheduled_for, scheduled_time);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_user_daily_briefing_schedule'
  ) THEN
    CREATE TRIGGER set_updated_at_user_daily_briefing_schedule
      BEFORE UPDATE ON user_daily_briefing_schedule
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
