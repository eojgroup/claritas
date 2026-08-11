-- V43: stage only the eight most recent event-scoped natural-color previews
-- for the event-focused rendering policy. Flyway runs before the new API
-- rollout, so this migration deliberately does not queue or otherwise mutate
-- a render job: old workers cannot see a successful job plus this new metadata
-- marker. The v3 worker atomically claims each marker after rollout. With its
-- square-render reserve this can reserve at most approximately 48 PU; existing
-- daily and monthly ceilings remain authoritative before any provider request.
WITH candidates AS (
  SELECT observation.id AS observation_id
  FROM earth_processing_job job
  JOIN earth_observation observation ON observation.id = job.observation_id
  JOIN intelligence_event event ON event.id = observation.event_id
  WHERE job.provider = 'copernicus'
    AND job.job_type = 'render'
    AND job.status = 'success'
    AND observation.product_type = 'true_color'
    AND observation.status = 'available'
    AND EXISTS (
      SELECT 1
      FROM earth_observation_asset asset
      WHERE asset.observation_id = observation.id
        AND asset.asset_type = 'preview'
        AND (asset.expires_at IS NULL OR asset.expires_at > now())
    )
  ORDER BY event.last_activity_time DESC, observation.captured_at DESC, job.updated_at DESC
  LIMIT 8
)
UPDATE earth_observation observation
SET methodology = COALESCE(observation.methodology, '{}'::jsonb)
      || jsonb_build_object('refresh_pending',jsonb_build_object(
           'policy','event_focused_v3',
           'requested_at',now(),
           'reason','bounded_quality_refresh'
         )),
    updated_at = now()
WHERE observation.id IN (SELECT observation_id FROM candidates);
