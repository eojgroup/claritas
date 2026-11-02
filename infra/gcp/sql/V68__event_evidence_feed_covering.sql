-- Keep event eligibility probes on narrow index pages instead of fetching
-- historical provider JSON/geometry from the evidence heap for every row.
-- A cancelled concurrent build can leave an invalid index. A Flyway repair
-- and retry must rebuild it rather than silently accepting that placeholder.
DROP INDEX CONCURRENTLY IF EXISTS intelligence_event_evidence_feed_covering_idx;
CREATE INDEX CONCURRENTLY intelligence_event_evidence_feed_covering_idx
  ON intelligence_event_evidence(event_id)
  INCLUDE (domain,source_id,source_record_type,source_record_id);
