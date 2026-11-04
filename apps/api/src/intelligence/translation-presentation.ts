import { query } from "../db";
import { SharedReadCache } from "../shared-read-cache";
import { getNewsTranslationAvailability, newsLanguageMatchesTarget, configuredNewsTranslationTargets } from "../news-translation";
import { canonicalSourceRecordBigintSql } from "./source-record";
import { normalizeIntelligenceDisplayLanguage } from "./display-language";
import type { TranslationContext, TranslationSourceRow } from "./translation-presentation-model";
export * from "./translation-presentation-model";
export { normalizeIntelligenceDisplayLanguage } from "./display-language";
const availabilityCache = new SharedReadCache({ ttlMs: 30_000, maxEntries: 8, maxBytes: 32_768 });

/** One bounded indexed metadata read; it never requests generation or calls a model. */
export async function loadTranslationContext(eventIds: string[], itemIds: string[], targetLanguage = "en"): Promise<TranslationContext> {
  const target = normalizeIntelligenceDisplayLanguage(targetLanguage);
  const events = [...new Set(eventIds)].slice(0, 100);
  const items = [...new Set(itemIds)].filter((id) => /^[0-9]{1,19}$/.test(id)
    && (id.length < 19 || id <= "9223372036854775807")).slice(0, 200);
  const context: TranslationContext = { events: new Map(), items: new Map(), targetLanguage: target, availability: null };
  if (!events.length && !items.length) return context;
  let rows: TranslationSourceRow[];
  try { ({ rows } = await query<TranslationSourceRow>(
    `WITH requested AS (
      SELECT feed.id AS event_id,${canonicalSourceRecordBigintSql("feed", "news", "item")} AS item_id,
        feed.metadata->>'canonical_evidence_key' AS canonical_evidence_key
      FROM intelligence_event_feed feed WHERE feed.id=ANY($1::uuid[])
      UNION ALL SELECT NULL::uuid,item_id,NULL::text FROM unnest($2::bigint[]) item_id
    ) SELECT requested.event_id,article.id::text AS item_id,requested.canonical_evidence_key,
      article.title,left(article.summary,2000) AS summary,article.language_code,article.event_time,
      translation.translated_title,translation.generated_summary,translation.summary_status,
      translation.provider,translation.model,translation.target_language_code,
      translation.title_generated_at,translation.summary_generated_at
    FROM requested JOIN item article ON article.id=requested.item_id AND article.kind='news_article'
    JOIN source ON source.id=article.source_id
    LEFT JOIN item_translation translation ON translation.item_id=article.id
      AND translation.target_language_code=$3
      AND translation.source_title_hash=md5(COALESCE(article.title,''))
      AND translation.source_summary_hash IS NOT DISTINCT FROM md5(article.summary)
      AND (NULLIF(translation.generation_metadata->>'source_language_code','') IS NULL
        OR split_part(lower(replace(translation.generation_metadata->>'source_language_code','_','-')),'-',1)
          =split_part(lower(replace(COALESCE(article.language_code,'und'),'_','-')),'-',1))
    WHERE CASE WHEN lower(source.name)='gdelt' THEN article.payload->>'quality_status'='accepted'
      ELSE COALESCE(article.payload->>'quality_status','accepted')='accepted' END`, [events, items, target])); }
  catch (error) {
    console.warn(JSON.stringify({ event: "intelligence_translation_metadata_unavailable", event_count: events.length, item_count: items.length,
      target_language: target, message: error instanceof Error ? error.message : String(error) }));
    context.unavailable = true;
    context.availability = { status: "unavailable", reason: "Translation metadata is temporarily unavailable. Original text is shown.", retry_after: null };
    return context;
  }
  for (const row of rows) {
    context.items.set(row.item_id, row);
    if (row.event_id) context.events.set(row.event_id, row);
  }
  if (rows.some((row) => !newsLanguageMatchesTarget(row.language_code, target) && !row.translated_title?.trim())) {
    try { context.availability = configuredNewsTranslationTargets().includes(target)
      ? await availabilityCache.get(target, () => getNewsTranslationAvailability(target))
      : { status: "unavailable", reason: "Automatic translation is not configured for this display language. Original publisher text is shown.", retry_after: null }; }
    catch { context.availability = { status: "unavailable", reason: "Translation status is temporarily unavailable. Original publisher text is shown.", retry_after: null }; }
  }
  return context;
}

