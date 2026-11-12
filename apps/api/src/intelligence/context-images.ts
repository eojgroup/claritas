import { eventMediaWindow } from "./event-media";
import { query } from "../db";
import { sourceRecordBigintSql } from "./source-record";

export type ContextImage = {
  id: string;
  kind: "satellite" | "news";
  preview_url: string;
  thumbnail_url: string | null;
  width: number;
  height: number;
  captured_at: string | null;
  published_at: string | null;
  collected_at: string | null;
  source_event_id: string | null;
  source_event_title: string | null;
  source_url: string | null;
  title: string;
  attribution: string;
  license: string;
  location_name: string | null;
  match_reason: "rendered_area_contains_location" | "same_specific_location";
  notice: string;
};

type ContextImageEvent = {
  id: string;
  event_type?: string;
  last_activity_time?: string | Date | null;
  primary_location_id?: string | null;
  location_type?: string | null;
  location_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  metadata?: Record<string, unknown> | null;
};

type ContextImageRow = Omit<ContextImage, "notice" | "captured_at" | "published_at" | "collected_at"> & {
  content_hash: string;
  captured_at: Date | string | null;
  published_at: Date | string | null;
  collected_at: Date | string | null;
};

type ContextImageRead = (sql: string, params: any[]) => Promise<{ rows: ContextImageRow[] }>;

const broadLocations = new Set(["country", "region", "area", "agricultural_region"]);
const satelliteNotice = "Previously captured satellite imagery of this location, reused for geographic context. The acquisition date belongs to the original scene; this image does not establish conditions during this event or prove its cause.";
const newsNotice = "Image from related reporting in this named location and event time window. Its capture location and time are unverified; it is contextual reporting, not a photograph or evidence of this event.";

function finiteCoordinate(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= maximum;
}

/**
 * Query only retained metadata. Neither provider downloads, image bytes, model
 * analysis nor event/evidence writes belong on the event-detail read path.
 */
export function buildContextImageQuery(event: ContextImageEvent) {
  const window = eventMediaWindow(event);
  if (!window) return null;
  const specificLocation = Boolean(event.primary_location_id && event.location_type
    && !broadLocations.has(event.location_type));
  const exactPoint = (event.metadata?.exact_geography === true || specificLocation)
    && finiteCoordinate(event.latitude, 90) && finiteCoordinate(event.longitude, 180);
  if (!specificLocation && !exactPoint) return null;
  const offset = exactPoint ? 4 : 2;
  const since = `$${offset + 1}::timestamptz`;
  const until = `$${offset + 2}::timestamptz`;
  const eventType = `$${offset + 3}::text`;
  const satellite = exactPoint ? `
    SELECT * FROM (SELECT DISTINCT ON (preview.content_hash)
      observation.id::text AS id,'satellite'::text AS kind,preview.content_hash,
      '/api/earth-observation/assets/'||preview.id::text||'?v='||left(preview.content_hash,16) AS preview_url,
      (SELECT '/api/earth-observation/assets/'||thumbnail.id::text||'?v='||left(thumbnail.content_hash,16)
       FROM earth_observation_asset thumbnail WHERE thumbnail.observation_id=observation.id
         AND thumbnail.asset_type='thumbnail' AND (thumbnail.expires_at IS NULL OR thumbnail.expires_at>now())) AS thumbnail_url,
      preview.width,preview.height,observation.captured_at,scene.published_at,
      preview.generated_at AS collected_at,observation.event_id::text AS source_event_id,
      original.title AS source_event_title,scene.source_url,
      scene.mission||' natural color' AS title,observation.attribution,observation.license,
      location.canonical_name AS location_name,'rendered_area_contains_location'::text AS match_reason
    FROM earth_scene scene
    JOIN earth_observation observation ON observation.scene_id=scene.id
    JOIN earth_observation_asset preview ON preview.observation_id=observation.id AND preview.asset_type='preview'
    LEFT JOIN intelligence_event original ON original.id=observation.event_id
    LEFT JOIN intelligence_location location ON location.id=observation.location_id
    WHERE scene.geometry && ST_SetSRID(ST_MakePoint($3::double precision,$4::double precision),4326)
      AND ST_Covers(scene.geometry,ST_SetSRID(ST_MakePoint($3::double precision,$4::double precision),4326))
      AND observation.status='available' AND observation.product_type='true_color'
      AND observation.captured_at BETWEEN (SELECT since FROM context_window) AND (SELECT until FROM context_window)
      AND observation.event_id IS DISTINCT FROM $1::uuid
      AND (original.id IS NULL OR original.status<>'dismissed')
      AND (preview.expires_at IS NULL OR preview.expires_at>now())
      -- A catalog scene can cover much more than the actual rendered image.
      -- Never substitute the scene footprint for the retained preview's AOI.
      AND CASE WHEN jsonb_typeof(observation.methodology->'render_context'->'aoi_bbox')='array'
        AND jsonb_array_length(CASE WHEN jsonb_typeof(observation.methodology->'render_context'->'aoi_bbox')='array'
          THEN observation.methodology->'render_context'->'aoi_bbox' ELSE '[]'::jsonb END)=4
        AND jsonb_typeof(observation.methodology->'render_context'->'aoi_bbox'->0)='number'
        AND jsonb_typeof(observation.methodology->'render_context'->'aoi_bbox'->1)='number'
        AND jsonb_typeof(observation.methodology->'render_context'->'aoi_bbox'->2)='number'
        AND jsonb_typeof(observation.methodology->'render_context'->'aoi_bbox'->3)='number'
      THEN (observation.methodology->'render_context'->'aoi_bbox'->>0)::numeric <= $3::numeric
        AND (observation.methodology->'render_context'->'aoi_bbox'->>2)::numeric >= $3::numeric
        AND (observation.methodology->'render_context'->'aoi_bbox'->>1)::numeric <= $4::numeric
        AND (observation.methodology->'render_context'->'aoi_bbox'->>3)::numeric >= $4::numeric
      ELSE false END
      AND NOT EXISTS (SELECT 1 FROM earth_observation own
        JOIN earth_observation_asset own_asset ON own_asset.observation_id=own.id
        WHERE own.event_id=$1::uuid AND own_asset.content_hash=preview.content_hash)
    ORDER BY preview.content_hash,observation.captured_at DESC,observation.id
    ) retained_satellite ORDER BY captured_at DESC,id LIMIT 12` : null;
  const news = specificLocation ? `
    SELECT * FROM (SELECT DISTINCT ON (image.content_hash)
      image.id::text AS id,'news'::text AS kind,image.content_hash,
      '/api/news-images/'||image.id::text||'/preview' AS preview_url,NULL::text AS thumbnail_url,
      asset.width,asset.height,NULL::timestamptz AS captured_at,item.event_time AS published_at,
      image.collected_at,original.id::text AS source_event_id,original.title AS source_event_title,
      image.article_url AS source_url,COALESCE(NULLIF(item.title,''),'Publisher image') AS title,image.publisher AS attribution,image.license,
      location.canonical_name AS location_name,'same_specific_location'::text AS match_reason
    FROM context_events original
    JOIN intelligence_location location ON location.id=original.primary_location_id
    JOIN intelligence_event_evidence evidence ON evidence.event_id=original.id
      AND evidence.domain='news' AND evidence.source_record_type='item'
    JOIN item ON item.id=${sourceRecordBigintSql("evidence", "item")}
    JOIN source ON source.id=item.source_id
    JOIN news_article_image image ON image.item_id=item.id
    JOIN news_image_asset asset ON asset.content_hash=image.content_hash
    WHERE asset.expires_at>now() AND item.kind='news_article'
      AND item.event_time BETWEEN (SELECT since FROM context_window) AND (SELECT until FROM context_window)
      AND CASE WHEN lower(source.name)='gdelt' THEN item.payload->>'quality_status'='accepted'
        ELSE COALESCE(item.payload->>'quality_status','accepted')='accepted' END
      AND NOT EXISTS (SELECT 1 FROM intelligence_event_evidence own
        JOIN news_article_image own_image ON own_image.item_id=${sourceRecordBigintSql("own", "item")}
        WHERE own.event_id=$1::uuid AND own.domain='news' AND own.source_record_type='item'
          AND own_image.content_hash=image.content_hash)
    ORDER BY image.content_hash,image.collected_at DESC,image.id
    ) retained_news ORDER BY collected_at DESC,id LIMIT 12` : null;
  return {
    sql: `WITH context_window AS (SELECT ${since} AS since,${until} AS until,${eventType} AS event_type),
    context_events AS MATERIALIZED (
      SELECT id,title,primary_location_id FROM intelligence_event
      WHERE primary_location_id=$2::uuid AND id<>$1::uuid AND status<>'dismissed'
        AND last_activity_time BETWEEN (SELECT since FROM context_window) AND (SELECT until FROM context_window)
        AND (event_type=(SELECT event_type FROM context_window) OR EXISTS (
          SELECT 1 FROM intelligence_event_relationship link WHERE link.from_event_id=$1::uuid AND link.to_event_id=intelligence_event.id))
      ORDER BY last_activity_time DESC,id LIMIT 24
    ) ${[satellite, news].filter(Boolean).map((sql) => `(${sql})`).join(" UNION ALL ")}`,
    params: [event.id, specificLocation ? event.primary_location_id : null,
      ...(exactPoint ? [event.longitude, event.latitude] : []), window.since, window.until, event.event_type ?? null],
  };
}

const iso = (value: Date | string | null) => value == null ? null : new Date(value).toISOString();

export function presentContextImages(rows: ContextImageRow[]): ContextImage[] {
  const unique = new Set<string>();
  const counts = { satellite: 0, news: 0 };
  return [...rows].sort((left, right) => (
    new Date(right.captured_at ?? right.published_at ?? right.collected_at ?? 0).getTime()
    - new Date(left.captured_at ?? left.published_at ?? left.collected_at ?? 0).getTime()
  )).flatMap(({ content_hash, ...row }) => {
    if (unique.has(content_hash) || counts[row.kind] >= 3) return [];
    unique.add(content_hash);
    counts[row.kind] += 1;
    return [{ ...row, width: Number(row.width), height: Number(row.height),
      captured_at: iso(row.captured_at), published_at: iso(row.published_at), collected_at: iso(row.collected_at),
      notice: row.kind === "satellite" ? satelliteNotice : newsNotice }];
  });
}

/** Reuse is geographic context only; it never creates evidence or alters scores. */
export async function getEventContextImages(event: ContextImageEvent, read: ContextImageRead = query): Promise<ContextImage[]> {
  const statement = buildContextImageQuery(event);
  if (!statement) return [];
  const { rows } = await read(statement.sql, statement.params);
  return presentContextImages(rows);
}
