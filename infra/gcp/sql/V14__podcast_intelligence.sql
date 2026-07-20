-- V14: PodcastIndex ingestion, timestamped evidence, and extracted intelligence signals

CREATE TABLE IF NOT EXISTS podcast_feed (
  id                     BIGSERIAL PRIMARY KEY,
  source_id              BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  podcast_index_id       BIGINT NOT NULL UNIQUE,
  podcast_guid           TEXT,
  title                  TEXT NOT NULL,
  feed_url               TEXT NOT NULL,
  site_url               TEXT,
  author                 TEXT,
  description            TEXT,
  image_url              TEXT,
  language               TEXT,
  itunes_id              BIGINT,
  categories             JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at         TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS podcast_feed_source_url_idx
  ON podcast_feed (source_id, feed_url);

CREATE TABLE IF NOT EXISTS podcast_episode (
  id                     BIGSERIAL PRIMARY KEY,
  item_id                BIGINT NOT NULL UNIQUE REFERENCES item(id) ON DELETE CASCADE,
  feed_id                BIGINT NOT NULL REFERENCES podcast_feed(id) ON DELETE CASCADE,
  podcast_index_id       BIGINT NOT NULL UNIQUE,
  guid                   TEXT,
  duration_seconds       INTEGER,
  enclosure_url          TEXT,
  image_url              TEXT,
  transcript_status      TEXT NOT NULL DEFAULT 'pending',
  transcript_source_url  TEXT,
  transcript_mime_type   TEXT,
  external_links         JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (transcript_status IN ('pending', 'available', 'missing', 'failed'))
);

CREATE INDEX IF NOT EXISTS podcast_episode_feed_idx
  ON podcast_episode (feed_id, podcast_index_id DESC);

CREATE TABLE IF NOT EXISTS evidence_segment (
  id                     BIGSERIAL PRIMARY KEY,
  episode_id             BIGINT NOT NULL REFERENCES podcast_episode(id) ON DELETE CASCADE,
  segment_index          INTEGER NOT NULL,
  start_ms               INTEGER NOT NULL DEFAULT 0,
  end_ms                 INTEGER,
  speaker                TEXT,
  text                   TEXT NOT NULL,
  source_url             TEXT,
  mime_type              TEXT,
  timing_method          TEXT NOT NULL DEFAULT 'source',
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_vector          TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', COALESCE(text, ''))) STORED,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (episode_id, segment_index),
  CHECK (start_ms >= 0),
  CHECK (end_ms IS NULL OR end_ms >= start_ms),
  CHECK (timing_method IN ('source', 'inferred', 'unknown'))
);

CREATE INDEX IF NOT EXISTS evidence_segment_episode_time_idx
  ON evidence_segment (episode_id, start_ms);
CREATE INDEX IF NOT EXISTS evidence_segment_search_idx
  ON evidence_segment USING GIN (search_vector);

CREATE TABLE IF NOT EXISTS intelligence_signal (
  id                     BIGSERIAL PRIMARY KEY,
  episode_id             BIGINT NOT NULL REFERENCES podcast_episode(id) ON DELETE CASCADE,
  signal_type            TEXT NOT NULL,
  title                  TEXT NOT NULL,
  summary                TEXT,
  canonical_key          TEXT NOT NULL,
  entities               JSONB NOT NULL DEFAULT '[]'::jsonb,
  topics                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_level             TEXT,
  confidence             NUMERIC(4,3),
  extraction_method      TEXT NOT NULL DEFAULT 'metadata',
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (episode_id, signal_type, canonical_key),
  CHECK (signal_type IN ('entity', 'topic', 'claim', 'event', 'risk')),
  CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'critical')),
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS intelligence_signal_episode_idx
  ON intelligence_signal (episode_id, signal_type);
CREATE INDEX IF NOT EXISTS intelligence_signal_entities_idx
  ON intelligence_signal USING GIN (entities jsonb_path_ops);
CREATE INDEX IF NOT EXISTS intelligence_signal_topics_idx
  ON intelligence_signal USING GIN (topics jsonb_path_ops);

CREATE TABLE IF NOT EXISTS intelligence_signal_evidence (
  signal_id              BIGINT NOT NULL REFERENCES intelligence_signal(id) ON DELETE CASCADE,
  evidence_segment_id    BIGINT NOT NULL REFERENCES evidence_segment(id) ON DELETE CASCADE,
  relevance              NUMERIC(4,3),
  quote                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (signal_id, evidence_segment_id),
  CHECK (relevance IS NULL OR (relevance >= 0 AND relevance <= 1))
);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ingestion_automation_rule_pipeline_check'
      AND conrelid = 'ingestion_automation_rule'::regclass
  ) THEN
    ALTER TABLE ingestion_automation_rule DROP CONSTRAINT ingestion_automation_rule_pipeline_check;
  END IF;
  ALTER TABLE ingestion_automation_rule
    ADD CONSTRAINT ingestion_automation_rule_pipeline_check
    CHECK (pipeline IN ('news', 'weather', 'market', 'podcasts'));
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ingestion_demand_signal_minute_pipeline_check'
      AND conrelid = 'ingestion_demand_signal_minute'::regclass
  ) THEN
    ALTER TABLE ingestion_demand_signal_minute DROP CONSTRAINT ingestion_demand_signal_minute_pipeline_check;
  END IF;
  ALTER TABLE ingestion_demand_signal_minute
    ADD CONSTRAINT ingestion_demand_signal_minute_pipeline_check
    CHECK (pipeline IN ('news', 'weather', 'market', 'podcasts'));
END $$;

INSERT INTO ingestion_automation_rule (
  pipeline, enabled, schedule_enabled, schedule_interval_minutes,
  intelligent_enabled, min_spacing_minutes, freshness_sla_minutes,
  demand_window_minutes, demand_threshold, failure_backoff_minutes,
  next_scheduled_at, default_payload
) VALUES (
  'podcasts', false, false, 360, true, 60, 720, 60, 5, 60, now(),
  jsonb_build_object('maxFeeds', 10, 'maxEpisodesPerFeed', 10, 'fetchTranscripts', true, 'extractIntelligence', true)
)
ON CONFLICT (pipeline) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_podcast_feed') THEN
    CREATE TRIGGER set_updated_at_podcast_feed BEFORE UPDATE ON podcast_feed
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_podcast_episode') THEN
    CREATE TRIGGER set_updated_at_podcast_episode BEFORE UPDATE ON podcast_episode
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_evidence_segment') THEN
    CREATE TRIGGER set_updated_at_evidence_segment BEFORE UPDATE ON evidence_segment
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_intelligence_signal') THEN
    CREATE TRIGGER set_updated_at_intelligence_signal BEFORE UPDATE ON intelligence_signal
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
