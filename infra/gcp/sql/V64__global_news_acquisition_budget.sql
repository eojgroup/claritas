-- Lift the old 25-headline DOC-era sample ceiling for the incremental minute
-- metadata reader. Preserve provider opt-outs, custom schedules and explicit
-- alternative budgets; only the legacy default (or no budget) moves to 120.
UPDATE ingestion_automation_rule
SET default_payload=jsonb_set(
      jsonb_set(COALESCE(default_payload,'{}'::jsonb),'{gdelt}',
        COALESCE(default_payload->'gdelt','{}'::jsonb),true),
      '{gdelt,maxRecords}','120'::jsonb,true),
    updated_at=now()
WHERE pipeline='news'
  AND COALESCE(default_payload#>>'{gdelt,maxRecords}',
               default_payload#>>'{gdelt,max_records}','25')='25';
