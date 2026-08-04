-- V32: lower background write/load cadence and bound operational audit growth.
-- Manual runs remain available when fresher data is required.

UPDATE ingestion_automation_rule
SET schedule_interval_minutes = GREATEST(schedule_interval_minutes, 240),
    min_spacing_minutes = GREATEST(min_spacing_minutes, 30),
    freshness_sla_minutes = GREATEST(freshness_sla_minutes, 300),
    next_scheduled_at = LEAST(
      COALESCE(next_scheduled_at, now() + interval '4 hours'),
      now() + interval '4 hours'
    )
WHERE pipeline = 'market';

DELETE FROM ingestion_demand_signal_minute
WHERE bucket_minute < now() - interval '7 days';

DELETE FROM ingestion_run
WHERE finished_at < now() - interval '30 days'
  AND status = 'success';

DELETE FROM ingestion_run
WHERE finished_at < now() - interval '90 days'
  AND status = 'failed';
