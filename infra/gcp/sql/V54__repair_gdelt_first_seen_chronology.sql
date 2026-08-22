-- V54: repair GDELT discovery timestamps written before canonical story
-- history became immutable. Rediscovery is provenance, not publication: every
-- alias of a provider-first-seen story must use the earliest time at which
-- Claritas could have known that canonical story.

WITH gdelt_discovery AS (
  SELECT
    i.id,
    i.source_id,
    COALESCE(NULLIF(i.payload->>'canonical_url', ''), i.url, i.external_id) AS story_key,
    LEAST(
      i.event_time,
      i.created_at,
      CASE
        WHEN i.payload->>'first_provider_seen_at'
          ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
          THEN (i.payload->>'first_provider_seen_at')::timestamptz
      END,
      CASE
        WHEN i.payload->>'provider_seen_at'
          ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
          THEN (i.payload->>'provider_seen_at')::timestamptz
      END
    ) AS earliest_row_seen_at
  FROM item i
  JOIN source s ON s.id=i.source_id
  WHERE i.kind='news_article'
    AND lower(s.name)='gdelt'
    AND i.payload->>'time_basis'='provider_first_seen'
), canonical_first_seen AS (
  SELECT
    source_id,
    story_key,
    MIN(earliest_row_seen_at) AS first_seen_at
  FROM gdelt_discovery
  GROUP BY source_id,story_key
), repaired AS (
  SELECT d.id,c.first_seen_at
  FROM gdelt_discovery d
  JOIN canonical_first_seen c
    ON c.source_id=d.source_id
   AND c.story_key=d.story_key
  WHERE c.first_seen_at IS NOT NULL
)
UPDATE item i
SET event_time=r.first_seen_at,
    payload=jsonb_set(
      i.payload,
      '{first_provider_seen_at}',
      to_jsonb(r.first_seen_at),
      true
    ),
    updated_at=now()
FROM repaired r
WHERE i.id=r.id
  AND (
    i.event_time IS DISTINCT FROM r.first_seen_at
    OR i.payload->>'first_provider_seen_at' IS DISTINCT FROM (to_jsonb(r.first_seen_at)#>>'{}')
  );
