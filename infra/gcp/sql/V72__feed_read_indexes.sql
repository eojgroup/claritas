-- Keep the ranking worker's working set narrow. These indexes do not change
-- ranking, quality or expiry policy. Concurrent creation keeps ingestion live.
SET lock_timeout='5s';
DROP INDEX CONCURRENTLY IF EXISTS intelligence_event_feed_active_covering_idx;
CREATE INDEX CONCURRENTLY intelligence_event_feed_active_covering_idx
  ON intelligence_event_feed(last_activity_time DESC,id)
  INCLUDE(event_type,severity,source_diversity,domain_count,relevance_score,
    urgency_score,materiality_score,end_time,primary_country_iso2,primary_location_id,metadata)
  WHERE status IN ('emerging','active','monitoring');
DROP INDEX CONCURRENTLY IF EXISTS news_item_assessment_feed_covering_idx;
CREATE INDEX CONCURRENTLY news_item_assessment_feed_covering_idx
  ON news_item_assessment(item_id) INCLUDE(score,assessed_at);

-- Defaults wait for hundreds of thousands of dead rows in these large tables.
-- Their small, frequently changed current cohort needs earlier vacuum/analyze.
ALTER TABLE intelligence_event_evidence SET (
  autovacuum_vacuum_scale_factor=0.005,autovacuum_vacuum_threshold=500,
  autovacuum_vacuum_insert_scale_factor=0.005,autovacuum_vacuum_insert_threshold=500,
  autovacuum_analyze_scale_factor=0.01,autovacuum_analyze_threshold=500);
ALTER TABLE intelligence_event_feed SET (
  autovacuum_vacuum_scale_factor=0.005,autovacuum_vacuum_threshold=500,
  autovacuum_vacuum_insert_scale_factor=0.005,autovacuum_vacuum_insert_threshold=500,
  autovacuum_analyze_scale_factor=0.01,autovacuum_analyze_threshold=500);
ALTER TABLE news_item_assessment SET (
  autovacuum_vacuum_scale_factor=0.01,autovacuum_vacuum_threshold=500,
  autovacuum_analyze_scale_factor=0.01,autovacuum_analyze_threshold=500);
RESET lock_timeout;
