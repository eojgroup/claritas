import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Anchor,
  ArrowRight,
  ExternalLink,
  LocateFixed,
  Minus,
  Plane,
  RefreshCw,
  Route,
  Ship,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import TransportTrackingMap from "./TransportTrackingMap";
import {
  fetchTransportEntity,
  fetchTransportOverview,
  type TransportEntity,
  type TransportMode,
  type TransportOverview,
  type TransportTrackPoint,
} from "../lib/api";

type ModeFilter = TransportMode | "all";

function timeLabel(value: string | null | undefined) {
  if (!value) return "Awaiting data";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Awaiting data";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3_600)}h ago`;
}

function formatNumber(value: number | null | undefined, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value).toLocaleString()}${suffix}`;
}

function changeLabel(value: number | null, direction: "up" | "down" | "flat" | "new") {
  if (direction === "new") return "New baseline";
  if (value == null || direction === "flat") return "No change";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export default function TransportWorkspace() {
  const [overview, setOverview] = useState<TransportOverview | null>(null);
  const [mode, setMode] = useState<ModeFilter>("all");
  const [country, setCountry] = useState<string>("");
  const [selected, setSelected] = useState<TransportEntity | null>(null);
  const [track, setTrack] = useState<TransportTrackPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingEntity, setLoadingEntity] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectionRequestRef = useRef(0);

  const load = useCallback(
    async (force = false) => {
      if (force) setRefreshing(true);
      else setLoading(true);
      try {
        const value = await fetchTransportOverview({
          detail: "full",
          mode: mode === "all" ? undefined : mode,
          country: country || undefined,
          entityLimit: 1_200,
          refresh: force,
        });
        setOverview(value);
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [country, mode],
  );

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(false), 60_000);
    return () => window.clearInterval(timer);
    // Selection is intentionally excluded: selecting a marker must not refetch
    // the entire workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, mode]);

  const selectEntity = useCallback(async (entity: TransportEntity) => {
    const requestID = selectionRequestRef.current + 1;
    selectionRequestRef.current = requestID;
    setSelected(entity);
    setTrack([]);
    setLoadingEntity(true);
    try {
      const detail = await fetchTransportEntity(entity.mode, entity.entity_id);
      if (selectionRequestRef.current !== requestID) return;
      setSelected(detail.entity);
      setTrack(detail.track);
    } catch {
      // The current snapshot remains useful if a historical trail is not yet sampled.
    } finally {
      if (selectionRequestRef.current === requestID) setLoadingEntity(false);
    }
  }, []);

  const clearSelection = useCallback(() => {
    selectionRequestRef.current += 1;
    setSelected(null);
    setTrack([]);
    setLoadingEntity(false);
  }, []);

  const selectCountry = useCallback(
    (nextCountry: string) => {
      clearSelection();
      setCountry(nextCountry);
    },
    [clearSelection],
  );

  const activity = useMemo(() => {
    const buckets = new Map<
      string,
      { bucket: string; label: string; maritime: number; aviation: number }
    >();
    for (const point of overview?.activity ?? []) {
      const row = buckets.get(point.bucket) ?? {
        bucket: point.bucket,
        label: new Date(point.bucket).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        maritime: 0,
        aviation: 0,
      };
      row[point.mode] = point.active_count;
      buckets.set(point.bucket, row);
    }
    return Array.from(buckets.values()).sort(
      (left, right) =>
        new Date(left.bucket).getTime() - new Date(right.bucket).getTime(),
    );
  }, [overview]);

  const countryRows = useMemo(
    () =>
      (overview?.countries ?? []).slice(0, 12).map((entry) => ({
        ...entry,
        vessels: entry.maritime.active,
        flights: entry.aviation.active,
      })),
    [overview],
  );

  const entities = overview?.entities ?? [];
  const summary = overview?.summary;
  const maritime = summary?.modes.maritime;
  const aviation = summary?.modes.aviation;

  return (
    <section className="transport-workspace" aria-busy={loading}>
      <div className="analytics-control-bar transport-controls">
        <div className="transport-mode-switch" aria-label="Transport mode">
          {(["all", "aviation", "maritime"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={mode === item}
              onClick={() => {
                setMode(item);
                clearSelection();
              }}
            >
              {item === "all" ? <Route /> : item === "aviation" ? <Plane /> : <Ship />}
              {item === "all" ? "Combined" : item === "aviation" ? "Flights" : "Shipping"}
            </button>
          ))}
        </div>

        <label>
          Country linkage
          <select
            value={country}
            onChange={(event) => {
              selectCountry(event.currentTarget.value);
            }}
          >
            <option value="">Global network</option>
            {(overview?.countries ?? []).map((entry) => (
              <option key={entry.country} value={entry.country}>
                {entry.country_name} ({entry.country})
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="transport-refresh"
          onClick={() => void load(true)}
          disabled={refreshing}
        >
          <RefreshCw className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Refreshing…" : "Refresh live data"}
        </button>
      </div>

      {error && (
        <div className="transport-notice" role="alert">
          <AlertTriangle />
          <div>
            <strong>Transport intelligence is temporarily unavailable</strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      <div className="transport-kpi-strip">
        <article>
          <span>Tracked now</span>
          <strong>{summary?.active.toLocaleString() ?? "—"}</strong>
          <small>{summary?.linked_countries ?? 0} linked countries</small>
        </article>
        <article>
          <span>Aircraft</span>
          <strong>{aviation?.active.toLocaleString() ?? "—"}</strong>
          <small>{aviation?.routed ?? 0} with plausible routes</small>
        </article>
        <article>
          <span>Vessels</span>
          <strong>{maritime?.active.toLocaleString() ?? "—"}</strong>
          <small>{maritime?.routed ?? 0} linked corridors</small>
        </article>
        <article data-alert={(summary?.alerts ?? 0) > 0 || undefined}>
          <span>Safety signals</span>
          <strong>{summary?.alerts.toLocaleString() ?? "—"}</strong>
          <small>Emergency or navigational states</small>
        </article>
      </div>

      <div className="transport-takeaway-grid" aria-label="Transport takeaways">
        {(overview?.takeaways ?? []).map((takeaway) => {
          const DirectionIcon =
            takeaway.direction === "up"
              ? TrendingUp
              : takeaway.direction === "down"
                ? TrendingDown
                : Minus;
          return (
            <article key={takeaway.id} data-direction={takeaway.direction}>
              <div>
                {takeaway.mode === "aviation" ? <Plane /> : <Ship />}
                <span>{takeaway.title}</span>
                <strong>
                  <DirectionIcon />
                  {changeLabel(takeaway.change_pct, takeaway.direction)}
                </strong>
              </div>
              <p>{takeaway.summary}</p>
              <small>{takeaway.qualifier}</small>
            </article>
          );
        })}
      </div>

      <div className="transport-map-stage">
        <div className="transport-map-panel">
          <header>
            <div>
              <span>Live tracking</span>
              <h2>Global movement map</h2>
            </div>
            <small>
              Flights {timeLabel(aviation?.latest_observed_at)} · vessels{" "}
              {timeLabel(maritime?.latest_observed_at)}
            </small>
          </header>
          <TransportTrackingMap
            entities={entities}
            mode={mode}
            selectedId={selected?.id}
            track={track}
            onSelect={(entity) => void selectEntity(entity)}
          />
        </div>

        <aside className="transport-detail-panel" aria-busy={loadingEntity}>
          {selected ? (
            <>
              <div className="transport-detail-title">
                <span>{selected.mode === "aviation" ? "Flight track" : "Vessel track"}</span>
                <h2>{selected.display_name ?? selected.entity_id}</h2>
                <p>
                  {selected.route_label ??
                    selected.current_location_name ??
                    selected.status ??
                    "Route is being resolved"}
                </p>
              </div>
              <dl>
                <div>
                  <dt>{selected.mode === "aviation" ? "Flight number" : "MMSI"}</dt>
                  <dd>{selected.flight_number ?? selected.callsign ?? selected.entity_id}</dd>
                </div>
                <div>
                  <dt>Registration</dt>
                  <dd>{selected.registration ?? "—"}</dd>
                </div>
                <div>
                  <dt>Speed</dt>
                  <dd>{formatNumber(selected.speed, " kt")}</dd>
                </div>
                <div>
                  <dt>{selected.mode === "aviation" ? "Altitude" : "Heading"}</dt>
                  <dd>
                    {selected.mode === "aviation"
                      ? formatNumber(selected.altitude, " ft")
                      : formatNumber(selected.heading, "°")}
                  </dd>
                </div>
              </dl>
              <div className="transport-country-chain">
                <span>{selected.origin_country_iso2 ?? selected.registration_country_iso2 ?? "—"}</span>
                <ArrowRight />
                <span>{selected.current_country_iso2 ?? "Transit"}</span>
                <ArrowRight />
                <span>{selected.destination_country_iso2 ?? "—"}</span>
              </div>
              <div className="transport-linkage">
                <strong>Country linkage</strong>
                <div>
                  {selected.country_links.map((link) => (
                    <span key={`${link.role}-${link.country}`}>
                      {link.role} · {link.country}
                    </span>
                  ))}
                </div>
                <small>
                  {selected.linkage_confidence} confidence ·{" "}
                  {selected.linkage_basis.join(", ").replace(/_/g, " ") || "unlinked"}
                </small>
              </div>
              <p className="transport-freshness">
                {loadingEntity ? (
                  <>
                    <RefreshCw className="animate-spin" /> Loading sampled trail…
                  </>
                ) : (
                  <>
                    <LocateFixed /> Last observed {timeLabel(selected.observed_at)} ·{" "}
                    {track.length} sampled trail points
                  </>
                )}
              </p>
            </>
          ) : (
            <div className="transport-detail-empty">
              <LocateFixed />
              <h2>Select a live vehicle</h2>
              <p>
                Choose an aircraft or vessel to inspect its identifiers, country
                chain, route, operating state, and sampled trail.
              </p>
            </div>
          )}
        </aside>
      </div>

      <div className="transport-analytics-grid">
        <article className="app-card transport-chart-card">
          <header>
            <div>
              <span>24-hour sampled activity</span>
              <h2>Tracked movement over time</h2>
            </div>
          </header>
          <div className="transport-chart">
            {activity.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activity}>
                  <defs>
                    <linearGradient id="aviation-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#77A8BA" stopOpacity={0.58} />
                      <stop offset="100%" stopColor="#77A8BA" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="maritime-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#EDA36A" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#EDA36A" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={32} />
                  <YAxis tick={{ fontSize: 10 }} width={42} />
                  <Tooltip />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="aviation"
                    name="Aircraft"
                    stroke="#77A8BA"
                    fill="url(#aviation-fill)"
                  />
                  <Area
                    type="monotone"
                    dataKey="maritime"
                    name="Vessels"
                    stroke="#EDA36A"
                    fill="url(#maritime-fill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="transport-chart-empty">Trail sampling is building the 24-hour baseline.</div>
            )}
          </div>
        </article>

        <article className="app-card transport-chart-card">
          <header>
            <div>
              <span>Country relationships</span>
              <h2>Most connected countries</h2>
            </div>
          </header>
          <div className="transport-chart">
            {countryRows.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={countryRows} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid stroke="var(--shell-border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis
                    type="category"
                    dataKey="country"
                    tick={{ fontSize: 10 }}
                    width={34}
                  />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="flights" name="Flights" stackId="transport" fill="#77A8BA" />
                  <Bar dataKey="vessels" name="Vessels" stackId="transport" fill="#EDA36A" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="transport-chart-empty">No linked countries in the current scope.</div>
            )}
          </div>
        </article>
      </div>

      <div className="transport-lower-grid">
        <article className="app-card transport-routes-card">
          <header>
            <div>
              <span>Network diagram</span>
              <h2>Leading live corridors</h2>
            </div>
            <Route />
          </header>
          <div className="transport-flow-list">
            {(overview?.routes ?? []).slice(0, 12).map((route) => (
              <button
                type="button"
                key={`${route.mode}-${route.origin_country}-${route.destination_country}`}
                onClick={() => selectCountry(route.destination_country)}
              >
                <span className="transport-flow-node">
                  <b>{route.origin_country}</b>
                  <small>{route.origin_name}</small>
                </span>
                <span className="transport-flow-line" data-mode={route.mode}>
                  <i style={{ width: `${Math.min(100, 20 + route.active_count * 5)}%` }} />
                  <em>{route.active_count}</em>
                </span>
                <span className="transport-flow-node">
                  <b>{route.destination_country}</b>
                  <small>{route.destination_name}</small>
                </span>
              </button>
            ))}
            {(overview?.routes.length ?? 0) === 0 && (
              <div className="transport-chart-empty">
                Routes appear as AIS destinations and plausible flight airport pairs resolve.
              </div>
            )}
          </div>
        </article>

        <article className="app-card transport-country-list">
          <header>
            <div>
              <span>Aggregation with drill-in</span>
              <h2>Country linkage table</h2>
            </div>
          </header>
          <div className="transport-country-scroll">
            {(overview?.countries ?? []).slice(0, 18).map((entry) => (
              <button
                type="button"
                key={entry.country}
                onClick={() =>
                  selectCountry(entry.country === country ? "" : entry.country)
                }
                aria-pressed={country === entry.country}
              >
                <span>
                  <b>{entry.country}</b>
                  <small>{entry.country_name}</small>
                </span>
                <span>
                  <small>Flights</small>
                  <b>{entry.aviation.active}</b>
                </span>
                <span>
                  <small>Vessels</small>
                  <b>{entry.maritime.active}</b>
                </span>
                <span>
                  <small>Arrivals</small>
                  <b>{entry.aviation.destinations + entry.maritime.destinations}</b>
                </span>
              </button>
            ))}
          </div>
        </article>
      </div>

      <article className="app-card transport-port-card">
        <header>
          <div>
            <span>Observed port transitions · 24 hours</span>
            <h2>Departures, arrivals, and cargo-vessel flow</h2>
          </div>
          <Anchor />
        </header>
        <div className="transport-port-grid">
          {(overview?.ports ?? []).slice(0, 12).map((port) => (
            <button
              type="button"
              key={`${port.country}-${port.location_name}`}
              onClick={() => selectCountry(port.country)}
            >
              <span>
                <b>{port.location_name}</b>
                <small>{port.country_name}</small>
              </span>
              <span>
                <small>Departures</small>
                <b>{port.departures}</b>
              </span>
              <span>
                <small>Arrivals</small>
                <b>{port.arrivals}</b>
              </span>
              <span>
                <small>Cargo vessels</small>
                <b>{port.cargo_vessel_departures}</b>
              </span>
            </button>
          ))}
          {(overview?.ports.length ?? 0) === 0 && (
            <div className="transport-chart-empty">
              Port movement baselines will appear after vessels enter and leave monitored geofences.
            </div>
          )}
        </div>
      </article>

      <article className="app-card transport-entity-table">
        <header>
          <div>
            <span>Live identifiers</span>
            <h2>Flights and shipping movements</h2>
          </div>
          <small>{entities.length.toLocaleString()} freshest records shown</small>
        </header>
        <div className="transport-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mode</th>
                <th>Flight / vessel</th>
                <th>Route</th>
                <th>Country links</th>
                <th>Speed</th>
                <th>Altitude / status</th>
                <th>Seen</th>
              </tr>
            </thead>
            <tbody>
              {entities.slice(0, 160).map((entity) => (
                <tr
                  key={entity.id}
                  data-selected={selected?.id === entity.id || undefined}
                  onClick={() => void selectEntity(entity)}
                >
                  <td>
                    {entity.mode === "aviation" ? <Plane /> : <Anchor />}
                    {entity.mode === "aviation" ? "Air" : "Sea"}
                  </td>
                  <td>
                    <strong>
                      {entity.flight_number ??
                        entity.callsign ??
                        entity.display_name ??
                        entity.entity_id}
                    </strong>
                    <small>
                      {entity.mode === "aviation"
                        ? [entity.registration, entity.vehicle_type].filter(Boolean).join(" · ")
                        : `MMSI ${entity.entity_id}`}
                    </small>
                  </td>
                  <td>
                    <strong>{entity.route_label ?? "Resolving"}</strong>
                    <small>
                      {entity.origin_country_iso2 ?? entity.registration_country_iso2 ?? "—"} →{" "}
                      {entity.destination_country_iso2 ?? "—"}
                    </small>
                  </td>
                  <td>
                    <div className="transport-table-tags">
                      {entity.country_links.map((link) => (
                        <span key={`${entity.id}-${link.role}-${link.country}`}>
                          {link.country}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{formatNumber(entity.speed, " kt")}</td>
                  <td>
                    {entity.mode === "aviation"
                      ? formatNumber(entity.altitude, " ft")
                      : entity.status ?? "Under way"}
                  </td>
                  <td>{timeLabel(entity.observed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <footer className="transport-sources">
        <span>
          <Ship /> Maritime positions, voyage metadata, and vessel identifiers:{" "}
          <a href="https://aisstream.io" target="_blank" rel="noreferrer">
            AISstream <ExternalLink />
          </a>
        </span>
        <span>
          <Plane /> Flight positions, callsigns, and plausible airport routes:{" "}
          <a href="https://api.adsb.lol/docs" target="_blank" rel="noreferrer">
            adsb.lol (ODbL) <ExternalLink />
          </a>
        </span>
      </footer>
    </section>
  );
}
