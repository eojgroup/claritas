import { query } from "../db";

type Evidence = { domain: string; evidence_type: string; source_record_type?: string; source_record_id: string; observed_at: string;
  metadata?: Record<string, unknown>; confidence?: number };
type Read = (sql: string, params: unknown[]) => Promise<{ rows: any[] }>;
export type EventTransportDetail = {
  current: number; baseline: number; observed_at: string; confidence: number | null;
  location_name: string; notice: string; coverage: "summary_only" | "retained_movements";
  country?: string; source_name?: string; window_start?: string; window_end?: string;
  hours: Array<{ observed_at: string | Date; arrivals: number; departures: number }>;
  movements: Array<{ id: string; entity_id: string; entity_name: string | null; event_type: string; vehicle_category: string | null; observed_at: string | Date; source_name: string }>;
};

/** Retained movements at the anomaly's own port and comparison time, not live country traffic. */
export async function getEventTransport(event: { location_name?: string | null }, evidence: Evidence[], read: Read = query): Promise<EventTransportDetail | null> {
  const anomaly = evidence.find((item) => item.domain === "transport" && item.evidence_type === "rolling_baseline_anomaly"
    && typeof item.metadata?.current === "number" && typeof item.metadata?.baseline === "number");
  if (!anomaly || !Number.isFinite(anomaly.metadata!.current) || !Number.isFinite(anomaly.metadata!.baseline)) return null;
  const current = Number(anomaly.metadata!.current), baseline = Number(anomaly.metadata!.baseline);
  if (current < 0 || baseline < 0) return null;
  const summary = { current, baseline, observed_at: anomaly.observed_at,
    confidence: anomaly.confidence ?? null, location_name: event.location_name ?? "Anomaly location",
    notice: "Tracked arrivals and departures for the same completed UTC hours. Telemetry coverage is partial; a change does not by itself establish disruption." };
  const id = anomaly.source_record_id;
  if (anomaly.source_record_type !== "transport_movement_event" || !/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) return { ...summary, coverage: "summary_only", hours: [], movements: [] };
  const { rows: [anchor] } = await read(`SELECT country_iso2,location_name,observed_at,source_name
    FROM transport_movement_event WHERE id=$1::bigint`, [id]);
  if (!anchor) return { ...summary, coverage: "summary_only", hours: [], movements: [] };
  const observed = new Date(anchor.observed_at);
  if (!Number.isFinite(observed.getTime())) return { ...summary, coverage: "summary_only", hours: [], movements: [] };
  const end = new Date(observed); end.setUTCMinutes(0, 0, 0);
  const start = new Date(end); start.setUTCHours(0);
  const params = [anchor.country_iso2, anchor.location_name, start.toISOString(), end.toISOString()];
  const [hours, movements] = await Promise.all([
    read(`SELECT bucket AS observed_at,sum(arrivals)::int AS arrivals,sum(departures)::int AS departures
      FROM transport_movement_hour WHERE country_iso2=$1 AND location_name=$2
        AND bucket>=$3::timestamptz AND bucket<$4::timestamptz GROUP BY bucket ORDER BY bucket LIMIT 24`, params),
    read(`SELECT movement.id::text,movement.entity_id,snapshot.display_name AS entity_name,movement.event_type,movement.vehicle_category,
        movement.observed_at,movement.source_name
      FROM transport_movement_event movement LEFT JOIN transport_snapshot snapshot ON snapshot.mode=movement.mode AND snapshot.entity_id=movement.entity_id
      WHERE movement.country_iso2=$1 AND movement.location_name=$2
        AND movement.observed_at>=$3::timestamptz AND movement.observed_at<$4::timestamptz
      ORDER BY movement.observed_at DESC,movement.id DESC LIMIT 20`, params),
  ]);
  return { ...summary, location_name: anchor.location_name, country: anchor.country_iso2,
    source_name: anchor.source_name, window_start: start.toISOString(), window_end: end.toISOString(),
    coverage: "retained_movements", hours: hours.rows, movements: movements.rows };
}
