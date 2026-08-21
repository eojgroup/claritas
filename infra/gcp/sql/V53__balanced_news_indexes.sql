-- V53: add lookup indexes for the durable GDELT URL reconciliation introduced
-- by V52 without locking the item write path. This migration is intentionally
-- nontransactional (see the sibling .conf file).

-- A canceled concurrent build can leave an INVALID index behind. Dropping the
-- run-owned names first makes a Flyway repair and retry deterministic; the
-- session-level Flyway advisory lock prevents another migration runner from
-- racing these statements.
DROP INDEX CONCURRENTLY IF EXISTS item_news_source_url_idx;
DROP INDEX CONCURRENTLY IF EXISTS item_news_source_canonical_url_idx;
DROP INDEX CONCURRENTLY IF EXISTS item_gdelt_canonical_reconciliation_idx;
DROP INDEX CONCURRENTLY IF EXISTS news_signal_gdelt_canonical_reconciliation_idx;

CREATE INDEX CONCURRENTLY item_news_source_url_idx
  ON item (source_id, url)
  WHERE kind='news_article' AND url IS NOT NULL;

CREATE INDEX CONCURRENTLY item_news_source_canonical_url_idx
  ON item (source_id, (payload->>'canonical_url'))
  WHERE kind='news_article';

-- These indexes contain only rows still awaiting the runtime WHATWG repair.
-- The GDELT source range becomes empty after reconciliation, making the
-- fail-closed completion check cheap on later ingests and process restarts.
CREATE INDEX CONCURRENTLY item_gdelt_canonical_reconciliation_idx
  ON item (source_id, id)
  WHERE kind='news_article'
    AND payload->>'canonical_url_algorithm' IS DISTINCT FROM 'whatwg-url-v1';

CREATE INDEX CONCURRENTLY news_signal_gdelt_canonical_reconciliation_idx
  ON news_signal (source_id, id)
  WHERE payload->>'canonical_url_algorithm' IS DISTINCT FROM 'whatwg-url-v1';
