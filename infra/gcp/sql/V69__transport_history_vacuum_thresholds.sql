-- Historical transport tables exceed 90 million rows. The default 20% vacuum
-- threshold leaves millions of deleted rows behind between maintenance runs.
-- Keep normal throttled autovacuum; reclaim reusable space more frequently.
SET LOCAL lock_timeout='5s';
ALTER TABLE transport_track_point SET (
  autovacuum_vacuum_scale_factor=0.01,
  autovacuum_vacuum_threshold=5000,
  autovacuum_analyze_scale_factor=0.02
);
ALTER TABLE transport_entity_activity_hour SET (
  autovacuum_vacuum_scale_factor=0.01,
  autovacuum_vacuum_threshold=5000,
  autovacuum_analyze_scale_factor=0.02
);
