-- V34: keep background coordination out of long-lived pool transactions and
-- reopen daily briefing schedules that were marked complete before generation
-- actually succeeded.

CREATE TABLE IF NOT EXISTS background_worker_lease (
  worker_name  TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  lease_until  TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (worker_name <> ''),
  CHECK (owner_id <> '')
);

ALTER TABLE user_daily_briefing_schedule
  ADD COLUMN IF NOT EXISTS pending_scheduled_for DATE;

-- A scheduled job used to advance last_scheduled_for before the asynchronous
-- generation finished. Reopen only dates that have no published briefing and
-- whose recorded job demonstrably failed.
UPDATE user_daily_briefing_schedule schedule
SET pending_scheduled_for = schedule.last_scheduled_for,
    last_scheduled_for = NULL,
    updated_at = now()
WHERE schedule.last_scheduled_for IS NOT NULL
  AND schedule.last_job_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM daily_signal_briefing_generation_job job
    WHERE job.id = schedule.last_job_id
      AND job.status = 'failed'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM daily_signal_briefing briefing
    WHERE briefing.briefing_date = schedule.last_scheduled_for
      AND briefing.status = 'published'
  );

-- A process termination can leave a durable job labelled running even though
-- no worker still owns it. The scheduler will retry these after deployment.
UPDATE daily_signal_briefing_generation_job
SET status = 'failed',
    error = COALESCE(error, 'Recovered abandoned scheduled generation job during migration.'),
    finished_at = COALESCE(finished_at, now()),
    updated_at = now()
WHERE (status = 'queued' AND updated_at < now() - interval '5 minutes')
   OR (status = 'running' AND updated_at < now() - interval '30 minutes');

CREATE INDEX IF NOT EXISTS user_daily_briefing_schedule_pending_idx
  ON user_daily_briefing_schedule (enabled, pending_scheduled_for, scheduled_time);
