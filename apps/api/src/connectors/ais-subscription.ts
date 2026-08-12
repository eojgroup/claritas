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
