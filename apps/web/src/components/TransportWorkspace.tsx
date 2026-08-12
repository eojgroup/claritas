import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import worldCountries from "world-countries";
import {
  AlertTriangle,
  Anchor,
  ArrowRight,
  ExternalLink,
  LocateFixed,
  Plane,
  RefreshCw,
  Route,
  Ship,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import TransportTrackingMap from "./TransportTrackingMap";
import {
  buildTransportScopeSignals,
  transportTimestamp,
} from "./transportWorkspacePresentation";
import {
  fetchTransportEntity,
  fetchTransportOverview,
  type TransportEntity,
  type TransportMode,
  type TransportOverview,
  type TransportTrackPoint,
} from "../lib/api";

type ModeFilter = TransportMode | "all";
type HistoryWindow = 7 | 30 | 90;
type Props = {
  initialCountry?: string | null;
};

type WorldCountryReference = {
  cca2?: string;
  name?: { common?: string };
};

const transportCountryOptions = (worldCountries as WorldCountryReference[])
  .flatMap((entry) => {
    const code = entry.cca2?.trim().toUpperCase();
    const name = entry.name?.common?.trim();
    return code && name ? [{ code, name }] : [];
  })
  .sort((left, right) => left.name.localeCompare(right.name));

function normalizedCountry(value: string | null | undefined) {
  const country = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(country) ? country : "";
}

function timeLabel(value: string | null | undefined) {
  return transportTimestamp(value)?.relative ?? "Awaiting data";
}

function exactTimeLabel(value: string | null | undefined) {
  return transportTimestamp(value)?.exact ?? "No timestamp received";
}

function historyDateLabel(value: string | null | undefined) {
  if (!value) return "No observations yet";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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
  if (coverage.primary_status === "upstream_stalled" || coverage.status === "upstream_stalled") {
    return coverage.fallback_last_snapshot_at
      ? "AISstream is connected but its upstream feed is silent; official regional fallback remains active"
      : "AISstream is connected but its upstream feed is silent; automatic recovery is active";
  }
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
    return `connected with ${coverage.subscription_boxes ?? 1} coverage area; global provider has not delivered AIS frames yet`;
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
  const [historyWindow, setHistoryWindow] = useState<HistoryWindow>(30);
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
        setError(null);
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
          corridorCountry: corridorCountry || undefined,
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
    [corridorCountry, country, mode],
  );

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(false), 60_000);
    return () => window.clearInterval(timer);
    // Selection is intentionally excluded: selecting a marker must not refetch
    // the entire workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corridorCountry, country, mode]);

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

  const history = overview?.history ?? null;
  const historySummary = history?.windows.find(
    (window) => window.days === historyWindow,
  );
  const historySeries = useMemo(() => {
    const corridorScoped = history?.scope === "corridor";
    return (history?.series ?? []).slice(-historyWindow).map((point) => ({
      ...point,
      label: new Date(point.bucket).toLocaleDateString([], {
        month: "short",
        day: "numeric",
      }),
      maritime: corridorScoped
        ? point.corridor_maritime_entities
        : point.maritime_entities,
      aviation: corridorScoped
        ? point.corridor_aviation_entities
        : point.aviation_entities,
      departures: corridorScoped ? null : point.ship_departures,
    }));
  }, [history, historyWindow]);
  const historySources = useMemo(
    () =>
      Array.from(
        new Set(historySeries.flatMap((point) => point.source_names)),
      ),
    [historySeries],
  );

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
  const scopeSignals = useMemo(
    () => buildTransportScopeSignals(overview, country, corridorCountry),
    [corridorCountry, country, overview],
  );
  const generatedTimestamp = transportTimestamp(overview?.generated_at);
  const aviationTimestamp = transportTimestamp(aviation?.latest_observed_at);
  const maritimeTimestamp = transportTimestamp(maritime?.latest_observed_at);
  const maritimeCoverage = overview?.coverage.maritime;
  const primaryMaritimeTimestamp = transportTimestamp(
    maritimeCoverage?.last_message_at ?? maritimeCoverage?.last_snapshot_at,
  );
  const fallbackMaritimeTimestamp = transportTimestamp(
    maritimeCoverage?.fallback_last_snapshot_at,
  );

  if (!country) {
    return (
      <section className="transport-workspace" aria-busy={false}>
        <div className="app-card-hero rounded-xl p-5 sm:p-7">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--shell-muted)]">
              Transport intelligence · scoped observations
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-[color:var(--shell-ink)]">
              Start with a country, then inspect its corridors and live positions
            </h1>
            <p className="mt-3 text-sm leading-6 text-[color:var(--shell-muted)]">
              Claritas does not present provider samples as a global traffic total. Choose a country to load vehicles with a current, origin, destination, flag, or registration relationship; then narrow to a two-country corridor or an individual location.
            </p>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(16rem,24rem)_1fr]">
            <label className="app-card rounded-xl p-4 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--shell-muted)]">
              Country scope
              <select
                aria-label="Choose transport country scope"
                value=""
                onChange={(event) => selectCountry(event.currentTarget.value)}
                className="mt-3 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-3 text-sm normal-case tracking-normal text-[color:var(--shell-ink)]"
              >
                <option value="">Choose a country…</option>
                {transportCountryOptions.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.name} ({entry.code})
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-3" aria-label="Transport investigation workflow">
              <article className="app-card rounded-xl p-4">
                <strong className="text-sm text-[color:var(--shell-ink)]">1 · Country relationship</strong>
                <p className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">See why each aircraft or vessel belongs in the selected scope.</p>
              </article>
              <article className="app-card rounded-xl p-4">
                <strong className="text-sm text-[color:var(--shell-ink)]">2 · Corridor signal</strong>
                <p className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">Compare directional activity and distinguish observed origins from proxy evidence.</p>
              </article>
              <article className="app-card rounded-xl p-4">
                <strong className="text-sm text-[color:var(--shell-ink)]">3 · Vehicle evidence</strong>
                <p className="mt-2 text-xs leading-5 text-[color:var(--shell-muted)]">Open the latest position, exact timestamp, route basis, and sampled trail.</p>
              </article>
            </div>
          </div>
        </div>
      </section>
    );
  }

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
            {transportCountryOptions.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name} ({entry.code})
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

      {overview && (
        <div className="transport-notice" role="status">
          <LocateFixed />
          <div>
            <strong>
              Observed scope: {selectedCountryInsight?.countryName ?? country}
              {selectedCorridor ? ` ↔ ${selectedCorridor.countryName}` : " and its resolved relationships"}
            </strong>
            <span>
              Snapshot {generatedTimestamp?.relative ?? "time unavailable"}
              {generatedTimestamp ? ` · ${generatedTimestamp.exact}` : ""}. Counts represent provider records linked to this scope, not complete national or global traffic.
            </span>
            <span>
              Aviation samples {overview.coverage.aviation.poll_areas} configured poll {overview.coverage.aviation.poll_areas === 1 ? "area" : "areas"}; maritime uses AISstream with Fintraffic as a regional fallback. Missing positions can reflect provider coverage, freshness limits, unresolved routes, or vessels outside the fallback region.
            </span>
          </div>
        </div>
      )}

      {maritimeCoverage && maritimeRuntimeLabel(maritimeCoverage) && (
        <div className="transport-notice" role="status">
          <Ship />
          <div>
            <strong>Maritime coverage is limited</strong>
            <span>{maritimeRuntimeLabel(maritimeCoverage)}.</span>
            <span>
              AISstream: {primaryMaritimeTimestamp ? `${primaryMaritimeTimestamp.relative} · ${primaryMaritimeTimestamp.exact}` : "no usable timestamp"}
              {fallbackMaritimeTimestamp ? ` · Fintraffic fallback: ${fallbackMaritimeTimestamp.relative} · ${fallbackMaritimeTimestamp.exact}` : ""}
            </span>
          </div>
        </div>
      )}

      {!loading && overview && (summary?.active ?? 0) === 0 && (
        <div className="transport-notice" role="status">
          <AlertTriangle />
          <div>
            <strong>No fresh drawable vehicles are linked to {country}</strong>
            <span>
              This is a coverage result, not evidence that transport has stopped. Try Combined mode, refresh the provider snapshot, or choose another country; routes can also remain unresolved until origin and destination metadata arrive.
            </span>
            <span>
              Aircraft latest: {aviationTimestamp ? `${aviationTimestamp.relative} · ${aviationTimestamp.exact}` : "not observed"} · vessel latest: {maritimeTimestamp ? `${maritimeTimestamp.relative} · ${maritimeTimestamp.exact}` : "not observed"}.
            </span>
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

      {scopeSignals.length > 0 && (
        <div className="transport-takeaway-grid" aria-label="Actionable scoped transport signals">
          {scopeSignals.map((signal) => (
            <article
              key={signal.id}
              data-direction={signal.emphasis === "attention" ? "up" : signal.emphasis === "change" ? "new" : "flat"}
            >
              <div>
                {signal.emphasis === "attention" ? <AlertTriangle /> : <Route />}
                <span>{signal.title}</span>
                <strong>{selectedCorridor ? `${country} ↔ ${selectedCorridor.country}` : country}</strong>
              </div>
              <p>{signal.summary}</p>
              <small>Investigative lead · validate against timestamp, route basis, and provider coverage below</small>
            </article>
          ))}
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

      {history && historySummary && (
        <section className="app-card transport-history-card" aria-label="Historical transport observations">
          <header>
            <div>
              <span>Persisted observation history</span>
              <h2>
                {history.scope === "corridor" && history.corridor_country
                  ? `${country} ↔ ${history.corridor_country} sampled activity`
                  : `${selectedCountryInsight?.countryName ?? country} sampled activity`}
              </h2>
              <p>
                Coverage {historyDateLabel(history.available_from)}–{historyDateLabel(history.available_to)} UTC · {history.observed_days} observed days currently retained
              </p>
            </div>
            <div className="transport-history-window" aria-label="History window">
              {([7, 30, 90] as const).map((days) => (
                <button
                  key={days}
                  type="button"
                  aria-pressed={historyWindow === days}
                  onClick={() => setHistoryWindow(days)}
                >
                  {days}d
                </button>
              ))}
            </div>
          </header>

          <div className="transport-history-layout">
            <div className="transport-history-chart">
              {historySummary.observed_days > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={historySeries} margin={{ top: 8, right: 8, bottom: 2, left: -10 }}>
                    <defs>
                      <linearGradient id="history-aviation-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#77A8BA" stopOpacity={0.58} />
                        <stop offset="100%" stopColor="#77A8BA" stopOpacity={0.03} />
                      </linearGradient>
                      <linearGradient id="history-maritime-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#EDA36A" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#EDA36A" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={30} />
                    <YAxis yAxisId="entities" tick={{ fontSize: 10 }} allowDecimals={false} />
                    {history.scope === "country" && (
                      <YAxis
                        yAxisId="movements"
                        orientation="right"
                        tick={{ fontSize: 10 }}
                        allowDecimals={false}
                      />
                    )}
                    <Tooltip
                      contentStyle={{
                        background: "var(--shell-surface-strong)",
                        border: "1px solid var(--shell-border)",
                        borderRadius: 8,
                      }}
                    />
                    <Legend />
                    {mode !== "maritime" && (
                      <Area
                        yAxisId="entities"
                        type="monotone"
                        dataKey="aviation"
                        name="Peak sampled aircraft"
                        stroke="#77A8BA"
                        fill="url(#history-aviation-fill)"
                        connectNulls={false}
                      />
                    )}
                    {mode !== "aviation" && (
                      <Area
                        yAxisId="entities"
                        type="monotone"
                        dataKey="maritime"
                        name="Peak sampled vessels"
                        stroke="#EDA36A"
                        fill="url(#history-maritime-fill)"
                        connectNulls={false}
                      />
                    )}
                    {history.scope === "country" && mode !== "aviation" && (
                      <Bar
                        yAxisId="movements"
                        dataKey="departures"
                        name="Port departures"
                        fill="var(--signal-amber)"
                        opacity={0.55}
                        maxBarSize={12}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="transport-chart-empty">
                  {history.scope === "corridor"
                    ? "Corridor history starts when this release records the first vehicle with both endpoints resolved."
                    : "No persisted observations fall inside this window yet."}
                </div>
              )}
            </div>

            <div className="transport-history-metrics">
              <article>
                <span>Average observed day</span>
                <strong>
                  {historySummary.average_daily_entities == null
                    ? "—"
                    : historySummary.average_daily_entities.toLocaleString()}
                </strong>
                <small>Daily peak sampled vehicles, not daily-unique; days without samples are excluded</small>
              </article>
              <article>
                <span>Peak observed day</span>
                <strong>{historySummary.peak_daily_entities?.value.toLocaleString() ?? "—"}</strong>
                <small>{historyDateLabel(historySummary.peak_daily_entities?.bucket)}</small>
              </article>
              <article>
                <span>Coverage in {historyWindow}d window</span>
                <strong>{historySummary.observed_days}/{historyWindow} days</strong>
                <small>{historySummary.observation_hours.toLocaleString()} provider-observation hours</small>
              </article>
              <article>
                <span>{history.scope === "corridor" ? "Resolved origin evidence" : "Monitored port flow"}</span>
                <strong>
                  {history.scope === "corridor"
                    ? historySummary.observed_origin_share == null
                      ? "—"
                      : `${historySummary.observed_origin_share.toFixed(1)}% direct`
                    : `${(historySummary.ship_departures ?? 0).toLocaleString()} out · ${(historySummary.ship_arrivals ?? 0).toLocaleString()} in`}
                </strong>
                <small>
                  {history.scope === "corridor"
                    ? "Remainder uses maritime flag state as an explicitly labelled proxy"
                    : `${(historySummary.cargo_vessel_departures ?? 0).toLocaleString()} cargo/tanker departure observations`}
                </small>
              </article>
            </div>
          </div>
          <footer>
            <span>{history.methodology}</span>
            <span>
              Sources in this window: {historySources.length > 0 ? historySources.join(", ") : "none observed"}. Retention policy: {history.retention_days} days.
            </span>
          </footer>
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
              Flights {aviationTimestamp?.relative ?? "awaiting data"}
              {aviationTimestamp ? ` (${aviationTimestamp.exact})` : ""} · vessels {maritimeTimestamp?.relative ?? "awaiting data"}
              {maritimeTimestamp ? ` (${maritimeTimestamp.exact})` : ""}
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
                    {exactTimeLabel(selected.observed_at)} · {track.length} sampled trail points
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
                            {timeLabel(entity.observed_at)} · {exactTimeLabel(entity.observed_at)}
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
                No resolved {selectedCorridor ? `${country} ↔ ${selectedCorridor.country}` : country} route is available in this snapshot. AIS destinations and plausible flight airport pairs appear only after both endpoints resolve; flag-state links remain contextual rather than a route.
              </div>
            )}
          </div>
        </article>

        <article className="app-card transport-country-list">
          <header>
            <div>
              <span>Normalized activity with drill-in</span>
              <h2>Countries connected to this observed scope</h2>
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
                  <td>
                    {timeLabel(entity.observed_at)}
                    <small>{exactTimeLabel(entity.observed_at)}</small>
                  </td>
                </tr>
              ))}
              {displayedEntities.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    No fresh vehicle records match {selectedCorridor ? `${country} ↔ ${selectedCorridor.country}` : country}. This can reflect provider silence, geographic sampling, route-resolution delay, or the selected mode—not a confirmed absence of traffic.
                  </td>
                </tr>
              )}
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
