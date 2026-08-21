-- Persist the deterministic, evidence-backed projection used to rank and
-- navigate publisher reporting. Source item rows remain immutable evidence;
-- assessments can be recomputed independently as governed event context
-- changes or the methodology is versioned.
CREATE OR REPLACE FUNCTION canonical_news_publisher_key(
  article_url TEXT,
  article_payload JSONB,
  fallback_source_name TEXT
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    NULLIF(regexp_replace(lower(trim(COALESCE(
      NULLIF(article_payload->>'publisher_domain',''),
      NULLIF(article_payload->>'domain',''),
      NULLIF(substring(article_url FROM '^[A-Za-z][A-Za-z0-9+.-]*://([^/:?#]+)'), '')
    ))), '^www[0-9]*\.', ''), ''),
    NULLIF(regexp_replace(lower(trim(COALESCE(
      NULLIF(article_payload->>'publisher',''),
      NULLIF(article_payload->>'source',''),
      fallback_source_name
    ))), '[^a-z0-9]+', '', 'g'), ''),
    'unknown'
  )
$$;

COMMENT ON FUNCTION canonical_news_publisher_key(TEXT, JSONB, TEXT) IS
  'Canonical original-publisher identity. Prefer the publisher domain/article host so direct and aggregator discoveries converge.';

CREATE TABLE IF NOT EXISTS news_item_assessment (
  item_id              BIGINT PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  methodology_version  TEXT NOT NULL,
  primary_category     TEXT NOT NULL CHECK (primary_category IN (
    'markets','economy','companies','geopolitics','policy','energy',
    'technology','climate_disasters','health','transport','other'
  )),
  categories           JSONB NOT NULL CHECK (jsonb_typeof(categories) = 'array'),
  tags                 JSONB NOT NULL CHECK (jsonb_typeof(tags) = 'array'),
  reasons              JSONB NOT NULL CHECK (jsonb_typeof(reasons) = 'array'),
  components           JSONB NOT NULL CHECK (jsonb_typeof(components) = 'object'),
  score                DOUBLE PRECISION NOT NULL CHECK (score BETWEEN 0 AND 100),
  tier                 TEXT NOT NULL CHECK (tier IN ('top','high','notable','routine')),
  confidence           DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  assessed_at          TIMESTAMPTZ NOT NULL,
  inputs_hash          TEXT NOT NULL CHECK (length(inputs_hash) = 64),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS news_item_assessment_score_idx
  ON news_item_assessment (score DESC, item_id DESC);
CREATE INDEX IF NOT EXISTS news_item_assessment_category_score_idx
  ON news_item_assessment (primary_category, score DESC, item_id DESC);
CREATE INDEX IF NOT EXISTS news_item_assessment_categories_gin
  ON news_item_assessment USING GIN (categories);
CREATE INDEX IF NOT EXISTS news_item_assessment_refresh_idx
  ON news_item_assessment (methodology_version, assessed_at);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_news_item_assessment'
  ) THEN
    CREATE TRIGGER set_updated_at_news_item_assessment
      BEFORE UPDATE ON news_item_assessment
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE news_item_assessment IS
  'Versioned Claritas classification and priority projection; never replaces publisher evidence.';
COMMENT ON COLUMN news_item_assessment.score IS
  'Automated news priority from 0 to 100, not measured market impact or investment advice.';
COMMENT ON COLUMN news_item_assessment.inputs_hash IS
  'SHA-256 of normalized evidence inputs and the bounded assessment time bucket.';

ANALYZE news_item_assessment;
