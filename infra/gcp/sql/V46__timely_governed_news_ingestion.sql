-- V46: reduce publisher-news latency without increasing the existing hourly
-- headline ceiling. Four 25-row GDELT polls replace one 100-row poll. GOV.UK
-- Search adds a keyless OGL-licensed primary source; unchanged rows remain
-- idempotent. Only the previous default 60-minute rule is rescheduled so an
-- operator's deliberately different cadence is preserved.

UPDATE ingestion_automation_rule
SET schedule_interval_minutes = 15,
    min_spacing_minutes = CASE
      WHEN min_spacing_minutes = 15 THEN 10
      ELSE min_spacing_minutes
    END,
    freshness_sla_minutes = CASE
      WHEN freshness_sla_minutes = 90 THEN 30
      ELSE freshness_sla_minutes
    END,
    next_scheduled_at = LEAST(
      COALESCE(next_scheduled_at, now() + interval '15 minutes'),
      now() + interval '15 minutes'
    ),
    default_payload = jsonb_set(
      jsonb_set(
        COALESCE(default_payload, '{}'::jsonb),
        '{providers}',
        CASE
          WHEN COALESCE(default_payload->'providers', '{}'::jsonb) ?| ARRAY['govUk', 'gov_uk', 'govuk']
            THEN COALESCE(default_payload->'providers', '{}'::jsonb)
          ELSE COALESCE(default_payload->'providers', '{}'::jsonb) || '{"govUk": true}'::jsonb
        END,
        true
      ),
      '{gdelt}',
      '{"timespan": "1h", "maxRecords": 25, "maxRawRows": 190}'::jsonb
        || COALESCE(default_payload->'gdelt', '{}'::jsonb),
      true
    ),
    updated_at = now()
WHERE pipeline = 'news'
  AND schedule_interval_minutes = 60;
