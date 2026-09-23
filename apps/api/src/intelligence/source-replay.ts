import { query } from "../db";

/**
 * Versioned, bounded replay of stored sources missed by older origin rules.
 * Run only from the upgraded worker, rather than during schema migration
 * while the previous API is still serving. No provider requests.
 */
export async function enqueueUnifiedSourceReplay() {
  await query(
    `WITH eligible_news AS (
       SELECT 'news.story.updated'::text AS event_type,'item'::text AS aggregate_type,
              item.id::text AS aggregate_id,jsonb_build_object('item_id',item.id) AS payload,
              item.event_time AS occurred_at,COALESCE(assessment.score,0) AS priority
       FROM item JOIN source ON source.id=item.source_id
       LEFT JOIN news_item_assessment assessment ON assessment.item_id=item.id
       WHERE item.kind='news_article' AND item.event_time>=now()-interval '7 days'
         AND item.payload->>'canonical_alias_of_item_id' IS NULL
         AND (item.payload->>'quality_status'='accepted'
              OR (source.name<>'gdelt' AND item.payload->>'quality_status' IS NULL))
     ), recent_news AS (
       SELECT event_type,aggregate_type,aggregate_id,payload,occurred_at FROM eligible_news
       ORDER BY occurred_at DESC,aggregate_id DESC LIMIT 3000
     ), priority_news AS (
       SELECT event_type,aggregate_type,aggregate_id,payload,occurred_at FROM eligible_news
       ORDER BY priority DESC,occurred_at DESC,aggregate_id DESC LIMIT 1000
     ), news AS (
       SELECT * FROM recent_news UNION SELECT * FROM priority_news
     ), podcasts AS (
       SELECT 'podcast.signal.extracted','intelligence_signal',signal.id::text,
              jsonb_build_object('episode_id',signal.episode_id,'signal_type',signal.signal_type,'canonical_key',signal.canonical_key),
              item.event_time
       FROM intelligence_signal signal JOIN podcast_episode episode ON episode.id=signal.episode_id
       JOIN item ON item.id=episode.item_id
       WHERE signal.signal_type IN ('event','risk','claim') AND signal.confidence>=0.55
         AND item.event_time>=now()-interval '7 days'
         AND jsonb_array_length(signal.entities)>0
         AND EXISTS (SELECT 1 FROM intelligence_signal_evidence evidence WHERE evidence.signal_id=signal.id)
       ORDER BY item.event_time DESC,signal.id DESC LIMIT 1000
     ), social AS (
       SELECT 'social.signal.updated','social_signal',id::text,
              jsonb_build_object('social_signal_id',id),posted_at
       FROM social_signal WHERE expires_at>now() AND posted_at>=now()-interval '7 days'
       ORDER BY posted_at DESC,id DESC LIMIT 2000
     ), imagery AS (
       SELECT 'earth.scene.available','earth_observation',id::text,
              jsonb_build_object('observation_id',id),captured_at
       FROM earth_observation WHERE status='available' AND event_id IS NULL
         AND captured_at>=now()-interval '7 days'
       ORDER BY captured_at DESC,id DESC LIMIT 500
     ), sources AS (
       SELECT * FROM news UNION ALL SELECT * FROM podcasts
       UNION ALL SELECT * FROM social UNION ALL SELECT * FROM imagery
     )
     INSERT INTO event_outbox(event_type,aggregate_type,aggregate_id,dedupe_key,payload,occurred_at)
     SELECT event_type,aggregate_type,aggregate_id,
            concat('unified-source-replay-v1:',aggregate_type,':',aggregate_id),payload,occurred_at
     FROM sources ON CONFLICT (dedupe_key) DO NOTHING`,
  );
}
