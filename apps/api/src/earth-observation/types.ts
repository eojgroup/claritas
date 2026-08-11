export type EarthProductType =
  | "true_color"
  | "false_color"
  | "ndvi"
  | "ndwi"
  | "burn_index"
  | "sar"
  | "gibs_layer";

export type BoundingBox = [number, number, number, number];

export type EarthScene = {
  provider: string;
  mission: string;
  collection: string;
  providerSceneId: string;
  captureStart: Date;
  captureEnd?: Date | null;
  publishedAt?: Date | null;
  bbox: BoundingBox;
  geometry?: Record<string, unknown> | null;
  cloudCover?: number | null;
  resolutionM?: number | null;
  orbitDirection?: string | null;
  sourceUrl: string;
  license: string;
  attribution: string;
  quality: Record<string, unknown>;
  rawMetadata: Record<string, unknown>;
};

export type SceneRank = {
  scene: EarthScene;
  score: number;
  components: {
    recency: number;
    cloud: number;
    event_timing: number;
    coverage: number;
    sensor: number;
    quality: number;
  };
  rejectedReason?: string;
};

export type SceneDiscoveryRequest = {
  bbox: BoundingBox;
  start: Date;
  end: Date;
  collections: string[];
  limit: number;
  eventTime?: Date | null;
};

export type RenderRequest = {
  bbox: BoundingBox;
  start: Date;
  end: Date;
  collection: string;
  product: EarthProductType;
  width: number;
  height: number;
  maxCloudCoverage?: number;
};

export type RenderedObservation = {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/tiff";
  width: number;
  height: number;
  processingUnits?: number;
};

export type EarthProviderStatus = {
  provider: string;
  enabled: boolean;
  configured: boolean;
  state: "disabled" | "not_configured" | "ready" | "degraded" | "circuit_open" | "rate_limited";
  reason?: string;
  attribution: string;
};

export function hasProcessingBudget(used: number, dailyBudget: number, estimatedCost = 1): boolean {
  if (![used, dailyBudget, estimatedCost].every(Number.isFinite) || used < 0 || estimatedCost < 0) return false;
  return dailyBudget <= 0 || used + estimatedCost <= dailyBudget;
}

export function validateBoundingBox(value: unknown): BoundingBox {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) {
    throw new Error("AOI bbox must contain four finite coordinates.");
  }
  const [west, south, east, north] = value.map(Number) as BoundingBox;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    throw new Error("AOI bbox is outside WGS84 bounds or has invalid ordering.");
  }
  const maxArea = Math.max(0.01, Number(process.env.EO_MAX_AOI_SQUARE_DEGREES ?? 25));
  if ((east - west) * (north - south) > maxArea) {
    throw new Error(`AOI exceeds the configured ${maxArea} square-degree limit.`);
  }
  return [west, south, east, north];
}

/** Deterministically crops a governed region to the configured provider budget. */
export function boundBoundingBox(
  value: unknown,
  maxArea = Number(process.env.EO_MAX_AOI_SQUARE_DEGREES ?? 25),
): BoundingBox {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) {
    throw new Error("AOI bbox must contain four finite coordinates.");
  }
  const [west, south, east, north] = value.map(Number) as BoundingBox;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    throw new Error("AOI bbox is outside WGS84 bounds or has invalid ordering.");
  }
  const safeArea = Math.max(0.01, maxArea);
  const width = east - west;
  const height = north - south;
  if (width * height <= safeArea) return [west, south, east, north];
  const scale = Math.sqrt((safeArea * 0.98) / (width * height));
  const halfWidth = (width * scale) / 2;
  const halfHeight = (height * scale) / 2;
  const centerLongitude = (west + east) / 2;
  const centerLatitude = (south + north) / 2;
  return validateBoundingBox([
    Math.max(-180, centerLongitude - halfWidth),
    Math.max(-90, centerLatitude - halfHeight),
    Math.min(180, centerLongitude + halfWidth),
    Math.min(90, centerLatitude + halfHeight),
  ]);
}
