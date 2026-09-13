-- Context links deliberately do not enter canonical evidence/confidence scores.
CREATE TABLE social_event_context (
  event_id UUID NOT NULL REFERENCES intelligence_event(id) ON DELETE CASCADE,
  signal_id BIGINT NOT NULL REFERENCES social_signal(id) ON DELETE CASCADE,
  matched_terms JSONB NOT NULL,
  PRIMARY KEY(event_id,signal_id)
);
CREATE INDEX social_event_context_signal_idx ON social_event_context(signal_id);

-- The deployed baseline already understands social rules. Enable the keyless
-- provider requested for continuous monitoring; paid/credentialed APIs stay opt-in.
INSERT INTO ingestion_automation_rule
  (pipeline,enabled,schedule_enabled,schedule_interval_minutes,min_spacing_minutes,
   freshness_sla_minutes,next_scheduled_at,default_payload)
VALUES ('social',true,true,60,30,180,now(),
  '{"providers":{"x":false,"reddit":false,"youtube":false,"bluesky":true},"maxResultsPerQuery":25,"lookbackHours":24}')
ON CONFLICT (pipeline) DO UPDATE SET enabled=true,schedule_enabled=true,
  next_scheduled_at=now(),default_payload=EXCLUDED.default_payload;
