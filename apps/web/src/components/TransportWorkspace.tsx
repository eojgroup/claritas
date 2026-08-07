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
type Props = {
  initialCountry?: string | null;
};

function normalizedCountry(value: string | null | undefined) {
  const country = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(country) ? country : "";
}

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

function maritimeRuntimeLabel(
  coverage: TransportOverview["coverage"]["maritime"] | undefined,
): string | null {
  if (!coverage) return null;
  if (coverage.status === "disabled") return "server credential not configured";
  if (coverage.last_error) return "provider stream error detected; reconnecting automatically";
  if (coverage.persistence_error) {
    return `database write retry active · ${coverage.queue_depth.toLocaleString()} snapshots queued`;
  }
  if (coverage.status === "live") return null;
  if (coverage.queue_depth > 0) {
    return `incrementally persisting ${coverage.queue_depth.toLocaleString()} queued vessel snapshots`;
  }
  if (coverage.fallback_error && coverage.messages_received === 0) {
    return "global AIS is silent and the official Baltic fallback is retrying";
  }
  if (coverage.connected && coverage.messages_received === 0) {
    return `connected on coverage batch ${coverage.subscription_batch}/${coverage.subscription_batches}; global provider has not delivered AIS frames yet`;
  }
  if (coverage.messages_received > 0 && coverage.snapshots_accepted === 0) {
    return `${coverage.messages_received.toLocaleString()} AIS frames received; awaiting a usable vessel position`;
  }
  if (coverage.status === "receiving") return "receiving and processing AIS messages";
  if (coverage.status === "connecting") return "connected and awaiting AIS messages";
  return "reconnecting after an idle or interrupted stream";
}

function entityLinksCountry(entity: TransportEntity, country: string) {
  const iso = country.trim().toUpperCase();
  return entity.country_links.some(
    (link) => link.country.trim().toUpperCase() === iso,
  );
}

function entityLinksCorridor(
  entity: TransportEntity,
  firstCountry: string,
  secondCountry: string,
) {
  const first = firstCountry.trim().toUpperCase();
  const second = secondCountry.trim().toUpperCase();
  const origin =
    entity.origin_country_iso2?.trim().toUpperCase() ??
    (entity.mode === "maritime"
      ? entity.registration_country_iso2?.trim().toUpperCase()
      : undefined);
  const destination = entity.destination_country_iso2?.trim().toUpperCase();
  return (
    (origin === first && destination === second) ||
    (origin === second && destination === first)
  );
}

function entityIdentifier(entity: TransportEntity) {
  return (
    entity.flight_number ??
    entity.callsign ??
    entity.display_name ??
    entity.entity_id
  );
}

function countryConnection(entity: TransportEntity, country: string) {
  const iso = country.trim().toUpperCase();
  const originIsCountry = entity.origin_country_iso2?.trim().toUpperCase() === iso;
  const destinationIsCountry =
    entity.destination_country_iso2?.trim().toUpperCase() === iso;
  const currentIsCountry = entity.current_country_iso2?.trim().toUpperCase() === iso;
  const registrationIsCountry =
    entity.registration_country_iso2?.trim().toUpperCase() === iso;
  const originLabel =
    entity.origin_name ??
    entity.origin_country_iso2 ??
    (entity.mode === "maritime" && entity.registration_country_iso2
      ? `${entity.registration_country_iso2} flag proxy`
      : "Origin resolving");
  const destinationLabel =
    entity.destination_name ??
    entity.destination_country_iso2 ??
    "Destination resolving";

  if (originIsCountry && destinationIsCountry) {
    return {
      role: "domestic",
      label: "Domestic",
      description: `${iso} origin and destination`,
      rank: 0,
    };
  }
  if (destinationIsCountry) {
    return {
      role: "inbound",
      label: "Inbound",
      description: `${originLabel} → ${iso}`,
      rank: 0,
    };
  }
  if (originIsCountry) {
    return {
      role: "outbound",
      label: "Outbound",
      description: `${iso} → ${destinationLabel}`,
      rank: 1,
    };
  }
  if (currentIsCountry) {
    return {
      role: "current",
      label: "In country",
      description: entity.destination_country_iso2
        ? `Current position · onward to ${destinationLabel}`
        : "Current position link · route resolving",
      rank: 2,
    };
  }
  if (registrationIsCountry) {
    return {
      role: "registration",
      label: entity.mode === "maritime" ? "Flag-linked" : "Registered",
      description:
        entity.mode === "maritime"
          ? `${iso} vessel flag · ${destinationLabel}`
          : `${iso} aircraft registration · route resolving`,
      rank: 3,
    };
  }
  return {
    role: "linked",
    label: "Country-linked",
    description: `Linked to ${iso} · route resolving`,
    rank: 4,
  };
}

export default function TransportWorkspace({ initialCountry }: Props) {
  const [overview, setOverview] = useState<TransportOverview | null>(null);
  const [mode, setMode] = useState<ModeFilter>("all");
  const [country, setCountry] = useState<string>(() => normalizedCountry(initialCountry));
  const [corridorCountry, setCorridorCountry] = useState("");
  const [selected, setSelected] = useState<TransportEntity | null>(null);
  const [track, setTrack] = useState<TransportTrackPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingEntity, setLoadingEntity] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overviewRequestRef = useRef(0);
  const selectionRequestRef = useRef(0);
  const selectedRef = useRef<TransportEntity | null>(null);

  useEffect(() => {
    const nextCountry = normalizedCountry(initialCountry);
    if (nextCountry) {
      setCountry(nextCountry);
      setCorridorCountry("");
    }
  }, [initialCountry]);

  const load = useCallback(
    async (force = false) => {
      const requestId = overviewRequestRef.current + 1;
      overviewRequestRef.current = requestId;
      if (!country) {
        setOverview(null);
        setError("Choose a country to load transport intelligence.");
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (force) setRefreshing(true);
      else setLoading(true);
      try {
        const value = await fetchTransportOverview({
          detail: "full",
          mode: mode === "all" ? undefined : mode,
          country,
          entityLimit: 1_200,
          refresh: force,
        });
        if (overviewRequestRef.current !== requestId) return;
        setOverview(value);
        setError(null);
      } catch (reason) {
        if (overviewRequestRef.current !== requestId) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (overviewRequestRef.current === requestId) {
          setLoading(false);
          setRefreshing(false);
        }
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

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    const current = selectedRef.current;
    if (!current || !overview) return;
    const refreshed = overview.entities.find((entity) => entity.id === current.id);
    if (refreshed && refreshed.observed_at !== current.observed_at) {
      void selectEntity(refreshed);
    }
  }, [overview, selectEntity]);

  const clearSelection = useCallback(() => {
    selectionRequestRef.current += 1;
    setSelected(null);
    setTrack([]);
    setLoadingEntity(false);
  }, []);

  const selectCountry = useCallback(
    (nextCountry: string) => {
      clearSelection();
      const normalized = normalizedCountry(nextCountry);
      if (!normalized) return;
      setCountry(normalized);
      setCorridorCountry("");
    },
    [clearSelection],
  );

  const selectCorridorCountry = useCallback(
    (nextCountry: string) => {
      clearSelection();
      setCorridorCountry(nextCountry.trim().toUpperCase());
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
      (overview?.activity_ranking?.countries ?? []).slice(0, 12).map((entry) => ({
        ...entry,
        vessels: entry.current.ship_movements,
        flights: entry.current.tracked_flights,
      })),
    [overview],
  );
  const activityRankingByCountry = useMemo(
    () =>
      new Map(
        (overview?.activity_ranking?.countries ?? []).map((entry) => [
          entry.country.trim().toUpperCase(),
          entry,
        ]),
      ),
    [overview],
  );

  const selectedCountryInsight = useMemo(() => {
    if (!country) return null;
    const iso = country.trim().toUpperCase();
    const linkedEntities = (overview?.entities ?? [])
      .filter((entity) => entityLinksCountry(entity, iso))
      .sort((left, right) => {
        if (left.is_alert !== right.is_alert) return left.is_alert ? -1 : 1;
        const roleDifference =
          countryConnection(left, iso).rank - countryConnection(right, iso).rank;
        if (roleDifference !== 0) return roleDifference;
        return (
          new Date(right.observed_at).getTime() -
          new Date(left.observed_at).getTime()
        );
      });
    const selectedRoutes = (overview?.routes ?? []).filter(
      (route) =>
        route.origin_country.trim().toUpperCase() === iso ||
        route.destination_country.trim().toUpperCase() === iso,
    );
    const counterparties = new Map<
      string,
      {
        country: string;
        name: string;
        active: number;
        aviation: number;
        maritime: number;
      }
    >();
    let inbound = 0;
    let outbound = 0;
    for (const route of selectedRoutes) {
      const isOutbound = route.origin_country.trim().toUpperCase() === iso;
      const isInbound = route.destination_country.trim().toUpperCase() === iso;
      if (isOutbound) outbound += route.active_count;
      if (isInbound) inbound += route.active_count;
      const counterpartCountry = isOutbound
        ? route.destination_country.trim().toUpperCase()
        : route.origin_country.trim().toUpperCase();
      if (counterpartCountry === iso) continue;
      const counterpartName = isOutbound
        ? route.destination_name
        : route.origin_name;
      const current = counterparties.get(counterpartCountry) ?? {
        country: counterpartCountry,
        name: counterpartName,
        active: 0,
        aviation: 0,
        maritime: 0,
      };
      current.active += route.active_count;
      current[route.mode] += route.active_count;
      counterparties.set(counterpartCountry, current);
    }
    const rankedCounterparties = Array.from(counterparties.values()).sort(
      (left, right) => right.active - left.active,
    );
    const strongestCounterparty = rankedCounterparties[0] ?? null;
    const currentEntities = linkedEntities.filter(
      (entity) => entity.current_country_iso2?.trim().toUpperCase() === iso,
    );
    const completeRoutes = linkedEntities.filter(
      (entity) =>
        entity.origin_country_iso2 && entity.destination_country_iso2,
    ).length;
    const proxyOnly = linkedEntities.filter((entity) => {
      const roles = entity.country_links.filter(
        (link) => link.country.trim().toUpperCase() === iso,
      );
      return (
        roles.length > 0 &&
        roles.every(
          (link) => link.role === "flag" || link.role === "registration",
        )
      );
    }).length;
    const countryEntry = (overview?.countries ?? []).find(
      (entry) => entry.country.trim().toUpperCase() === iso,
    );

    return {
      countryName: countryEntry?.country_name ?? iso,
      linkedEntities,
      inbound,
      outbound,
      strongestCounterparty,
      counterparties: rankedCounterparties,
      currentEntities,
      completeRoutes,
      proxyOnly,
    };
  }, [country, overview]);

  const selectedCorridor = useMemo(() => {
    if (!country || !corridorCountry) return null;
    const first = country.trim().toUpperCase();
    const second = corridorCountry.trim().toUpperCase();
    const routes = (overview?.routes ?? []).filter((route) => {
      const origin = route.origin_country.trim().toUpperCase();
      const destination = route.destination_country.trim().toUpperCase();
      return (
        (origin === first && destination === second) ||
        (origin === second && destination === first)
      );
    });
    const entities = (overview?.entities ?? [])
      .filter((entity) => entityLinksCorridor(entity, first, second))
      .sort((left, right) => {
        if (left.is_alert !== right.is_alert) return left.is_alert ? -1 : 1;
        return (
          new Date(right.observed_at).getTime() -
          new Date(left.observed_at).getTime()
        );
      });
    const active = routes.reduce((total, route) => total + route.active_count, 0);
    const outbound = routes.reduce(
      (total, route) =>
        total +
        (route.origin_country.trim().toUpperCase() === first
          ? route.active_count
          : 0),
      0,
    );
    const inbound = routes.reduce(
      (total, route) =>
        total +
        (route.origin_country.trim().toUpperCase() === second
          ? route.active_count
          : 0),
      0,
    );
    const aviation = routes.reduce(
      (total, route) =>
        total + (route.mode === "aviation" ? route.active_count : 0),
      0,
    );
    const maritime = routes.reduce(
      (total, route) =>
        total + (route.mode === "maritime" ? route.active_count : 0),
      0,
    );
    const observed = routes.reduce(
      (total, route) =>
        total + (route.origin_basis === "observed" ? route.active_count : 0),
      0,
    );
    const flagFallback = routes.reduce(
      (total, route) =>
        total + (route.origin_basis === "flag_fallback" ? route.active_count : 0),
      0,
    );
    const mixed = routes.reduce(
      (total, route) =>
        total + (route.origin_basis === "mixed" ? route.active_count : 0),
      0,
    );
    const counterpart = selectedCountryInsight?.counterparties.find(
      (entry) => entry.country === second,
    );
    const countryEntry = (overview?.countries ?? []).find(
      (entry) => entry.country.trim().toUpperCase() === second,
    );
    const countryRoutedTotal =
      (selectedCountryInsight?.inbound ?? 0) +
      (selectedCountryInsight?.outbound ?? 0);

    return {
      country: second,
      countryName: counterpart?.name ?? countryEntry?.country_name ?? second,
      routes,
      entities,
      active,
      outbound,
      inbound,
      aviation,
      maritime,
      observed,
      flagFallback,
      mixed,
      alerts: entities.filter((entity) => entity.is_alert).length,
      networkShare:
        countryRoutedTotal > 0 ? (active / countryRoutedTotal) * 100 : null,
    };
  }, [corridorCountry, country, overview, selectedCountryInsight]);

  const entities = overview?.entities ?? [];
  const summary = overview?.summary;
  const maritime = summary?.modes.maritime;
  const aviation = summary?.modes.aviation;
  const displayedEntities = selectedCorridor?.entities ?? entities;
  const displayedRoutes = selectedCorridor?.routes ?? overview?.routes ?? [];

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
                setCorridorCountry("");
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
            {(overview?.countries ?? []).map((entry) => (
              <option key={entry.country} value={entry.country}>
                {entry.country_name} ({entry.country})
              </option>
            ))}
          </select>
        </label>

        {selectedCountryInsight && (
          <label>
            Corridor with
            <select
              value={corridorCountry}
              onChange={(event) =>
                selectCorridorCountry(event.currentTarget.value)
              }
            >
              <option value="">All country connections</option>
              {selectedCountryInsight.counterparties.map((entry) => (
                <option key={entry.country} value={entry.country}>
                  {entry.name} ({entry.country}) · {entry.active}
                </option>
              ))}
            </select>
          </label>
        )}

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
        {selectedCorridor ? (
          <>
            <article>
              <span>Total active corridor</span>
              <strong>{selectedCorridor.active.toLocaleString()}</strong>
              <small>
                {selectedCorridor.aviation} flights · {selectedCorridor.maritime} vessels
              </small>
            </article>
            <article>
              <span>{country} → {selectedCorridor.country}</span>
              <strong>{selectedCorridor.outbound.toLocaleString()}</strong>
              <small>Resolved movements from {country}</small>
            </article>
            <article>
              <span>{selectedCorridor.country} → {country}</span>
              <strong>{selectedCorridor.inbound.toLocaleString()}</strong>
              <small>Resolved movements into {country}</small>
            </article>
            <article data-alert={selectedCorridor.alerts > 0 || undefined}>
              <span>Selectable live records</span>
              <strong>{selectedCorridor.entities.length.toLocaleString()}</strong>
              <small>{selectedCorridor.alerts} safety signals in this corridor</small>
            </article>
          </>
        ) : selectedCountryInsight ? (
          <>
            <article>
              <span>Country-linked now</span>
              <strong>{summary?.active.toLocaleString() ?? "—"}</strong>
              <small>
                {aviation?.active ?? 0} flights · {maritime?.active ?? 0} vessels
              </small>
            </article>
            <article>
              <span>Resolved arrivals</span>
              <strong>{selectedCountryInsight.inbound.toLocaleString()}</strong>
              <small>Active destination links into {country}</small>
            </article>
            <article>
              <span>Resolved departures</span>
              <strong>{selectedCountryInsight.outbound.toLocaleString()}</strong>
              <small>Active origin links from {country}</small>
            </article>
            <article data-alert={(summary?.alerts ?? 0) > 0 || undefined}>
              <span>Currently in country</span>
              <strong>{selectedCountryInsight.currentEntities.length}</strong>
              <small>{summary?.alerts ?? 0} safety signals in country scope</small>
            </article>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>

      {!selectedCorridor && (
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
      )}

      {!selectedCorridor &&
        (overview?.activity_ranking?.highlights?.length ?? 0) > 0 && (
          <section
            className="transport-ranking-summary"
            aria-label="Current country transport ranking highlights"
          >
            <header>
              <div>
                <span>Country activity index · current 24 hours</span>
                <h2>What stands out now</h2>
              </div>
              <Route />
            </header>
            <div>
              {overview!.activity_ranking.highlights.slice(0, 3).map((highlight, index) => (
                <article key={`transport-ranking-highlight-${index}`}>
                  <b>0{index + 1}</b>
                  <p>{highlight}</p>
                </article>
              ))}
            </div>
            <small>{overview!.activity_ranking.methodology.coverage}</small>
          </section>
        )}

      {selectedCountryInsight && (
        <section
          className="transport-country-insights"
          aria-label={
            selectedCorridor
              ? `${selectedCountryInsight.countryName} and ${selectedCorridor.countryName} transport corridor`
              : `${selectedCountryInsight.countryName} transport connections`
          }
        >
          {selectedCorridor ? (
            <>
              <article>
                <span>Flights on corridor</span>
                <strong>{selectedCorridor.aviation.toLocaleString()}</strong>
                <small>Resolved aircraft routes in either direction</small>
              </article>
              <article>
                <span>Vessels on corridor</span>
                <strong>{selectedCorridor.maritime.toLocaleString()}</strong>
                <small>Resolved vessel routes in either direction</small>
              </article>
              <article>
                <span>Share of country network</span>
                <strong>
                  {selectedCorridor.networkShare == null
                    ? "—"
                    : `${selectedCorridor.networkShare.toFixed(1)}%`}
                </strong>
                <small>Share of {country}'s resolved inbound + outbound flow</small>
              </article>
              <article>
                <span>Origin evidence</span>
                <strong>
                  {selectedCorridor.observed} observed · {selectedCorridor.flagFallback} proxy
                </strong>
                <small>
                  {selectedCorridor.mixed > 0
                    ? `${selectedCorridor.mixed} additional movements use mixed origin evidence`
                    : "No mixed-origin aggregate in this corridor"}
                </small>
              </article>
            </>
          ) : (
            <>
              {selectedCountryInsight.strongestCounterparty ? (
                <button
                  type="button"
                  className="transport-country-insight-action"
                  onClick={() =>
                    selectCorridorCountry(
                      selectedCountryInsight.strongestCounterparty!.country,
                    )
                  }
                >
                  <span>Most connected country</span>
                  <strong>
                    {selectedCountryInsight.strongestCounterparty.name} ({selectedCountryInsight.strongestCounterparty.country})
                  </strong>
                  <small>
                    {selectedCountryInsight.strongestCounterparty.active} active · select to view corridor total
                    <ArrowRight />
                  </small>
                </button>
              ) : (
                <article>
                  <span>Most connected country</span>
                  <strong>Resolving</strong>
                  <small>No resolved counterpart route in this scope</small>
                </article>
              )}
              <article>
                <span>Network reach</span>
                <strong>{selectedCountryInsight.counterparties.length}</strong>
                <small>Countries with a resolved inbound or outbound route</small>
              </article>
              <article>
                <span>Full route data</span>
                <strong>
                  {selectedCountryInsight.linkedEntities.length > 0
                    ? `${selectedCountryInsight.completeRoutes}/${selectedCountryInsight.linkedEntities.length}`
                    : "—"}
                </strong>
                <small>Live records with both origin and destination identified</small>
              </article>
              <article>
                <span>Direct country basis</span>
                <strong>
                  {Math.max(
                    0,
                    selectedCountryInsight.linkedEntities.length -
                      selectedCountryInsight.proxyOnly,
                  )}/{selectedCountryInsight.linkedEntities.length}
                </strong>
                <small>
                  {selectedCountryInsight.proxyOnly} flag/registration-only links
                </small>
              </article>
            </>
          )}
        </section>
      )}

      <div className="transport-map-stage">
        <div className="transport-map-panel">
          <header>
            <div>
              <span>Live tracking</span>
              <h2>
                {selectedCorridor
                  ? `${selectedCountryInsight?.countryName ?? country} ↔ ${selectedCorridor.countryName}`
                  : selectedCountryInsight
                    ? `${selectedCountryInsight.countryName} (${country}) connections`
                    : `${country} connections`}
              </h2>
            </div>
            <small>
              {selectedCorridor
                ? `${selectedCorridor.active} total active · ${selectedCorridor.outbound} ${country} → ${selectedCorridor.country} · ${selectedCorridor.inbound} ${selectedCorridor.country} → ${country} · `
                : selectedCountryInsight
                  ? `${selectedCountryInsight.linkedEntities.length} linked vehicles · ${selectedCountryInsight.inbound} inbound · ${selectedCountryInsight.outbound} outbound · `
                  : ""}
              Flights {timeLabel(aviation?.latest_observed_at)} · vessels {timeLabel(maritime?.latest_observed_at)}
            </small>
          </header>
          <TransportTrackingMap
            entities={entities}
            routes={overview?.routes}
            selectedCountry={country}
            comparisonCountry={corridorCountry}
            mode={mode}
            selectedId={selected?.id}
            track={track}
            onSelect={(entity) => void selectEntity(entity)}
            onCountrySelect={selectCorridorCountry}
          />
        </div>

        <aside className="transport-detail-panel" aria-busy={loadingEntity}>
          {selected ? (
            <>
              <div className="transport-detail-title">
                <span>
                  {selected.mode === "aviation" ? "Following flight" : "Following vessel"}
                </span>
                <h2>{selected.display_name ?? selected.entity_id}</h2>
                <p>
                  {selected.route_label ??
                    selected.current_location_name ??
                    selected.status ??
                    "Route is being resolved"}
                </p>
                <button type="button" onClick={clearSelection}>
                  Back to {selectedCorridor
                    ? `${country} ↔ ${selectedCorridor.country}`
                    : country
                      ? `${country} flows`
                      : "all live vehicles"}
                </button>
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
          ) : selectedCountryInsight ? (
            <div className="transport-country-connections">
              <header>
                <span>Connected movements</span>
                <h2>
                  {selectedCorridor
                    ? `${selectedCorridor.entities.length} live on ${country} ↔ ${selectedCorridor.country}`
                    : `${selectedCountryInsight.linkedEntities.length} linked to ${country}`}
                </h2>
                <p>
                  {selectedCorridor
                    ? "Only vehicles with a resolved route between the two selected countries are shown. Select one to follow it on the map."
                    : "Each live record below shows the country role that placed it in this view. Select one to follow it on the map."}
                </p>
              </header>
              <div className="transport-country-vehicle-list">
                {(selectedCorridor?.entities ?? selectedCountryInsight.linkedEntities)
                  .slice(0, 60)
                  .map((entity) => {
                    const connection = countryConnection(entity, country);
                    return (
                      <button
                        type="button"
                        key={`country-connection-${entity.id}`}
                        onClick={() => void selectEntity(entity)}
                        data-alert={entity.is_alert || undefined}
                      >
                        <i data-mode={entity.mode}>
                          {entity.mode === "aviation" ? <Plane /> : <Ship />}
                        </i>
                        <span>
                          <strong>{entityIdentifier(entity)}</strong>
                          <small>{connection.description}</small>
                          <small>
                            {entity.mode === "aviation" ? "Flight" : "Vessel"} · seen{" "}
                            {timeLabel(entity.observed_at)}
                          </small>
                        </span>
                        <em data-role={connection.role}>{connection.label}</em>
                      </button>
                    );
                  })}
                {(selectedCorridor?.entities ?? selectedCountryInsight.linkedEntities)
                  .length === 0 && (
                  <div className="transport-country-connections-empty">
                    <LocateFixed />
                    <strong>
                      {selectedCorridor
                        ? "No selectable live records for this corridor"
                        : "No linked vehicles in the live freshness window"}
                    </strong>
                    <small>
                      {selectedCorridor
                        ? "The aggregate total can exceed the live list when a routed snapshot lacks a drawable current position or the detail limit is reached."
                        : "Country corridors may still be visible when aggregate route evidence is available."}
                    </small>
                  </div>
                )}
              </div>
              {(selectedCorridor?.entities ?? selectedCountryInsight.linkedEntities)
                .length > 60 && (
                <small className="transport-country-connections-limit">
                  Showing the 60 freshest of{" "}
                  {(selectedCorridor?.entities ?? selectedCountryInsight.linkedEntities)
                    .length.toLocaleString()} linked vehicles.
                </small>
              )}
            </div>
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

      {!selectedCorridor && (
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
                <div className="transport-chart-empty">
                  Trail sampling is building the 24-hour baseline.
                </div>
              )}
            </div>
          </article>

          <article className="app-card transport-chart-card">
            <header>
              <div>
                <span>Country relationships</span>
                <h2>Most active countries · 24 hours</h2>
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
                <div className="transport-chart-empty">
                  No comparable country activity in the current scope.
                </div>
              )}
            </div>
          </article>
        </div>
      )}

      <div className="transport-lower-grid">
        <article className="app-card transport-routes-card">
          <header>
            <div>
              <span>Network diagram</span>
              <h2>
                {selectedCorridor
                  ? `${country} ↔ ${selectedCorridor.country} route totals`
                  : "Leading live corridors"}
              </h2>
            </div>
            <Route />
          </header>
          <div className="transport-flow-list">
            {displayedRoutes.slice(0, 12).map((route) => (
              <button
                type="button"
                key={`${route.mode}-${route.origin_country}-${route.destination_country}`}
                onClick={() => {
                  const origin = route.origin_country.trim().toUpperCase();
                  const destination = route.destination_country.trim().toUpperCase();
                  const selectedIso = country.trim().toUpperCase();
                  if (selectedIso && (origin === selectedIso || destination === selectedIso)) {
                    selectCorridorCountry(
                      origin === selectedIso ? destination : origin,
                    );
                    return;
                  }
                  selectCountry(destination);
                }}
              >
                <span className="transport-flow-node">
                  <b>{route.origin_country}</b>
                  <small>
                    {route.origin_name}
                    {route.origin_basis === "flag_fallback"
                      ? " · flag proxy"
                      : route.origin_basis === "mixed"
                        ? " · some flag proxy"
                        : ""}
                  </small>
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
            {displayedRoutes.length === 0 && (
              <div className="transport-chart-empty">
                Routes appear as AIS destinations and plausible flight airport pairs resolve.
              </div>
            )}
          </div>
        </article>

        <article className="app-card transport-country-list">
          <header>
            <div>
              <span>Normalized activity with drill-in</span>
              <h2>Country transport activity ranking</h2>
            </div>
            <small title={overview?.activity_ranking?.methodology.index}>
              Index blends live links, ship movements, and tracked flights
            </small>
          </header>
          <div className="transport-country-scroll">
            {(overview?.countries ?? []).slice(0, 18).map((entry) => {
              const entryIso = entry.country.trim().toUpperCase();
              const ranking = activityRankingByCountry.get(entryIso);
              const isPrimary = entryIso === country.trim().toUpperCase();
              const isCounterparty = Boolean(
                selectedCountryInsight?.counterparties.some(
                  (counterparty) => counterparty.country === entryIso,
                ),
              );
              return (
                <button
                  type="button"
                  key={entry.country}
                  onClick={() => {
                    if (isPrimary) {
                      if (corridorCountry) selectCorridorCountry("");
                      return;
                    }
                    if (country && !isPrimary && isCounterparty) {
                      selectCorridorCountry(entryIso);
                      return;
                    }
                    selectCountry(entryIso);
                  }}
                  aria-pressed={isPrimary || corridorCountry === entryIso}
                  title={
                    isPrimary && corridorCountry
                      ? `Return to all ${country} connections`
                      : isPrimary
                        ? `${country} is the current country scope`
                        : country && isCounterparty
                          ? `View ${country} ↔ ${entryIso} corridor`
                          : `Select ${entry.country_name}`
                  }
                >
                  <span>
                    <b>
                      {ranking ? `#${ranking.rank} ` : ""}{entry.country}
                    </b>
                    <small>{entry.country_name}</small>
                  </span>
                  <span>
                    <small>Activity index</small>
                    <b>{ranking ? `${ranking.activity_index.toFixed(1)}/100` : "—"}</b>
                  </span>
                  <span>
                    <small>24h tracked</small>
                    <b>{ranking?.current.observed_movements ?? 0}</b>
                  </span>
                  <span>
                    <small>vs prior 24h</small>
                    <b>
                      {ranking
                        ? changeLabel(
                            ranking.momentum.change_pct,
                            ranking.momentum.direction,
                          )
                        : "—"}
                    </b>
                  </span>
                </button>
              );
            })}
          </div>
        </article>
      </div>

      {!selectedCorridor && (
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
      )}

      <article className="app-card transport-entity-table">
        <header>
          <div>
            <span>Live identifiers</span>
            <h2>
              {selectedCorridor
                ? `${country} ↔ ${selectedCorridor.country} movements`
                : "Flights and shipping movements"}
            </h2>
          </div>
          <small>{displayedEntities.length.toLocaleString()} freshest records shown</small>
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
              {displayedEntities.slice(0, 160).map((entity) => (
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
          <Ship /> Baltic AIS fallback: {" "}
          <a
            href="https://www.digitraffic.fi/en/marine-traffic/"
            target="_blank"
            rel="noreferrer"
          >
            Fintraffic Digitraffic (CC BY 4.0) <ExternalLink />
          </a>
        </span>
        {maritimeRuntimeLabel(overview?.coverage.maritime) && (
          <span>
            <RefreshCw /> Maritime feed:{" "}
            {maritimeRuntimeLabel(overview?.coverage.maritime)}
          </span>
        )}
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
