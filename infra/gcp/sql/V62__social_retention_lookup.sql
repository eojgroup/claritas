-- Retention dismisses the event opened directly from each expired social
-- post. Without this expression index the row trigger scans every event for
-- every deleted post, times out, and rolls the entire retention batch back.
-- Keep ingestion writes available while building the lookup. As in V53,
-- discard a possibly invalid index left by an interrupted concurrent build.
DROP INDEX CONCURRENTLY IF EXISTS intelligence_event_canonical_evidence_key_idx;
CREATE INDEX CONCURRENTLY intelligence_event_canonical_evidence_key_idx
  ON intelligence_event ((metadata->>'canonical_evidence_key'));

ANALYZE intelligence_event;
