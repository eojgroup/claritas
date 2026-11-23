import { useEffect, useMemo, useState, useRef } from "react";
import { Anchor, ArrowRight, Plane, RefreshCw, Ship } from "lucide-react";
import { fetchTransportEntity, fetchTransportOverview, type IntelligenceEvent, type TransportEntity, type TransportHistory, type TransportHistoryPoint, type TransportMode, type TransportOverview, type TransportTrackPoint } from "../lib/api";
import { readWithDeadline } from "../lib/readDeadline";
import "./TransportScopeContext.css";

type Props = {
  onOverview?: (value: TransportOverview | null) => void;
  selectedVehicle?: TransportEntity | null;
  country?: string | null;
  events?: IntelligenceEvent[];
  relatedEventIds?: string[];
  onSelectCountry?: (country: string) => void;
  onOpenEvent?: (eventId: string) => void;
};
type HistoryMetric = "movements" | "vessels" | "flights";
const count = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString();
const date = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Not yet available";
const countryName = (value: string) => new Intl.DisplayNames(undefined, { type: "region" }).of(value) || value;
const change = (value: number | null | undefined) => value == null ? "No comparable prior sample" : `${value > 0 ? "+" : ""}${value.toFixed(1)}% vs prior 24 hours`;
const historyValue = (point: TransportHistoryPoint, metric: HistoryMetric): number | null => metric === "vessels" ? point.maritime_entities : metric === "flights" ? point.aviation_entities : point.ship_arrivals == null && point.ship_departures == null ? null : (point.ship_arrivals ?? 0) + (point.ship_departures ?? 0);
const metricLabel: Record<HistoryMetric, string> = { movements: "Port arrivals + departures", vessels: "Peak sampled vessels", flights: "Peak sampled aircraft" };
const identifier = (entity: TransportEntity) => entity.flight_number || entity.callsign || entity.display_name || entity.entity_id;

/** Mount only while the World transport layer is selected; every read uses retained data. */
export default function TransportScopeContext({ country, events = [], relatedEventIds = [], onSelectCountry, onOpenEvent, onOverview, selectedVehicle }: Props) {
  const iso = country?.trim().toUpperCase() || undefined;
  const lastScope = useRef("");
  const [overview, setOverview] = useState<TransportOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<TransportMode | "all">("all");
  const [corridor, setCorridor] = useState("");
  const [days, setDays] = useState<7 | 30 | 90 | 365>(30);
  const [metric, setMetric] = useState<HistoryMetric>("movements");
  const [selected, setSelected] = useState<TransportEntity | null>(null);
  const [entityQuery, setEntityQuery] = useState("");
  const [shownEntities, setShownEntities] = useState(40);
  useEffect(() => { setCorridor(""); setSelected(null); setEntityQuery(""); setShownEntities(40); }, [iso]);
  useEffect(() => {
    const controller = new AbortController();
    const scope = `${iso ?? 'global'}|${mode}|${corridor}`;
    if (lastScope.current !== scope) { onOverview?.(null); setOverview(null); setSelected(null); lastScope.current = scope; }
    setLoading(true); setFailed(false);
    void readWithDeadline((signal) => fetchTransportOverview({ signal, historyDays: iso ? 400 : undefined, country: iso, detail: iso ? "full" : "aggregate", mode: mode === "all" ? undefined : mode, corridorCountry: corridor || undefined, entityLimit: 160 }), controller.signal, 10_000)
      .then((value) => { if (!controller.signal.aborted) { setOverview(value); onOverview?.(value); setLoading(false); } })
      .catch(() => { if (!controller.signal.aborted) { setFailed(true); setLoading(false); } });
    return () => controller.abort();
  }, [iso, mode, corridor, retry, onOverview]);
  useEffect(() => { if (selectedVehicle) setSelected(selectedVehicle); }, [selectedVehicle]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) setRetry(value => value + 1); }, 120_000);
    return () => clearInterval(timer);
  }, []);
  const scopeName = iso ? countryName(iso) : "Worldwide";
  const history = overview?.history;
  const series = useMemo(() => (history?.series ?? []).slice(-days), [history, days]);
  const scopeTrend = iso ? overview?.countries.find((row) => row.country === iso)?.trend : undefined;
  const departures = scopeTrend?.ship_departures ?? overview?.trends.maritime.ship_departures;
  const arrivals = scopeTrend?.ship_arrivals ?? overview?.trends.maritime.ship_arrivals;
  const flights = scopeTrend?.tracked_flights ?? overview?.trends.aviation.tracked_flights;
  const relatedIds = new Set(relatedEventIds);
  const related = events.filter((event) => relatedIds.has(event.id) || ((!iso || event.primary_country_iso2 === iso) && (event.signal_domains?.includes("transport") || event.origin_domain === "transport" || event.event_type === "transport_activity_change")));
  const filteredEntities = (overview?.entities ?? []).filter((entity) => `${identifier(entity)} ${entity.entity_id} ${entity.registration || ""} ${entity.route_label || ""} ${entity.current_location_name || ""}`.toLocaleLowerCase().includes(entityQuery.trim().toLocaleLowerCase()));
  const counterparties = [...new Set((overview?.routes ?? []).flatMap((route) => [route.origin_country, route.destination_country]).filter((value) => value !== iso))].sort();
  return <section className="transport-scope-context" aria-label="Transport exploration" aria-busy={loading}>
    <header className="scope-context-heading"><div><small>Transport · {scopeName}</small><h3>Live tracking & activity</h3></div><button type="button" onClick={() => setRetry((value) => value + 1)} disabled={loading} aria-label="Refresh saved transport"><RefreshCw size={16} /></button></header>
    <div className="scope-context-controls"><label>Mode<select value={mode} onChange={(event) => { setMode(event.target.value as TransportMode | "all"); setMetric(event.target.value === "aviation" ? "flights" : corridor ? "vessels" : "movements"); }}><option value="all">Air & sea</option><option value="maritime">Maritime</option><option value="aviation">Aviation</option></select></label>
      {iso && <label>Connection<select value={corridor} onChange={(event) => { setCorridor(event.target.value); setMetric(mode === "aviation" ? "flights" : "vessels"); }}><option value="">All {scopeName} connections</option>{[...new Set([...counterparties, ...(corridor ? [corridor] : [])])].map((value) => <option key={value} value={value}>{scopeName} ↔ {countryName(value)}</option>)}</select></label>}
    </div>
    {loading && <p role="status">Loading saved transport observations…</p>}
    {failed && <p role="alert">Transport context could not be loaded. <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry transport</button></p>}
    {overview && <>
      <div className="scope-context-metrics">
        {mode !== "aviation" && <><Metric title="Port departures · 24h" value={departures?.current} detail={change(departures?.change_pct)} /><Metric title="Port arrivals · 24h" value={arrivals?.current} detail={change(arrivals?.change_pct)} /></>}
        {mode !== "maritime" && <Metric title="Sampled aircraft · 24h" value={flights?.current} detail={change(flights?.change_pct)} />}
        <Metric title="Fresh linked vehicles" value={overview.summary.active} detail={`${count(overview.summary.routed)} with resolved routes`} />
      </div>
      <p className="scope-context-boundary">Partial AIS / ADS-B tracking · select a vehicle on the map for details.</p><h4>Tracked vehicles · past 24 hours</h4><RecentActivity points={overview.activity} />
      {history ? <section className="scope-context-history" aria-label="Retained transport history">
        <header><h4>{corridor ? `${scopeName} ↔ ${countryName(corridor)}` : scopeName} over time</h4><div className="scope-context-controls"><label>History<select value={days} onChange={(event) => setDays(Number(event.target.value) as 7 | 30 | 90 | 365)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">Past year</option></select></label><label>Measure<select value={metric} onChange={(event) => setMetric(event.target.value as HistoryMetric)}>{mode !== "aviation" && !corridor && <option value="movements">Port movements</option>}{mode !== "aviation" && <option value="vessels">Vessel samples</option>}{mode !== "maritime" && <option value="flights">Aircraft samples</option>}</select></label></div></header>
        <details><summary>History coverage</summary><p>Retained observations: {date(history.available_from)}–{date(history.available_to)} UTC · {history.observed_days} observed days. Activity retention: {history.activity_retention_days ?? history.retention_days} days; port movements: {history.movement_retention_days ?? history.retention_days} days. The latest UTC day may be incomplete.</p></details>
        <HistoryChart points={series} metric={metric} corridor={Boolean(corridor)} />
        <details><summary>Compare periods</summary><PeriodComparisons history={history} /></details>
        <details><summary>Coverage & interpretation</summary><p>{history.methodology}</p><p>Year-on-year comparison needs observations from both years. Unrecorded days remain gaps and are never treated as zero traffic.</p></details>
      </section> : <section aria-label="Recent global transport sampling"><p>Select a country to inspect its retained daily history, monitored ports, corridors and individual vehicles.</p></section>}
      {!iso && overview.activity_ranking.countries.length > 0 && <section><h4>Browse country transport</h4><div className="scope-context-country-list">{overview.activity_ranking.countries.slice(0, 12).map((row) => <button key={row.country} type="button" onClick={() => onSelectCountry?.(row.country)}><strong>{row.country_name}</strong><span>{count(row.current.observed_movements)} observed · {change(row.momentum.change_pct)}</span><ArrowRight size={14} /></button>)}</div></section>}
      {overview.routes.length > 0 && <details><summary>Observed connections · {overview.routes.length}</summary><div className="scope-context-routes">{overview.routes.slice(0, 12).map((route) => <button key={`${route.mode}:${route.origin_country}:${route.destination_country}`} type="button" onClick={() => { if (iso) { setCorridor(route.origin_country === iso ? route.destination_country : route.origin_country); setMetric(route.mode === "aviation" ? "flights" : "vessels"); } else onSelectCountry?.(route.destination_country); }}><span>{route.mode === "aviation" ? <Plane size={15} /> : <Ship size={15} />}{route.origin_name} → {route.destination_name}</span><strong>{count(route.active_count)}</strong>{route.origin_basis !== "observed" && <small>{route.origin_basis === "flag_fallback" ? "Flag-state proxy origin" : "Includes flag-state proxy origins"}</small>}</button>)}</div></details>}
      {!corridor && overview.ports.length > 0 && <details><summary>Monitored ports · 24 hours</summary><div className="scope-context-table-scroll"><table><thead><tr><th>Port</th><th>Arrivals</th><th>Departures</th><th>Cargo vessel departures</th></tr></thead><tbody>{overview.ports.slice(0, 20).map((port) => <tr key={`${port.country}:${port.location_name}`}><th><button type="button" onClick={() => onSelectCountry?.(port.country)}>{port.location_name}</button><small>{port.country_name}</small></th><td>{count(port.arrivals)}</td><td>{count(port.departures)}</td><td>{count(port.cargo_vessel_departures)}</td></tr>)}</tbody></table></div></details>}
      {iso && <details><summary>Browse flights & vessels · {overview.entities.length} retained snapshots</summary><label className="scope-context-vehicle-search">Find a vessel, flight or route<input type="search" value={entityQuery} onChange={(event) => { setEntityQuery(event.target.value); setShownEntities(40); }} /></label><div className="scope-context-entities">{filteredEntities.slice(0, shownEntities).map((entity) => <button key={entity.id} type="button" aria-pressed={selected?.id === entity.id} onClick={() => setSelected(entity)}><span>{entity.mode === "aviation" ? <Plane size={15} /> : <Anchor size={15} />}<strong>{identifier(entity)}</strong></span><small>{entity.route_label || entity.current_location_name || "Route unresolved"} · {date(entity.observed_at)}</small><small>{entity.country_links.map((link) => `${link.country}: ${link.role === "current" ? "observed location" : link.role === "flag" ? "vessel flag" : link.role}`).join(" · ")}</small></button>)}</div>{!overview.entities.length && <p>No fresh vehicle snapshots match this scope. This does not establish absence of traffic.</p>}{filteredEntities.length > shownEntities && <button type="button" onClick={() => setShownEntities((value) => value + 40)}>Show more vehicles ({filteredEntities.length - shownEntities} remaining)</button>}{entityQuery && !filteredEntities.length && <p>No retained snapshots match this search.</p>}<p>{overview.entities.length} freshest snapshots loaded for this scope; current samples do not represent every vehicle.</p></details>}
      {selected && <EntityDetail key={`${selected.mode}:${selected.entity_id}`} entity={selected} onClose={() => setSelected(null)} />}
      {related.length > 0 && <details aria-label="Related transport developments"><summary>Related reporting</summary><h4>Reporting & developments in this scope</h4><p>Open an event to inspect its linked reporting and explanations. Sharing a location and time does not establish cause.</p>{related.slice(0, 6).map((event) => <button className="scope-context-related-event" type="button" key={event.id} onClick={() => onOpenEvent?.(event.id)}><strong>{event.title}</strong><small>{event.location_name || event.primary_country_iso2 || "Global"} · {date(event.last_activity_time)}</small><span>{event.summary}</span></button>)}</details>}
      <details><summary>Sources & freshness</summary><p>Saved overview generated {new Date(overview.generated_at).toLocaleString()}. Maritime: {overview.coverage.maritime.coverage_note}</p><p>Flights: {overview.coverage.aviation.source} · {overview.coverage.aviation.license}. Routes may use inferred airport pairs; vessel flags are separately labelled as contextual origins.</p></details>
    </>}
  </section>;
}

function Metric({ title, value, detail }: { title: string; value?: number; detail: string }) { return <div><small>{title}</small><strong>{count(value)}</strong><span>{detail}</span></div>; }
const selectedValue = (point: TransportHistoryPoint, metric: HistoryMetric, corridor: boolean) => corridor ? metric === "flights" ? point.corridor_aviation_entities : point.corridor_maritime_entities : historyValue(point, metric);
function HistoryChart({ points, metric, corridor }: { points: TransportHistoryPoint[]; metric: HistoryMetric; corridor: boolean }) {
  const rows = points.map((point) => ({ bucket: point.bucket, value: selectedValue(point, metric, corridor) }));
  const values = rows.flatMap((point) => point.value == null ? [] : [point.value]);
  if (!values.length) return <p>No retained samples for this measure in the selected period.</p>;
  const max = Math.max(1, ...values), start = Date.parse(rows[0].bucket), end = Date.parse(rows[rows.length - 1].bucket);
  const width = Math.max(1, Math.min(12, 650 / Math.max(1, rows.length) - 1));
  return <figure className="scope-context-chart"><figcaption>{metricLabel[metric]} · daily retained samples</figcaption><svg viewBox="0 0 720 180" role="img" aria-label={`${metricLabel[metric]}, ${date(rows[0].bucket)} to ${date(rows[rows.length - 1].bucket)} UTC; missing observations shown as gaps`}>
    <line x1="32" x2="710" y1="152" y2="152" stroke="var(--shell-border)" /><text x="0" y="18">{count(max)}</text><text x="13" y="154">0</text>{rows.filter((point) => point.value != null).map((point) => <rect key={point.bucket} x={32 + (Date.parse(point.bucket) - start) / Math.max(1, end - start) * 670 - width / 2} y={152 - point.value! / max * 130} width={width} height={point.value! / max * 130} rx="1"><title>{date(point.bucket)} · {count(point.value)}</title></rect>)}
    <text x="32" y="176">{date(rows[0].bucket)}</text><text x="710" y="176" textAnchor="end">{date(rows[rows.length - 1].bucket)}</text>
  </svg><details><summary>Daily counts & gaps</summary><div className="scope-context-table-scroll"><table><thead><tr><th>Day · UTC</th><th>{metricLabel[metric]}</th></tr></thead><tbody>{rows.map((point) => <tr key={point.bucket}><th>{date(point.bucket)}</th><td>{point.value == null ? "No retained observation" : count(point.value)}</td></tr>)}</tbody></table></div></details></figure>;
}
function PeriodComparisons({ history }: { history: TransportHistory }) {
  if (!history.comparisons?.length) return <p className="scope-context-boundary">Long-period comparisons need retained observations in both periods. Unrecorded days are not zero traffic.</p>;
  return <section className="scope-context-periods" aria-label="Sampled vehicle period comparisons"><h4>Sampled vehicle activity · period comparisons</h4>{history.comparisons.map((comparison) => <article key={comparison.key}>
    <strong>{comparison.label}</strong>
    {comparison.comparable ? <p>{comparison.change_percent == null ? "No percentage baseline" : `${comparison.change_percent > 0 ? "+" : ""}${comparison.change_percent.toFixed(1)}%`} · average daily sampled vehicles {count(comparison.current.average_daily_entities)} vs {count(comparison.previous.average_daily_entities)}</p> : <p>Comparison unavailable · {comparison.current.observed_days}/{comparison.current.days} current days and {comparison.previous.observed_days}/{comparison.previous.days} prior days observed.</p>}
    <small>{date(comparison.current.start)}–{date(new Date(Date.parse(comparison.current.end) - 1).toISOString())} vs {date(comparison.previous.start)}–{date(new Date(Date.parse(comparison.previous.end) - 1).toISOString())} UTC</small><p className="scope-context-boundary">{comparison.notice}</p>
  </article>)}</section>;
}
function RecentActivity({ points }: { points: TransportOverview["activity"] }) {
  const buckets = [...new Set(points.map((point) => point.bucket))].sort();
  const max = Math.max(1, ...points.map((point) => point.active_count));
  if (!buckets.length) return <p>No retained recent samples are available.</p>;
  const start = Date.parse(buckets[0]), end = Date.parse(buckets[buckets.length - 1]);
  const time = (value: string) => new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return <figure className="scope-context-chart"><svg viewBox="0 0 720 180" role="img" aria-label={`Sampled aircraft and vessels from ${time(buckets[0])} to ${time(buckets[buckets.length - 1])} UTC; missing hours are gaps`}>
    <line x1="32" x2="710" y1="152" y2="152" stroke="var(--shell-border)" /><text x="0" y="18">{count(max)}</text>
    {points.map((point) => <rect key={`${point.bucket}:${point.mode}`} x={32 + (Date.parse(point.bucket) - start) / Math.max(1, end - start) * 670 + (point.mode === "aviation" ? 0 : -5)} y={152 - point.active_count / max * 130} width="4" height={point.active_count / max * 130} style={{ fill: point.mode === "aviation" ? "var(--signal-sky,#77a8ba)" : "var(--shell-accent,#eda36a)" }}><title>{time(point.bucket)} UTC · {point.mode} · {point.active_count}</title></rect>)}
    <text x="32" y="176">{time(buckets[0])}</text><text x="710" y="176" textAnchor="end">{time(buckets[buckets.length - 1])}</text>
  </svg><figcaption>Vessels · orange / aircraft · blue · UTC · sampled activity</figcaption></figure>;
}
function EntityDetail({ entity, onClose }: { entity: TransportEntity; onClose: () => void }) {
  const [track, setTrack] = useState<TransportTrackPoint[] | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => { const controller = new AbortController(); void readWithDeadline((signal) => fetchTransportEntity(entity.mode, entity.entity_id, signal), controller.signal, 10_000).then((value) => { if (!controller.signal.aborted) setTrack(value.track); }).catch(() => { if (!controller.signal.aborted) setFailed(true); }); return () => controller.abort(); }, [entity.mode, entity.entity_id]);
  return <section className="scope-context-entity-detail" aria-label="Selected vehicle"><header><h4>{identifier(entity)}</h4><button type="button" onClick={onClose}>Close vehicle</button></header><p>{entity.route_label || "Route unresolved"} · {entity.entity_id} · {entity.source_name}</p><dl><div><dt>Speed</dt><dd>{count(entity.speed)} knots</dd></div><div><dt>Country roles</dt><dd>{entity.country_links.map((link) => `${link.country}: ${link.role}`).join(" · ")}</dd></div><div><dt>Last observed</dt><dd>{new Date(entity.observed_at).toLocaleString()}</dd></div></dl>{track ? <details open><summary>Retained sampled trail · {track.length} positions</summary><div className="scope-context-table-scroll"><table><thead><tr><th>Observed</th><th>Position</th><th>Speed · knots</th></tr></thead><tbody>{track.slice(-20).reverse().map((point) => <tr key={`${point.observed_at}:${point.latitude}:${point.longitude}`}><th>{new Date(point.observed_at).toLocaleString()}</th><td>{point.latitude.toFixed(3)}, {point.longitude.toFixed(3)}</td><td>{count(point.speed)}</td></tr>)}</tbody></table></div></details> : <p>{failed ? "The retained trail could not be loaded." : "Loading retained sampled trail…"}</p>}</section>;
}
