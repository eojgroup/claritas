-- Earlier event consumers treated every GDELT coordinate as exact even when
-- GDELT explicitly classified it as a country or administrative centroid.
-- The current consumer retains only city/local-place types. Existing markers
-- cannot be reconstructed safely, so fail closed and let fresh evidence or a
-- specific linked location restore defensible context.

CREATE TEMP TABLE invalidated_gdelt_event (
  id UUID PRIMARY KEY
);

INSERT INTO invalidated_gdelt_event (id)
SELECT id
FROM intelligence_event
WHERE metadata @> '{"exact_geography":true}'::jsonb
  AND (
    metadata->>'coordinate_source' = 'gdelt_gkg_location'
    OR metadata->>'canonical_evidence_key' LIKE 'news:global_event:%'
  );

UPDATE intelligence_event event
SET metadata = event.metadata - 'exact_geography' - 'geography_provenance_key',
    updated_at = now()
FROM invalidated_gdelt_event invalidated
WHERE event.id = invalidated.id;

UPDATE earth_processing_job job
SET status = 'dead_letter',
    finished_at = now(),
    started_at = NULL,
    last_error = 'Legacy GDELT geography was not typed precisely enough for event-scoped Earth Observation.',
    updated_at = now()
FROM invalidated_gdelt_event invalidated
WHERE job.event_id = invalidated.id
  AND job.status IN ('queued', 'running', 'failed', 'budget_deferred');

UPDATE earth_observation observation
SET status = 'failed',
    last_error = 'Legacy GDELT geography was invalidated because it may represent a country or administrative centroid.',
    methodology = observation.methodology || jsonb_build_object(
      'geography_invalidated', true,
      'geography_invalidation_reason', 'legacy_untyped_gdelt_coordinate'
    ),
    updated_at = now()
FROM invalidated_gdelt_event invalidated
WHERE observation.event_id = invalidated.id
  AND observation.status IN ('queued', 'processing', 'available');

UPDATE earth_observation_asset asset
SET expires_at = LEAST(COALESCE(asset.expires_at, now()), now())
FROM earth_observation observation
JOIN invalidated_gdelt_event invalidated ON invalidated.id = observation.event_id
WHERE asset.observation_id = observation.id;
