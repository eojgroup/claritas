-- V10: ingestion automation controls + paywall billing entities

-- ===========================
-- Ingestion automation config
-- ===========================
CREATE TABLE IF NOT EXISTS ingestion_automation_rule (
  pipeline                   TEXT PRIMARY KEY,
  enabled                    BOOLEAN NOT NULL DEFAULT true,
  schedule_enabled           BOOLEAN NOT NULL DEFAULT true,
  schedule_interval_minutes  INTEGER NOT NULL DEFAULT 60,
  intelligent_enabled        BOOLEAN NOT NULL DEFAULT true,
  min_spacing_minutes        INTEGER NOT NULL DEFAULT 15,
  freshness_sla_minutes      INTEGER NOT NULL DEFAULT 90,
  demand_window_minutes      INTEGER NOT NULL DEFAULT 15,
  demand_threshold           INTEGER NOT NULL DEFAULT 20,
  failure_backoff_minutes    INTEGER NOT NULL DEFAULT 20,
  next_scheduled_at          TIMESTAMPTZ,
  last_evaluated_at          TIMESTAMPTZ,
  last_triggered_at          TIMESTAMPTZ,
  last_trigger_reason        TEXT,
  last_error                 TEXT,
  default_payload            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (pipeline IN ('news', 'weather', 'market')),
  CHECK (schedule_interval_minutes BETWEEN 1 AND 10080),
  CHECK (min_spacing_minutes BETWEEN 1 AND 10080),
  CHECK (freshness_sla_minutes BETWEEN 1 AND 43200),
  CHECK (demand_window_minutes BETWEEN 1 AND 1440),
  CHECK (demand_threshold BETWEEN 1 AND 100000),
  CHECK (failure_backoff_minutes BETWEEN 1 AND 10080)
);

CREATE INDEX IF NOT EXISTS ingestion_automation_rule_enabled_schedule_idx
  ON ingestion_automation_rule (enabled, schedule_enabled, next_scheduled_at);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_ingestion_automation_rule'
  ) THEN
    CREATE TRIGGER set_updated_at_ingestion_automation_rule
      BEFORE UPDATE ON ingestion_automation_rule
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

INSERT INTO ingestion_automation_rule (
  pipeline,
  enabled,
  schedule_enabled,
  schedule_interval_minutes,
  intelligent_enabled,
  min_spacing_minutes,
  freshness_sla_minutes,
  demand_window_minutes,
  demand_threshold,
  failure_backoff_minutes,
  next_scheduled_at,
  default_payload
) VALUES
  (
    'news',
    true,
    true,
    60,
    true,
    15,
    90,
    15,
    20,
    20,
    now(),
    jsonb_build_object(
      'providers', jsonb_build_object('newsapi', true, 'thenewsapi', true),
      'everything', jsonb_build_object('q', 'OpenAI', 'language', 'en', 'pageSize', 50, 'maxPages', 2),
      'topHeadlines', jsonb_build_object('country', 'us', 'category', 'technology', 'q', 'OpenAI', 'pageSize', 50, 'maxPages', 2),
      'theNewsApi', jsonb_build_object('search', 'OpenAI', 'language', 'en', 'locale', 'us', 'pageSize', 50, 'maxPages', 2)
    )
  ),
  (
    'weather',
    true,
    true,
    120,
    true,
    30,
    180,
    20,
    10,
    30,
    now(),
    '{}'::jsonb
  ),
  (
    'market',
    true,
    true,
    15,
    true,
    5,
    20,
    10,
    15,
    10,
    now(),
    jsonb_build_object('symbols', jsonb_build_array('AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','JPM'))
  )
ON CONFLICT (pipeline) DO NOTHING;

-- Demand signal counters for intelligent triggering
CREATE TABLE IF NOT EXISTS ingestion_demand_signal_minute (
  pipeline      TEXT NOT NULL,
  bucket_minute TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pipeline, bucket_minute),
  CHECK (pipeline IN ('news', 'weather', 'market')),
  CHECK (request_count >= 0)
);

CREATE INDEX IF NOT EXISTS ingestion_demand_signal_minute_bucket_idx
  ON ingestion_demand_signal_minute (bucket_minute DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_ingestion_demand_signal_minute'
  ) THEN
    CREATE TRIGGER set_updated_at_ingestion_demand_signal_minute
      BEFORE UPDATE ON ingestion_demand_signal_minute
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ===================
-- Billing + paywall
-- ===================
CREATE TABLE IF NOT EXISTS billing_plan (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  price_cents   INTEGER NOT NULL DEFAULT 0,
  currency      CHAR(3) NOT NULL DEFAULT 'USD',
  interval_unit TEXT NOT NULL DEFAULT 'month',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (price_cents >= 0),
  CHECK (interval_unit IN ('month', 'year', 'one_time'))
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_billing_plan'
  ) THEN
    CREATE TRIGGER set_updated_at_billing_plan
      BEFORE UPDATE ON billing_plan
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS billing_subscription (
  id                         BIGSERIAL PRIMARY KEY,
  user_id                    BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  plan_id                    BIGINT NOT NULL REFERENCES billing_plan(id) ON DELETE RESTRICT,
  status                     TEXT NOT NULL DEFAULT 'incomplete',
  provider                   TEXT NOT NULL DEFAULT 'manual',
  provider_customer_id       TEXT,
  provider_subscription_id   TEXT,
  started_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end         TIMESTAMPTZ,
  canceled_at                TIMESTAMPTZ,
  metadata                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('trialing', 'active', 'past_due', 'grace_period', 'canceled', 'unpaid', 'incomplete'))
);

CREATE INDEX IF NOT EXISTS billing_subscription_user_idx
  ON billing_subscription (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_subscription_access_idx
  ON billing_subscription (user_id, status, current_period_end DESC);

CREATE UNIQUE INDEX IF NOT EXISTS billing_subscription_active_user_unique
  ON billing_subscription (user_id)
  WHERE status IN ('trialing', 'active', 'grace_period')
    AND canceled_at IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_billing_subscription'
  ) THEN
    CREATE TRIGGER set_updated_at_billing_subscription
      BEFORE UPDATE ON billing_subscription
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

INSERT INTO billing_plan (code, name, description, price_cents, currency, interval_unit, is_active, metadata)
VALUES
  (
    'pro',
    'Claritas Pro',
    'Full access to global signals dashboard, ingestion-backed datasets, and admin analytics.',
    4900,
    'USD',
    'month',
    true,
    jsonb_build_object('launch', true)
  ),
  (
    'enterprise',
    'Claritas Enterprise',
    'Enterprise access with custom support and managed onboarding.',
    0,
    'USD',
    'month',
    true,
    jsonb_build_object('contact_sales', true)
  )
ON CONFLICT (code) DO NOTHING;
