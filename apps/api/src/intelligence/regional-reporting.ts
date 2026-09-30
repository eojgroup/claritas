import { query } from "../db";
import { trustedNewsDirectCountrySql } from "../news-country-attribution";
import { normalizeLocationAlias } from "./location-normalization";

export const REGIONAL_REPORTING_NOTICE = "Nearby reporting shares a place and time window only. It is not linked evidence and does not increase importance or confidence.";

export function regionalReportingWindow(startTime: string | Date | null) {
  if (startTime == null) return null;
  const time = new Date(startTime).getTime();
  if (!Number.isFinite(time)) return null;
  return { start: new Date(time - 86_400_000).toISOString(), end: new Date(time + 86_400_000).toISOString() };
}

export function mentionsNamedLocation(title: string, summary: string | null, aliases: string[]) {
  const text = ` ${normalizeLocationAlias(`${title} ${summary ?? ""}`)} `;
  return aliases.some((alias) => {
    const normalized = normalizeLocationAlias(alias);
    return normalized.length >= 4 && !["airport", "port", "city", "region", "international"].includes(normalized) && text.includes(` ${normalized} `);
  });
}

const topicStopWords = new Set("about after again amid and are been from have into near over says that their there these this with south north korea korean report reported latest update news city area airport port fire".split(" "));
export function sharedHeadlineTerms(eventTitle: string, reportTitle: string) {
  const terms = new Set(normalizeLocationAlias(eventTitle).split(" ").filter((word) => word.length >= 4 && !topicStopWords.has(word)));
  return [...new Set(normalizeLocationAlias(reportTitle).split(" "))].filter((word) => terms.has(word)).slice(0, 4);
}

/** Read-only discovery, kept outside the evidence graph and all ranking inputs. */
export async function getRegionalReporting(input: {
  id: string; primary_country_iso2?: string | null; primary_location_id?: string | null;
  start_time: string | Date | null; title?: string | null;
  latitude?: number | null; longitude?: number | null; metadata?: Record<string, unknown> | null;
}) {
  const window = regionalReportingWindow(input.start_time);
  const exactPoint = input.metadata?.exact_geography === true && Number.isFinite(input.latitude) && Number.isFinite(input.longitude);
  if (!window || (!input.primary_country_iso2 && !exactPoint)) return null;
  type Report = { id: string; title: string; summary: string | null; url: string; publisher: string; observed_at: Date; published_at: string | null; distance_km?: number };
  const [reports, aliases, mappedReports] = await Promise.all([
    input.primary_country_iso2 ? query<Report>(
      `SELECT item.id::text,item.title,item.summary,item.url,
              COALESCE(NULLIF(item.payload->>'publisher',''),NULLIF(item.payload->>'domain',''),source.name) AS publisher,
              item.event_time AS observed_at,NULLIF(item.payload->>'publisher_published_at','') AS published_at
       FROM item JOIN source ON source.id=item.source_id
       WHERE item.kind='news_article' AND item.country_iso2=$1
         AND ${trustedNewsDirectCountrySql("item")}
         AND item.event_time BETWEEN $2::timestamptz AND $3::timestamptz
         AND item.event_time<=now()+interval '5 minutes'
         AND item.url IS NOT NULL AND NULLIF(trim(item.title),'') IS NOT NULL
         AND CASE WHEN lower(source.name)='gdelt' THEN item.payload->>'quality_status'='accepted'
                  ELSE COALESCE(item.payload->>'quality_status','accepted')='accepted' END
         AND NOT EXISTS (SELECT 1 FROM intelligence_event_evidence evidence
           WHERE evidence.event_id=$4::uuid AND evidence.source_record_type='item'
             AND evidence.source_record_id=item.id::text)
       ORDER BY item.event_time DESC,item.id DESC LIMIT 100`,
      [input.primary_country_iso2, window.start, window.end, input.id],
    ) : Promise.resolve({ rows: [] as Report[] }),
    query<{ alias: string }>(
      `SELECT alias.alias FROM intelligence_location_alias alias
       JOIN intelligence_location location ON location.id=alias.location_id
       WHERE location.id=$1::uuid AND location.location_type<>'country'
         AND alias.alias_type<>'abbreviation' ORDER BY length(alias.alias) DESC LIMIT 30`,
      [input.primary_location_id ?? null],
    ),
    exactPoint ? query<Report>(
      `SELECT DISTINCT ON (item.id) item.id::text,item.title,item.summary,item.url,
              COALESCE(NULLIF(item.payload->>'publisher',''),NULLIF(item.payload->>'domain',''),source.name) AS publisher,
              item.event_time AS observed_at,NULLIF(item.payload->>'publisher_published_at','') AS published_at,
              ST_Distance(report_event.geography::geography,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography)/1000 AS distance_km
       FROM intelligence_event report_event
       JOIN intelligence_event_evidence evidence ON evidence.event_id=report_event.id
         AND evidence.domain='news' AND evidence.source_record_type='item'
         AND evidence.source_record_id ~ '^[0-9]{1,18}$'
       JOIN item ON item.id=CASE WHEN evidence.source_record_id ~ '^[0-9]{1,18}$'
         THEN evidence.source_record_id::bigint END
       JOIN source ON source.id=item.source_id
       WHERE report_event.id<>$1::uuid AND report_event.metadata @> '{"exact_geography":true}'::jsonb
         AND report_event.geography IS NOT NULL
         AND report_event.start_time<=$5::timestamptz AND report_event.last_activity_time>=$4::timestamptz
         AND ST_DWithin(report_event.geography::geography,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,100000)
         AND item.kind='news_article' AND item.event_time BETWEEN $4::timestamptz AND $5::timestamptz
         AND item.event_time<=now()+interval '5 minutes'
         AND item.url IS NOT NULL AND NULLIF(trim(item.title),'') IS NOT NULL
         AND COALESCE(item.payload->>'quality_status','accepted')='accepted'
         AND NOT (item.payload ? 'canonical_alias_of_item_id')
         AND NOT EXISTS (SELECT 1 FROM intelligence_event_evidence linked
           WHERE linked.event_id=$1::uuid AND linked.source_record_type='item' AND linked.source_record_id=item.id::text)
       ORDER BY item.id,item.event_time DESC LIMIT 60`,
      [input.id, input.longitude, input.latitude, window.start, window.end],
    ) : Promise.resolve({ rows: [] as Report[] }),
  ]);
  const seen = new Set<string>();
  const items = [...mappedReports.rows, ...reports.rows].map((row) => ({
    ...row,
    scope: row.distance_km != null ? "mapped_nearby"
      : mentionsNamedLocation(row.title, row.summary, aliases.rows.map((item) => item.alias)) ? "same_named_location"
      : sharedHeadlineTerms(input.title ?? "", row.title).length >= 2 ? "same_topic" : "same_country",
  })).sort((left, right) => {
    const rank = (scope: string) => ({ mapped_nearby: 3, same_named_location: 2, same_topic: 1, same_country: 0 }[scope] ?? 0);
    return rank(right.scope) - rank(left.scope) || Date.parse(String(right.observed_at)) - Date.parse(String(left.observed_at));
  })
    .filter((row) => {
      const key = normalizeLocationAlias(row.title) || row.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6).map(({ summary: _summary, ...row }) => ({
      ...row,
      observed_at: new Date(row.observed_at).toISOString(),
      scope_label: row.scope === "mapped_nearby" ? `Within ${Math.ceil(Number(row.distance_km) / 10) * 10} km of mapped event`
        : row.scope === "same_named_location" ? "Same named location"
        : row.scope === "same_topic" ? `Similar headline terms · ${input.primary_country_iso2}`
        : `Same country · ${input.primary_country_iso2}`,
    }));
  return { window_start: window.start, window_end: window.end, notice: REGIONAL_REPORTING_NOTICE, items };
}
