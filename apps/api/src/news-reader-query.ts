import { intelligenceEventEarthObservationStateSql } from "./intelligence/service";
import { createNewsQueryParameterPlan } from "./news-intelligence";
import {
  currentNewsAssessmentSql,
  newsStoryKeySql,
  trustedNewsDirectCountrySql,
} from "./news-country-attribution";

export type NewsReaderQueryInput = {
  displayLanguage: string;
  limit: number;
  offset: number;
  q: string;
  country: string;
  language: string;
  sourceCountry: string;
  provider: string;
  category: string;
  sort: "importance" | "newest";
  archive: boolean;
  includeMetadata: boolean;
};

export function buildNewsReaderQuery(input: NewsReaderQueryInput): {
  sql: string;
  params: any[];
} {
  const {
    displayLanguage,
    limit,
    offset,
    q,
    country,
    language,
    sourceCountry,
    provider,
    category,
    sort,
    archive,
    includeMetadata,
  } = input;
  const {
    params,
    displayLanguageIndex,
    categoryCatalogIndex,
    methodologyIndex,
  } = createNewsQueryParameterPlan(displayLanguage, includeMetadata);
  // Discovery time is operational provenance, not publisher time. Reader
  // modes require a plausible, explicitly labelled effective timestamp; only
  // explicit archive mode relaxes the lower bound.
  const where: string[] = [
    "i.kind = 'news_article'",
    "(lower(s.name) <> 'gdelt' OR i.payload->>'quality_status' = 'accepted')",
    "i.event_time <= now() + interval '5 minutes'",
  ];
  // The default workspace is a current operational briefing, not a disguised
  // archive. Two days covers overnight/closed-market context without allowing
  // a thin category to look healthy because it still contains week-old rows.
  if (!archive) where.push("i.event_time >= now() - interval '48 hours'");
  if (q) {
    const titleIndex = params.push(`%${q}%`);
    const summaryIndex = params.push(`%${q}%`);
    const translatedTitleIndex = params.push(`%${q}%`);
    const translatedSummaryIndex = params.push(`%${q}%`);
    where.push(`(
      i.title ILIKE $${titleIndex}
      OR i.summary ILIKE $${summaryIndex}
      OR translation.translated_title ILIKE $${translatedTitleIndex}
      OR translation.generated_summary ILIKE $${translatedSummaryIndex}
    )`);
  }
  let countryIndex: number | null = null;
  if (country) {
    countryIndex = params.push(country);
    where.push(`(
      (${trustedNewsDirectCountrySql("i")} AND upper(BTRIM(i.country_iso2::text)) = $${countryIndex})
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(i.payload->'subject_country_iso2s')='array'
              THEN i.payload->'subject_country_iso2s'
            ELSE '[]'::jsonb
          END
        ) structured_country
        WHERE upper(structured_country) = $${countryIndex}
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(i.payload#>'{gkg,locations}')='array'
              THEN i.payload#>'{gkg,locations}'
            ELSE '[]'::jsonb
          END
        ) subject_location
        WHERE upper(subject_location->>'country_iso2') = $${countryIndex}
      )
      OR EXISTS (
        SELECT 1
        FROM intelligence_event_evidence country_evidence
        JOIN intelligence_event country_event ON country_event.id=country_evidence.event_id
        WHERE country_evidence.domain='news'
          AND country_evidence.source_record_type='item'
          AND country_evidence.source_record_id=i.id::text
          AND country_evidence.correlation_factors->>'decision'='attached'
          AND country_event.status<>'dismissed'
          AND upper(BTRIM(country_event.primary_country_iso2::text))=$${countryIndex}
      )
    )`);
  }
  if (language) {
    const index = params.push(language);
    where.push(`lower(i.language_code) = $${index}`);
  }
  if (sourceCountry) {
    const index = params.push(sourceCountry);
    where.push(`upper(i.source_country_iso2) = $${index}`);
  }
  if (provider) {
    const index = params.push(provider);
    where.push(`lower(s.name) = $${index}`);
  }
  const categoryIndex = category ? params.push(category) : null;
  const limitIndex = params.push(limit);
  const offsetIndex = params.push(offset);
  const candidateOrder = sort === "importance"
    ? `GREATEST(
         0::double precision,
         candidate.base_quality_score
           - LEAST(24::double precision,(candidate.publisher_rank-1)::double precision*8)
       ) DESC,
       candidate.importance_score DESC,
       candidate.event_time DESC NULLS LAST,
       candidate.id DESC`
    : "candidate.event_time DESC NULLS LAST, candidate.id DESC";
  const publisherRank = sort === "importance"
    ? `, ROW_NUMBER() OVER (
         PARTITION BY candidate.publisher_key
         ORDER BY candidate.base_quality_score DESC,
                  candidate.importance_score DESC,
                  candidate.event_time DESC NULLS LAST,candidate.id DESC
       ) AS publisher_rank`
    : "";
  const metadataCtes = includeMetadata
    ? `, category_counts AS MATERIALIZED (
      SELECT category.value AS category,count(*)::int AS count
        FROM (
          SELECT category.value,facet_item.story_key
          FROM base_news facet_item
          CROSS JOIN LATERAL jsonb_array_elements_text(facet_item.categories) category(value)
          GROUP BY category.value,facet_item.story_key
        ) category
        GROUP BY category.value
      ), category_facets AS MATERIALIZED (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'category',catalog.value,
                 'count',COALESCE(category_counts.count,0)
               ) ORDER BY catalog.ordinality),'[]'::jsonb) AS categories
        FROM unnest($${categoryCatalogIndex}::text[]) WITH ORDINALITY AS catalog(value,ordinality)
        LEFT JOIN category_counts ON category_counts.category=catalog.value
      )`
    : "";

  const sql = `
    WITH base_news AS NOT MATERIALIZED (
      SELECT i.id,i.country_iso2,i.event_time,
             canonical_news_publisher_key(i.url,i.payload,s.name) AS publisher_key,
             COALESCE(assessment.primary_category,'other') AS primary_category,
             COALESCE(assessment.categories,to_jsonb(ARRAY['other']::text[])) AS categories,
             COALESCE(assessment.tags,'[]'::jsonb) AS tags,
             COALESCE(assessment.reasons,jsonb_build_array(jsonb_build_object(
               'code','assessment_pending','label','Automated assessment pending'
             ))) AS importance_reasons,
             COALESCE(assessment.components,jsonb_build_object('assessment_pending',true)) AS importance_components,
             COALESCE(assessment.score,0)::double precision AS importance_score,
             GREATEST(
               0::double precision,
               COALESCE(assessment.score,0)::double precision
                 - CASE WHEN i.payload->>'time_basis'='provider_first_seen' THEN 8 ELSE 0 END
             ) AS base_quality_score,
             COALESCE(assessment.tier,'routine') AS importance_tier,
             COALESCE(assessment.confidence,0)::double precision AS importance_confidence,
             COALESCE(assessment.methodology_version,$${methodologyIndex}::text) AS ranking_methodology,
             assessment.assessed_at AS ranking_assessed_at,
             assessment.item_id IS NULL AS ranking_is_fallback,
             COALESCE(i.payload->>'time_basis'='provider_first_seen',false) AS time_is_provider_discovery,
             (
               ${trustedNewsDirectCountrySql("i")}
               OR jsonb_array_length(CASE
                    WHEN jsonb_typeof(i.payload->'subject_country_iso2s')='array'
                      THEN i.payload->'subject_country_iso2s' ELSE '[]'::jsonb END) > 0
               OR jsonb_array_length(CASE
                    WHEN jsonb_typeof(i.payload#>'{gkg,locations}')='array'
                      THEN i.payload#>'{gkg,locations}' ELSE '[]'::jsonb END) > 0
               OR EXISTS (
                 SELECT 1
                 FROM intelligence_event_evidence geography_evidence
                 JOIN intelligence_event geography_event ON geography_event.id=geography_evidence.event_id
                 WHERE geography_evidence.domain='news'
                   AND geography_evidence.source_record_type='item'
                   AND geography_evidence.source_record_id=i.id::text
                   AND geography_evidence.correlation_factors->>'decision'='attached'
                   AND geography_event.status<>'dismissed'
                   AND geography_event.primary_country_iso2 IS NOT NULL
               )
             ) AS has_subject_country,
             ${newsStoryKeySql("i")} AS story_key
      FROM item i
      JOIN source s ON s.id = i.source_id
      LEFT JOIN news_item_assessment assessment
        ON assessment.item_id=i.id
       AND assessment.methodology_version=$${methodologyIndex}
       AND ${currentNewsAssessmentSql("i", "assessment")}
      LEFT JOIN item_translation translation
        ON translation.item_id = i.id
       AND translation.target_language_code = $${displayLanguageIndex}
       AND translation.source_title_hash = md5(COALESCE(i.title, ''))
       AND translation.source_summary_hash IS NOT DISTINCT FROM md5(i.summary)
      WHERE ${where.join(" AND ")}
    ), category_eligible_news AS NOT MATERIALIZED (
      SELECT candidate.*
      FROM base_news candidate
      ${categoryIndex ? `WHERE candidate.categories ? $${categoryIndex}` : ""}
    ), story_ranked AS MATERIALIZED (
      SELECT candidate.*,
             ROW_NUMBER() OVER (
               PARTITION BY candidate.story_key
               ORDER BY candidate.ranking_is_fallback ASC,
                        candidate.time_is_provider_discovery ASC,
                        candidate.event_time DESC NULLS LAST,
                        candidate.importance_score DESC,
                        candidate.has_subject_country DESC,
                        candidate.id DESC
             ) AS story_rank
      FROM category_eligible_news candidate
    ), distinct_news AS MATERIALIZED (
      SELECT * FROM story_ranked WHERE story_rank=1
    )${metadataCtes}, eligible_news AS NOT MATERIALIZED (
      SELECT candidate.*,
             true AS eligible${publisherRank}
      FROM distinct_news candidate
    ), ranked_news AS MATERIALIZED (
      SELECT candidate.*,
             ROW_NUMBER() OVER (ORDER BY ${candidateOrder}) AS result_order
      FROM eligible_news candidate
      ORDER BY ${candidateOrder}
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    ), result_rows AS MATERIALIZED (
      SELECT i.id, i.kind, i.title, i.summary, i.url,
             subject_country.countries[1] AS country_iso2,
             to_jsonb(COALESCE(subject_country.countries,ARRAY[]::text[])) AS countries,
             i.language_code, i.source_country_iso2, i.tone,
             i.event_time, i.payload, s.name AS source_name,
             COALESCE(NULLIF(i.payload->>'source', ''), NULLIF(i.payload->>'domain', ''), s.name) AS publisher,
             translation.translated_title,
             translation.generated_summary AS ai_summary,
             CASE WHEN translation.item_id IS NULL THEN NULL ELSE jsonb_build_object(
               'target_language_code', translation.target_language_code,
               'headline_kind', 'ai_translation',
               'summary_kind', CASE
                 WHEN translation.summary_status = 'generated' THEN 'ai_generated'
                 ELSE NULL
               END,
               'summary_status', translation.summary_status,
               'provider', translation.provider,
               'model', translation.model,
               'title_generated_at', translation.title_generated_at,
               'summary_generated_at', translation.summary_generated_at,
               'source_content_preserved', true,
               'article_body_used', false
             ) END AS translation,
             jsonb_build_object(
               'basis',COALESCE(NULLIF(i.payload->>'time_basis',''),'unknown'),
               'is_publisher_verified',COALESCE(i.payload->>'publication_time_verified'='true',
                 (i.payload->>'time_basis') LIKE 'publisher_published%',false),
               'published_at',NULLIF(i.payload->>'publisher_published_at',''),
               'discovered_at',COALESCE(
                 NULLIF(i.payload->>'first_provider_seen_at',''),
                 NULLIF(i.payload->>'provider_seen_at','')
               )
             ) AS time,
             ranked.primary_category,ranked.categories,ranked.tags,
             jsonb_build_object(
               'score',ranked.importance_score,
               'tier',ranked.importance_tier,
               'confidence',ranked.importance_confidence,
               'reasons',ranked.importance_reasons,
               'components',ranked.importance_components,
               'methodology',ranked.ranking_methodology,
               'calculated_at',ranked.ranking_assessed_at,
               'is_fallback',ranked.ranking_is_fallback
             ) AS importance,
             COALESCE(linked.linked_events, '[]'::jsonb) AS linked_events,
             ranked.result_order
      FROM ranked_news ranked
      JOIN item i ON i.id = ranked.id
      JOIN source s ON s.id = i.source_id
      LEFT JOIN item_translation translation
        ON translation.item_id = i.id
       AND translation.target_language_code = $${displayLanguageIndex}
       AND translation.source_title_hash = md5(COALESCE(i.title, ''))
       AND translation.source_summary_hash IS NOT DISTINCT FROM md5(i.summary)
      LEFT JOIN LATERAL (
        SELECT array_agg(country ORDER BY ${countryIndex ? `CASE WHEN country=$${countryIndex} THEN -1 ELSE priority END` : "priority"},country) AS countries
        FROM (
          SELECT country,min(priority) AS priority
          FROM (
            SELECT upper(BTRIM(i.country_iso2::text)) AS country,0 AS priority
            WHERE ${trustedNewsDirectCountrySql("i")}
            UNION ALL
            SELECT upper(structured_country),1
            FROM jsonb_array_elements_text(
              CASE
                WHEN jsonb_typeof(i.payload->'subject_country_iso2s')='array'
                  THEN i.payload->'subject_country_iso2s'
                ELSE '[]'::jsonb
              END
            ) structured_country
            WHERE structured_country ~ '^[A-Za-z]{2}$'
            UNION ALL
            SELECT upper(location->>'country_iso2'),2
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(i.payload#>'{gkg,locations}')='array'
                  THEN i.payload#>'{gkg,locations}'
                ELSE '[]'::jsonb
              END
            ) location
            WHERE location->>'country_iso2' ~ '^[A-Za-z]{2}$'
            UNION ALL
            SELECT upper(BTRIM(country_event.primary_country_iso2::text)),3
            FROM intelligence_event_evidence country_evidence
            JOIN intelligence_event country_event ON country_event.id=country_evidence.event_id
            WHERE country_evidence.domain='news'
              AND country_evidence.source_record_type='item'
              AND country_evidence.source_record_id=i.id::text
              AND country_evidence.correlation_factors->>'decision'='attached'
              AND country_event.status<>'dismissed'
              AND country_event.primary_country_iso2 IS NOT NULL
          ) country_candidates
          GROUP BY country
        ) distinct_countries
      ) subject_country ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'id', event.id,
          'title', event.title,
          'event_type', event.event_type,
          'status', event.status,
          'severity', event.severity,
          'confidence', event.confidence,
          'relevance_score', event.relevance_score,
          'urgency_score', event.urgency_score,
          'materiality_score', event.materiality_score,
          'source_diversity', event.source_diversity,
          'domain_count', event.domain_count,
          'evidence_count', (
            SELECT count(*)::int FROM intelligence_event_evidence all_evidence
            WHERE all_evidence.event_id=event.id
          ),
          'domains', (
            SELECT COALESCE(jsonb_agg(domain ORDER BY domain), '[]'::jsonb)
            FROM (SELECT DISTINCT all_evidence.domain
                  FROM intelligence_event_evidence all_evidence
                  WHERE all_evidence.event_id=event.id) domains
          ),
          'correlation_score', evidence.correlation_score,
          'correlation_factors', evidence.correlation_factors,
          'earth_observation_state', (${intelligenceEventEarthObservationStateSql()}),
          'best_thumbnail_url', (
            SELECT '/api/earth-observation/assets/' || asset.id::text
            FROM earth_observation observation
            JOIN earth_observation_asset asset ON asset.observation_id=observation.id
            WHERE observation.event_id=event.id AND observation.status='available'
              AND (asset.expires_at IS NULL OR asset.expires_at > now())
            ORDER BY CASE asset.asset_type WHEN 'thumbnail' THEN 0 WHEN 'preview' THEN 1 ELSE 2 END,
                     observation.captured_at DESC
            LIMIT 1
          )
        ) ORDER BY event.relevance_score DESC,event.last_activity_time DESC) AS linked_events
        FROM intelligence_event_evidence evidence
        JOIN intelligence_event event ON event.id=evidence.event_id
        WHERE evidence.domain='news'
          AND evidence.source_record_type='item'
          AND evidence.source_record_id=i.id::text
          AND event.status <> 'dismissed'
      ) linked ON true
      ORDER BY ranked.result_order
    )
    SELECT COALESCE(jsonb_agg(
             to_jsonb(result_rows)-'result_order' ORDER BY result_rows.result_order
           ),'[]'::jsonb) AS items,
           ${includeMetadata ? "(SELECT categories FROM category_facets)" : "'[]'::jsonb"} AS category_facets,
           ${includeMetadata ? "(SELECT count(*)::int FROM eligible_news)" : "NULL::int"} AS total_count,
           ${includeMetadata ? `(SELECT count(*)::int FROM (
             SELECT story_key
             FROM base_news
             GROUP BY story_key
             HAVING bool_and(ranking_is_fallback)
           ) wholly_unassessed_stories)` : "NULL::int"} AS unassessed_count,
           ${includeMetadata ? "(SELECT count(*)::int FROM eligible_news WHERE ranking_is_fallback)" : "NULL::int"} AS selected_unassessed_count,
           ${includeMetadata ? "(SELECT max(ranking_assessed_at) FROM eligible_news)" : "NULL::timestamptz"} AS latest_assessed_at
    FROM result_rows
  `;
  return { sql, params };
}
