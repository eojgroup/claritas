-- V27: Backfill unresolved GDELT stories from DOC's publisher-country field.
--
-- This is intentionally labelled as a low-confidence fallback: the country
-- identifies where the publisher is based, not necessarily where the reported
-- event occurred. New ingestion prefers matched GKG geography and only uses
-- this fallback when no article geography can be inferred.

UPDATE item AS story
SET country_iso2 = story.source_country_iso2,
    payload = jsonb_set(
      COALESCE(story.payload, '{}'::jsonb),
      '{country_attribution}',
      to_jsonb('publisher_country_fallback'::text),
      true
    ),
    updated_at = now()
FROM source AS provider,
     country AS publisher_country
WHERE story.source_id = provider.id
  AND publisher_country.iso2 = story.source_country_iso2
  AND provider.name = 'gdelt'
  AND story.kind = 'news_article'
  AND story.country_iso2 IS NULL
  AND story.source_country_iso2 IS NOT NULL;
