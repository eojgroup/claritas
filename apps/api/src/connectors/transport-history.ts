export type TransportHistoryPoint = {
  bucket: string;
  maritime_entities: number | null;
  aviation_entities: number | null;
  observed_hours: number;
  ship_departures: number | null;
  ship_arrivals: number | null;
  cargo_vessel_departures: number | null;
  corridor_maritime_entities: number | null;
  corridor_aviation_entities: number | null;
  corridor_observed_hours: number;
  corridor_observed_origins: number | null;
  corridor_flag_proxy_origins: number | null;
};

export function transportHistoryModeValue(
  requestedMode: "maritime" | "aviation" | null,
  valueMode: "maritime" | "aviation",
  value: number,
): number | null {
  return requestedMode && requestedMode !== valueMode ? null : value;
}

export function transportHistoryWindow(
  points: TransportHistoryPoint[],
  days: 7 | 30 | 90,
  corridorScoped: boolean,
) {
  const selected = points.slice(-days);
  const entityCount = (point: TransportHistoryPoint) =>
    corridorScoped
      ? (point.corridor_maritime_entities ?? 0) +
        (point.corridor_aviation_entities ?? 0)
      : (point.maritime_entities ?? 0) + (point.aviation_entities ?? 0);
  const observedHours = (point: TransportHistoryPoint) =>
    corridorScoped ? point.corridor_observed_hours : point.observed_hours;
  const entityObserved = selected.filter((point) => observedHours(point) > 0);
  const observed = selected.filter((point) =>
    observedHours(point) > 0 || (
      !corridorScoped && (
        point.ship_departures != null ||
        point.ship_arrivals != null ||
        point.cargo_vessel_departures != null
      )
    ),
  );
  const entityDayObservations = entityObserved.reduce(
    (total, point) => total + entityCount(point),
    0,
  );
  const peak = [...entityObserved]
    .filter((point) => observedHours(point) > 0)
    .sort((left, right) => entityCount(right) - entityCount(left))[0];
  const observedOrigins = corridorScoped
    ? selected.reduce(
        (total, point) => total + (point.corridor_observed_origins ?? 0),
        0,
      )
    : null;
  const flagProxyOrigins = corridorScoped
    ? selected.reduce(
        (total, point) => total + (point.corridor_flag_proxy_origins ?? 0),
        0,
      )
    : null;
  const originEvidenceTotal =
    observedOrigins == null || flagProxyOrigins == null
      ? null
      : observedOrigins + flagProxyOrigins;
  return {
    days,
    observed_days: observed.length,
    observation_hours: selected.reduce(
      (total, point) => total + observedHours(point),
      0,
    ),
    entity_day_observations: entityDayObservations,
    average_daily_entities:
      entityObserved.length > 0
        ? Math.round((entityDayObservations / entityObserved.length) * 10) / 10
        : null,
    peak_daily_entities: peak
      ? { bucket: peak.bucket, value: entityCount(peak) }
      : null,
    maritime_entity_days: selected.reduce(
      (total, point) =>
        total +
        (corridorScoped
          ? point.corridor_maritime_entities ?? 0
          : point.maritime_entities ?? 0),
      0,
    ),
    aviation_entity_days: selected.reduce(
      (total, point) =>
        total +
        (corridorScoped
          ? point.corridor_aviation_entities ?? 0
          : point.aviation_entities ?? 0),
      0,
    ),
    ship_departures: corridorScoped
      ? null
      : selected.reduce(
          (total, point) => total + (point.ship_departures ?? 0),
          0,
        ),
    ship_arrivals: corridorScoped
      ? null
      : selected.reduce(
          (total, point) => total + (point.ship_arrivals ?? 0),
          0,
        ),
    cargo_vessel_departures: corridorScoped
      ? null
      : selected.reduce(
          (total, point) => total + (point.cargo_vessel_departures ?? 0),
          0,
        ),
    observed_origin_share:
      originEvidenceTotal && observedOrigins != null
        ? Math.round((observedOrigins / originEvidenceTotal) * 1_000) / 10
        : null,
  };
}
