-- Backfill country_iso2 for existing news items using ccTLD heuristics
-- - Extract hostname from url, take final label as TLD
-- - Ignore generic TLDs; special-case 'uk' -> 'GB'
-- - Only set when resulting ISO2 exists in country table (FK safety)

WITH hosts AS (
  SELECT i.id,
         lower(regexp_replace(substring(i.url from '^[a-z]+://([^/]+)'), '.*\.([^.]+)$', '\\1')) AS tld
  FROM item i
  WHERE i.country_iso2 IS NULL
    AND i.url IS NOT NULL
), mapped AS (
  SELECT id,
         CASE
           WHEN tld IN ('com','net','org','info','biz','edu','gov','mil','int','io','me','tv','news','xyz','online','shop','site','app','tech','cloud','ai','dev','pro','press') THEN NULL
           WHEN tld = 'uk' THEN 'GB'
           WHEN length(tld) = 2 THEN upper(tld)
           ELSE NULL
         END AS iso2
  FROM hosts
)
UPDATE item i
SET country_iso2 = c.iso2
FROM mapped m
JOIN country c ON c.iso2 = m.iso2
WHERE i.id = m.id
  AND m.iso2 IS NOT NULL
  AND i.country_iso2 IS NULL;

