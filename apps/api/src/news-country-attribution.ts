const SAFE_SQL_ALIAS = /^[a-z_][a-z0-9_]*$/i;

function checkedAlias(alias: string): string {
  if (!SAFE_SQL_ALIAS.test(alias)) throw new Error(`Unsafe SQL alias: ${alias}`);
  return alias;
}

/**
 * Publisher/feed geography is useful provenance, but it is not evidence that
 * the article is about that country. Keep this predicate shared by the reader
 * and map aggregate so a country accepted by one surface is accepted by both.
 */
export function trustedNewsDirectCountrySql(alias: string): string {
  const item = checkedAlias(alias);
  const source = `lower(COALESCE(NULLIF(${item}.payload->>'country_attribution',''),NULLIF(${item}.payload#>>'{country_inference,source}',''),'none'))`;
  const confidence = `lower(COALESCE(NULLIF(${item}.payload#>>'{country_inference,confidence}',''),'none'))`;
  return `(
    ${item}.country_iso2 IS NOT NULL
    AND (
      ${source} IN ('gkg_location','article_structured_location','targeted_event_query_fallback','institutional_jurisdiction')
      OR (${source}='content_alias' AND ${confidence} IN ('medium','high'))
    )
  )`;
}

export function newsStoryKeySql(alias: string): string {
  const item = checkedAlias(alias);
  return `CASE
    WHEN NULLIF(trim(regexp_replace(lower(${item}.title),'[^[:alnum:]]+',' ','g')),'') IS NULL
      THEN 'url:' || COALESCE(${item}.url,${item}.id::text)
    ELSE 'title:' || trim(regexp_replace(lower(${item}.title),'[^[:alnum:]]+',' ','g'))
      || ':hour:' || to_char(date_trunc('hour',${item}.event_time AT TIME ZONE 'UTC'),'YYYY-MM-DD HH24')
  END`;
}

/**
 * An assessment is displayable only when neither its item nor any attached
 * event evidence changed after the worker's statement-start watermark.
 */
export function currentNewsAssessmentSql(itemAlias: string, assessmentAlias: string): string {
  const item = checkedAlias(itemAlias);
  const assessment = checkedAlias(assessmentAlias);
  return `${assessment}.assessed_at>=${item}.updated_at
    AND (
      now()<=${item}.event_time+interval '1 hour'
      OR ${assessment}.assessed_at>${item}.event_time+interval '1 hour'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM intelligence_event_evidence changed_evidence
      JOIN intelligence_event changed_event ON changed_event.id=changed_evidence.event_id
      WHERE changed_evidence.domain='news'
        AND changed_evidence.source_record_type='item'
        AND changed_evidence.source_record_id=${item}.id::text
        AND GREATEST(changed_event.updated_at,changed_evidence.created_at)>
              ${assessment}.assessed_at
    )`;
}

export function buildNewsCountryStatsQuery(): string {
  const trustedDirect = trustedNewsDirectCountrySql("eligible");
  return `WITH eligible_news AS MATERIALIZED (
      SELECT i.id,i.title,i.url,i.country_iso2,i.event_time,i.payload,
             CASE
               WHEN i.payload->>'time_basis' LIKE 'publisher_published%'
                 OR i.payload->>'publication_time_verified'='true'
               THEN i.event_time
               ELSE NULL
             END AS publisher_event_time,
             canonical_news_publisher_key(i.url,i.payload,s.name) AS publisher_key,
             ${newsStoryKeySql("i")} AS story_key
      FROM item i
      JOIN source s ON s.id=i.source_id
      JOIN news_item_assessment assessment
        ON assessment.item_id=i.id
       AND assessment.methodology_version=$2
       AND ${currentNewsAssessmentSql("i", "assessment")}
      WHERE i.kind='news_article'
        AND (lower(s.name)<>'gdelt' OR i.payload->>'quality_status'='accepted')
        AND lower(COALESCE(s.metadata->>'retired','false'))
              NOT IN ('true','t','1','yes','y','on')
        AND i.event_time>=now()-($1 || ' days')::interval
        AND i.event_time<=now()+interval '5 minutes'
    ), subject_countries AS MATERIALIZED (
      SELECT eligible.id,eligible.story_key,eligible.publisher_key,eligible.event_time,eligible.publisher_event_time,
             upper(BTRIM(eligible.country_iso2::text)) AS country
      FROM eligible_news eligible
      WHERE ${trustedDirect}
      UNION ALL
      SELECT eligible.id,eligible.story_key,eligible.publisher_key,eligible.event_time,eligible.publisher_event_time,
             upper(structured_country) AS country
      FROM eligible_news eligible
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(eligible.payload->'subject_country_iso2s')='array'
          THEN eligible.payload->'subject_country_iso2s' ELSE '[]'::jsonb END
      ) structured_country
      WHERE structured_country ~ '^[A-Za-z]{2}$'
      UNION ALL
      SELECT eligible.id,eligible.story_key,eligible.publisher_key,eligible.event_time,eligible.publisher_event_time,
             upper(location->>'country_iso2') AS country
      FROM eligible_news eligible
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(eligible.payload#>'{gkg,locations}')='array'
          THEN eligible.payload#>'{gkg,locations}' ELSE '[]'::jsonb END
      ) location
      WHERE location->>'country_iso2' ~ '^[A-Za-z]{2}$'
      UNION ALL
      SELECT eligible.id,eligible.story_key,eligible.publisher_key,eligible.event_time,eligible.publisher_event_time,
             upper(BTRIM(country_event.primary_country_iso2::text)) AS country
      FROM eligible_news eligible
      JOIN intelligence_event_evidence evidence
        ON evidence.domain='news'
       AND evidence.source_record_type='item'
       AND evidence.source_record_id=eligible.id::text
       AND evidence.correlation_factors->>'decision'='attached'
      JOIN intelligence_event country_event ON country_event.id=evidence.event_id
      WHERE country_event.status<>'dismissed'
        AND country_event.primary_country_iso2 IS NOT NULL
    ), distinct_subject_countries AS MATERIALIZED (
      SELECT DISTINCT story_key,publisher_key,event_time,publisher_event_time,country
      FROM subject_countries
      WHERE country ~ '^[A-Z]{2}$'
    ), mapped_story_keys AS MATERIALIZED (
      SELECT DISTINCT story_key
      FROM distinct_subject_countries
    ), country_rollup AS MATERIALIZED (
      SELECT country,count(DISTINCT story_key)::int AS count,
             count(DISTINCT story_key) FILTER (
               WHERE publisher_event_time IS NOT NULL
             )::int AS verified_count,
             max(publisher_event_time) AS latest_at,
             count(DISTINCT publisher_key) FILTER (
               WHERE publisher_event_time IS NOT NULL AND publisher_key<>'unknown'
             )::int AS provider_count
      FROM distinct_subject_countries
      GROUP BY country
    )
    SELECT COALESCE((
             SELECT jsonb_agg(to_jsonb(country_rollup) ORDER BY count DESC,country)
             FROM country_rollup
           ),'[]'::jsonb) AS stats,
           count(DISTINCT eligible.story_key)::int AS total,
           count(DISTINCT eligible.story_key) FILTER (
             WHERE mapped.story_key IS NOT NULL
           )::int AS mapped
    FROM eligible_news eligible
    LEFT JOIN mapped_story_keys mapped ON mapped.story_key=eligible.story_key`;
}
