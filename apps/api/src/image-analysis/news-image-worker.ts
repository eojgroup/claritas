import { createHash } from "node:crypto";
import sharp from "sharp";
import { query, withTransaction, withWorkerLease } from "../db";
import { newsImageRetentionDays } from "./news-image-policy";
import { fetchPublicHtml, fetchPublicImage } from "../image-proxy";
import { OpenRouterVisionClient, EO_VISION_PROMPT_VERSION } from "../earth-observation/openrouter-vision";
import { recomputeIntelligenceEventAggregateTx } from "../intelligence/service";
import { reserveVisionRequest } from "./usage";
import { gateObjectCounts } from "./object-counts";
import { extractNewsImageCandidates, newsImageUrl, type NewsImageCandidate } from "./news-image-metadata";
const vision = new OpenRouterVisionClient();
let running = false;
let timer: NodeJS.Timeout | null = null;
const enabled = (name: string) => !["false", "0", "off"].includes(process.env[name]?.toLowerCase() ?? "");
const dailyCollectionLimit = () => Math.min(200, Math.max(0, Number.parseInt(process.env.NEWS_IMAGE_MAX_DAILY_ARTICLES ?? "50", 10) || 0));

export async function collectNewsImages(batchSize = 3) {
  const candidates = await query<any>(
    `SELECT item.id,item.url,item.payload,COALESCE(item.payload->>'publisher',source.name) AS publisher
     FROM item JOIN source ON source.id=item.source_id LEFT JOIN news_image_discovery discovery ON discovery.item_id=item.id
     WHERE item.kind='news_article' AND item.url LIKE 'https://%'
       AND COALESCE(item.event_time,item.created_at)>now()-interval '8 days'
       AND (lower(source.name)<>'gdelt' OR item.payload->>'quality_status'='accepted')
       AND (discovery.item_id IS NULL OR (NOT discovery.complete AND discovery.attempts<3 AND discovery.retry_after<=now()))
     ORDER BY EXISTS (SELECT 1 FROM intelligence_event_evidence e WHERE e.domain='news'
       AND e.source_record_type='item' AND e.source_record_id=item.id::text) DESC,item.event_time DESC
     LIMIT $1`, [Math.min(10, Math.max(1, Math.trunc(batchSize)))]);
  let retained = 0;
  for (const article of candidates.rows) {
    const reservation = await query(
      `INSERT INTO news_image_collection_usage(usage_date,article_requests)
       SELECT (now() AT TIME ZONE 'UTC')::date,1 WHERE $1::int>0
       ON CONFLICT (usage_date) DO UPDATE SET article_requests=news_image_collection_usage.article_requests+1
       WHERE news_image_collection_usage.article_requests<$1 RETURNING article_requests`, [dailyCollectionLimit()]);
    if (!reservation.rows.length) break;
    let pageFailed = false;
    let images: NewsImageCandidate[] = [];
    try { images = extractNewsImageCandidates(await fetchPublicHtml(article.url), article.url); }
    catch { pageFailed = true; }
    const fallback = newsImageUrl(article.payload?.image_url, article.url);
    if (fallback && !images.some((image) => image.url === fallback)) images.push({ url: fallback, caption: null, discovery: "feed" });
    let stored = 0;
    for (const image of images.slice(0, 4)) {
      try {
        const response = await fetchPublicImage(image.url);
        const normalized = await sharp(response.body, { limitInputPixels: 25_000_000, animated: false }).rotate()
          .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer({ resolveWithObject: true });
        if (normalized.info.width < 160 || normalized.info.height < 120 || normalized.data.length > 1_000_000) continue;
        const hash = createHash("sha256").update(normalized.data).digest("hex");
        await withTransaction(async (client) => {
          await client.query(`INSERT INTO news_image_asset(content_hash,preview,width,height,expires_at)
            VALUES ($1,$2,$3,$4,now()+make_interval(days=>$5::int)) ON CONFLICT (content_hash) DO NOTHING`,
            [hash, normalized.data, normalized.info.width, normalized.info.height, newsImageRetentionDays()]);
          await client.query(`INSERT INTO news_article_image(item_id,content_hash,image_url,caption,discovery,publisher,article_url)
            VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (item_id,content_hash) DO NOTHING`,
            [article.id,hash,image.url,image.caption,image.discovery,article.publisher,article.url]);
        });
        stored += 1;
      } catch { /* One inaccessible image must not discard other article images. */ }
    }
    retained += stored;
    const complete = stored > 0 || (!pageFailed && images.length === 0);
    await query(`INSERT INTO news_image_discovery(item_id,attempts,complete,retry_after,last_error)
      VALUES ($1,1,$2,now()+interval '6 hours',$3) ON CONFLICT (item_id) DO UPDATE SET
        attempts=news_image_discovery.attempts+1,complete=EXCLUDED.complete,checked_at=now(),
        retry_after=EXCLUDED.retry_after,last_error=EXCLUDED.last_error`,
      [article.id, complete, complete ? null : "Publisher metadata or images were unavailable; bounded retry scheduled."]);
  }
  return { candidates: candidates.rows.length, retained };
}

export async function analyzePendingNewsImage() {
  const status = vision.status();
  if (!enabled("NEWS_IMAGE_ANALYSIS_ENABLED") || !status.enabled || !status.configured) return { skipped: true };
  const result = await query<any>(`SELECT * FROM news_image_asset WHERE analysis IS NULL AND expires_at>now()
    AND analysis_after<=now() AND analysis_attempts<3 ORDER BY created_at DESC LIMIT 1`);
  const asset = result.rows[0];
  if (!asset) return { skipped: true };
  const budget = await reserveVisionRequest("news");
  if (!budget.reserved) return { budget_deferred: true };
  // Persist attempt accounting before inference; a terminated worker cannot retry indefinitely.
  await query(`UPDATE news_image_asset SET analysis_attempts=analysis_attempts+1,analysis_after=now()+interval '6 hours' WHERE content_hash=$1`, [asset.content_hash]);
  try {
    const response = await vision.interpret({ image: asset.preview, mimeType: "image/jpeg", context: {
      source_kind: "news", image_width: asset.width, image_height: asset.height,
      capture_time_verified: false, capture_location_verified: false,
      scope: "Analyse only the visible photograph. The publication date and article subject do not establish when or where it was taken.",
    } });
    const interpretation = { ...response.interpretation,
      object_counts: gateObjectCounts(response.interpretation.object_counts ?? [], { source_kind: "news", width: asset.width, height: asset.height }),
      visual_signal_score: 0, capture_verified: false, epistemic_class: "model_interpretation",
      provider: "openrouter", actual_model: response.actualModel, prompt_version: EO_VISION_PROMPT_VERSION,
      generated_at: new Date().toISOString(),
    };
    await query(`UPDATE news_image_asset SET analysis=$2::jsonb,analysis_model=$3,prompt_version=$4 WHERE content_hash=$1`,
      [asset.content_hash,JSON.stringify(interpretation),response.actualModel,EO_VISION_PROMPT_VERSION]);
    return { analyzed: true };
  } catch (error) {
    console.warn(JSON.stringify({ event: "news_image_analysis_failed", message: error instanceof Error ? error.message : String(error) }));
    return { failed: true };
  }
}

export async function attachNewsImageSignals() {
  const { rows } = await query<any>(
    `SELECT DISTINCT ON (parent.event_id,asset.content_hash) parent.event_id,parent.location_id,
       image.*,asset.analysis,asset.analysis_model,item.source_id
     FROM news_article_image image JOIN news_image_asset asset USING(content_hash) JOIN item ON item.id=image.item_id
     JOIN source ON source.id=item.source_id
     JOIN intelligence_event_evidence parent ON parent.domain='news' AND parent.source_record_type='item' AND parent.source_record_id=item.id::text
     WHERE asset.analysis IS NOT NULL AND asset.expires_at>now()
       AND (lower(source.name)<>'gdelt' OR item.payload->>'quality_status'='accepted')
       AND NOT EXISTS (SELECT 1 FROM intelligence_event_evidence existing WHERE existing.event_id=parent.event_id
         AND existing.source_record_type='news_image' AND existing.source_record_id=asset.content_hash)
     ORDER BY parent.event_id,asset.content_hash,image.collected_at DESC LIMIT 40`);
  for (const image of rows) {
    await withTransaction(async (client) => {
      await client.query(`INSERT INTO intelligence_event_evidence(event_id,domain,evidence_type,source_record_type,source_record_id,
        source_id,observed_at,location_id,confidence,relationship,provenance,license,attribution,metadata)
        VALUES ($1,'news','publisher_image_analysis','news_image',$2,$3,$4,$5,$6,'model_interpretation',$7::jsonb,$8,$9,$10::jsonb)
        ON CONFLICT (event_id,domain,source_record_type,source_record_id) DO NOTHING`,
        [image.event_id,image.content_hash,image.source_id,image.collected_at,image.location_id,
         Math.min(.55,Math.max(0,Number(image.analysis.confidence) || 0)),
         JSON.stringify({ provider: "openrouter", publisher: image.publisher, parent_item_id: image.item_id,
           url: image.article_url, image_url: image.image_url, news_image_id: image.id, actual_model: image.analysis_model }),
         image.license, image.publisher, JSON.stringify({ ...image.analysis, parent_item_id: image.item_id,
           title: "Publisher image analysis", summary: image.analysis.summary, captured_at: null,
           independent_corroboration: false, visual_signal_score: 0 })]);
      await recomputeIntelligenceEventAggregateTx(client,image.event_id);
    });
  }
  return rows.length;
}

async function cleanupNewsImages() {
  const removed = await query<{ event_id: string }>(`DELETE FROM intelligence_event_evidence evidence
    WHERE source_record_type='news_image' AND NOT EXISTS (SELECT 1 FROM news_image_asset asset
      WHERE asset.content_hash=evidence.source_record_id AND asset.expires_at>now()) RETURNING event_id`);
  await query(`DELETE FROM news_image_asset WHERE expires_at<=now() OR NOT EXISTS
    (SELECT 1 FROM news_article_image image WHERE image.content_hash=news_image_asset.content_hash)`);
  await query(`DELETE FROM news_image_collection_usage WHERE usage_date<current_date-30`);
  for (const eventId of new Set(removed.rows.map((row) => row.event_id))) await withTransaction((client) => recomputeIntelligenceEventAggregateTx(client,eventId));
}
export async function runNewsImageWorkerCycle() {
  if (running || !enabled("NEWS_IMAGE_COLLECTION_ENABLED")) return;
  running = true;
  try {
    await withWorkerLease("news-image-analysis",300,async () => {
      await cleanupNewsImages();
      const collection = await collectNewsImages();
      const analysis = await analyzePendingNewsImage();
      const linked = await attachNewsImageSignals();
      console.info(JSON.stringify({ event: "news_image_cycle", ...collection, ...analysis, linked }));
    });
  } catch (error) { console.warn(JSON.stringify({ event: "news_image_worker_failed", message: error instanceof Error ? error.message : String(error) })); }
  finally { running = false; }
}
export function startNewsImageWorker() {
  if (timer || !enabled("NEWS_IMAGE_COLLECTION_ENABLED")) return;
  timer = setInterval(() => void runNewsImageWorkerCycle(),90_000); timer.unref();
  const startup = setTimeout(() => void runNewsImageWorkerCycle(),20_000); startup.unref();
}
