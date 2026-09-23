import { query } from "../db";
import { regionalReportingWindow } from "./regional-reporting";

export type RegionalContextSignal = {
  id: string; domain: string; title: string; summary: string; scope_label: string;
  relationship: "regional_context"; observed_at: string | null;
  metrics: Array<{ label: string; value: number; unit: string }>;
  coverage_notice: string; native_route: string | null;
};

/** Historical, country-scoped context. No totals here assert local impact. */
export async function getRegionalContext(input: { primary_country_iso2?: string | null; start_time: string | Date | null }): Promise<RegionalContextSignal[]> {
  const country = input.primary_country_iso2;
  const window = regionalReportingWindow(input.start_time);
  if (!country || !window) return [];
  const [activity, movements, weather] = await Promise.all([
    query<{ mode: string; entities: number; providers: number; observed_at: Date }>(
      `SELECT mode,count(DISTINCT entity_id)::int AS entities,count(DISTINCT source_name)::int AS providers,
        max(last_observed_at) AS observed_at FROM transport_entity_activity_hour
       WHERE country_iso2=$1 AND bucket BETWEEN $2::timestamptz AND $3::timestamptz
       GROUP BY mode`, [country, window.start, window.end]),
    query<{ departures: number; arrivals: number; ports: number }>(
      `SELECT sum(departures)::int AS departures,sum(arrivals)::int AS arrivals,
        count(DISTINCT location_name)::int AS ports FROM transport_movement_hour
       WHERE country_iso2=$1 AND bucket BETWEEN $2::timestamptz AND $3::timestamptz`, [country, window.start, window.end]),
    query<{ event: string; headline: string | null; starts_at: Date; sender_name: string }>(
      `SELECT event,headline,starts_at,sender_name FROM weather_alert
       WHERE country_iso2=$1 AND starts_at<=$3::timestamptz
         AND COALESCE(ends_at,starts_at+interval '24 hours')>=$2::timestamptz
       ORDER BY starts_at DESC,id DESC LIMIT 5`, [country, window.start, window.end]),
  ]);
  const timestamp = activity.rows.map((row) => new Date(row.observed_at).toISOString()).sort().at(-1) ?? null;
  const hasMovement = Number(movements.rows[0]?.ports ?? 0) > 0;
  const scope = `Same country · ${country} · ${window.start.slice(0, 16).replace("T", " ")} – ${window.end.slice(0, 16).replace("T", " ")} UTC`;
  const transportMetrics = activity.rows.map((row) => ({ label: row.mode === "aviation" ? "Tracked aircraft" : "Tracked vessels", value: Number(row.entities), unit: "unique vehicles" }));
  if (hasMovement) transportMetrics.push(
    { label: "Observed port departures", value: Number(movements.rows[0].departures ?? 0), unit: "movements" },
    { label: "Observed port arrivals", value: Number(movements.rows[0].arrivals ?? 0), unit: "movements" },
  );
  return [{
    id: `regional-transport-${country}`, domain: "transport", title: "Transport activity around this development",
    summary: transportMetrics.length ? "Observed aircraft, vessel and port activity in the country during the event window." : "No retained transport observations were found for this country and time window.",
    scope_label: scope, relationship: "regional_context", observed_at: timestamp, metrics: transportMetrics,
    coverage_notice: "Tracking samples are partial coverage, not total national traffic or freight volume. Shared country and timing do not establish disruption, impact or a link to this event.", native_route: null,
  }, {
    id: `regional-weather-${country}`, domain: "weather", title: "Weather in the same country and time window",
    summary: weather.rows.length ? weather.rows.map((row) => `${row.sender_name}: ${row.headline || row.event}`).join(" · ") : "No retained official weather alerts overlap this country and time window.",
    scope_label: scope, relationship: "regional_context", observed_at: weather.rows[0] ? new Date(weather.rows[0].starts_at).toISOString() : null,
    metrics: weather.rows.length ? [{ label: "Recent overlapping alerts shown", value: weather.rows.length, unit: "alerts" }] : [],
    coverage_notice: "Country-level discovery only. An alert may concern another area; no alert in the retained data does not mean no hazardous weather.", native_route: null,
  }];
}
