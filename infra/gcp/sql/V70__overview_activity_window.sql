-- Includes resolved investigations so overview history can describe the selected
-- period without scanning the full canonical event or historical evidence heap.
SET lock_timeout='5s';
DROP INDEX CONCURRENTLY IF EXISTS intelligence_event_feed_overview_time_idx;
CREATE INDEX CONCURRENTLY intelligence_event_feed_overview_time_idx
  ON intelligence_event_feed(last_activity_time DESC,id);
RESET lock_timeout;
