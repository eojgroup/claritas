import { intelligenceEventEarthObservationStateSql } from "./intelligence/service";
import { createNewsQueryParameterPlan } from "./news-intelligence";

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
  // Discovery time is operational provenance, not publisher time. Every
  // reader mode requires a plausible publication timestamp; only explicit
  // archive mode relaxes the lower bound.
  const where: string[] = [
    "i.kind = 'news_article'",
    "(lower(s.name) <> 'gdelt' OR i.payload->>'quality_status' = 'accepted')",
    "i.event_time <= now() + interval '5 minutes'",
  ];
  if (!archive) where.push("i.event_time >= now() - interval '8 days'");
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
  if (country) {
    const index = params.push(country);
    where.push(`upper(i.country_iso2) = $${index}`);
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
         candidate.importance_score
           - LEAST(24::double precision,(candidate.publisher_rank-1)::double precision*8)
       ) DESC,
       candidate.importance_score DESC,
       candidate.event_time DESC NULLS LAST,
       candidate.id DESC`
    : "candidate.event_time DESC NULLS LAST, candidate.id DESC";
  const publisherRank = sort === "importance"
    ? `, ROW_NUMBER() OVER (
         PARTITION BY candidate.publisher_key
         ORDER BY candidate.importance_score DESC,
                  candidate.event_time DESC NULLS LAST,candidate.id DESC
       ) AS publisher_rank`
    : "";
  const metadataCtes = includeMetadata
    ? `, category_counts AS MATERIALIZED (
        SELECT category.value AS category,count(*)::int AS count
        FROM base_news facet_item
        CROSS JOIN LATERAL jsonb_array_elements_text(facet_item.categories) category(value)
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
             COALESCE(assessment.tier,'routine') AS importance_tier,
             COALESCE(assessment.confidence,0)::double precision AS importance_confidence,
             COALESCE(assessment.methodology_version,$${methodologyIndex}::text) AS ranking_methodology,
             assessment.assessed_at AS ranking_assessed_at,
             assessment.item_id IS NULL AS ranking_is_fallback
      FROM item i
      JOIN source s ON s.id = i.source_id
      LEFT JOIN news_item_assessment assessment
        ON assessment.item_id=i.id
       AND assessment.methodology_version=$${methodologyIndex}
      LEFT JOIN item_translation translation
        ON translation.item_id = i.id
       AND translation.target_language_code = $${displayLanguageIndex}
       AND translation.source_title_hash = md5(COALESCE(i.title, ''))
       AND translation.source_summary_hash IS NOT DISTINCT FROM md5(i.summary)
      WHERE ${where.join(" AND ")}
    )${metadataCtes}, eligible_news AS NOT MATERIALIZED (
      SELECT candidate.*,
             true AS eligible${publisherRank}
      FROM base_news candidate
      ${categoryIndex ? `WHERE candidate.categories ? $${categoryIndex}` : ""}
    ), ranked_news AS MATERIALIZED (
      SELECT candidate.*,
             ROW_NUMBER() OVER (ORDER BY ${candidateOrder}) AS result_order
      FROM eligible_news candidate
      ORDER BY ${candidateOrder}
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    ), result_rows AS MATERIALIZED (
      SELECT i.id, i.kind, i.title, i.summary, i.url, i.country_iso2,
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
           ${includeMetadata ? "(SELECT count(*)::int FROM base_news WHERE ranking_is_fallback)" : "NULL::int"} AS unassessed_count,
           ${includeMetadata ? "(SELECT count(*)::int FROM eligible_news WHERE ranking_is_fallback)" : "NULL::int"} AS selected_unassessed_count,
           ${includeMetadata ? "(SELECT max(ranking_assessed_at) FROM eligible_news)" : "NULL::timestamptz"} AS latest_assessed_at
    FROM result_rows
  `;
  return { sql, params };
}
