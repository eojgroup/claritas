-- V33: lightweight, auditable translations for non-English news.
--
-- Original publisher text remains on item. Generated presentation text is
-- stored separately and keyed by target language so additional application
-- languages do not require schema changes.

CREATE TABLE IF NOT EXISTS item_translation (
  item_id                BIGINT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  target_language_code   TEXT NOT NULL,
  translated_title       TEXT NOT NULL,
  generated_summary      TEXT,
  summary_status         TEXT NOT NULL DEFAULT 'not_requested',
  source_title_hash      CHAR(32) NOT NULL,
  source_summary_hash    CHAR(32),
  provider               TEXT NOT NULL,
  model                  TEXT,
  generation_metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  title_generated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary_generated_at   TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, target_language_code),
  CONSTRAINT item_translation_target_language_check
    CHECK (target_language_code ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'),
  CONSTRAINT item_translation_title_not_blank
    CHECK (length(btrim(translated_title)) > 0),
  CONSTRAINT item_translation_title_length
    CHECK (length(translated_title) <= 500),
  CONSTRAINT item_translation_summary_length
    CHECK (generated_summary IS NULL OR length(generated_summary) <= 1000),
  CONSTRAINT item_translation_summary_status_check
    CHECK (summary_status IN ('not_requested', 'generated', 'insufficient')),
  CONSTRAINT item_translation_summary_state_check
    CHECK (
      (summary_status = 'generated' AND generated_summary IS NOT NULL AND summary_generated_at IS NOT NULL)
      OR (summary_status = 'insufficient' AND generated_summary IS NULL AND summary_generated_at IS NOT NULL)
      OR (summary_status = 'not_requested' AND generated_summary IS NULL AND summary_generated_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS item_translation_target_generated_idx
  ON item_translation (target_language_code, title_generated_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_item_translation'
  ) THEN
    CREATE TRIGGER set_updated_at_item_translation
      BEFORE UPDATE ON item_translation
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
