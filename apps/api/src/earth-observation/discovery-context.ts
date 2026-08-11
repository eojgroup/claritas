import { boundBoundingBox, type BoundingBox, type EarthProductType } from "./types";

const COPERNICUS_PRODUCTS: readonly EarthProductType[] = [
  "true_color", "false_color", "ndvi", "ndwi", "burn_index", "sar",
];

export function requestedCopernicusProducts(value: unknown): EarthProductType[] {
  const requested = Array.isArray(value) ? value : ["true_color"];
  const normalized = requested.filter((entry): entry is EarthProductType => (
    typeof entry === "string" && COPERNICUS_PRODUCTS.includes(entry as EarthProductType)
  ));
  return [...new Set(normalized.length ? normalized : ["true_color"] as EarthProductType[])];
}

export function compatibleCopernicusProducts(collection: string, products: EarthProductType[]) {
  return products.filter((product) => (
    collection === "sentinel-1-grd" ? product === "sar" : product !== "sar"
  ));
}

export type DiscoveryAoiInput = {
  eventLatitude?: number | null;
  eventLongitude?: number | null;
  locationBbox?: BoundingBox | number[] | null;
  locationLatitude?: number | null;
  locationLongitude?: number | null;
  pointHalfSpanDegrees?: number;
};

export type ResolvedDiscoveryAoi = {
  bbox: BoundingBox;
  source: "event_geography" | "location_bbox" | "location_point";
  center: { latitude: number; longitude: number };
};

const coordinatePresent = (value: number | null | undefined) => value !== null && typeof value !== "undefined";

function validPoint(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

export function resolveTrustedEventCoordinates(input: {
  incomingLatitude?: number | null;
  incomingLongitude?: number | null;
  incomingCoordinatesAreExact?: boolean;
  canonicalLatitude?: number | null;
  canonicalLongitude?: number | null;
  canonicalCoordinatesAreExact?: boolean;
}) {
  if (input.incomingCoordinatesAreExact === true
      && typeof input.incomingLatitude === "number"
      && typeof input.incomingLongitude === "number"
      && validPoint(input.incomingLatitude, input.incomingLongitude)) {
    return {
      latitude: input.incomingLatitude,
      longitude: input.incomingLongitude,
      source: "incoming_signal" as const,
    };
  }
  if (input.canonicalCoordinatesAreExact === true
      && typeof input.canonicalLatitude === "number"
      && typeof input.canonicalLongitude === "number"
      && validPoint(input.canonicalLatitude, input.canonicalLongitude)) {
    return {
      latitude: input.canonicalLatitude,
      longitude: input.canonicalLongitude,
      source: "canonical_event" as const,
    };
  }
  return null;
}

function pointBbox(latitude: number, longitude: number, halfSpanDegrees: number): BoundingBox {
  if (!validPoint(latitude, longitude)) throw new Error("Earth Observation point coordinates are invalid.");
  const span = Math.min(2, Math.max(0.01, halfSpanDegrees));
  const west = Math.max(-180, longitude - span);
  const east = Math.min(180, longitude + span);
  const south = Math.max(-90, latitude - span);
  const north = Math.min(90, latitude + span);
  if (west >= east || south >= north) throw new Error("Earth Observation point cannot produce a valid AOI.");
  return boundBoundingBox([west, south, east, north]);
}

/**
 * Resolves an AOI without coercing null database coordinates to zero. Exact
 * event geography takes precedence over the broader canonical location so a
 * remote incident is not rendered at the nearest port/country centroid.
 */
export function resolveDiscoveryAoi(input: DiscoveryAoiInput): ResolvedDiscoveryAoi {
  const eventLatitudePresent = coordinatePresent(input.eventLatitude);
  const eventLongitudePresent = coordinatePresent(input.eventLongitude);
  if (eventLatitudePresent !== eventLongitudePresent) {
    throw new Error("Earth Observation event geography is incomplete.");
  }
  if (eventLatitudePresent && eventLongitudePresent) {
    const latitude = input.eventLatitude as number;
    const longitude = input.eventLongitude as number;
    return {
      bbox: pointBbox(latitude, longitude, input.pointHalfSpanDegrees ?? 0.15),
      source: "event_geography",
      center: { latitude, longitude },
    };
  }

  if (input.locationBbox !== null && typeof input.locationBbox !== "undefined") {
    const bbox = boundBoundingBox(input.locationBbox);
    return {
      bbox,
      source: "location_bbox",
      center: {
        latitude: (bbox[1] + bbox[3]) / 2,
        longitude: (bbox[0] + bbox[2]) / 2,
      },
    };
  }

  const locationLatitudePresent = coordinatePresent(input.locationLatitude);
  const locationLongitudePresent = coordinatePresent(input.locationLongitude);
  if (locationLatitudePresent !== locationLongitudePresent) {
    throw new Error("Earth Observation location coordinates are incomplete.");
  }
  if (locationLatitudePresent && locationLongitudePresent) {
    const latitude = input.locationLatitude as number;
    const longitude = input.locationLongitude as number;
    return {
      bbox: pointBbox(latitude, longitude, input.pointHalfSpanDegrees ?? 0.15),
      source: "location_point",
      center: { latitude, longitude },
    };
  }

  throw new Error("Earth Observation requires valid event geography or location geometry; no AOI was inferred.");
}

export function buildDiscoveryDedupeKey(input: {
  eventId?: string | null;
  locationId?: string | null;
  revisitNumber?: number;
  discoverySeries?: string;
  discoveryWindow?: string;
}) {
  const segment = (value: string | undefined) => value?.trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || null;
  const series = segment(input.discoverySeries);
  const window = segment(input.discoveryWindow);
  const base = [
    "scene-discovery",
    input.eventId ?? "location",
    input.locationId ?? "event-aoi",
    series,
    window,
  ].filter((value): value is string => Boolean(value)).join(":");
  const revisit = Math.max(0, Math.trunc(input.revisitNumber ?? 0));
  return revisit > 0 ? `${base}:revisit-${revisit}` : base;
}
