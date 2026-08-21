type JsonRecord = Record<string, unknown>;

export type MpaMaritimeObservation = {
  mmsi: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  course: number | null;
  heading: number | null;
  navigationStatus: null;
  observedAt: string;
  displayName: string | null;
  callsign: string | null;
  shipType: string | number | null;
  destination: null;
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

/**
 * MPA documents `timeStamp` as date-time, but its examples omit a timezone.
 * Accept both UTC and Singapore-local interpretations and retain whichever is
 * plausibly fresh. This avoids depending on the API container's local timezone.
 */
function timestampMilliseconds(
  value: unknown,
  nowMilliseconds: number,
  freshnessMilliseconds: number,
): number | null {
  const raw = text(value);
  if (!raw) return null;
  const explicitlyZoned = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const candidates: number[] = [];
  if (explicitlyZoned) {
    candidates.push(Date.parse(raw));
  } else {
    const match = raw.match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/,
    );
    if (!match) return null;
    const milliseconds = Number((match[7] ?? "0").padEnd(3, "0"));
    const asUtc = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
      milliseconds,
    );
    candidates.push(asUtc, asUtc - 8 * 60 * 60_000);
  }
  const plausible = candidates
    .filter(Number.isFinite)
    .filter(
      (candidate) =>
        candidate <= nowMilliseconds + 5 * 60_000 &&
        nowMilliseconds - candidate <= freshnessMilliseconds,
    )
    .sort(
      (left, right) =>
        Math.abs(nowMilliseconds - left) - Math.abs(nowMilliseconds - right),
    );
  return plausible[0] ?? null;
}

export function parseMpaMaritimeObservations(
  payload: unknown,
  nowMilliseconds = Date.now(),
  freshnessMilliseconds = 15 * 60_000,
): MpaMaritimeObservation[] {
  const records = Array.isArray(payload) ? payload : [];
  const byMmsi = new Map<string, MpaMaritimeObservation>();
  for (const candidate of records) {
    const row = asRecord(candidate);
    const vessel = asRecord(row?.vesselParticulars);
    const mmsi = text(vessel?.mmsiNumber);
    // The API's latitude/longitude examples are radians despite their schema
    // descriptions. Only the explicit degree-valued fields are safe to map.
    const latitude = finiteNumber(row?.latitudeDegrees);
    const longitude = finiteNumber(row?.longitudeDegrees);
    const observedMilliseconds = timestampMilliseconds(
      row?.timeStamp,
      nowMilliseconds,
      freshnessMilliseconds,
    );
    if (
      !mmsi ||
      !/^\d{9}$/.test(mmsi) ||
      latitude == null ||
      latitude < -90 ||
      latitude > 90 ||
      longitude == null ||
      longitude < -180 ||
      longitude > 180 ||
      observedMilliseconds == null
    ) {
      continue;
    }
    const shipTypeValue = vessel?.vesselType;
    const shipType =
      typeof shipTypeValue === "string" || typeof shipTypeValue === "number"
        ? shipTypeValue
        : null;
    const observation: MpaMaritimeObservation = {
      mmsi,
      latitude,
      longitude,
      speed: finiteNumber(row?.speed),
      course: finiteNumber(row?.course),
      heading: finiteNumber(row?.heading),
      navigationStatus: null,
      observedAt: new Date(observedMilliseconds).toISOString(),
      displayName: text(vessel?.vesselName),
      callsign: text(vessel?.callSign),
      shipType,
      destination: null,
    };
    const existing = byMmsi.get(mmsi);
    if (!existing || observation.observedAt > existing.observedAt) {
      byMmsi.set(mmsi, observation);
    }
  }
  return Array.from(byMmsi.values());
}
