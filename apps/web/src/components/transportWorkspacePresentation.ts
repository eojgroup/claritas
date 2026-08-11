import type { TransportOverview } from "../lib/api";

export type TransportScopeSignal = {
  id: string;
  title: string;
  summary: string;
  emphasis: "attention" | "change" | "relationship" | "coverage";
};

export function transportTimestamp(
  value: string | null | undefined,
  now = Date.now(),
  locale?: string,
  timeZone?: string,
): { relative: string; exact: string } | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1_000));
  const relative = seconds < 60
    ? `${seconds}s ago`
    : seconds < 3_600
      ? `${Math.round(seconds / 60)}m ago`
      : seconds < 86_400
        ? `${Math.round(seconds / 3_600)}h ago`
        : `${Math.round(seconds / 86_400)}d ago`;
  const exact = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
  return { relative, exact };
}

function iso(value: string) {
  return value.trim().toUpperCase();
}

function routeTouchesCountry(
  route: TransportOverview["routes"][number],
  country: string,
) {
  return iso(route.origin_country) === country || iso(route.destination_country) === country;
}

function entityTouchesCountry(
  entity: TransportOverview["entities"][number],
  country: string,
) {
  return entity.country_links.some((link) => iso(link.country) === country)
    || iso(entity.current_country_iso2 ?? "") === country
    || iso(entity.origin_country_iso2 ?? "") === country
    || iso(entity.destination_country_iso2 ?? "") === country
    || iso(entity.registration_country_iso2 ?? "") === country;
}

export function buildTransportScopeSignals(
  overview: TransportOverview | null,
  countryValue: string,
  corridorValue = "",
): TransportScopeSignal[] {
  if (!overview) return [];
  const country = iso(countryValue);
  const corridor = iso(corridorValue);
  if (!/^[A-Z]{2}$/.test(country)) return [];
  const routes = overview.routes.filter((route) => {
    if (!routeTouchesCountry(route, country)) return false;
    if (!corridor) return true;
    return routeTouchesCountry(route, corridor);
  });
  const linkedEntities = overview.entities.filter((entity) => {
    return entityTouchesCountry(entity, country)
      && (!corridor || entityTouchesCountry(entity, corridor));
  });
  const signals: TransportScopeSignal[] = [];
  const alerts = linkedEntities.filter((entity) => entity.is_alert);
  if (alerts.length) {
    signals.push({
      id: "safety-state",
      title: `Review ${alerts.length} live safety ${alerts.length === 1 ? "state" : "states"}`,
      summary: `Emergency or navigational flags are present in the ${corridor ? `${country} ↔ ${corridor} corridor` : `${country} country-linked scope`}. Open a vehicle record before drawing operational conclusions.`,
      emphasis: "attention",
    });
  }

  const ranking = overview.activity_ranking.countries.find(
    (entry) => iso(entry.country) === country,
  );
  if (!corridor && ranking && ranking.momentum.direction !== "flat") {
    const change = ranking.momentum.change_pct;
    signals.push({
      id: "country-momentum",
      title: `${country} observed movement is ${ranking.momentum.direction === "up" ? "accelerating" : ranking.momentum.direction === "down" ? "slowing" : "establishing a baseline"}`,
      summary: `${ranking.current.observed_movements.toLocaleString()} tracked movements in the current 24-hour window versus ${ranking.previous.observed_movements.toLocaleString()} previously${change == null ? "" : ` (${change > 0 ? "+" : ""}${change.toFixed(1)}%)`}. This is Claritas coverage, not total national traffic.`,
      emphasis: "change",
    });
  }

  const relations = new Map<string, { country: string; name: string; active: number }>();
  for (const route of routes) {
    const origin = iso(route.origin_country);
    const counterpart = origin === country ? iso(route.destination_country) : origin;
    if (counterpart === country) continue;
    const name = origin === country ? route.destination_name : route.origin_name;
    const current = relations.get(counterpart) ?? { country: counterpart, name, active: 0 };
    current.active += route.active_count;
    relations.set(counterpart, current);
  }
  const strongest = [...relations.values()].sort((left, right) => right.active - left.active)[0];
  if (!corridor && strongest) {
    signals.push({
      id: "strongest-relationship",
      title: `${strongest.name} is the strongest resolved connection`,
      summary: `${strongest.active.toLocaleString()} active routed records link ${country} and ${strongest.country} in this observed snapshot. Select that corridor to inspect direction, evidence basis, and vehicles.`,
      emphasis: "relationship",
    });
  }

  if (corridor) {
    const outbound = routes.reduce(
      (total, route) => total + (iso(route.origin_country) === country ? route.active_count : 0),
      0,
    );
    const inbound = routes.reduce(
      (total, route) => total + (iso(route.origin_country) === corridor ? route.active_count : 0),
      0,
    );
    if (outbound || inbound) {
      signals.push({
        id: "corridor-balance",
        title: `${country} ↔ ${corridor} direction check`,
        summary: `${outbound.toLocaleString()} resolved records move ${country} → ${corridor}; ${inbound.toLocaleString()} move ${corridor} → ${country}. The difference is an observed coverage signal, not evidence of cargo volume or disruption.`,
        emphasis: "change",
      });
    }
  }

  const proxyRecords = routes
    .filter((route) => route.origin_basis !== "observed")
    .reduce((total, route) => total + route.active_count, 0);
  if (proxyRecords) {
    signals.push({
      id: "proxy-evidence",
      title: "Validate proxy-based route evidence",
      summary: `${proxyRecords.toLocaleString()} routed records use flag-state or mixed origin evidence. Treat those links as contextual until a directly observed origin is available.`,
      emphasis: "coverage",
    });
  }
  return signals.slice(0, 4);
}
