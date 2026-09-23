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

/** Read-only discovery, kept outside the evidence graph and all ranking inputs. */
export async function getRegionalReporting(input: {
  id: string; primary_country_iso2?: string | null; primary_location_id?: string | null;
  start_time: string | Date | null;
}) {
  const window = regionalReportingWindow(input.start_time);
  if (!window || !input.primary_country_iso2) return null;
  const [reports, aliases] = await Promise.all([
    query<{ id: string; title: string; summary: string | null; url: string; publisher: string; observed_at: Date; published_at: string | null }>(
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
    ),
    query<{ alias: string }>(
      `SELECT alias.alias FROM intelligence_location_alias alias
       JOIN intelligence_location location ON location.id=alias.location_id
       WHERE location.id=$1::uuid AND location.location_type<>'country'
         AND alias.alias_type<>'abbreviation' ORDER BY length(alias.alias) DESC LIMIT 30`,
      [input.primary_location_id ?? null],
    ),
  ]);
  const seen = new Set<string>();
  const items = reports.rows.map((row) => ({
    ...row,
    scope: mentionsNamedLocation(row.title, row.summary, aliases.rows.map((item) => item.alias))
      ? "same_named_location" : "same_country",
  })).sort((left, right) => Number(right.scope === "same_named_location") - Number(left.scope === "same_named_location"))
    .filter((row) => {
      const key = normalizeLocationAlias(row.title) || row.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6).map(({ summary: _summary, ...row }) => ({
      ...row,
      observed_at: new Date(row.observed_at).toISOString(),
      scope_label: row.scope === "same_named_location" ? "Same named location" : `Same country · ${input.primary_country_iso2}`,
    }));
  return { window_start: window.start, window_end: window.end, notice: REGIONAL_REPORTING_NOTICE, items };
}
