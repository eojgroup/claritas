-- V39: retry Sentinel-2 visual renders rejected because the categorical SCL
-- band inherited REFLECTANCE units from the old evalscript. The replacement
-- evalscript uses native per-band defaults and masks only no-data pixels.
WITH repaired_jobs AS (
  UPDATE earth_processing_job job
  SET status = 'queued',
      attempts = 0,
      available_at = now(),
      started_at = NULL,
      finished_at = NULL,
      last_error = NULL,
      result = '{}'::jsonb,
      updated_at = now()
  FROM earth_observation observation
  WHERE job.observation_id = observation.id
    AND job.provider = 'copernicus'
    AND job.job_type = 'render'
    AND observation.product_type IN ('true_color', 'false_color')
    AND job.status IN ('failed', 'dead_letter')
    AND job.last_error ILIKE '%Band ''SCL''%unsupported units ''REFLECTANCE''%'
  RETURNING job.observation_id
)
UPDATE earth_observation observation
SET status = 'queued',
    last_error = NULL,
    updated_at = now()
WHERE observation.id IN (SELECT observation_id FROM repaired_jobs);

UPDATE provider_runtime_state
SET consecutive_failures = 0,
    circuit_open_until = NULL,
    last_error = NULL,
    updated_at = now()
WHERE provider = 'copernicus'
  AND last_error ILIKE '%Band ''SCL''%unsupported units ''REFLECTANCE''%';
