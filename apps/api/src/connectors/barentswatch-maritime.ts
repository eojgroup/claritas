type JsonRecord = Record<string, unknown>;

export type BarentsWatchMaritimeObservation = {
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

export function parseBarentsWatchMaritimeObservations(
  payload: unknown,
  nowMilliseconds = Date.now(),
  freshnessMilliseconds = 15 * 60_000,
): BarentsWatchMaritimeObservation[] {
  const records = Array.isArray(payload) ? payload : [];
  const byMmsi = new Map<string, BarentsWatchMaritimeObservation>();
  for (const candidate of records) {
    const row = asRecord(candidate);
    const mmsi = text(row?.mmsi);
    const latitude = finiteNumber(row?.latitude);
    const longitude = finiteNumber(row?.longitude);
    const observedMilliseconds = Date.parse(text(row?.msgtime) ?? "");
    if (
      !mmsi ||
      !/^\d{9}$/.test(mmsi) ||
      latitude == null ||
      latitude < -90 ||
      latitude > 90 ||
      longitude == null ||
      longitude < -180 ||
      longitude > 180 ||
      !Number.isFinite(observedMilliseconds) ||
      observedMilliseconds > nowMilliseconds + 5 * 60_000 ||
      nowMilliseconds - observedMilliseconds > freshnessMilliseconds
    ) {
      continue;
    }
    const observation: BarentsWatchMaritimeObservation = {
      mmsi,
      latitude,
      longitude,
      speed: finiteNumber(row?.speedOverGround),
      course: finiteNumber(row?.courseOverGround),
      heading: finiteNumber(row?.trueHeading),
      navigationStatus: finiteNumber(row?.navigationalStatus),
      observedAt: new Date(observedMilliseconds).toISOString(),
      displayName: text(row?.name),
      callsign: text(row?.callSign),
      shipType: finiteNumber(row?.shipType),
      destination: text(row?.destination),
    };
    const existing = byMmsi.get(mmsi);
    if (!existing || observation.observedAt > existing.observedAt) {
      byMmsi.set(mmsi, observation);
    }
  }
  return Array.from(byMmsi.values());
}

export type BarentsWatchToken = {
  accessToken: string;
  expiresAt: number;
};

export function parseBarentsWatchToken(
  payload: unknown,
  nowMilliseconds = Date.now(),
): BarentsWatchToken | null {
  const row = asRecord(payload);
  const accessToken = text(row?.access_token);
  const expiresIn = finiteNumber(row?.expires_in);
  if (!accessToken || expiresIn == null || expiresIn <= 0) return null;
  // Refresh at least one minute before expiry, while preserving short-lived
  // test/development tokens for half of their advertised lifetime.
  const refreshMarginSeconds = Math.min(60, Math.max(1, expiresIn / 2));
  return {
    accessToken,
    expiresAt: nowMilliseconds + (expiresIn - refreshMarginSeconds) * 1_000,
  };
}
