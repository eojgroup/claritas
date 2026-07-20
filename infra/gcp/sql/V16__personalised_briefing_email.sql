-- V16: Per-user briefing interests, generation jobs, and durable SMTP delivery

ALTER TABLE user_daily_briefing_schedule
  ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS industries TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS company_symbols TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS country_iso2s TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS regions TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS max_items INTEGER NOT NULL DEFAULT 10;

CREATE TABLE IF NOT EXISTS personal_daily_briefing (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  briefing_date       DATE NOT NULL,
  title               TEXT NOT NULL,
  update_text         TEXT NOT NULL DEFAULT '',
  key_takeaways       JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_window_start TIMESTAMPTZ,
  source_window_end   TIMESTAMPTZ,
  generated_by        TEXT,
  preference_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, briefing_date),
  CHECK (jsonb_typeof(key_takeaways) = 'array'),
  CHECK (jsonb_typeof(preference_snapshot) = 'object'),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS personal_daily_briefing_user_date_idx
  ON personal_daily_briefing (user_id, briefing_date DESC);

CREATE TABLE IF NOT EXISTS personal_daily_briefing_item (
  briefing_id       BIGINT NOT NULL REFERENCES personal_daily_briefing(id) ON DELETE CASCADE,
  item_id           BIGINT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  relevance_score   DOUBLE PRECISION NOT NULL DEFAULT 0,
  relevance_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (briefing_id, item_id),
  CHECK (jsonb_typeof(relevance_reasons) = 'array')
);

CREATE TABLE IF NOT EXISTS personal_daily_briefing_job (
  id                  TEXT PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  briefing_date       DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'queued',
  delivery_requested  BOOLEAN NOT NULL DEFAULT false,
  preference_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  briefing_id         BIGINT REFERENCES personal_daily_briefing(id) ON DELETE SET NULL,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, briefing_date),
  CHECK (status IN ('queued', 'running', 'success', 'failed')),
  CHECK (jsonb_typeof(preference_snapshot) = 'object'),
  CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS personal_daily_briefing_job_queue_idx
  ON personal_daily_briefing_job (status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS briefing_email_delivery (
  id                  BIGSERIAL PRIMARY KEY,
  briefing_id         BIGINT NOT NULL REFERENCES personal_daily_briefing(id) ON DELETE CASCADE,
  user_id             BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  recipient_email     TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'queued',
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider            TEXT NOT NULL DEFAULT 'smtp',
  provider_message_id TEXT,
  last_error          TEXT,
  queued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (briefing_id, recipient_email),
  CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'suppressed')),
  CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS briefing_email_delivery_queue_idx
  ON briefing_email_delivery (status, next_attempt_at, created_at);

ALTER TABLE user_daily_briefing_schedule
  ADD COLUMN IF NOT EXISTS last_personal_job_id TEXT
    REFERENCES personal_daily_briefing_job(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_daily_briefing_schedule_max_items_check'
  ) THEN
    ALTER TABLE user_daily_briefing_schedule
      ADD CONSTRAINT user_daily_briefing_schedule_max_items_check
      CHECK (max_items BETWEEN 3 AND 25);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_personal_daily_briefing'
  ) THEN
    CREATE TRIGGER set_updated_at_personal_daily_briefing
      BEFORE UPDATE ON personal_daily_briefing
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_personal_daily_briefing_job'
  ) THEN
    CREATE TRIGGER set_updated_at_personal_daily_briefing_job
      BEFORE UPDATE ON personal_daily_briefing_job
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_briefing_email_delivery'
  ) THEN
    CREATE TRIGGER set_updated_at_briefing_email_delivery
      BEFORE UPDATE ON briefing_email_delivery
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
