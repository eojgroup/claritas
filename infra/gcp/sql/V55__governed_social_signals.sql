-- V55: governed social-media signals.
--
-- Social posts are intentionally stored outside `item`/`news_article`. A post
-- is evidence that an account made a claim; it is not evidence that the claim
-- is true. The immutable defaults and CHECK constraints make that distinction
-- survive every API/client implementation.

CREATE TABLE IF NOT EXISTS social_signal (
  id                         BIGSERIAL PRIMARY KEY,
  source_id                  BIGINT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  external_id                TEXT NOT NULL,
  platform                   TEXT NOT NULL,
  content_type               TEXT NOT NULL DEFAULT 'social_post',
  signal_nature              TEXT NOT NULL DEFAULT 'claim',
  verification_status        TEXT NOT NULL DEFAULT 'unverified',
  content_text               TEXT NOT NULL,
  title                      TEXT,
  url                        TEXT NOT NULL,
  language_code              TEXT,
  country_iso2               CHAR(2) REFERENCES country(iso2),
  country_attribution        JSONB NOT NULL DEFAULT '{}'::jsonb,
  posted_at                  TIMESTAMPTZ NOT NULL,
  acquired_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  author_account_id          TEXT NOT NULL,
  author_handle              TEXT,
  author_display_name        TEXT,
  author_profile_url         TEXT,
  author_avatar_url          TEXT,
  author_platform_verified   BOOLEAN,
  responsible_party_name     TEXT NOT NULL,
  responsible_party_account_id TEXT NOT NULL,
  responsible_party_type     TEXT NOT NULL DEFAULT 'account_holder',
  responsibility_basis       TEXT NOT NULL DEFAULT 'platform_account',
  engagement                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  media                      JSONB NOT NULL DEFAULT '[]'::jsonb,
  topics                     JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at                 TIMESTAMPTZ NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id),
  CHECK (platform IN ('x', 'reddit', 'youtube', 'bluesky')),
  CHECK (content_type = 'social_post'),
  CHECK (signal_nature = 'claim'),
  CHECK (verification_status IN ('unverified', 'corroborated', 'disputed')),
  CHECK (length(btrim(content_text)) > 0),
  CHECK (length(btrim(author_account_id)) > 0),
  CHECK (length(btrim(responsible_party_name)) > 0),
  CHECK (length(btrim(responsible_party_account_id)) > 0),
  CHECK (responsible_party_type IN ('account_holder')),
  CHECK (responsibility_basis IN ('platform_account')),
  CHECK (jsonb_typeof(engagement) = 'object'),
  CHECK (jsonb_typeof(media) = 'array'),
  CHECK (jsonb_typeof(topics) = 'array'),
  CHECK (jsonb_typeof(country_attribution) = 'object'),
  CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS social_signal_posted_idx
  ON social_signal (posted_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS social_signal_expires_idx
  ON social_signal (expires_at);

CREATE INDEX IF NOT EXISTS social_signal_platform_posted_idx
  ON social_signal (platform, posted_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS social_signal_country_posted_idx
  ON social_signal (country_iso2, posted_at DESC, id DESC)
  WHERE country_iso2 IS NOT NULL;

CREATE INDEX IF NOT EXISTS social_signal_topics_gin
  ON social_signal USING GIN (topics);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_social_signal'
  ) THEN
    CREATE TRIGGER set_updated_at_social_signal
      BEFORE UPDATE ON social_signal
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Extend the existing automation/demand allowlists without weakening their
-- other constraints. Social polling is opt-in because X/Reddit access can be
-- contractual and YouTube search consumes quota.
ALTER TABLE ingestion_automation_rule
  DROP CONSTRAINT IF EXISTS ingestion_automation_rule_pipeline_check;
ALTER TABLE ingestion_automation_rule
  ADD CONSTRAINT ingestion_automation_rule_pipeline_check
  CHECK (pipeline IN ('news', 'weather', 'market', 'podcasts', 'leadership', 'social'));

ALTER TABLE ingestion_demand_signal_minute
  DROP CONSTRAINT IF EXISTS ingestion_demand_signal_minute_pipeline_check;
ALTER TABLE ingestion_demand_signal_minute
  ADD CONSTRAINT ingestion_demand_signal_minute_pipeline_check
  CHECK (pipeline IN ('news', 'weather', 'market', 'podcasts', 'leadership', 'social'));

-- Deliberately do not seed the social automation row in this expand migration.
-- Migrations run while the previous API is still serving, and that release does
-- not recognize the `social` pipeline. The upgraded API creates the disabled
-- rule only after an administrator explicitly prepares social automation once
-- the release gates have passed. This keeps both the pre-rollout window and a
-- failed application rollout compatible with the previous API.
