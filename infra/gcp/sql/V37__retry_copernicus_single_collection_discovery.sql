-- V37: CDSE Catalog now accepts exactly one collection per search. V37 resets
-- only jobs that failed with the former multi-collection request so the fixed
-- worker can recover imagery without an operator retrying every row.

UPDATE earth_processing_job
SET status = 'queued',
    attempts = 0,
    available_at = now(),
    started_at = NULL,
    finished_at = NULL,
    last_error = NULL,
    updated_at = now()
WHERE provider = 'copernicus'
  AND job_type = 'scene_discovery'
  AND status IN ('failed', 'dead_letter')
  AND last_error ILIKE '%Parameter ''collections'' size must be between 1 and 1%';

UPDATE provider_runtime_state
SET consecutive_failures = 0,
    circuit_open_until = NULL,
    rate_limited_until = NULL,
    last_error = NULL,
    updated_at = now()
WHERE provider = 'copernicus'
  AND last_error ILIKE '%Parameter ''collections'' size must be between 1 and 1%';
