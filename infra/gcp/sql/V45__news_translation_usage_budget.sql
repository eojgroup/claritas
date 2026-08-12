-- V45: durable free-tier budget accounting for news translation.
--
-- One row per UTC day is updated atomically before every provider request.
-- Reservations are intentionally not refunded after provider or parse errors:
-- this keeps retries bounded and avoids under-counting requests that reached
-- OpenRouter but whose response could not be accepted.

CREATE TABLE IF NOT EXISTS news_translation_usage (
  usage_date                 DATE PRIMARY KEY,
  request_count              INTEGER NOT NULL DEFAULT 0,
  automatic_request_count    INTEGER NOT NULL DEFAULT 0,
  input_characters           BIGINT NOT NULL DEFAULT 0,
  token_units_reserved       BIGINT NOT NULL DEFAULT 0,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT news_translation_usage_nonnegative_check CHECK (
    request_count >= 0
    AND automatic_request_count >= 0
    AND input_characters >= 0
    AND token_units_reserved >= 0
  ),
  CONSTRAINT news_translation_usage_automatic_within_total_check CHECK (
    automatic_request_count <= request_count
  )
);

COMMENT ON TABLE news_translation_usage IS
  'Atomic UTC-day reservations for free-only automatic and on-demand news translation.';
COMMENT ON COLUMN news_translation_usage.token_units_reserved IS
  'Conservative upper bound: UTF-8 prompt bytes plus configured maximum output tokens.';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_news_translation_usage'
  ) THEN
    CREATE TRIGGER set_updated_at_news_translation_usage
      BEFORE UPDATE ON news_translation_usage
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
