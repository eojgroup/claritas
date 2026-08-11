-- V40: refresh a bounded set of recent burn-index previews produced by the
-- legacy red-saturated renderer. The worker's normal PU ceilings still apply.
WITH candidates AS (
  SELECT job.id, observation.id AS observation_id
  FROM earth_processing_job job
  JOIN earth_observation observation ON observation.id = job.observation_id
  WHERE job.provider = 'copernicus'
    AND job.job_type = 'render'
    AND job.status = 'success'
    AND observation.product_type = 'burn_index'
    AND EXISTS (
      SELECT 1
      FROM earth_observation_asset asset
      WHERE asset.observation_id = observation.id
        AND (asset.expires_at IS NULL OR asset.expires_at > now())
    )
  ORDER BY observation.captured_at DESC, job.updated_at DESC
  LIMIT 12
), refreshed_jobs AS (
  UPDATE earth_processing_job job
  SET status = 'queued',
      attempts = 0,
      available_at = now(),
      started_at = NULL,
      finished_at = NULL,
      last_error = NULL,
      result = '{}'::jsonb,
      updated_at = now()
  FROM candidates
  WHERE job.id = candidates.id
  RETURNING candidates.observation_id
)
UPDATE earth_observation observation
SET status = 'queued',
    last_error = NULL,
    methodology = COALESCE(observation.methodology, '{}'::jsonb)
      || '{"visualization_version":"readable_nbr_v2"}'::jsonb,
    updated_at = now()
WHERE observation.id IN (SELECT observation_id FROM refreshed_jobs);
