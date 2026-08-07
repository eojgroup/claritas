export type AisBoundingBox = [
  [latitude: number, longitude: number],
  [latitude: number, longitude: number],
];

const LATITUDE_BANDS: Array<[number, number]> = [
  [30, 60],
  [0, 30],
  [-30, 0],
  [60, 90],
  [-60, -30],
  [-90, -60],
];

const LONGITUDE_BANDS: Array<[number, number]> = [
  [-30, 30],
  [30, 90],
  [90, 150],
  [150, 180],
  [-180, -150],
  [-150, -90],
  [-90, -30],
];

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

/**
 * Covers the world in bounded subscriptions, ordered so the first batches
 * include Europe/North Atlantic and Middle East/Indian Ocean traffic.
 */
export function incrementalWorldAisBoundingBoxes(): AisBoundingBox[] {
  return LATITUDE_BANDS.flatMap(([south, north]) =>
    LONGITUDE_BANDS.map(
      ([west, east]): AisBoundingBox => [[south, west], [north, east]],
    ),
  );
}

export function batchAisBoundingBoxes(
  boxes: AisBoundingBox[],
  batchSize: number,
): AisBoundingBox[][] {
  const boundedBatchSize = Math.max(1, Math.min(Math.trunc(batchSize) || 1, 12));
  const batches: AisBoundingBox[][] = [];
  for (let offset = 0; offset < boxes.length; offset += boundedBatchSize) {
    batches.push(boxes.slice(offset, offset + boundedBatchSize));
  }
  return batches;
}
