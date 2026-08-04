-- V28: align production ingestion with commercially reusable providers.
-- Historical ingestion_run rows remain as an immutable operator audit trail.

CREATE TABLE IF NOT EXISTS weather_alert (
  id           BIGSERIAL PRIMARY KEY,
  source_id    BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  external_id  TEXT NOT NULL,
  country_iso2 CHAR(2) NOT NULL REFERENCES country(iso2),
  sender_name  TEXT NOT NULL,
  event        TEXT NOT NULL,
  severity     TEXT,
  urgency      TEXT,
  certainty    TEXT,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ,
  headline     TEXT,
  description  TEXT,
  instruction  TEXT,
  area         TEXT,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_id, external_id, country_iso2)
);

CREATE INDEX IF NOT EXISTS weather_alert_country_time_idx
  ON weather_alert (country_iso2, starts_at DESC, ends_at);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_weather_alert') THEN
    CREATE TRIGGER set_updated_at_weather_alert BEFORE UPDATE ON weather_alert
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

UPDATE source
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'retired', true,
      'retired_reason', 'Provider is outside the commercially reusable production source policy',
      'retired_at', now()
    )
WHERE name IN ('newsapi', 'thenewsapi', 'openmeteo');

DELETE FROM item
WHERE source_id IN (SELECT id FROM source WHERE name IN ('newsapi', 'thenewsapi'));

DELETE FROM weather_forecast
WHERE source_id = (SELECT id FROM source WHERE name = 'openmeteo');
DELETE FROM air_quality_snapshot
WHERE source_id = (SELECT id FROM source WHERE name = 'openmeteo');
DELETE FROM weather_snapshot
WHERE source_id = (SELECT id FROM source WHERE name = 'openmeteo');

UPDATE ingestion_automation_rule
SET default_payload = jsonb_set(
      COALESCE(default_payload, '{}'::jsonb) - 'everything' - 'topHeadlines' - 'theNewsApi',
      '{providers}',
      (COALESCE(default_payload->'providers', '{}'::jsonb) - 'newsapi' - 'thenewsapi')
        || '{"gdelt": true, "institutionalRss": true}'::jsonb,
      true
    )
WHERE pipeline = 'news';

UPDATE ingestion_automation_rule
SET schedule_interval_minutes = GREATEST(schedule_interval_minutes, 240),
    min_spacing_minutes = GREATEST(min_spacing_minutes, 60),
    freshness_sla_minutes = GREATEST(freshness_sla_minutes, 300),
    default_payload = jsonb_set(
      COALESCE(default_payload, '{}'::jsonb),
      '{providers}',
      (COALESCE(default_payload->'providers', '{}'::jsonb) - 'openmeteo')
        || '{"openweather": true, "nws": true}'::jsonb,
      true
    )
WHERE pipeline = 'weather';

UPDATE ingestion_automation_rule
SET schedule_interval_minutes = GREATEST(schedule_interval_minutes, 60),
    freshness_sla_minutes = GREATEST(freshness_sla_minutes, 180),
    default_payload = jsonb_set(
      COALESCE(default_payload, '{}'::jsonb),
      '{providers}',
      COALESCE(default_payload->'providers', '{}'::jsonb)
        || '{"secEdgar": true, "ecb": true, "oecd": true, "bis": true}'::jsonb,
      true
    )
WHERE pipeline = 'market';
