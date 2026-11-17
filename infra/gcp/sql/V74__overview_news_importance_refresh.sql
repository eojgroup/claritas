-- Publisher assessments feed the same saved overview as other signal families.
CREATE FUNCTION queue_overview_news_assessment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.score IS DISTINCT FROM OLD.score
    OR NEW.methodology_version IS DISTINCT FROM OLD.methodology_version THEN
    INSERT INTO intelligence_overview_dirty(id)
      SELECT DISTINCT evidence.event_id FROM intelligence_event_evidence evidence
      JOIN intelligence_event event ON event.id=evidence.event_id
      WHERE evidence.domain='news' AND evidence.source_record_type='item'
        AND evidence.source_record_id=NEW.item_id::text
        AND event.last_activity_time>=now()-interval '14 days'
      ON CONFLICT(id) DO UPDATE SET queued_at=clock_timestamp();
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER overview_news_assessment_dirty AFTER INSERT OR UPDATE ON news_item_assessment
  FOR EACH ROW EXECUTE FUNCTION queue_overview_news_assessment();
