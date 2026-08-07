type JsonRecord = Record<string, unknown>;

export type DigitrafficMaritimeObservation = {
  mmsi: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  course: number | null;
  heading: number | null;
  navigationStatus: number | null;
  observedAt: string;
  displayName: string | null;
  callsign: string | null;
  shipType: number | null;
  destination: string | null;
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function epochMilliseconds(value: unknown): number | null {
  const parsed = finiteNumber(value);
  if (parsed == null) return null;
  return Math.abs(parsed) < 1_000_000_000_000 ? parsed * 1_000 : parsed;
}

export function parseDigitrafficMaritimeObservations(
  locationsPayload: unknown,
  vesselsPayload: unknown,
  nowMilliseconds = Date.now(),
  freshnessMilliseconds = 15 * 60_000,
): DigitrafficMaritimeObservation[] {
  const metadataByMmsi = new Map<string, JsonRecord>();
  if (Array.isArray(vesselsPayload)) {
    for (const candidate of vesselsPayload) {
      const metadata = asRecord(candidate);
      const mmsi = text(metadata?.mmsi);
      if (mmsi && /^\d{9}$/.test(mmsi)) metadataByMmsi.set(mmsi, metadata!);
    }
  }

  const locations = asRecord(locationsPayload);
  const features = Array.isArray(locations?.features) ? locations.features : [];
  const byMmsi = new Map<string, DigitrafficMaritimeObservation>();
  for (const candidate of features) {
    const feature = asRecord(candidate);
    const geometry = asRecord(feature?.geometry);
    const properties = asRecord(feature?.properties);
    const coordinates = Array.isArray(geometry?.coordinates)
      ? geometry.coordinates
      : [];
    const mmsi = text(feature?.mmsi ?? properties?.mmsi);
    const longitude = finiteNumber(coordinates[0]);
    const latitude = finiteNumber(coordinates[1]);
    const observedMilliseconds = epochMilliseconds(properties?.timestampExternal);
    if (
      !mmsi ||
      !/^\d{9}$/.test(mmsi) ||
      latitude == null ||
      latitude < -90 ||
      latitude > 90 ||
      longitude == null ||
      longitude < -180 ||
      longitude > 180 ||
      observedMilliseconds == null ||
      observedMilliseconds > nowMilliseconds + 5 * 60_000 ||
      nowMilliseconds - observedMilliseconds > freshnessMilliseconds
    ) {
      continue;
    }
    const metadata = metadataByMmsi.get(mmsi);
    const observation: DigitrafficMaritimeObservation = {
      mmsi,
      latitude,
      longitude,
      speed: finiteNumber(properties?.sog),
      course: finiteNumber(properties?.cog),
      heading: finiteNumber(properties?.heading),
      navigationStatus: finiteNumber(properties?.navStat),
      observedAt: new Date(observedMilliseconds).toISOString(),
      displayName: text(metadata?.name),
      callsign: text(metadata?.callSign),
      shipType: finiteNumber(metadata?.shipType),
      destination: text(metadata?.destination),
    };
    const existing = byMmsi.get(mmsi);
    if (!existing || observation.observedAt > existing.observedAt) {
      byMmsi.set(mmsi, observation);
    }
  }
  return Array.from(byMmsi.values());
}
