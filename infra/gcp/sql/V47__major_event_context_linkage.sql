-- V47: refresh major-event context when country weather samples change and
-- replay recent major earthquakes through the improved non-causal linkage
-- policy. The outbox keeps ingestion and correlation independently retryable.

CREATE OR REPLACE FUNCTION enqueue_weather_snapshot_context_event()
RETURNS TRIGGER AS $$
DECLARE
  emitted_time TIMESTAMPTZ;
BEGIN
  emitted_time := COALESCE(NEW.observed_at, NEW.updated_at, now());
  INSERT INTO event_outbox (
    event_type,aggregate_type,aggregate_id,dedupe_key,payload,occurred_at
  ) VALUES (
    'weather.snapshot.updated',
    'weather_snapshot',
    NEW.id::text,
    'weather.snapshot.updated:' || NEW.id::text || ':' ||
      extract(epoch FROM COALESCE(NEW.updated_at,now()))::bigint::text,
    jsonb_build_object(
      'weather_snapshot_id',NEW.id,
      'country_iso2',NEW.country_iso2,
      'observed_at',NEW.observed_at
    ),
    emitted_time
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS weather_snapshot_context_outbox ON weather_snapshot;
CREATE TRIGGER weather_snapshot_context_outbox
  AFTER INSERT OR UPDATE OF observed_at,payload,coord_lat,coord_lon
  ON weather_snapshot
  FOR EACH ROW EXECUTE FUNCTION enqueue_weather_snapshot_context_event();

-- Existing current samples should be eligible immediately after rollout;
-- subsequent updates use the trigger above.
INSERT INTO event_outbox (
  event_type,aggregate_type,aggregate_id,dedupe_key,payload,occurred_at
)
SELECT
  'weather.snapshot.updated',
  'weather_snapshot',
  snapshot.id::text,
  'weather.snapshot.context-backfill:v1:' || snapshot.id::text,
  jsonb_build_object(
    'weather_snapshot_id',snapshot.id,
    'country_iso2',snapshot.country_iso2,
    'observed_at',snapshot.observed_at
  ),
  snapshot.observed_at
FROM weather_snapshot snapshot
WHERE snapshot.observed_at >= now()-interval '7 days'
ON CONFLICT (dedupe_key) DO NOTHING;

-- Re-run only recent M7+ observations. Source identity makes this idempotent:
-- the existing canonical earthquake is retained while the new context pass
-- adds accepted news/weather/transport evidence.
INSERT INTO event_outbox (
  event_type,aggregate_type,aggregate_id,dedupe_key,payload,occurred_at
)
SELECT
  'disaster.earthquake.context.recheck',
  'earthquake_observation',
  observation.id::text,
  'disaster.earthquake.context.recheck:v1:' || observation.id::text,
  jsonb_build_object(
    'earthquake_observation_id',observation.id,
    'source_id',(SELECT id FROM source WHERE name='usgs-earthquakes' LIMIT 1)
  ),
  observation.updated_at_source
FROM earthquake_observation observation
WHERE observation.magnitude >= 7
  AND observation.observed_at >= now()-interval '7 days'
ON CONFLICT (dedupe_key) DO NOTHING;
