-- V17: Keep shared and personalised daily briefing scheduling independent.
-- The shared briefing scheduler owns last_scheduled_for; personalised delivery
-- needs its own daily marker so neither scheduler suppresses the other.

ALTER TABLE user_daily_briefing_schedule
  ADD COLUMN IF NOT EXISTS last_personal_scheduled_for DATE;

-- V16 reused last_scheduled_for for personalised jobs. Preserve that marker for
-- the personalised worker and release the shared scheduler to create the
-- missed shared briefing on its next due cycle.
UPDATE user_daily_briefing_schedule
SET last_personal_scheduled_for = last_scheduled_for,
    last_scheduled_for = NULL
WHERE last_personal_scheduled_for IS NULL
  AND last_personal_job_id IS NOT NULL
  AND last_scheduled_for IS NOT NULL;
