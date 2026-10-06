import { query } from "../db";
export async function listNewsImages(options: { eventId?: string; country?: string; search?: string; limit?: number } = {}) {
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 30)));
  const { rows } = await query<any>(
    `SELECT image.id,image.item_id,image.image_url,image.caption,image.discovery,image.publisher,
            image.article_url,image.license,image.collected_at,item.title AS article_title,item.event_time AS article_published_at,
            asset.content_hash,asset.width,asset.height,asset.expires_at,asset.analysis,asset.analysis_model,asset.analysis_attempts
     FROM news_article_image image JOIN news_image_asset asset USING(content_hash)
     JOIN item ON item.id=image.item_id JOIN source ON source.id=item.source_id
     WHERE asset.expires_at>now() AND item.kind='news_article'
       AND (lower(source.name)<>'gdelt' OR item.payload->>'quality_status'='accepted')
       AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM intelligence_event_evidence evidence
         WHERE evidence.event_id=$1 AND evidence.domain='news' AND evidence.source_record_type='item' AND evidence.source_record_id=item.id::text))
       AND ($2::text IS NULL OR item.country_iso2=$2)
       AND ($3::text IS NULL OR concat_ws(' ',item.title,image.caption,asset.analysis->>'summary') ILIKE '%'||$3||'%')
     ORDER BY image.collected_at DESC,image.id LIMIT $4`,
    [options.eventId ?? null, options.country ?? null, options.search?.slice(0, 100) || null, limit]);
  // One photograph reused by multiple publishers is one visual observation.
  return [...new Map(rows.map((row) => [row.content_hash, row])).values()].map((row) => ({
    ...row, preview_url: `/api/news-images/${row.id}/preview`,
    captured_at: null, capture_verified: false,
    analysis_status: row.analysis ? "available" : Number(row.analysis_attempts) >= 3 ? "unavailable" : "pending",
    notice: "Publisher image; capture time and location are unverified. Visible-object estimates cover this photograph only.",
  }));
}
export async function getNewsImagePreview(id: string) {
  const { rows } = await query<{ preview: Buffer; content_hash: string }>(
    `SELECT asset.preview,asset.content_hash FROM news_article_image image
     JOIN news_image_asset asset USING(content_hash) WHERE image.id=$1 AND asset.expires_at>now()`, [id]);
  return rows[0] ?? null;
}
