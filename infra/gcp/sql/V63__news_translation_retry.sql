-- Failed optional translations must not repeatedly occupy the front of the
-- durable source-item queue. A source change makes its previous retry obsolete.
CREATE TABLE news_translation_retry (
  item_id bigint NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  target_language_code text NOT NULL,
  source_title_hash text NOT NULL,
  source_summary_hash text,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  next_attempt_at timestamptz NOT NULL,
  last_error text,
  provider_status integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, target_language_code)
);
CREATE INDEX news_translation_retry_due_idx
  ON news_translation_retry(target_language_code, next_attempt_at);

-- Dispatch pacing and provider backoff survive restarts and are shared by the
-- ingestion wake-up and the recovery worker. The existing worker lease owns it.
CREATE TABLE news_translation_dispatch (
  target_language_code text PRIMARY KEY,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status text NOT NULL,
  last_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
