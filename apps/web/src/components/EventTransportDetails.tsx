import { useEffect, useState } from "react";
import { fetchEventTransport, type EventTransportDetail } from "../lib/api";

export default function EventTransportDetails({ eventId }: { eventId: string }) {
  const [data, setData] = useState<EventTransportDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setState("loading"); setData(null);
    void fetchEventTransport(eventId, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setData(value); setState("ready"); }
    }).catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [eventId, retry]);
  if (state === "loading") return <p role="status">Loading this anomaly’s movements…</p>;
  if (state === "error") return <p>Movement details could not be loaded. <button type="button" onClick={() => setRetry(retry + 1)}>Retry movements</button></p>;
  if (!data) return <p>No retained movement detail is linked to this event.</p>;
  const max = Math.max(1, ...data.hours.map((hour) => hour.arrivals + hour.departures));
  const columns = Math.max(1, data.window_end ? new Date(data.window_end).getUTCHours() : 0, ...data.hours.map((hour) => new Date(hour.observed_at).getUTCHours() + 1));
  return <section className="event-transport-details" aria-label="Anomaly movement details">
    <h4>{data.location_name}</h4>
    {data.window_end && <p>Completed UTC hours through {new Date(data.window_end).toLocaleString([], { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} UTC · {data.source_name}</p>}
    {data.hours.length > 0 && <><h5>Tracked movements by hour</h5><div className="context-hourly-chart" role="img" aria-label="Hourly tracked arrivals and departures" style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {data.hours.map((hour) => <div key={hour.observed_at} style={{ gridColumn: new Date(hour.observed_at).getUTCHours() + 1 }} title={`${new Date(hour.observed_at).getUTCHours()}:00 UTC · ${hour.arrivals} arrivals, ${hour.departures} departures`}>
        <i style={{ height: `${(hour.arrivals + hour.departures) / max * 100}%` }} /><small>{new Date(hour.observed_at).getUTCHours()}</small>
      </div>)}
    </div><details><summary>Hourly counts</summary><ul>{data.hours.map((hour) => <li key={hour.observed_at}>{new Date(hour.observed_at).getUTCHours()}:00 UTC · {hour.arrivals} arrivals · {hour.departures} departures</li>)}</ul></details></>}
    {data.movements.length > 0 && <details open><summary>Recent movements in this comparison ({data.movements.length})</summary><ul className="context-movement-list">
      {data.movements.map((movement) => <li key={movement.id}><strong>{movement.entity_name || `Vessel ${movement.entity_id}`}</strong><span>{movement.event_type} · {movement.vehicle_category || "Vessel"}{movement.entity_name ? ` · ${movement.entity_id}` : ""}</span><time dateTime={movement.observed_at}>{new Date(movement.observed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</time></li>)}
    </ul></details>}
    {data.coverage === "summary_only" && <p>Only the retained anomaly comparison is available for this update.</p>}
    <p className="event-context-boundary">{data.notice}</p>
  </section>;
}
