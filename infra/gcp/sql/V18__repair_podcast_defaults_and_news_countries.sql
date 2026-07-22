-- V18: Give podcast automation safe discovery defaults and repair country
-- attribution for high-confidence geopolitical aliases added to ingestion.

INSERT INTO country (iso2, name, region, ext)
VALUES
  ('IR', 'Iran', 'Asia', '{}'::jsonb),
  ('YE', 'Yemen', 'Asia', '{}'::jsonb)
ON CONFLICT (iso2) DO NOTHING;

-- Existing podcast automation rules may retain this validation error from
-- before the API and ConfigMap supplied safe discovery defaults. Do not alter
-- any saved payload: explicit rule or environment targets still take priority.
UPDATE ingestion_automation_rule
SET last_error = NULL,
    updated_at = now()
WHERE pipeline = 'podcasts'
  AND last_error = 'Provide feedIds/searchTerms or configure PODCAST_FEED_IDS/PODCAST_DISCOVERY_TERMS.';

WITH news_text AS (
  SELECT
    id,
    concat_ws(' ', title, summary) AS text
  FROM item
  WHERE country_iso2 IS NULL
    AND kind <> 'podcast_episode'
),
candidates AS (
  SELECT
    id,
    CASE
      WHEN text ~* '(^|[^[:alnum:]])(houthi|houthis)([^[:alnum:]]|$)' THEN 'YE'
      WHEN text ~* '(^|[^[:alnum:]])(strait of hormuz|hormuz)([^[:alnum:]]|$)' THEN 'IR'
      WHEN text ~* '(^|[^[:alnum:]])(federal reserve|the fed|fed outlook|fed policy|fed rates?)([^[:alnum:]]|$)'
        THEN 'US'
      WHEN text ~* '(^|[^[:alnum:]])(pentagon|white house)([^[:alnum:]]|$)' THEN 'US'
      WHEN text ~* '(^|[^[:alnum:]])u[.]s[.]([^[:alnum:]]|$)' THEN 'US'
      ELSE NULL
    END AS iso2,
    CASE
      WHEN text ~* '(^|[^[:alnum:]])(houthi|houthis)([^[:alnum:]]|$)' THEN 'houthi'
      WHEN text ~* '(^|[^[:alnum:]])(strait of hormuz|hormuz)([^[:alnum:]]|$)' THEN 'hormuz'
      WHEN text ~* '(^|[^[:alnum:]])(federal reserve|the fed|fed outlook|fed policy|fed rates?)([^[:alnum:]]|$)'
        THEN 'federal reserve'
      WHEN text ~* '(^|[^[:alnum:]])pentagon([^[:alnum:]]|$)' THEN 'pentagon'
      WHEN text ~* '(^|[^[:alnum:]])white house([^[:alnum:]]|$)' THEN 'white house'
      WHEN text ~* '(^|[^[:alnum:]])u[.]s[.]([^[:alnum:]]|$)' THEN 'u.s.'
      ELSE NULL
    END AS matched_alias
  FROM news_text
),
resolved AS (
  SELECT candidates.id, candidates.iso2, candidates.matched_alias
  FROM candidates
  JOIN country ON country.iso2 = candidates.iso2
  WHERE candidates.iso2 IS NOT NULL
)
UPDATE item
SET country_iso2 = resolved.iso2,
    payload = jsonb_set(
      payload,
      '{country_inference}',
      COALESCE(payload->'country_inference', '{}'::jsonb) || jsonb_build_object(
        'iso2', resolved.iso2,
        'source', 'content_alias',
        'confidence', 'medium',
        'matched_alias', resolved.matched_alias
      ),
      true
    ),
    updated_at = now()
FROM resolved
WHERE item.id = resolved.id
  AND item.country_iso2 IS NULL;
