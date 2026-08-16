-- V48: a 15-minute GDELT poll needs overlap for provider latency, but the
-- previous one-hour window repeatedly returned the same newest candidates.
-- A 30-minute window preserves one full poll of overlap while allowing older
-- high-volume publisher bursts to leave the candidate pool sooner. The
-- connector still enforces the existing 25-headline persistence ceiling.

UPDATE ingestion_automation_rule
SET default_payload = jsonb_set(
      COALESCE(default_payload, '{}'::jsonb),
      '{gdelt}',
      COALESCE(default_payload->'gdelt', '{}'::jsonb)
        || '{"timespan":"30min"}'::jsonb,
      true
    ),
    updated_at = now()
WHERE pipeline = 'news'
  AND schedule_interval_minutes = 15
  AND COALESCE(default_payload#>>'{gdelt,timespan}', '1h') = '1h';
