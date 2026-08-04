-- V26: retire Finnhub data and remove it from active market automation.
-- Historical ingestion_run rows are retained for the audit trail.

UPDATE ingestion_automation_rule
SET default_payload = (
  jsonb_set(
    COALESCE(default_payload, '{}'::jsonb),
    '{providers}',
    COALESCE(default_payload->'providers', '{}'::jsonb) - 'finnhub',
    true
  )
  - 'symbols'
  - 'includeNews'
  - 'newsCategory'
  - 'newsMinId'
  - 'newsMaxItems'
)
WHERE pipeline = 'market';

UPDATE source
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'retired', true,
      'retired_reason', 'Provider removed from Claritas market and news ingestion',
      'retired_at', now()
    )
WHERE name = 'finnhub';

DELETE FROM item
WHERE source_id = (SELECT id FROM source WHERE name = 'finnhub');

DELETE FROM market_snapshot
WHERE source_id = (SELECT id FROM source WHERE name = 'finnhub');

DELETE FROM market_event
WHERE source_id = (SELECT id FROM source WHERE name = 'finnhub');

DELETE FROM market_indicator
WHERE source_id = (SELECT id FROM source WHERE name = 'finnhub');
