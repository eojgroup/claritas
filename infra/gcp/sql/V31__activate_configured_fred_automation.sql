-- V31: let runtime configuration decide whether scheduled FRED ingestion runs.
-- buildMarketRunPlan enables FRED when FRED_API_KEY exists and keeps it disabled
-- in keyless deployments. Explicit manual-run provider choices still win.

UPDATE ingestion_automation_rule
SET default_payload = jsonb_set(
      COALESCE(default_payload, '{}'::jsonb),
      '{providers}',
      COALESCE(default_payload->'providers', '{}'::jsonb) - 'fred',
      true
    )
WHERE pipeline = 'market';
