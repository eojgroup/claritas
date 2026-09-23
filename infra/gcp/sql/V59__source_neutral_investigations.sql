-- Every eligible source can open an investigation. A social post remains an
-- attributed, unverified claim, including after it enters the evidence graph.
ALTER TABLE intelligence_event_evidence
  DROP CONSTRAINT IF EXISTS intelligence_event_evidence_domain_check;
ALTER TABLE intelligence_event_evidence
  ADD CONSTRAINT intelligence_event_evidence_domain_check
  CHECK (domain IN ('news','transport','market','weather','earth_observation','disaster','podcast','social','assessment'));

CREATE OR REPLACE FUNCTION enqueue_social_investigation_signal()
RETURNS TRIGGER AS $$
DECLARE
  emitted_type TEXT;
BEGIN
  IF TG_OP='UPDATE' AND NEW.content_text IS NOT DISTINCT FROM OLD.content_text
      AND NEW.title IS NOT DISTINCT FROM OLD.title
      AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at THEN
    RETURN NEW;
  END IF;
  emitted_type := CASE WHEN TG_OP='INSERT' THEN 'social.signal.ingested' ELSE 'social.signal.updated' END;
  INSERT INTO event_outbox(event_type,aggregate_type,aggregate_id,dedupe_key,payload,occurred_at)
  VALUES (emitted_type,'social_signal',NEW.id::text,
          concat('social-signal-v1:',NEW.id,':',md5(concat_ws('|',NEW.content_text,NEW.title,NEW.posted_at::text))),
          jsonb_build_object('social_signal_id',NEW.id),NEW.posted_at)
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER social_signal_investigation_outbox
AFTER INSERT OR UPDATE OF content_text,title,posted_at ON social_signal
FOR EACH ROW EXECUTE FUNCTION enqueue_social_investigation_signal();

-- Preserve the existing social-retention boundary for copies in evidence.
CREATE OR REPLACE FUNCTION expire_social_investigation_source()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE intelligence_event SET status='dismissed',title='Expired social source',
    summary='The originating social source is no longer retained.',updated_at=now()
  WHERE metadata->>'canonical_evidence_key'=concat('social:social_signal:',OLD.id);
  DELETE FROM intelligence_event_evidence
  WHERE domain='social' AND source_record_type='social_signal' AND source_record_id=OLD.id::text;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER social_signal_investigation_retention
BEFORE DELETE ON social_signal
FOR EACH ROW EXECUTE FUNCTION expire_social_investigation_source();

-- GKG codes remain in payload.gkg.themes for classification. They are not
-- publisher summaries. Keep this cleanup bounded to the active reading window.
UPDATE item SET summary=NULL
WHERE kind='news_article' AND summary ILIKE 'GDELT themes:%'
  AND event_time>=now()-interval '30 days'
  AND source_id IN (SELECT id FROM source WHERE name='gdelt');

-- Source replay runs in the upgraded event worker, not here: an older API
-- must not acknowledge new event types during the migration/rollout window.
