-- V29: remove providers that no longer belong to the Claritas production model.
-- Earlier migrations remain immutable because Flyway verifies their checksums.

-- Preserve provider-native air quality categories instead of mapping the
-- OpenWeather 1-5 category onto the unrelated US or European AQI scales.
ALTER TABLE air_quality_snapshot
  ADD COLUMN IF NOT EXISTS provider_aqi NUMERIC,
  ADD COLUMN IF NOT EXISTS aqi_scale TEXT;

UPDATE ingestion_automation_rule
SET default_payload = CASE pipeline
  WHEN 'news' THEN jsonb_set(
    COALESCE(default_payload, '{}'::jsonb) - 'everything' - 'topHeadlines' - 'theNewsApi',
    '{providers}',
    (COALESCE(default_payload->'providers', '{}'::jsonb)
      - 'newsapi' - 'thenewsapi' - 'finnhub' - 'openmeteo' - 'bis')
      || '{"gdelt": true, "institutionalRss": true}'::jsonb,
    true
  )
  WHEN 'weather' THEN jsonb_set(
    COALESCE(default_payload, '{}'::jsonb),
    '{providers}',
    (COALESCE(default_payload->'providers', '{}'::jsonb)
      - 'newsapi' - 'thenewsapi' - 'finnhub' - 'openmeteo' - 'bis')
      || '{"openweather": true, "nws": true}'::jsonb,
    true
  )
  WHEN 'market' THEN jsonb_set(
    COALESCE(default_payload, '{}'::jsonb) - 'includeNews' - 'newsCategory',
    '{providers}',
    (COALESCE(default_payload->'providers', '{}'::jsonb)
      - 'newsapi' - 'thenewsapi' - 'finnhub' - 'openmeteo' - 'bis')
      || '{"secEdgar": true, "ecb": true, "oecd": true}'::jsonb,
    true
  )
  ELSE COALESCE(default_payload, '{}'::jsonb)
END
WHERE pipeline IN ('news', 'weather', 'market');

-- All dependent source data and historic run logs use ON DELETE CASCADE.
DELETE FROM source
WHERE name IN ('finnhub', 'newsapi', 'thenewsapi', 'openmeteo', 'bis');
