import { query } from "../db";
/** Retained daily country-pair samples, not inferred journeys or cargo volume. */
export async function getTransportOutlook(country: string, days: 7 | 30 | 90, mode?: string) {
  const end = new Date(); end.setUTCHours(0,0,0,0);
  const start = new Date(end); start.setUTCDate(start.getUTCDate()-days);
  const {rows} = await query(`SELECT origin_country_iso2 AS origin,destination_country_iso2 AS destination,mode,
    count(*)::int AS observed_days,sum(peak_active_entities)::int AS sample_days,
    sum(peak_observed_origins)::int AS observed_origins,sum(peak_flag_proxy_origins)::int AS flag_proxies,
    min(bucket)::text AS first_day,max(bucket)::text AS last_day
    FROM transport_corridor_activity_day WHERE bucket >= $2::date AND bucket < $3::date
    AND (origin_country_iso2=$1 OR destination_country_iso2=$1) AND ($4::text IS NULL OR mode=$4)
    GROUP BY origin_country_iso2,destination_country_iso2,mode
    ORDER BY observed_days DESC,sample_days DESC,origin,destination LIMIT 40`,[country,start.toISOString(),end.toISOString(),mode??null]);
  return {country,days,start:start.toISOString(),end:end.toISOString(),corridors:rows,
    notice:"Lines connect country reference points, not actual tracks. Ranked by observed days, then summed daily peak samples; these are not journey counts or cargo volume. Flag-based maritime origins are estimates. Sampling admits at most 1,000 country pairs per mode/day, so rankings are incomplete. Missing days mean unknown coverage."};
}
