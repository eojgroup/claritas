-- Match the queue's ordered, bounded claim instead of sorting every pending row.
-- Concurrent construction keeps ingestion and publication available.
CREATE INDEX CONCURRENTLY IF NOT EXISTS event_outbox_claim_order_idx
  ON event_outbox(occurred_at,id)
  WHERE status IN ('pending','failed','publishing');
ANALYZE event_outbox;
