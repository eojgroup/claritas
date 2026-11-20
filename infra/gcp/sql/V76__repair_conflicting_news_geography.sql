-- An article can mention many places. GDELT context from one of those
-- places must not replace the position of a named local investigation.
-- Keep the rejected position/provenance for audit; readers use the retained
-- catalogue location as an estimate, rather than an invented precise point.
WITH conflicts AS MATERIALIZED (
  SELECT event.id FROM intelligence_event event
  JOIN intelligence_location location ON location.id=event.primary_location_id
  WHERE location.location_type IN ('city','port','airport','strait','canal','chokepoint','industrial_facility','refinery','lng_terminal','rail_terminal','dam','strategic_site','point')
    AND location.center IS NOT NULL
    AND event.primary_location_id IS NOT NULL AND event.geography IS NOT NULL
    AND NOT ST_DWithin(location.center,ST_PointOnSurface(event.geography)::geography,150000)
)
UPDATE intelligence_event event
SET geography = NULL,
    metadata = (event.metadata - 'exact_geography' - 'geography_provenance_key')
      || jsonb_build_object('geography_repair_v1', jsonb_build_object(
        'reason', 'news_coordinates_conflict_with_named_location',
        'previous_latitude', ST_Y(ST_PointOnSurface(event.geography)),
        'previous_longitude', ST_X(ST_PointOnSurface(event.geography)),
        'previous_provenance', event.metadata->>'geography_provenance_key',
        'repaired_at', now())),
    updated_at = now()
FROM conflicts
WHERE conflicts.id=event.id
  AND event.metadata->>'geography_provenance_key' LIKE 'news:%';
