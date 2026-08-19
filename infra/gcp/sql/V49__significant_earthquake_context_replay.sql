-- V49: replay recent materially significant moderate earthquakes through the
-- governed cross-signal context pass. Runtime eligibility is authoritative;
-- this predicate mirrors it closely enough to keep the replay bounded.
--
-- The replay event is attach-only: it does not recreate the canonical event,
-- send alerts, or enqueue Earth-observation discovery. Its versioned dedupe
-- key makes this migration safe to apply or repair repeatedly.

INSERT INTO event_outbox (
  event_type,aggregate_type,aggregate_id,dedupe_key,payload,occurred_at
)
SELECT
  'disaster.earthquake.context.recheck',
  'earthquake_observation',
  observation.id::text,
  'disaster.earthquake.context.recheck:v2:' || observation.id::text,
  jsonb_build_object(
    'earthquake_observation_id',observation.id,
    'source_id',(SELECT id FROM source WHERE name='usgs-earthquakes' LIMIT 1),
    'context_policy','significant-earthquake-context-v2'
  ),
  observation.updated_at_source
FROM earthquake_observation observation
WHERE observation.observed_at >= now()-interval '8 days'
  AND (
    observation.magnitude >= 7
    OR lower(COALESCE(observation.alert_level,'')) IN ('orange','red')
    OR (
      observation.magnitude >= 5.5
      AND (
        observation.magnitude >= 5.8
        OR COALESCE(observation.significance,0) >= 450
        OR observation.tsunami
        OR lower(COALESCE(observation.alert_level,'')) = 'yellow'
        OR COALESCE(observation.felt,0) >= 10
      )
    )
  )
ON CONFLICT (dedupe_key) DO NOTHING;
