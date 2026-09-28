-- Bound current-event scans before evidence checks and ranking. Detailed
-- imagery state is fetched only for the selected page of investigations.
CREATE INDEX IF NOT EXISTS intelligence_event_active_time_idx
  ON intelligence_event (last_activity_time DESC)
  WHERE status IN ('emerging','active','monitoring');

CREATE INDEX IF NOT EXISTS earth_processing_job_event_status_idx
  ON earth_processing_job (event_id,status)
  WHERE event_id IS NOT NULL;

-- Refresh estimates after the source-neutral replay changed the distribution.
ANALYZE intelligence_event;
ANALYZE intelligence_event_evidence;
ANALYZE earth_processing_job;
