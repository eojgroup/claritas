-- Feed ranking must not read toasted summaries, full metadata or PostGIS
-- geometry for every candidate. Keep its small inputs transactionally in sync;
-- only the selected page joins the complete canonical event.
SET lock_timeout='5s';

CREATE TABLE IF NOT EXISTS intelligence_event_feed (
  id UUID PRIMARY KEY REFERENCES intelligence_event(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  source_diversity INTEGER NOT NULL,
  domain_count INTEGER NOT NULL,
  relevance_score DOUBLE PRECISION NOT NULL,
  urgency_score DOUBLE PRECISION NOT NULL,
  materiality_score DOUBLE PRECISION NOT NULL,
  last_activity_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  primary_country_iso2 CHAR(2),
  primary_location_id UUID,
  metadata JSONB NOT NULL
);

CREATE OR REPLACE FUNCTION sync_intelligence_event_feed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO intelligence_event_feed (
    id,event_type,status,severity,source_diversity,domain_count,
    relevance_score,urgency_score,materiality_score,last_activity_time,end_time,
    primary_country_iso2,primary_location_id,metadata
  ) VALUES (
    NEW.id,NEW.event_type,NEW.status,NEW.severity,NEW.source_diversity,NEW.domain_count,
    NEW.relevance_score,NEW.urgency_score,NEW.materiality_score,NEW.last_activity_time,NEW.end_time,
    NEW.primary_country_iso2,NEW.primary_location_id,
    jsonb_build_object('origin_domain',NEW.metadata->>'origin_domain',
                      'canonical_evidence_key',NEW.metadata->>'canonical_evidence_key')
  ) ON CONFLICT (id) DO UPDATE SET
    event_type=EXCLUDED.event_type,status=EXCLUDED.status,severity=EXCLUDED.severity,
    source_diversity=EXCLUDED.source_diversity,domain_count=EXCLUDED.domain_count,
    relevance_score=EXCLUDED.relevance_score,urgency_score=EXCLUDED.urgency_score,
    materiality_score=EXCLUDED.materiality_score,last_activity_time=EXCLUDED.last_activity_time,
    end_time=EXCLUDED.end_time,primary_country_iso2=EXCLUDED.primary_country_iso2,
    primary_location_id=EXCLUDED.primary_location_id,metadata=EXCLUDED.metadata;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER sync_intelligence_event_feed
  AFTER INSERT OR UPDATE OF event_type,status,severity,source_diversity,domain_count,
    relevance_score,urgency_score,materiality_score,last_activity_time,end_time,
    primary_country_iso2,primary_location_id,metadata
  ON intelligence_event FOR EACH ROW EXECUTE FUNCTION sync_intelligence_event_feed();

INSERT INTO intelligence_event_feed
SELECT id,event_type,status,severity,source_diversity,domain_count,
       relevance_score,urgency_score,materiality_score,last_activity_time,end_time,
       primary_country_iso2,primary_location_id,
       jsonb_build_object('origin_domain',metadata->>'origin_domain',
                          'canonical_evidence_key',metadata->>'canonical_evidence_key')
-- Each copied parent is protected from concurrent deletion. An event update
-- racing the copy is already synchronized by the trigger; never overwrite its
-- newer projection with this statement's older snapshot.
FROM intelligence_event FOR KEY SHARE
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS intelligence_event_feed_active_time_idx
  ON intelligence_event_feed(last_activity_time DESC)
  WHERE status IN ('emerging','active','monitoring');
CREATE INDEX IF NOT EXISTS intelligence_event_feed_country_time_idx
  ON intelligence_event_feed(primary_country_iso2,last_activity_time DESC);
CREATE INDEX IF NOT EXISTS intelligence_event_feed_location_time_idx
  ON intelligence_event_feed(primary_location_id,last_activity_time DESC);

ANALYZE intelligence_event_feed;
RESET lock_timeout;
