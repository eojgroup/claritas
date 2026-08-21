export type AisBoundingBox = [
  [latitude: number, longitude: number],
  [latitude: number, longitude: number],
];

export const GLOBAL_AIS_BOUNDING_BOX: AisBoundingBox = [
  [-90, -180],
  [90, 180],
];

export const AIS_POSITION_MESSAGE_TYPES = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "LongRangeAisBroadcastMessage",
  "ShipStaticData",
  "StaticDataReport",
] as const;

const AIS_COORDINATE_MESSAGE_TYPES = new Set<string>([
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "LongRangeAisBroadcastMessage",
]);

export function isAisCoordinateMessageType(
  messageType: string | null | undefined,
): boolean {
  return Boolean(messageType && AIS_COORDINATE_MESSAGE_TYPES.has(messageType));
}

/**
 * AISstream is a live feed. Reject missing, stale, and implausibly future
 * provider timestamps before they can prove liveness or enter arbitration.
 */
export function normalizeAisObservedAt(
  value: unknown,
  nowMilliseconds = Date.now(),
  freshnessMilliseconds = 15 * 60_000,
  futureToleranceMilliseconds = 5 * 60_000,
): string | null {
  let observedMilliseconds: number;
  if (typeof value === "number" && Number.isFinite(value)) {
    observedMilliseconds =
      Math.abs(value) < 1_000_000_000_000 ? value * 1_000 : value;
  } else if (typeof value === "string" && value.trim()) {
    observedMilliseconds = Date.parse(value);
  } else {
    return null;
  }
  if (
    !Number.isFinite(observedMilliseconds) ||
    !Number.isFinite(nowMilliseconds) ||
    observedMilliseconds > nowMilliseconds + futureToleranceMilliseconds ||
    nowMilliseconds - observedMilliseconds > freshnessMilliseconds
  ) {
    return null;
  }
  return new Date(observedMilliseconds).toISOString();
}

const AIS_RECONNECT_DELAYS_MILLISECONDS = [
  2_000,
  10_000,
  30_000,
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
] as const;

export function aisReconnectDelayMilliseconds(attempt: number): number {
  const normalizedAttempt = Number.isFinite(attempt)
    ? Math.max(0, Math.floor(attempt))
    : 0;
  return AIS_RECONNECT_DELAYS_MILLISECONDS[
    Math.min(normalizedAttempt, AIS_RECONNECT_DELAYS_MILLISECONDS.length - 1)
  ];
}

export function buildAisSubscription(
  apiKey: string,
  boundingBoxes: AisBoundingBox[],
) {
  return {
    APIKey: apiKey,
    BoundingBoxes: boundingBoxes,
    FilterMessageTypes: [...AIS_POSITION_MESSAGE_TYPES],
  };
}

/**
 * Only coordinate-bearing AIS messages may replace the persisted live
 * position. Static reports are still subscribed to and cached as metadata, but
 * must never erase a vessel's last usable map position with null coordinates.
 */
export function shouldQueueAisSnapshot(
  latitude: number | null,
  longitude: number | null,
): boolean {
  return (
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function finiteCoordinate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export function normalizeAisBoundingBoxes(value: unknown): AisBoundingBox[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!Array.isArray(candidate) || candidate.length !== 2) return [];
    const first = candidate[0];
    const second = candidate[1];
    if (!Array.isArray(first) || first.length !== 2) return [];
    if (!Array.isArray(second) || second.length !== 2) return [];
    const firstLatitude = finiteCoordinate(first[0]);
    const firstLongitude = finiteCoordinate(first[1]);
    const secondLatitude = finiteCoordinate(second[0]);
    const secondLongitude = finiteCoordinate(second[1]);
    if (
      firstLatitude == null ||
      firstLongitude == null ||
      secondLatitude == null ||
      secondLongitude == null ||
      firstLatitude < -90 ||
      firstLatitude > 90 ||
      secondLatitude < -90 ||
      secondLatitude > 90 ||
      firstLongitude < -180 ||
      firstLongitude > 180 ||
      secondLongitude < -180 ||
      secondLongitude > 180 ||
      firstLatitude === secondLatitude ||
      firstLongitude === secondLongitude
    ) {
      return [];
    }
    return [[
      [Math.min(firstLatitude, secondLatitude), Math.min(firstLongitude, secondLongitude)],
      [Math.max(firstLatitude, secondLatitude), Math.max(firstLongitude, secondLongitude)],
    ] as AisBoundingBox];
  });
}
