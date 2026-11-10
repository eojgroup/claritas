-- Build complete reporting windows away from reader requests. A generation is
-- published only once its bounded keyset backfill and all snapshots succeed.
CREATE TABLE intelligence_overview_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  generation_id UUID NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  pending_events INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE intelligence_overview_refresh (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  generation_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  cursor_time TIMESTAMPTZ,
  cursor_id UUID,
  scanned_events INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE intelligence_overview_projection (
  generation_id UUID NOT NULL,
  id UUID NOT NULL,
  last_activity_time TIMESTAMPTZ NOT NULL,
  country_iso2 TEXT,
  topic TEXT NOT NULL,
  location_key TEXT,
  location_name TEXT,
  severity TEXT NOT NULL,
  priority_base DOUBLE PRECISION NOT NULL,
  priority_cap DOUBLE PRECISION NOT NULL,
  sample JSONB NOT NULL,
  event JSONB NOT NULL,
  PRIMARY KEY (generation_id,id)
);
CREATE INDEX intelligence_overview_projection_time_idx
  ON intelligence_overview_projection(generation_id,last_activity_time DESC,id);
CREATE INDEX intelligence_overview_projection_country_idx
  ON intelligence_overview_projection(generation_id,country_iso2,last_activity_time DESC);
CREATE INDEX intelligence_overview_projection_topic_idx
  ON intelligence_overview_projection(generation_id,topic,last_activity_time DESC);
CREATE INDEX intelligence_overview_projection_social_idx
  ON intelligence_overview_projection(generation_id)
  WHERE sample->'metadata'->>'canonical_evidence_key' LIKE 'social:social_signal:%';
CREATE TABLE intelligence_overview_snapshot (
  hours INTEGER NOT NULL CHECK (hours IN (24,72,168)),
  priority TEXT NOT NULL CHECK (priority IN ('high','all')),
  generation_id UUID NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (hours,priority)
);

-- Feed mutations include priority/status/location changes; evidence mutations
-- include new source context and removed/expired social records. Every change
-- during initial backfill remains queued until its saved projection is replayed.
CREATE TABLE intelligence_overview_dirty (
  id UUID PRIMARY KEY,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX intelligence_overview_dirty_queued_idx ON intelligence_overview_dirty(queued_at,id);
CREATE FUNCTION queue_intelligence_overview_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_id UUID;
BEGIN
  IF TG_TABLE_NAME='intelligence_event_evidence' THEN
    IF TG_OP='DELETE' THEN event_id := OLD.event_id; ELSE event_id := NEW.event_id; END IF;
  ELSE
    IF TG_OP='DELETE' THEN event_id := OLD.id; ELSE event_id := NEW.id; END IF;
  END IF;
  INSERT INTO intelligence_overview_dirty(id) VALUES(event_id)
    ON CONFLICT(id) DO UPDATE SET queued_at=clock_timestamp();
  RETURN NULL;
END $$;
CREATE TRIGGER intelligence_overview_feed_dirty AFTER INSERT OR UPDATE OR DELETE ON intelligence_event_feed
  FOR EACH ROW EXECUTE FUNCTION queue_intelligence_overview_event();
CREATE TRIGGER intelligence_overview_presentation_dirty AFTER UPDATE OF title,summary,confidence,geography,start_time ON intelligence_event
  FOR EACH ROW EXECUTE FUNCTION queue_intelligence_overview_event();
CREATE TRIGGER intelligence_overview_evidence_dirty AFTER INSERT OR UPDATE OR DELETE ON intelligence_event_evidence
  FOR EACH ROW EXECUTE FUNCTION queue_intelligence_overview_event();
CREATE FUNCTION queue_intelligence_overview_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payload->>'quality_status' IS DISTINCT FROM OLD.payload->>'quality_status'
    OR NEW.title IS DISTINCT FROM OLD.title OR NEW.summary IS DISTINCT FROM OLD.summary THEN
    INSERT INTO intelligence_overview_dirty(id)
      SELECT DISTINCT event_id FROM intelligence_event_evidence WHERE source_record_type='item' AND source_record_id=NEW.id::text
      ON CONFLICT(id) DO UPDATE SET queued_at=clock_timestamp();
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER intelligence_overview_item_dirty AFTER UPDATE OF payload,title,summary ON item
  FOR EACH ROW EXECUTE FUNCTION queue_intelligence_overview_item();
