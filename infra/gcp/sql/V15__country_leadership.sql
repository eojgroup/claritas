-- V15: current country leadership sourced from Wikidata

CREATE TABLE IF NOT EXISTS country_leadership (
  country_iso2         CHAR(2) PRIMARY KEY REFERENCES country(iso2) ON DELETE CASCADE,
  country_name         TEXT NOT NULL,
  wikidata_country_id  TEXT NOT NULL,
  government_type      TEXT,
  summary              TEXT NOT NULL,
  source_name          TEXT NOT NULL DEFAULT 'wikidata',
  source_url           TEXT NOT NULL,
  source_license       TEXT NOT NULL DEFAULT 'CC0',
  source_updated_at    TIMESTAMPTZ,
  retrieved_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS country_leadership_source_updated_idx
  ON country_leadership (source_updated_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS country_leadership_role (
  id                    BIGSERIAL PRIMARY KEY,
  country_iso2          CHAR(2) NOT NULL REFERENCES country_leadership(country_iso2) ON DELETE CASCADE,
  role_type             TEXT NOT NULL,
  person_name           TEXT NOT NULL,
  person_wikidata_id    TEXT NOT NULL,
  started_at            TIMESTAMPTZ,
  source_url            TEXT NOT NULL,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (country_iso2, role_type, person_wikidata_id),
  CHECK (role_type IN ('head_of_state', 'head_of_government'))
);

CREATE INDEX IF NOT EXISTS country_leadership_role_country_idx
  ON country_leadership_role (country_iso2, role_type);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_country_leadership'
  ) THEN
    CREATE TRIGGER set_updated_at_country_leadership
      BEFORE UPDATE ON country_leadership
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_country_leadership_role'
  ) THEN
    CREATE TRIGGER set_updated_at_country_leadership_role
      BEFORE UPDATE ON country_leadership_role
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ingestion_automation_rule_pipeline_check'
      AND conrelid = 'ingestion_automation_rule'::regclass
  ) THEN
    ALTER TABLE ingestion_automation_rule
      DROP CONSTRAINT ingestion_automation_rule_pipeline_check;
  END IF;
  ALTER TABLE ingestion_automation_rule
    ADD CONSTRAINT ingestion_automation_rule_pipeline_check
    CHECK (pipeline IN ('news', 'weather', 'market', 'podcasts', 'leadership'));
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ingestion_demand_signal_minute_pipeline_check'
      AND conrelid = 'ingestion_demand_signal_minute'::regclass
  ) THEN
    ALTER TABLE ingestion_demand_signal_minute
      DROP CONSTRAINT ingestion_demand_signal_minute_pipeline_check;
  END IF;
  ALTER TABLE ingestion_demand_signal_minute
    ADD CONSTRAINT ingestion_demand_signal_minute_pipeline_check
    CHECK (pipeline IN ('news', 'weather', 'market', 'podcasts', 'leadership'));
END $$;

INSERT INTO ingestion_automation_rule (
  pipeline, enabled, schedule_enabled, schedule_interval_minutes,
  intelligent_enabled, min_spacing_minutes, freshness_sla_minutes,
  demand_window_minutes, demand_threshold, failure_backoff_minutes,
  next_scheduled_at, default_payload
) VALUES (
  'leadership', true, true, 1440, true, 360, 2880, 120, 10, 180, now(),
  '{}'::jsonb
)
ON CONFLICT (pipeline) DO NOTHING;
