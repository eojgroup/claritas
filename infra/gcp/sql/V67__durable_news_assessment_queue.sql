-- Incremental assessment work: readers and idle worker cycles must not scan all
-- publisher history. Input changes invalidate small durable identities, and
-- completion uses revisions so a racing change cannot be acknowledged away.
CREATE TABLE news_assessment_queue (
  item_id BIGINT PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  priority SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 2),
  revision BIGINT NOT NULL DEFAULT 1
);
CREATE INDEX news_assessment_queue_due_idx ON news_assessment_queue(priority, due_at, item_id);

-- Event fan-out happens in the worker, outside ingestion transactions. This
-- prevents source/event writers from locking many item queue rows at once.
-- No FK: an event deletion must leave its removed news sources invalidated.
CREATE TABLE news_assessment_event_queue (
  event_id UUID PRIMARY KEY,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revision BIGINT NOT NULL DEFAULT 1
);
CREATE INDEX news_assessment_event_queue_order_idx ON news_assessment_event_queue(enqueued_at,event_id);
CREATE TABLE news_assessment_queue_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  methodology_version TEXT NOT NULL,
  backfill_before_item_id BIGINT NOT NULL DEFAULT 9223372036854775807
);

CREATE FUNCTION news_assessment_priority(published_at TIMESTAMPTZ) RETURNS SMALLINT
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN published_at>=now()-interval '4 hours' AND published_at<=now()+interval '5 minutes' THEN 0
    WHEN published_at>=now()-interval '8 days' AND published_at<=now()+interval '5 minutes' THEN 1
    ELSE 2 END::smallint
$$;

CREATE FUNCTION news_assessment_item_id(identity_text TEXT) RETURNS BIGINT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN identity_text ~ '^[1-9][0-9]{0,18}$'
    AND (length(identity_text)<19 OR identity_text COLLATE "C"<='9223372036854775807' COLLATE "C")
    THEN identity_text::bigint END
$$;

CREATE FUNCTION enqueue_news_item_assessment(target_item_id BIGINT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO news_assessment_queue(item_id,due_at,priority)
  SELECT item.id,clock_timestamp(),news_assessment_priority(item.event_time)
  FROM item JOIN source ON source.id=item.source_id
  WHERE item.id=target_item_id AND item.kind='news_article'
    AND (lower(source.name)<>'gdelt' OR item.payload->>'quality_status'='accepted')
  ON CONFLICT(item_id) DO UPDATE SET
    due_at=LEAST(news_assessment_queue.due_at,EXCLUDED.due_at),
    priority=EXCLUDED.priority,revision=news_assessment_queue.revision+1;
  IF NOT FOUND THEN
    DELETE FROM news_assessment_queue WHERE item_id=target_item_id;
  END IF;
END $$;

CREATE FUNCTION invalidate_news_assessment_item() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.kind='news_article' THEN
      INSERT INTO news_assessment_event_queue(event_id)
      SELECT DISTINCT event_id FROM intelligence_event_evidence
      WHERE domain='news' AND source_record_type='item' AND source_record_id=OLD.id::text
      ORDER BY event_id
      ON CONFLICT(event_id) DO UPDATE SET revision=news_assessment_event_queue.revision+1;
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.kind,NEW.title,NEW.summary,NEW.event_time,NEW.created_at,NEW.source_id,NEW.url,NEW.payload)
      IS NOT DISTINCT FROM ROW(OLD.kind,OLD.title,OLD.summary,OLD.event_time,OLD.created_at,OLD.source_id,OLD.url,OLD.payload) THEN
    -- Readers require assessed_at>=item.updated_at even when a provider replay
    -- only touches that timestamp. Reassess this item without event fan-out.
    IF NEW.kind='news_article' AND NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
      PERFORM enqueue_news_item_assessment(NEW.id);
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind='news_article' OR (TG_OP='UPDATE' AND OLD.kind='news_article') THEN
    PERFORM enqueue_news_item_assessment(NEW.id);
    -- Publisher identity/eligibility can affect other reports on this event.
    INSERT INTO news_assessment_event_queue(event_id)
    SELECT DISTINCT event_id FROM intelligence_event_evidence
    WHERE domain='news' AND source_record_type='item' AND source_record_id=NEW.id::text
    ORDER BY event_id
    ON CONFLICT(event_id) DO UPDATE SET revision=news_assessment_event_queue.revision+1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER news_assessment_item_invalidated AFTER INSERT OR UPDATE OR DELETE ON item
  FOR EACH ROW EXECUTE FUNCTION invalidate_news_assessment_item();

CREATE FUNCTION invalidate_news_assessment_event() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO news_assessment_event_queue(event_id) VALUES(NEW.id)
  ON CONFLICT(event_id) DO UPDATE SET revision=news_assessment_event_queue.revision+1;
  RETURN NEW;
END $$;
CREATE TRIGGER news_assessment_event_invalidated AFTER UPDATE ON intelligence_event
  FOR EACH ROW WHEN (
    ROW(NEW.event_type,NEW.status,NEW.severity,NEW.confidence,NEW.relevance_score,NEW.urgency_score,
        NEW.materiality_score,NEW.source_diversity,NEW.domain_count)
      IS DISTINCT FROM
    ROW(OLD.event_type,OLD.status,OLD.severity,OLD.confidence,OLD.relevance_score,OLD.urgency_score,
        OLD.materiality_score,OLD.source_diversity,OLD.domain_count)
  ) EXECUTE FUNCTION invalidate_news_assessment_event();

CREATE FUNCTION invalidate_news_assessment_evidence() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.event_id,NEW.domain,NEW.source_record_type,NEW.source_record_id,NEW.correlation_score,NEW.correlation_factors)
    IS NOT DISTINCT FROM ROW(OLD.event_id,OLD.domain,OLD.source_record_type,OLD.source_record_id,OLD.correlation_score,OLD.correlation_factors) THEN
    RETURN NEW;
  END IF;
  IF TG_OP<>'INSERT' AND OLD.domain='news' AND OLD.source_record_type='item' THEN
    -- The removed item cannot be found by the later event fan-out.
    PERFORM enqueue_news_item_assessment(news_assessment_item_id(OLD.source_record_id));
    INSERT INTO news_assessment_event_queue(event_id) VALUES(OLD.event_id)
    ON CONFLICT(event_id) DO UPDATE SET revision=news_assessment_event_queue.revision+1;
  END IF;
  IF TG_OP<>'DELETE' AND NEW.domain='news' AND NEW.source_record_type='item' THEN
    INSERT INTO news_assessment_event_queue(event_id) VALUES(NEW.event_id)
    ON CONFLICT(event_id) DO UPDATE SET revision=news_assessment_event_queue.revision+1;
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER news_assessment_evidence_invalidated AFTER INSERT OR UPDATE OR DELETE ON intelligence_event_evidence
  FOR EACH ROW EXECUTE FUNCTION invalidate_news_assessment_evidence();

COMMENT ON TABLE news_assessment_queue IS
  'Due news assessment identities. Revision-checked completion preserves racing source/event changes; no periodic historical scan.';
COMMENT ON TABLE news_assessment_queue_state IS
  'One resumable descending item-ID cursor per assessment methodology. Each cycle scans a bounded slice including ineligible records.';
