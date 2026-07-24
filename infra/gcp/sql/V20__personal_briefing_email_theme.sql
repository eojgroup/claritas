-- V20: Persist the user's chosen newsletter and briefing-map appearance.

ALTER TABLE user_daily_briefing_schedule
  ADD COLUMN IF NOT EXISTS email_theme TEXT NOT NULL DEFAULT 'dark';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_daily_briefing_schedule_email_theme_check'
  ) THEN
    ALTER TABLE user_daily_briefing_schedule
      ADD CONSTRAINT user_daily_briefing_schedule_email_theme_check
      CHECK (email_theme IN ('light', 'dark'));
  END IF;
END $$;
