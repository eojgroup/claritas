import { feature } from "topojson-client";
import worldCountries from "world-countries";
import type { FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson";
import type { GeometryCollection, Properties, Topology } from "topojson-specification";
import WebSocket from "ws";
import { getCountryFromMMSI } from "mmsi-country-lookup";
import { pool, query } from "../db";

export type TransportMode = "maritime" | "aviation";
export type TransportDetailLevel = "aggregate" | "full";

type JsonRecord = Record<string, unknown>;
type NullableNumber = number | null;

type CountryReference = {
  cca2?: string;
  ccn3?: string;
  latlng?: [number, number];
  name?: { common?: string };
};

type CountryGeometry = {
  iso2: string;
  name: string;
  geometry: Polygon | MultiPolygon;
  bounds: [number, number, number, number];
};

type TransportSnapshotInput = {
  mode: TransportMode;
  entity_id: string;
  display_name?: string | null;
  callsign?: string | null;
  flight_number?: string | null;
  registration?: string | null;
  vehicle_type?: string | null;
  vehicle_category?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  heading?: number | null;
  speed?: number | null;
  altitude?: number | null;
  vertical_rate?: number | null;
  current_country_iso2?: string | null;
  origin_country_iso2?: string | null;
  destination_country_iso2?: string | null;
  registration_country_iso2?: string | null;
  origin_name?: string | null;
  destination_name?: string | null;
  origin_latitude?: number | null;
  origin_longitude?: number | null;
  destination_latitude?: number | null;
  destination_longitude?: number | null;
  current_location_name?: string | null;
  route_label?: string | null;
  linkage_basis?: string[];
  linkage_confidence?: "high" | "medium" | "low" | "none";
  status?: string | null;
  is_alert?: boolean;
  source_name: "aisstream" | "adsb_lol";
  observed_at: string;
  payload: JsonRecord;
};

type TransportSnapshotRow = Omit<TransportSnapshotInput, "linkage_basis"> & {
  id: string | number;
  linkage_basis: string[] | null;
};

type CountryAggregateRow = {
  mode: TransportMode;
  country: string;
  active_count: string | number;
  current_count: string | number;
  origin_count: string | number;
  destination_count: string | number;
  registration_count: string | number;
};

type RouteAggregateRow = {
  mode: TransportMode;
  origin_country: string;
  destination_country: string;
  active_count: string | number;
  examples: string[] | null;
};

type ModeAggregateRow = {
  mode: TransportMode;
  active_count: string | number;
  routed_count: string | number;
  alert_count: string | number;
  latest_observed_at: string | Date | null;
};

type ActivityRow = {
  bucket: string | Date;
  mode: TransportMode;
  active_count: string | number;
};

type TransportTrendRow = {
  country: string | null;
  departures_current: string | number;
  departures_previous: string | number;
  cargo_departures_current: string | number;
  cargo_departures_previous: string | number;
  arrivals_current: string | number;
  arrivals_previous: string | number;
};

type AviationTrendRow = {
  country: string | null;
  flights_current: string | number;
  flights_previous: string | number;
};

type PortTrendRow = {
  country: string;
  location_name: string;
  departures_current: string | number;
  arrivals_current: string | number;
  cargo_departures_current: string | number;
};

type AdsbAircraft = {
  hex?: unknown;
  flight?: unknown;
  r?: unknown;
  t?: unknown;
  lat?: unknown;
  lon?: unknown;
  track?: unknown;
  gs?: unknown;
  alt_baro?: unknown;
  baro_rate?: unknown;
  geom_rate?: unknown;
  squawk?: unknown;
  emergency?: unknown;
  seen?: unknown;
  [key: string]: unknown;
};

type AdsbPointResponse = {
  ac?: AdsbAircraft[];
  now?: number;
};

type AdsbAirport = {
  name?: string;
  icao?: string;
  iata?: string;
  location?: string;
  countryiso2?: string;
  lat?: number;
  lon?: number;
};

type AdsbRoute = {
  callsign?: string;
  number?: string;
  airline_code?: string;
  airport_codes?: string;
  _airport_codes_iata?: string;
  _airports?: AdsbAirport[];
  plausible?: boolean;
};

type MaritimeStatic = {
  display_name?: string | null;
  callsign?: string | null;
  vehicle_type?: string | null;
  vehicle_category?: string | null;
  destination_name?: string | null;
  destination_country_iso2?: string | null;
  route_label?: string | null;
};

type MaritimePort = {
  name: string;
  iso2: string;
  latitude: number;
  longitude: number;
  radius_km: number;
  pattern: RegExp;
};

const AIS_STREAM_URL = "wss://stream.aisstream.io/v0/stream";
const ADSB_BASE_URL = "https://api.adsb.lol";
const WORKER_LOCK_NAMESPACE = 9433;
const WORKER_LOCK_KEY = 21;
const TRANSPORT_SCOPE_GLOBAL = "*";
const OVERVIEW_CACHE_MAX_ENTRIES = 64;
const COUNTRY_REFERENCES = worldCountries as CountryReference[];
const COUNTRY_NAME_BY_ISO = new Map(
  COUNTRY_REFERENCES.flatMap((country) =>
    country.cca2
      ? [[country.cca2.toUpperCase(), country.name?.common ?? country.cca2.toUpperCase()] as const]
      : []
  )
);
const VALID_ISO2 = new Set(COUNTRY_NAME_BY_ISO.keys());
const ISO_BY_NUMERIC = new Map(
  COUNTRY_REFERENCES.flatMap((country) =>
    country.cca2 && country.ccn3
      ? [[country.ccn3.padStart(3, "0"), country.cca2.toUpperCase()] as const]
      : []
  )
);

// Runtime import keeps Natural Earth geography inside the API image.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const worldAtlas = require("world-atlas/countries-110m.json") as Topology<{
  countries: GeometryCollection<Properties>;
}>;

const COUNTRY_GEOMETRIES = buildCountryGeometries();
const MARITIME_PORTS: MaritimePort[] = [
  { name: "Los Angeles / Long Beach", iso2: "US", latitude: 33.74, longitude: -118.24, radius_km: 42, pattern: /\b(?:USLAX|USLGB|LOS ANGELES|LONG BEACH)\b/i },
  { name: "New York / Newark", iso2: "US", latitude: 40.67, longitude: -74.08, radius_km: 45, pattern: /\b(?:USNYC|USNWK|NEW YORK|NEWARK)\b/i },
  { name: "Savannah", iso2: "US", latitude: 32.08, longitude: -81.09, radius_km: 32, pattern: /\b(?:USSAV|SAVANNAH)\b/i },
  { name: "Vancouver", iso2: "CA", latitude: 49.30, longitude: -123.11, radius_km: 42, pattern: /\b(?:CAVAN|VANCOUVER)\b/i },
  { name: "Santos", iso2: "BR", latitude: -23.96, longitude: -46.30, radius_km: 36, pattern: /\b(?:BRSSZ|SANTOS)\b/i },
  { name: "Rotterdam", iso2: "NL", latitude: 51.95, longitude: 4.14, radius_km: 48, pattern: /\b(?:NLRTM|ROTTERDAM)\b/i },
  { name: "Antwerp-Bruges", iso2: "BE", latitude: 51.27, longitude: 4.34, radius_km: 42, pattern: /\b(?:BEANR|ANTWERP|BRUGES)\b/i },
  { name: "Hamburg", iso2: "DE", latitude: 53.54, longitude: 9.93, radius_km: 32, pattern: /\b(?:DEHAM|HAMBURG)\b/i },
  { name: "Felixstowe", iso2: "GB", latitude: 51.95, longitude: 1.31, radius_km: 30, pattern: /\b(?:GBFXT|FELIXSTOWE)\b/i },
  { name: "Southampton", iso2: "GB", latitude: 50.90, longitude: -1.40, radius_km: 30, pattern: /\b(?:GBSOU|SOUTHAMPTON)\b/i },
  { name: "Algeciras", iso2: "ES", latitude: 36.13, longitude: -5.44, radius_km: 32, pattern: /\b(?:ESALG|ALGECIRAS)\b/i },
  { name: "Valencia", iso2: "ES", latitude: 39.44, longitude: -0.31, radius_km: 30, pattern: /\b(?:ESVLC|VALENCIA)\b/i },
  { name: "Piraeus", iso2: "GR", latitude: 37.94, longitude: 23.63, radius_km: 28, pattern: /\b(?:GRPIR|PIRAEUS)\b/i },
  { name: "Port Said", iso2: "EG", latitude: 31.25, longitude: 32.31, radius_km: 38, pattern: /\b(?:EGPSD|PORT SAID|SUEZ)\b/i },
  { name: "Jebel Ali", iso2: "AE", latitude: 25.01, longitude: 55.06, radius_km: 38, pattern: /\b(?:AEJEA|JEBEL ALI|DUBAI)\b/i },
  { name: "Singapore", iso2: "SG", latitude: 1.25, longitude: 103.82, radius_km: 55, pattern: /\b(?:SGSIN|SINGAPORE)\b/i },
  { name: "Shanghai", iso2: "CN", latitude: 31.23, longitude: 121.50, radius_km: 55, pattern: /\b(?:CNSHA|SHANGHAI)\b/i },
  { name: "Ningbo-Zhoushan", iso2: "CN", latitude: 29.87, longitude: 121.84, radius_km: 55, pattern: /\b(?:CNNGB|NINGBO|ZHOUSHAN)\b/i },
  { name: "Shenzhen", iso2: "CN", latitude: 22.51, longitude: 113.88, radius_km: 42, pattern: /\b(?:CNSZX|SHENZHEN|YANTIAN)\b/i },
  { name: "Hong Kong", iso2: "HK", latitude: 22.30, longitude: 114.16, radius_km: 38, pattern: /\b(?:HKHKG|HONG KONG)\b/i },
  { name: "Busan", iso2: "KR", latitude: 35.10, longitude: 129.04, radius_km: 34, pattern: /\b(?:KRPUS|BUSAN)\b/i },
  { name: "Yokohama", iso2: "JP", latitude: 35.45, longitude: 139.65, radius_km: 32, pattern: /\b(?:JPYOK|YOKOHAMA)\b/i },
  { name: "Tokyo", iso2: "JP", latitude: 35.62, longitude: 139.78, radius_km: 32, pattern: /\b(?:JPTYO|TOKYO)\b/i },
  { name: "Port Klang", iso2: "MY", latitude: 3.00, longitude: 101.39, radius_km: 34, pattern: /\b(?:MYPKG|PORT KLANG)\b/i },
  { name: "Tanjung Pelepas", iso2: "MY", latitude: 1.36, longitude: 103.55, radius_km: 30, pattern: /\b(?:MYTPP|TANJUNG PELEPAS)\b/i },
  { name: "Colombo", iso2: "LK", latitude: 6.95, longitude: 79.84, radius_km: 32, pattern: /\b(?:LKCMB|COLOMBO)\b/i },
  { name: "Nhava Sheva", iso2: "IN", latitude: 18.95, longitude: 72.95, radius_km: 36, pattern: /\b(?:INNSA|NHAVA SHEVA|JAWAHARLAL NEHRU)\b/i },
  { name: "Mundra", iso2: "IN", latitude: 22.74, longitude: 69.71, radius_km: 34, pattern: /\b(?:INMUN|MUNDRA)\b/i },
  { name: "Sydney", iso2: "AU", latitude: -33.86, longitude: 151.20, radius_km: 32, pattern: /\b(?:AUSYD|SYDNEY)\b/i },
  { name: "Melbourne", iso2: "AU", latitude: -37.84, longitude: 144.91, radius_km: 34, pattern: /\b(?:AUMEL|MELBOURNE)\b/i },
  { name: "Durban", iso2: "ZA", latitude: -29.87, longitude: 31.04, radius_km: 32, pattern: /\b(?:ZADUR|DURBAN)\b/i },
  { name: "Cape Town", iso2: "ZA", latitude: -33.91, longitude: 18.44, radius_km: 32, pattern: /\b(?:ZACPT|CAPE TOWN)\b/i },
];

const NAVIGATION_STATUS: Record<number, string> = {
  0: "Under way using engine",
  1: "At anchor",
  2: "Not under command",
  3: "Restricted manoeuvrability",
  4: "Constrained by draught",
  5: "Moored",
  6: "Aground",
  7: "Fishing",
  8: "Under way sailing",
  14: "AIS-SART active",
  15: "Not defined",
};

const ADSB_POLL_POINTS = [
  { label: "North-east North America", lat: 40.7, lon: -74.0, radius: 250 },
  { label: "South-east North America", lat: 28.2, lon: -81.0, radius: 250 },
  { label: "Central North America", lat: 40.0, lon: -96.0, radius: 250 },
  { label: "West North America", lat: 36.0, lon: -119.0, radius: 250 },
  { label: "North-west North America", lat: 47.5, lon: -122.3, radius: 250 },
  { label: "Northern South America", lat: 7.0, lon: -74.0, radius: 250 },
  { label: "Southern South America", lat: -27.0, lon: -55.0, radius: 250 },
  { label: "Western Europe", lat: 50.5, lon: 1.0, radius: 250 },
  { label: "Central Europe", lat: 49.0, lon: 11.0, radius: 250 },
  { label: "Southern Europe", lat: 41.0, lon: 12.0, radius: 250 },
  { label: "Eastern Mediterranean", lat: 39.5, lon: 29.0, radius: 250 },
  { label: "North Africa", lat: 31.0, lon: 30.0, radius: 250 },
  { label: "East Africa", lat: 0.0, lon: 36.0, radius: 250 },
  { label: "Southern Africa", lat: -27.0, lon: 28.0, radius: 250 },
  { label: "Arabian Gulf", lat: 25.0, lon: 54.0, radius: 250 },
  { label: "South Asia", lat: 24.0, lon: 78.0, radius: 250 },
  { label: "South-east Asia", lat: 3.0, lon: 102.0, radius: 250 },
  { label: "East Asia", lat: 30.0, lon: 121.0, radius: 250 },
  { label: "North-east Asia", lat: 36.0, lon: 139.0, radius: 250 },
  { label: "Australia east", lat: -33.0, lon: 151.0, radius: 250 },
];

const maritimeQueue = new Map<string, TransportSnapshotInput>();
const maritimeStatic = new Map<string, MaritimeStatic>();
const firstMaritimeCountry = new Map<string, string>();
const lastMaritimeQueuedAt = new Map<string, number>();
const lastTrackAt = new Map<string, number>();
const routeCache = new Map<string, { expiresAt: number; value: AdsbRoute | null }>();

let aisSocket: WebSocket | null = null;
let aisReconnectTimer: NodeJS.Timeout | null = null;
let aisFlushTimer: NodeJS.Timeout | null = null;
let aisReconnectAttempt = 0;
let aviationRefresh: Promise<{ fetched: number; stored: number }> | null = null;
let lastAviationRefreshAt = 0;
let transportWorkerStarted = false;
let transportRetentionTimer: NodeJS.Timeout | null = null;

function enabledFromEnv(name: string, fallback = true): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "no", "off"].includes(value);
}

function boundedIntegerFromEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Math.max(
    minimum,
    Math.min(Number.isFinite(parsed) ? parsed : fallback, maximum),
  );
}

function transportTrackSampleMilliseconds(): number {
  return (
    boundedIntegerFromEnv("TRANSPORT_TRACK_SAMPLE_SECONDS", 300, 60, 1_800) *
    1_000
  );
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const output = String(value).trim();
  return output || null;
}

function asFinite(value: unknown): number | null {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeIso2(value: unknown): string | null {
  const output = asString(value)?.toUpperCase() ?? "";
  return VALID_ISO2.has(output) ? output : null;
}

function isoDate(value: unknown, fallback = new Date()): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value)
        : typeof value === "string"
          ? new Date(value)
          : fallback;
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback.toISOString();
}

function count(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function boundsForGeometry(geometry: Polygon | MultiPolygon): [number, number, number, number] {
  const positions: Position[] =
    geometry.type === "Polygon"
      ? geometry.coordinates.flat()
      : geometry.coordinates.flat(2);
  return positions.reduce<[number, number, number, number]>(
    (bounds, position) => [
      Math.min(bounds[0], Number(position[0])),
      Math.min(bounds[1], Number(position[1])),
      Math.max(bounds[2], Number(position[0])),
      Math.max(bounds[3], Number(position[1])),
    ],
    [180, 90, -180, -90]
  );
}

function buildCountryGeometries(): CountryGeometry[] {
  const collection = feature(
    worldAtlas,
    worldAtlas.objects.countries
  ) as unknown as FeatureCollection<Geometry, Properties>;
  return collection.features.flatMap((countryFeature) => {
    const iso2 = ISO_BY_NUMERIC.get(String(countryFeature.id ?? "").padStart(3, "0"));
    if (!iso2 || iso2 === "AQ") return [];
    if (
      countryFeature.geometry.type !== "Polygon" &&
      countryFeature.geometry.type !== "MultiPolygon"
    ) {
      return [];
    }
    return [
      {
        iso2,
        name: COUNTRY_NAME_BY_ISO.get(iso2) ?? iso2,
        geometry: countryFeature.geometry,
        bounds: boundsForGeometry(countryFeature.geometry),
      },
    ];
  });
}

function pointInRing(longitude: number, latitude: number, ring: Position[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    const currentX = Number(currentPoint[0]);
    const currentY = Number(currentPoint[1]);
    const previousX = Number(previousPoint[0]);
    const previousY = Number(previousPoint[1]);
    const crosses =
      currentY > latitude !== previousY > latitude &&
      longitude <
        ((previousX - currentX) * (latitude - currentY)) /
          (previousY - currentY || Number.EPSILON) +
          currentX;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(longitude: number, latitude: number, polygon: Position[][]): boolean {
  if (!polygon[0] || !pointInRing(longitude, latitude, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(longitude, latitude, hole));
}

export function countryAtPosition(latitude: number, longitude: number): string | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  for (const country of COUNTRY_GEOMETRIES) {
    const [minLon, minLat, maxLon, maxLat] = country.bounds;
    if (
      longitude < minLon ||
      longitude > maxLon ||
      latitude < minLat ||
      latitude > maxLat
    ) {
      continue;
    }
    const polygons =
      country.geometry.type === "Polygon"
        ? [country.geometry.coordinates]
        : country.geometry.coordinates;
    if (polygons.some((polygon) => pointInPolygon(longitude, latitude, polygon))) {
      return country.iso2;
    }
  }
  return null;
}

function destinationCountryFromText(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  const unLocode = normalized.match(/(?:^|\s)([A-Z]{2})[A-Z]{3}(?:\s|$)/)?.[1];
  if (unLocode && VALID_ISO2.has(unLocode)) return unLocode;
  for (const port of MARITIME_PORTS) {
    if (port.pattern.test(normalized)) return port.iso2;
  }
  for (const country of COUNTRY_REFERENCES) {
    const name = country.name?.common?.toUpperCase();
    if (name && normalized.includes(name) && country.cca2) return country.cca2.toUpperCase();
  }
  return null;
}

function maritimeCategory(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  const numeric = Number.parseInt(normalized, 10);
  if (Number.isFinite(numeric)) {
    if (numeric === 30) return "fishing";
    if (numeric >= 40 && numeric <= 49) return "high_speed";
    if (numeric >= 60 && numeric <= 69) return "passenger";
    if (numeric >= 70 && numeric <= 79) return "cargo";
    if (numeric >= 80 && numeric <= 89) return "tanker";
    if (numeric >= 31 && numeric <= 39) return "service";
    if (numeric >= 50 && numeric <= 59) return "service";
    if (numeric >= 90 && numeric <= 99) return "other";
  }
  if (normalized.includes("cargo") || normalized.includes("freight")) return "cargo";
  if (normalized.includes("tanker")) return "tanker";
  if (normalized.includes("passenger") || normalized.includes("ferry")) return "passenger";
  if (normalized.includes("fishing")) return "fishing";
  return null;
}

function distanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (latitudeB - latitudeA) * radians;
  const longitudeDelta = (longitudeB - longitudeA) * radians;
  const firstLatitude = latitudeA * radians;
  const secondLatitude = latitudeB * radians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function maritimePortAtPosition(
  latitude: number,
  longitude: number
): MaritimePort | null {
  let nearest: { port: MaritimePort; distance: number } | null = null;
  for (const port of MARITIME_PORTS) {
    const distance = distanceKm(
      latitude,
      longitude,
      port.latitude,
      port.longitude
    );
    if (distance > port.radius_km || (nearest && distance >= nearest.distance)) continue;
    nearest = { port, distance };
  }
  return nearest?.port ?? null;
}

function resolveAisBoundingBoxes(): unknown[] {
  const configured = process.env.AISSTREAM_BOUNDING_BOXES?.trim();
  if (configured) {
    try {
      const parsed = JSON.parse(configured);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      console.warn("AISSTREAM_BOUNDING_BOXES is not valid JSON; using global coverage.");
    }
  }
  return [[[-90, -180], [90, 180]]];
}

function aisSampleMilliseconds(): number {
  return (
    boundedIntegerFromEnv("AISSTREAM_SAMPLE_SECONDS", 300, 60, 900) * 1_000
  );
}

function queueMaritimeMessage(message: unknown): void {
  const envelope = asRecord(message);
  if (!envelope) return;
  if (typeof envelope.error === "string") {
    console.warn(`AISstream subscription error: ${envelope.error}`);
    return;
  }
  const messageType = asString(envelope.MessageType);
  const metadata = asRecord(envelope.MetaData ?? envelope.Metadata) ?? {};
  const messageContainer = asRecord(envelope.Message) ?? {};
  const body = (messageType ? asRecord(messageContainer[messageType]) : null) ?? {};
  const reportA = asRecord(body.ReportA) ?? {};
  const reportB = asRecord(body.ReportB) ?? {};
  const mmsi =
    asString(body.UserID) ??
    asString(reportA.UserID) ??
    asString(reportB.UserID) ??
    asString(metadata.MMSI);
  if (!mmsi || !/^\d{9}$/.test(mmsi)) return;

  const latitude = asFinite(body.Latitude ?? metadata.latitude ?? metadata.Latitude);
  const longitude = asFinite(body.Longitude ?? metadata.longitude ?? metadata.Longitude);
  const observedAt = isoDate(metadata.time_utc);
  const now = Date.now();
  const isPosition =
    latitude != null &&
    longitude != null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;

  const displayName =
    asString(body.Name) ??
    asString(reportA.Name) ??
    asString(metadata.ShipName);
  const callsign = asString(body.CallSign ?? reportB.CallSign);
  const destinationName = asString(body.Destination);
  const shipType = asString(body.Type ?? reportB.ShipType);

  if (displayName || callsign || destinationName || shipType) {
    const destinationCountry = destinationCountryFromText(destinationName);
    maritimeStatic.set(mmsi, {
      ...maritimeStatic.get(mmsi),
      display_name: displayName ?? maritimeStatic.get(mmsi)?.display_name,
      callsign: callsign ?? maritimeStatic.get(mmsi)?.callsign,
      vehicle_type: shipType ?? maritimeStatic.get(mmsi)?.vehicle_type,
      vehicle_category:
        maritimeCategory(shipType) ?? maritimeStatic.get(mmsi)?.vehicle_category,
      destination_name: destinationName ?? maritimeStatic.get(mmsi)?.destination_name,
      destination_country_iso2:
        destinationCountry ?? maritimeStatic.get(mmsi)?.destination_country_iso2,
      route_label: destinationName
        ? `Destination ${destinationName}`
        : maritimeStatic.get(mmsi)?.route_label,
    });
  }

  if (isPosition && now - (lastMaritimeQueuedAt.get(mmsi) ?? 0) < aisSampleMilliseconds()) {
    return;
  }

  const staticData = maritimeStatic.get(mmsi);
  const registration = getCountryFromMMSI(mmsi);
  const registrationCountry = registration.valid ? normalizeIso2(registration.alpha2) : null;
  const currentPort =
    isPosition && latitude != null && longitude != null
      ? maritimePortAtPosition(latitude, longitude)
      : null;
  const currentCountry =
    isPosition && latitude != null && longitude != null
      ? currentPort?.iso2 ?? countryAtPosition(latitude, longitude)
      : null;
  if (currentCountry && !firstMaritimeCountry.has(mmsi)) {
    firstMaritimeCountry.set(mmsi, currentCountry);
  }
  const originCountry =
    staticData?.destination_country_iso2 &&
    firstMaritimeCountry.get(mmsi) !== staticData.destination_country_iso2
      ? firstMaritimeCountry.get(mmsi) ?? null
      : null;
  const navigationStatusNumber = asFinite(body.NavigationalStatus);
  const status =
    navigationStatusNumber == null
      ? null
      : NAVIGATION_STATUS[Math.round(navigationStatusNumber)] ??
        `Navigation status ${Math.round(navigationStatusNumber)}`;
  const alert =
    navigationStatusNumber != null &&
    [2, 6, 14].includes(Math.round(navigationStatusNumber));
  const linkageBasis = [
    currentCountry && !currentPort ? "position_country" : null,
    currentPort ? "port_geofence" : null,
    originCountry ? "voyage_origin" : null,
    staticData?.destination_country_iso2 ? "declared_destination" : null,
    registrationCountry ? "mmsi_flag" : null,
  ].filter((value): value is string => Boolean(value));

  const snapshot: TransportSnapshotInput = {
    mode: "maritime",
    entity_id: mmsi,
    display_name: displayName ?? staticData?.display_name ?? asString(metadata.ShipName),
    callsign: callsign ?? staticData?.callsign,
    registration: mmsi,
    vehicle_type: shipType ?? staticData?.vehicle_type ?? registration.type,
    vehicle_category:
      maritimeCategory(shipType) ?? staticData?.vehicle_category,
    latitude,
    longitude,
    heading: asFinite(body.TrueHeading ?? body.Cog),
    speed: asFinite(body.Sog),
    current_country_iso2: currentCountry,
    origin_country_iso2: originCountry,
    destination_country_iso2: staticData?.destination_country_iso2,
    registration_country_iso2: registrationCountry,
    origin_name: originCountry ? COUNTRY_NAME_BY_ISO.get(originCountry) ?? originCountry : null,
    destination_name: staticData?.destination_name,
    current_location_name: currentPort?.name,
    route_label: staticData?.route_label,
    linkage_basis: linkageBasis,
    linkage_confidence:
      currentCountry || staticData?.destination_country_iso2
        ? "high"
        : registrationCountry
          ? "medium"
          : "none",
    status,
    is_alert: alert,
    source_name: "aisstream",
    observed_at: observedAt,
    payload: {
      message_type: messageType,
      metadata,
      message: body,
      mmsi_type: registration.type,
    },
  };

  maritimeQueue.set(mmsi, snapshot);
  if (isPosition) lastMaritimeQueuedAt.set(mmsi, now);
  const maximumQueue = Math.max(
    500,
    Math.min(Number.parseInt(process.env.AISSTREAM_MAX_QUEUE || "5000", 10) || 5000, 25000)
  );
  if (maritimeQueue.size > maximumQueue) {
    const oldest = maritimeQueue.keys().next().value;
    if (oldest) maritimeQueue.delete(oldest);
  }
}

function connectAisStream(): void {
  if (!enabledFromEnv("AISSTREAM_ENABLED")) {
    console.info("AISstream ingestion is disabled by AISSTREAM_ENABLED.");
    return;
  }
  const apiKey = process.env.AISSTREAM_API_KEY?.trim();
  if (!apiKey) {
    console.info("AISstream ingestion is disabled until AISSTREAM_API_KEY is configured.");
    return;
  }
  if (
    aisSocket &&
    (aisSocket.readyState === WebSocket.OPEN || aisSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const socket = new WebSocket(AIS_STREAM_URL, {
    handshakeTimeout: 15_000,
  });
  aisSocket = socket;

  socket.on("open", () => {
    aisReconnectAttempt = 0;
    socket.send(
      JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: resolveAisBoundingBoxes(),
        FilterMessageTypes: [
          "PositionReport",
          "StandardClassBPositionReport",
          "ExtendedClassBPositionReport",
          "LongRangeAisBroadcastMessage",
          "ShipStaticData",
          "StaticDataReport",
        ],
      })
    );
    console.info("AISstream transport subscription connected.");
  });

  socket.on("message", (raw) => {
    try {
      queueMaritimeMessage(JSON.parse(raw.toString()));
    } catch (error) {
      console.warn(
        `Skipped malformed AISstream message: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  socket.on("error", (error) => {
    console.warn(`AISstream connection error: ${error.message}`);
  });

  socket.on("close", () => {
    if (aisSocket === socket) aisSocket = null;
    scheduleAisReconnect();
  });
}

function scheduleAisReconnect(): void {
  if (
    aisReconnectTimer ||
    !enabledFromEnv("AISSTREAM_ENABLED") ||
    !process.env.AISSTREAM_API_KEY?.trim()
  ) {
    return;
  }
  const delay = Math.min(60_000, 2_000 * 2 ** Math.min(aisReconnectAttempt, 5));
  aisReconnectAttempt += 1;
  aisReconnectTimer = setTimeout(() => {
    aisReconnectTimer = null;
    connectAisStream();
  }, delay);
  aisReconnectTimer.unref();
}

async function flushMaritimeQueue(): Promise<void> {
  if (maritimeQueue.size === 0) return;
  const snapshots = Array.from(maritimeQueue.values());
  maritimeQueue.clear();
  try {
    await storeTransportSnapshots(snapshots);
  } catch (error) {
    console.error(
      `AISstream flush failed for ${snapshots.length} snapshots: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    snapshots.slice(-2000).forEach((snapshot) => maritimeQueue.set(snapshot.entity_id, snapshot));
  }
}

function configuredAdsbPollPoints(): typeof ADSB_POLL_POINTS {
  const configured = process.env.ADSB_LOL_POLL_POINTS?.trim();
  if (!configured) return ADSB_POLL_POINTS;
  try {
    const parsed = JSON.parse(configured);
    if (!Array.isArray(parsed)) return ADSB_POLL_POINTS;
    const valid = parsed.flatMap((point, index) => {
      const row = asRecord(point);
      const lat = asFinite(row?.lat);
      const lon = asFinite(row?.lon);
      const radius = asFinite(row?.radius) ?? 250;
      if (lat == null || lon == null) return [];
      return [
        {
          label: asString(row?.label) ?? `Configured area ${index + 1}`,
          lat,
          lon,
          radius: Math.max(1, Math.min(radius, 250)),
        },
      ];
    });
    return valid.length > 0 ? valid : ADSB_POLL_POINTS;
  } catch {
    console.warn("ADSB_LOL_POLL_POINTS is not valid JSON; using the default global hub grid.");
    return ADSB_POLL_POINTS;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent":
          process.env.ADSB_LOL_USER_AGENT?.trim() ||
          "Claritas/1.0 (+https://app.claritas.info; engineering@claritas.info)",
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(`adsb.lol returned HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        output[index] = await operation(values[index], index);
      }
    })
  );
  return output;
}

async function getAdsbRoute(
  callsign: string,
  latitude: number,
  longitude: number
): Promise<AdsbRoute | null> {
  const cached = routeCache.get(callsign);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const route = await fetchJson<AdsbRoute>(
      `${ADSB_BASE_URL}/api/0/route/${encodeURIComponent(callsign)}/${latitude.toFixed(
        4
      )}/${longitude.toFixed(4)}`
    );
    const value =
      route && route.airport_codes && route.airport_codes !== "unknown" ? route : null;
    routeCache.set(callsign, {
      expiresAt: Date.now() + (value ? 20 * 60_000 : 2 * 60_000),
      value,
    });
    return value;
  } catch {
    routeCache.set(callsign, { expiresAt: Date.now() + 60_000, value: null });
    return null;
  }
}

function flightSnapshot(
  aircraft: AdsbAircraft,
  route: AdsbRoute | null,
  observedAt: string
): TransportSnapshotInput | null {
  const entityId = asString(aircraft.hex)?.toLowerCase();
  const latitude = asFinite(aircraft.lat);
  const longitude = asFinite(aircraft.lon);
  if (!entityId || latitude == null || longitude == null) return null;
  const callsign = asString(aircraft.flight)?.replace(/\s+/g, "");
  const airports = Array.isArray(route?._airports) ? route?._airports ?? [] : [];
  const origin = airports[0];
  const destination = airports.length > 1 ? airports[airports.length - 1] : undefined;
  const originCountry = normalizeIso2(origin?.countryiso2);
  const destinationCountry = normalizeIso2(destination?.countryiso2);
  const currentCountry = countryAtPosition(latitude, longitude);
  const routeNumber = asString(route?.number);
  const airlineCode = asString(route?.airline_code);
  const flightNumber =
    routeNumber && airlineCode ? `${airlineCode}${routeNumber}` : callsign;
  const squawk = asString(aircraft.squawk);
  const emergency = asString(aircraft.emergency)?.toLowerCase();
  const isAlert =
    Boolean(emergency && emergency !== "none" && emergency !== "no emergency") ||
    ["7500", "7600", "7700"].includes(squawk ?? "");
  const altitudeRaw = aircraft.alt_baro;
  const altitude =
    typeof altitudeRaw === "string" && altitudeRaw.toLowerCase() === "ground"
      ? 0
      : asFinite(altitudeRaw);
  const linkageBasis = [
    currentCountry ? "position_country" : null,
    originCountry ? "route_origin_airport" : null,
    destinationCountry ? "route_destination_airport" : null,
  ].filter((value): value is string => Boolean(value));
  const routeLabel =
    asString(route?._airport_codes_iata) ??
    asString(route?.airport_codes)?.replace(/-/g, " → ") ??
    null;

  return {
    mode: "aviation",
    entity_id: entityId,
    display_name: callsign ?? asString(aircraft.r) ?? entityId.toUpperCase(),
    callsign,
    flight_number: flightNumber,
    registration: asString(aircraft.r),
    vehicle_type: asString(aircraft.t),
    vehicle_category: "aircraft",
    latitude,
    longitude,
    heading: asFinite(aircraft.track),
    speed: asFinite(aircraft.gs),
    altitude,
    vertical_rate: asFinite(aircraft.baro_rate ?? aircraft.geom_rate),
    current_country_iso2: currentCountry,
    origin_country_iso2: originCountry,
    destination_country_iso2: destinationCountry,
    origin_name: origin?.name ?? origin?.location ?? null,
    destination_name: destination?.name ?? destination?.location ?? null,
    origin_latitude: asFinite(origin?.lat),
    origin_longitude: asFinite(origin?.lon),
    destination_latitude: asFinite(destination?.lat),
    destination_longitude: asFinite(destination?.lon),
    route_label: routeLabel,
    linkage_basis: linkageBasis,
    linkage_confidence:
      originCountry && destinationCountry ? "high" : currentCountry ? "medium" : "none",
    status: isAlert ? emergency ?? `Squawk ${squawk}` : altitude === 0 ? "On ground" : "Airborne",
    is_alert: isAlert,
    source_name: "adsb_lol",
    observed_at: observedAt,
    payload: {
      aircraft,
      route,
      source_license: "ODbL-1.0",
    },
  };
}

async function runAviationRefresh(): Promise<{ fetched: number; stored: number }> {
  const pointResults = await mapWithConcurrency(
    configuredAdsbPollPoints(),
    4,
    async (point) => {
      try {
        return await fetchJson<AdsbPointResponse>(
          `${ADSB_BASE_URL}/v2/point/${point.lat}/${point.lon}/${point.radius}`
        );
      } catch (error) {
        console.warn(
          `adsb.lol poll failed for ${point.label}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return { ac: [], now: Date.now() } satisfies AdsbPointResponse;
      }
    }
  );
  const byHex = new Map<string, { aircraft: AdsbAircraft; observedAt: string }>();
  for (const result of pointResults) {
    const responseTime = asFinite(result.now) ?? Date.now();
    const responseTimeMs =
      Math.abs(responseTime) < 1_000_000_000_000 ? responseTime * 1000 : responseTime;
    for (const aircraft of result.ac ?? []) {
      const hex = asString(aircraft.hex)?.toLowerCase();
      const seen = asFinite(aircraft.seen) ?? 0;
      if (!hex || seen > 180 || asFinite(aircraft.lat) == null || asFinite(aircraft.lon) == null) {
        continue;
      }
      const observedAt = isoDate(responseTimeMs - Math.max(seen, 0) * 1000);
      const previous = byHex.get(hex);
      if (!previous || observedAt > previous.observedAt) {
        byHex.set(hex, { aircraft, observedAt });
      }
    }
  }

  const routeByHex = new Map<string, AdsbRoute | null>();
  const routeCandidates = Array.from(byHex.values())
    .filter((entry) => {
      const hex = asString(entry.aircraft.hex)?.toLowerCase();
      const callsign = asString(entry.aircraft.flight)?.replace(/\s+/g, "");
      if (!hex || !callsign) return false;
      const cached = routeCache.get(callsign);
      if (cached && cached.expiresAt > Date.now()) {
        routeByHex.set(hex, cached.value);
        return false;
      }
      return true;
    })
    .slice(
      0,
      Math.max(
        10,
        Math.min(Number.parseInt(process.env.ADSB_LOL_MAX_ROUTE_LOOKUPS || "60", 10) || 60, 100)
      )
    );
  const routes = await mapWithConcurrency(routeCandidates, 6, async (entry) => {
    const callsign = asString(entry.aircraft.flight)?.replace(/\s+/g, "");
    const latitude = asFinite(entry.aircraft.lat);
    const longitude = asFinite(entry.aircraft.lon);
    return callsign && latitude != null && longitude != null
      ? getAdsbRoute(callsign, latitude, longitude)
      : null;
  });
  routeCandidates.forEach((entry, index) => {
    const hex = asString(entry.aircraft.hex)?.toLowerCase();
    if (hex) routeByHex.set(hex, routes[index]);
  });
  const snapshots = Array.from(byHex.values()).flatMap((entry) => {
    const hex = asString(entry.aircraft.hex)?.toLowerCase();
    const snapshot = flightSnapshot(
      entry.aircraft,
      hex ? routeByHex.get(hex) ?? null : null,
      entry.observedAt
    );
    return snapshot ? [snapshot] : [];
  });
  await storeTransportSnapshots(snapshots);
  lastAviationRefreshAt = Date.now();
  return { fetched: byHex.size, stored: snapshots.length };
}

export async function refreshAviationNow(
  force = false
): Promise<{ fetched: number; stored: number }> {
  const minimumSpacing = Math.max(
    30,
    Math.min(Number.parseInt(process.env.ADSB_LOL_MIN_REFRESH_SECONDS || "90", 10) || 90, 900)
  );
  if (!force && Date.now() - lastAviationRefreshAt < minimumSpacing * 1000) {
    return { fetched: 0, stored: 0 };
  }
  if (!aviationRefresh) {
    aviationRefresh = runAviationRefresh().finally(() => {
      aviationRefresh = null;
    });
  }
  return aviationRefresh;
}

async function storeTransportSnapshots(snapshots: TransportSnapshotInput[]): Promise<void> {
  for (let offset = 0; offset < snapshots.length; offset += 100) {
    const batch = snapshots.slice(offset, offset + 100);
    if (batch.length === 0) continue;
    const values: unknown[] = [];
    const rows = batch.map((snapshot, index) => {
      const start = index * 33;
      values.push(
        snapshot.mode,
        snapshot.entity_id,
        snapshot.display_name ?? null,
        snapshot.callsign ?? null,
        snapshot.flight_number ?? null,
        snapshot.registration ?? null,
        snapshot.vehicle_type ?? null,
        snapshot.latitude ?? null,
        snapshot.longitude ?? null,
        snapshot.heading ?? null,
        snapshot.speed ?? null,
        snapshot.altitude ?? null,
        snapshot.vertical_rate ?? null,
        snapshot.current_country_iso2 ?? null,
        snapshot.origin_country_iso2 ?? null,
        snapshot.destination_country_iso2 ?? null,
        snapshot.registration_country_iso2 ?? null,
        snapshot.origin_name ?? null,
        snapshot.destination_name ?? null,
        snapshot.origin_latitude ?? null,
        snapshot.origin_longitude ?? null,
        snapshot.destination_latitude ?? null,
        snapshot.destination_longitude ?? null,
        snapshot.route_label ?? null,
        snapshot.linkage_basis ?? [],
        snapshot.linkage_confidence ?? "none",
        snapshot.status ?? null,
        snapshot.is_alert ?? false,
        snapshot.source_name,
        snapshot.observed_at,
        JSON.stringify(snapshot.payload),
        snapshot.vehicle_category ?? null,
        snapshot.current_location_name ?? null
      );
      return `(${Array.from({ length: 33 }, (_, valueIndex) => `$${start + valueIndex + 1}`).join(
        ", "
      )})`;
    });
    await query(
      `INSERT INTO transport_snapshot (
         mode, entity_id, display_name, callsign, flight_number, registration,
         vehicle_type, latitude, longitude, heading, speed, altitude, vertical_rate,
         current_country_iso2, origin_country_iso2, destination_country_iso2,
         registration_country_iso2, origin_name, destination_name, origin_latitude,
         origin_longitude, destination_latitude, destination_longitude, route_label,
         linkage_basis, linkage_confidence, status, is_alert, source_name, observed_at,
         payload, vehicle_category, current_location_name
       ) VALUES ${rows.join(", ")}
       ON CONFLICT (mode, entity_id) DO UPDATE SET
         display_name = COALESCE(EXCLUDED.display_name, transport_snapshot.display_name),
         callsign = COALESCE(EXCLUDED.callsign, transport_snapshot.callsign),
         flight_number = COALESCE(EXCLUDED.flight_number, transport_snapshot.flight_number),
         registration = COALESCE(EXCLUDED.registration, transport_snapshot.registration),
         vehicle_type = COALESCE(EXCLUDED.vehicle_type, transport_snapshot.vehicle_type),
         latitude = CASE
           WHEN EXCLUDED.latitude IS NULL
             OR EXCLUDED.observed_at < transport_snapshot.observed_at
             THEN transport_snapshot.latitude
           ELSE EXCLUDED.latitude
         END,
         longitude = CASE
           WHEN EXCLUDED.longitude IS NULL
             OR EXCLUDED.observed_at < transport_snapshot.observed_at
             THEN transport_snapshot.longitude
           ELSE EXCLUDED.longitude
         END,
         heading = CASE
           WHEN EXCLUDED.latitude IS NULL
             OR EXCLUDED.observed_at < transport_snapshot.observed_at
             THEN transport_snapshot.heading
           ELSE COALESCE(EXCLUDED.heading, transport_snapshot.heading)
         END,
         speed = CASE
           WHEN EXCLUDED.latitude IS NULL
             OR EXCLUDED.observed_at < transport_snapshot.observed_at
             THEN transport_snapshot.speed
           ELSE COALESCE(EXCLUDED.speed, transport_snapshot.speed)
         END,
         altitude = CASE
           WHEN EXCLUDED.latitude IS NULL
             OR EXCLUDED.observed_at < transport_snapshot.observed_at
             THEN transport_snapshot.altitude
           ELSE COALESCE(EXCLUDED.altitude, transport_snapshot.altitude)
         END,
         vertical_rate = CASE
           WHEN EXCLUDED.latitude IS NULL
             OR EXCLUDED.observed_at < transport_snapshot.observed_at
             THEN transport_snapshot.vertical_rate
           ELSE COALESCE(EXCLUDED.vertical_rate, transport_snapshot.vertical_rate)
         END,
         current_country_iso2 = CASE
           WHEN EXCLUDED.latitude IS NULL
             OR EXCLUDED.observed_at < transport_snapshot.observed_at
             THEN transport_snapshot.current_country_iso2
           ELSE EXCLUDED.current_country_iso2
         END,
         origin_country_iso2 = COALESCE(EXCLUDED.origin_country_iso2, transport_snapshot.origin_country_iso2),
         destination_country_iso2 = COALESCE(EXCLUDED.destination_country_iso2, transport_snapshot.destination_country_iso2),
         registration_country_iso2 = COALESCE(EXCLUDED.registration_country_iso2, transport_snapshot.registration_country_iso2),
         origin_name = COALESCE(EXCLUDED.origin_name, transport_snapshot.origin_name),
         destination_name = COALESCE(EXCLUDED.destination_name, transport_snapshot.destination_name),
         origin_latitude = COALESCE(EXCLUDED.origin_latitude, transport_snapshot.origin_latitude),
         origin_longitude = COALESCE(EXCLUDED.origin_longitude, transport_snapshot.origin_longitude),
         destination_latitude = COALESCE(EXCLUDED.destination_latitude, transport_snapshot.destination_latitude),
         destination_longitude = COALESCE(EXCLUDED.destination_longitude, transport_snapshot.destination_longitude),
         route_label = COALESCE(EXCLUDED.route_label, transport_snapshot.route_label),
         linkage_basis = CASE
           WHEN cardinality(EXCLUDED.linkage_basis) > 0 THEN EXCLUDED.linkage_basis
           ELSE transport_snapshot.linkage_basis
         END,
         linkage_confidence = CASE
           WHEN EXCLUDED.linkage_confidence <> 'none' THEN EXCLUDED.linkage_confidence
           ELSE transport_snapshot.linkage_confidence
         END,
         status = COALESCE(EXCLUDED.status, transport_snapshot.status),
         is_alert = CASE
           WHEN EXCLUDED.status IS NULL THEN transport_snapshot.is_alert
           ELSE EXCLUDED.is_alert
         END,
         source_name = EXCLUDED.source_name,
         observed_at = GREATEST(EXCLUDED.observed_at, transport_snapshot.observed_at),
         payload = transport_snapshot.payload || EXCLUDED.payload,
         vehicle_category = COALESCE(EXCLUDED.vehicle_category, transport_snapshot.vehicle_category),
         current_location_name = CASE
           WHEN EXCLUDED.latitude IS NULL
             OR EXCLUDED.observed_at < transport_snapshot.observed_at
             THEN transport_snapshot.current_location_name
           ELSE EXCLUDED.current_location_name
         END`,
      values
    );
  }

  const trackPoints = snapshots.filter((snapshot) => {
    if (snapshot.latitude == null || snapshot.longitude == null) return false;
    const key = `${snapshot.mode}:${snapshot.entity_id}`;
    const observed = new Date(snapshot.observed_at).getTime();
    if (
      observed - (lastTrackAt.get(key) ?? 0) <
      transportTrackSampleMilliseconds()
    ) {
      return false;
    }
    lastTrackAt.set(key, observed);
    return true;
  });
  for (let offset = 0; offset < trackPoints.length; offset += 200) {
    const batch = trackPoints.slice(offset, offset + 200);
    const values: unknown[] = [];
    const rows = batch.map((snapshot, index) => {
      const start = index * 14;
      const observed = new Date(snapshot.observed_at);
      observed.setUTCSeconds(0, 0);
      values.push(
        snapshot.mode,
        snapshot.entity_id,
        snapshot.latitude,
        snapshot.longitude,
        snapshot.heading ?? null,
        snapshot.speed ?? null,
        snapshot.altitude ?? null,
        snapshot.current_country_iso2 ?? null,
        snapshot.origin_country_iso2 ?? null,
        snapshot.destination_country_iso2 ?? null,
        observed.toISOString(),
        snapshot.source_name,
        snapshot.vehicle_category ?? null,
        snapshot.current_location_name ?? null
      );
      return `(${Array.from({ length: 14 }, (_, valueIndex) => `$${start + valueIndex + 1}`).join(
        ", "
      )})`;
    });
    await query(
      `INSERT INTO transport_track_point (
         mode, entity_id, latitude, longitude, heading, speed, altitude,
         current_country_iso2, origin_country_iso2, destination_country_iso2,
         observed_at, source_name, vehicle_category, current_location_name
       ) VALUES ${rows.join(", ")}
       ON CONFLICT (mode, entity_id, observed_at) DO NOTHING`,
      values
    );
  }

  const activityRows = trackPoints.flatMap((snapshot) => {
    const bucket = new Date(snapshot.observed_at);
    bucket.setUTCMinutes(0, 0, 0);
    const scopes = new Set<string>([TRANSPORT_SCOPE_GLOBAL]);
    [
      snapshot.current_country_iso2,
      snapshot.origin_country_iso2,
      snapshot.destination_country_iso2,
    ].forEach((country) => {
      const normalized = normalizeIso2(country);
      if (normalized) scopes.add(normalized);
    });
    return Array.from(scopes, (country) => ({
      snapshot,
      country,
      bucket: bucket.toISOString(),
    }));
  });
  for (let offset = 0; offset < activityRows.length; offset += 500) {
    const batch = activityRows.slice(offset, offset + 500);
    const values: unknown[] = [];
    const rows = batch.map(({ snapshot, country, bucket }, index) => {
      const start = index * 8;
      values.push(
        bucket,
        snapshot.mode,
        snapshot.entity_id,
        country,
        snapshot.observed_at,
        snapshot.observed_at,
        snapshot.source_name,
        snapshot.vehicle_category ?? null,
      );
      return `(${Array.from(
        { length: 8 },
        (_, valueIndex) => `$${start + valueIndex + 1}`,
      ).join(", ")})`;
    });
    await query(
      `INSERT INTO transport_entity_activity_hour (
         bucket, mode, entity_id, country_iso2, first_observed_at,
         last_observed_at, source_name, vehicle_category
       ) VALUES ${rows.join(", ")}
       ON CONFLICT (bucket, mode, entity_id, country_iso2) DO UPDATE SET
         first_observed_at = LEAST(
           transport_entity_activity_hour.first_observed_at,
           EXCLUDED.first_observed_at
         ),
         last_observed_at = GREATEST(
           transport_entity_activity_hour.last_observed_at,
           EXCLUDED.last_observed_at
         ),
         source_name = EXCLUDED.source_name,
         vehicle_category = COALESCE(
           EXCLUDED.vehicle_category,
           transport_entity_activity_hour.vehicle_category
         )`,
      values,
    );
  }
}

function activeTransportWhere(alias = "s"): string {
  return `(
    (${alias}.mode = 'maritime' AND ${alias}.observed_at >= now() - interval '2 hours')
    OR
    (${alias}.mode = 'aviation' AND ${alias}.observed_at >= now() - interval '20 minutes')
  )`;
}

function serializeEntity(row: TransportSnapshotRow) {
  const links = [
    row.current_country_iso2
      ? { role: "current", country: row.current_country_iso2 }
      : null,
    row.origin_country_iso2
      ? { role: "origin", country: row.origin_country_iso2 }
      : null,
    row.destination_country_iso2
      ? { role: "destination", country: row.destination_country_iso2 }
      : null,
    row.registration_country_iso2
      ? { role: row.mode === "maritime" ? "flag" : "registration", country: row.registration_country_iso2 }
      : null,
  ].filter(Boolean);
  return {
    ...row,
    id: `${row.mode}:${row.entity_id}`,
    observed_at: isoDate(row.observed_at),
    linkage_basis: row.linkage_basis ?? [],
    country_links: links,
  };
}

function percentageChange(currentValue: number, previousValue: number): number | null {
  if (previousValue === 0) return currentValue === 0 ? 0 : null;
  return Math.round(((currentValue - previousValue) / previousValue) * 10_000) / 100;
}

function trendDirection(
  currentValue: number,
  previousValue: number
): "up" | "down" | "flat" | "new" {
  if (previousValue === 0 && currentValue > 0) return "new";
  if (currentValue > previousValue) return "up";
  if (currentValue < previousValue) return "down";
  return "flat";
}

function transportTrendMetric(currentValue: number, previousValue: number) {
  return {
    current: currentValue,
    previous: previousValue,
    change_pct: percentageChange(currentValue, previousValue),
    direction: trendDirection(currentValue, previousValue),
  };
}

function emptyCountryTransportTrend() {
  return {
    ship_departures: transportTrendMetric(0, 0),
    cargo_vessel_departures: transportTrendMetric(0, 0),
    ship_arrivals: transportTrendMetric(0, 0),
    tracked_flights: transportTrendMetric(0, 0),
  };
}

function describeTrendChange(
  metric: ReturnType<typeof transportTrendMetric>,
  noun: string
): string {
  if (metric.direction === "new") {
    return `${metric.current} ${noun}; the previous 24-hour window had no comparable observations.`;
  }
  if (metric.change_pct == null || metric.direction === "flat") {
    return `${metric.current} ${noun}, unchanged from the previous 24-hour window.`;
  }
  return `${metric.current} ${noun}, ${Math.abs(metric.change_pct).toFixed(1)}% ${
    metric.direction === "up" ? "higher" : "lower"
  } than the previous 24-hour window.`;
}

type TransportOverviewOptions = {
  detail?: TransportDetailLevel;
  mode?: TransportMode;
  country?: string;
  entityLimit?: number;
  bypassCache?: boolean;
};

async function loadTransportOverview(options?: TransportOverviewOptions) {
  const detail = options?.detail ?? "aggregate";
  const mode = options?.mode ?? null;
  const country = normalizeIso2(options?.country) ?? null;
  const filters = [
    activeTransportWhere("s"),
    mode ? `s.mode = $1` : null,
    country
      ? `(s.current_country_iso2 = $${mode ? 2 : 1}
          OR s.origin_country_iso2 = $${mode ? 2 : 1}
          OR s.destination_country_iso2 = $${mode ? 2 : 1}
          OR s.registration_country_iso2 = $${mode ? 2 : 1})`
      : null,
  ].filter(Boolean);
  const params: unknown[] = [];
  if (mode) params.push(mode);
  if (country) params.push(country);
  const where = filters.join(" AND ");

  const trendCountryParams = country ? [country] : [];
  const [
    modeResult,
    countryResult,
    routeResult,
    activityResult,
  ] = await Promise.all([
    query<ModeAggregateRow>(
      `SELECT
         s.mode,
         COUNT(*) AS active_count,
         COUNT(*) FILTER (
           WHERE s.destination_country_iso2 IS NOT NULL
             AND COALESCE(
               s.origin_country_iso2,
               CASE WHEN s.mode = 'maritime' THEN s.registration_country_iso2 END
             ) IS NOT NULL
         ) AS routed_count,
         COUNT(*) FILTER (WHERE s.is_alert) AS alert_count,
         MAX(s.observed_at) AS latest_observed_at
       FROM transport_snapshot s
       WHERE ${where}
       GROUP BY s.mode
       ORDER BY s.mode`,
      params
    ),
    query<CountryAggregateRow>(
      `WITH linked AS (
         SELECT
           s.id,
           s.mode,
           link.role,
           link.country
         FROM transport_snapshot s
         CROSS JOIN LATERAL (
           VALUES
             ('current', s.current_country_iso2),
             ('origin', s.origin_country_iso2),
             ('destination', s.destination_country_iso2),
             ('registration', s.registration_country_iso2)
         ) AS link(role, country)
         WHERE ${where} AND link.country IS NOT NULL
       )
       SELECT
         mode,
         country,
         COUNT(DISTINCT id) AS active_count,
         COUNT(DISTINCT id) FILTER (WHERE role = 'current') AS current_count,
         COUNT(DISTINCT id) FILTER (WHERE role = 'origin') AS origin_count,
         COUNT(DISTINCT id) FILTER (WHERE role = 'destination') AS destination_count,
         COUNT(DISTINCT id) FILTER (WHERE role = 'registration') AS registration_count
       FROM linked
       GROUP BY mode, country
       ORDER BY active_count DESC, country`,
      params
    ),
    query<RouteAggregateRow>(
      `SELECT
         s.mode,
         COALESCE(
           s.origin_country_iso2,
           CASE WHEN s.mode = 'maritime' THEN s.registration_country_iso2 END
         ) AS origin_country,
         s.destination_country_iso2 AS destination_country,
         COUNT(*) AS active_count,
         (ARRAY_AGG(
           COALESCE(s.flight_number, s.callsign, s.display_name, s.entity_id)
           ORDER BY s.observed_at DESC
         ))[1:5] AS examples
       FROM transport_snapshot s
       WHERE ${where}
         AND s.destination_country_iso2 IS NOT NULL
         AND COALESCE(
           s.origin_country_iso2,
           CASE WHEN s.mode = 'maritime' THEN s.registration_country_iso2 END
         ) IS NOT NULL
       GROUP BY s.mode, origin_country, destination_country
       ORDER BY active_count DESC
       LIMIT 100`,
      params
    ),
    query<ActivityRow>(
      `SELECT
         a.bucket,
         a.mode,
         COUNT(DISTINCT a.entity_id) AS active_count
       FROM transport_entity_activity_hour a
       WHERE a.last_observed_at >= now() - interval '24 hours'
         AND a.country_iso2 = ${
           country ? `$${mode ? 2 : 1}` : `'${TRANSPORT_SCOPE_GLOBAL}'`
         }
         ${mode ? `AND a.mode = $1` : ""}
       GROUP BY a.bucket, a.mode
       ORDER BY a.bucket, a.mode`,
      params
    ),
  ]);

  // Keep a single overview refresh below the per-replica pool cap. The second
  // wave reads compact event/hour tables and cannot starve unrelated requests.
  const [movementTrendResult, aviationTrendResult, portTrendResult] =
    await Promise.all([
    mode === "aviation"
      ? Promise.resolve({ rows: [] as TransportTrendRow[] })
      : query<TransportTrendRow>(
          `SELECT
             CASE
               WHEN GROUPING(e.country_iso2) = 1 THEN NULL
               ELSE BTRIM(e.country_iso2::text)
             END AS country,
             COUNT(*) FILTER (
               WHERE e.event_type = 'departure'
                 AND e.observed_at >= now() - interval '24 hours'
             ) AS departures_current,
             COUNT(*) FILTER (
               WHERE e.event_type = 'departure'
                 AND e.observed_at < now() - interval '24 hours'
             ) AS departures_previous,
             COUNT(*) FILTER (
               WHERE e.event_type = 'departure'
                 AND e.vehicle_category IN ('cargo', 'tanker')
                 AND e.observed_at >= now() - interval '24 hours'
             ) AS cargo_departures_current,
             COUNT(*) FILTER (
               WHERE e.event_type = 'departure'
                 AND e.vehicle_category IN ('cargo', 'tanker')
                 AND e.observed_at < now() - interval '24 hours'
             ) AS cargo_departures_previous,
             COUNT(*) FILTER (
               WHERE e.event_type = 'arrival'
                 AND e.observed_at >= now() - interval '24 hours'
             ) AS arrivals_current,
             COUNT(*) FILTER (
               WHERE e.event_type = 'arrival'
                 AND e.observed_at < now() - interval '24 hours'
             ) AS arrivals_previous
           FROM transport_movement_event e
           WHERE e.observed_at >= now() - interval '48 hours'
             ${country ? "AND BTRIM(e.country_iso2::text) = $1" : ""}
           GROUP BY GROUPING SETS ((e.country_iso2), ())`,
          trendCountryParams
        ),
    mode === "maritime"
      ? Promise.resolve({ rows: [] as AviationTrendRow[] })
      : query<AviationTrendRow>(
          `WITH country_counts AS (
             SELECT
               a.country_iso2 AS country,
               COUNT(DISTINCT a.entity_id) FILTER (
                 WHERE a.last_observed_at >= now() - interval '24 hours'
               ) AS flights_current,
               COUNT(DISTINCT a.entity_id) FILTER (
                 WHERE a.first_observed_at < now() - interval '24 hours'
                   AND a.last_observed_at >= now() - interval '48 hours'
               ) AS flights_previous
             FROM transport_entity_activity_hour a
             WHERE a.mode = 'aviation'
               AND a.country_iso2 <> '${TRANSPORT_SCOPE_GLOBAL}'
               AND a.last_observed_at >= now() - interval '48 hours'
               ${country ? "AND a.country_iso2 = $1" : ""}
             GROUP BY a.country_iso2
           ),
           total_count AS (
             SELECT
               NULL::text AS country,
               COUNT(DISTINCT a.entity_id) FILTER (
                 WHERE a.last_observed_at >= now() - interval '24 hours'
               ) AS flights_current,
               COUNT(DISTINCT a.entity_id) FILTER (
                 WHERE a.first_observed_at < now() - interval '24 hours'
                   AND a.last_observed_at >= now() - interval '48 hours'
               ) AS flights_previous
             FROM transport_entity_activity_hour a
             WHERE a.mode = 'aviation'
               AND a.last_observed_at >= now() - interval '48 hours'
               AND a.country_iso2 = ${country ? "$1" : `'${TRANSPORT_SCOPE_GLOBAL}'`}
           )
           SELECT country, flights_current, flights_previous
           FROM country_counts
           UNION ALL
           SELECT country, flights_current, flights_previous
           FROM total_count`,
          trendCountryParams
        ),
    mode === "aviation"
      ? Promise.resolve({ rows: [] as PortTrendRow[] })
      : query<PortTrendRow>(
          `SELECT
             BTRIM(e.country_iso2::text) AS country,
             e.location_name,
             COUNT(*) FILTER (WHERE e.event_type = 'departure') AS departures_current,
             COUNT(*) FILTER (WHERE e.event_type = 'arrival') AS arrivals_current,
             COUNT(*) FILTER (
               WHERE e.event_type = 'departure'
                 AND e.vehicle_category IN ('cargo', 'tanker')
             ) AS cargo_departures_current
           FROM transport_movement_event e
           WHERE e.observed_at >= now() - interval '24 hours'
             ${country ? "AND BTRIM(e.country_iso2::text) = $1" : ""}
           GROUP BY e.country_iso2, e.location_name
           ORDER BY COUNT(*) DESC, location_name
           LIMIT 20`,
          trendCountryParams
        ),
    ]);

  const countries = new Map<
    string,
    {
      country: string;
      country_name: string;
      active_count: number;
      maritime: { active: number; current: number; origins: number; destinations: number; flagged: number };
      aviation: { active: number; current: number; origins: number; destinations: number; registered: number };
      trend: ReturnType<typeof emptyCountryTransportTrend>;
    }
  >();
  const aggregateForCountry = (iso2: string) => {
    const normalized = iso2.trim().toUpperCase();
    const existing = countries.get(normalized);
    if (existing) return existing;
    const created = {
      country: normalized,
      country_name: COUNTRY_NAME_BY_ISO.get(normalized) ?? normalized,
      active_count: 0,
      maritime: { active: 0, current: 0, origins: 0, destinations: 0, flagged: 0 },
      aviation: { active: 0, current: 0, origins: 0, destinations: 0, registered: 0 },
      trend: emptyCountryTransportTrend(),
    };
    countries.set(normalized, created);
    return created;
  };
  for (const row of countryResult.rows) {
    const iso2 = row.country.trim().toUpperCase();
    const aggregate = aggregateForCountry(iso2);
    const active = count(row.active_count);
    aggregate.active_count += active;
    if (row.mode === "maritime") {
      aggregate.maritime = {
        active,
        current: count(row.current_count),
        origins: count(row.origin_count),
        destinations: count(row.destination_count),
        flagged: count(row.registration_count),
      };
    } else {
      aggregate.aviation = {
        active,
        current: count(row.current_count),
        origins: count(row.origin_count),
        destinations: count(row.destination_count),
        registered: count(row.registration_count),
      };
    }
  }

  for (const row of movementTrendResult.rows) {
    if (!row.country) continue;
    const aggregate = aggregateForCountry(row.country);
    aggregate.trend.ship_departures = transportTrendMetric(
      count(row.departures_current),
      count(row.departures_previous)
    );
    aggregate.trend.cargo_vessel_departures = transportTrendMetric(
      count(row.cargo_departures_current),
      count(row.cargo_departures_previous)
    );
    aggregate.trend.ship_arrivals = transportTrendMetric(
      count(row.arrivals_current),
      count(row.arrivals_previous)
    );
  }
  for (const row of aviationTrendResult.rows) {
    if (!row.country) continue;
    const aggregate = aggregateForCountry(row.country);
    aggregate.trend.tracked_flights = transportTrendMetric(
      count(row.flights_current),
      count(row.flights_previous)
    );
  }

  const summaryModes = {
    maritime: { active: 0, routed: 0, alerts: 0, latest_observed_at: null as string | null },
    aviation: { active: 0, routed: 0, alerts: 0, latest_observed_at: null as string | null },
  };
  for (const row of modeResult.rows) {
    summaryModes[row.mode] = {
      active: count(row.active_count),
      routed: count(row.routed_count),
      alerts: count(row.alert_count),
      latest_observed_at: row.latest_observed_at ? isoDate(row.latest_observed_at) : null,
    };
  }

  let entities: ReturnType<typeof serializeEntity>[] = [];
  if (detail === "full") {
    const entityLimit = Math.max(25, Math.min(options?.entityLimit ?? 900, 2500));
    const entityResult = await query<TransportSnapshotRow>(
      `SELECT
         s.id, s.mode, s.entity_id, s.display_name, s.callsign, s.flight_number,
         s.registration, s.vehicle_type, s.vehicle_category,
         s.latitude, s.longitude, s.heading,
         s.speed, s.altitude, s.vertical_rate, s.current_country_iso2,
         s.origin_country_iso2, s.destination_country_iso2,
         s.registration_country_iso2, s.origin_name, s.destination_name,
         s.origin_latitude, s.origin_longitude, s.destination_latitude,
         s.destination_longitude, s.current_location_name, s.route_label, s.linkage_basis,
         s.linkage_confidence, s.status, s.is_alert, s.source_name,
         s.observed_at, '{}'::jsonb AS payload
       FROM transport_snapshot s
       WHERE ${where}
       ORDER BY s.is_alert DESC, s.observed_at DESC
       LIMIT ${entityLimit}`,
      params
    );
    entities = entityResult.rows.map(serializeEntity);
  }

  const movementTotal = movementTrendResult.rows.find((row) => row.country == null);
  const aviationTotal = aviationTrendResult.rows.find((row) => row.country == null);
  const trends = {
    window_hours: 24,
    comparison: "previous_24_hours",
    maritime: {
      ship_departures: transportTrendMetric(
        count(movementTotal?.departures_current),
        count(movementTotal?.departures_previous)
      ),
      cargo_vessel_departures: transportTrendMetric(
        count(movementTotal?.cargo_departures_current),
        count(movementTotal?.cargo_departures_previous)
      ),
      ship_arrivals: transportTrendMetric(
        count(movementTotal?.arrivals_current),
        count(movementTotal?.arrivals_previous)
      ),
    },
    aviation: {
      tracked_flights: transportTrendMetric(
        count(aviationTotal?.flights_current),
        count(aviationTotal?.flights_previous)
      ),
    },
  };
  const scopeName = country
    ? COUNTRY_NAME_BY_ISO.get(country) ?? country
    : "Global";
  const takeaways: Array<{
    id: string;
    mode: TransportMode;
    title: string;
    summary: string;
    current_value: number;
    previous_value: number;
    change_pct: number | null;
    direction: "up" | "down" | "flat" | "new";
    qualifier: string;
  }> = [];
  if (mode !== "aviation") {
    takeaways.push({
      id: "ship-departures",
      mode: "maritime",
      title: `${scopeName} ship departures`,
      summary: describeTrendChange(
        trends.maritime.ship_departures,
        "tracked departures from monitored ports"
      ),
      current_value: trends.maritime.ship_departures.current,
      previous_value: trends.maritime.ship_departures.previous,
      change_pct: trends.maritime.ship_departures.change_pct,
      direction: trends.maritime.ship_departures.direction,
      qualifier: "Port-geofence events; not a complete port authority movement count.",
    });
    takeaways.push({
      id: "cargo-vessel-departures",
      mode: "maritime",
      title: `${scopeName} cargo-vessel flow`,
      summary: describeTrendChange(
        trends.maritime.cargo_vessel_departures,
        "cargo or tanker vessel departures"
      ),
      current_value: trends.maritime.cargo_vessel_departures.current,
      previous_value: trends.maritime.cargo_vessel_departures.previous,
      change_pct: trends.maritime.cargo_vessel_departures.change_pct,
      direction: trends.maritime.cargo_vessel_departures.direction,
      qualifier: "Movement proxy only; AIS does not report cargo tonnage or load.",
    });
  }
  if (mode !== "maritime") {
    takeaways.push({
      id: "tracked-flights",
      mode: "aviation",
      title: `${scopeName} flight activity`,
      summary: describeTrendChange(
        trends.aviation.tracked_flights,
        "uniquely tracked aircraft with country links"
      ),
      current_value: trends.aviation.tracked_flights.current,
      previous_value: trends.aviation.tracked_flights.previous,
      change_pct: trends.aviation.tracked_flights.change_pct,
      direction: trends.aviation.tracked_flights.direction,
      qualifier: "Coverage reflects Claritas polling areas and available ADS-B reception.",
    });
  }

  return {
    generated_at: new Date().toISOString(),
    detail,
    summary: {
      active: summaryModes.maritime.active + summaryModes.aviation.active,
      routed: summaryModes.maritime.routed + summaryModes.aviation.routed,
      alerts: summaryModes.maritime.alerts + summaryModes.aviation.alerts,
      linked_countries: countries.size,
      modes: summaryModes,
    },
    countries: Array.from(countries.values()).sort(
      (left, right) => right.active_count - left.active_count
    ),
    routes: routeResult.rows.map((row) => ({
      mode: row.mode,
      origin_country: row.origin_country.trim(),
      origin_name: COUNTRY_NAME_BY_ISO.get(row.origin_country.trim()) ?? row.origin_country.trim(),
      destination_country: row.destination_country.trim(),
      destination_name:
        COUNTRY_NAME_BY_ISO.get(row.destination_country.trim()) ??
        row.destination_country.trim(),
      active_count: count(row.active_count),
      examples: row.examples ?? [],
    })),
    trends,
    takeaways,
    ports: portTrendResult.rows.map((row) => ({
      country: row.country.trim(),
      country_name: COUNTRY_NAME_BY_ISO.get(row.country.trim()) ?? row.country.trim(),
      location_name: row.location_name,
      departures: count(row.departures_current),
      arrivals: count(row.arrivals_current),
      cargo_vessel_departures: count(row.cargo_departures_current),
    })),
    activity: activityResult.rows.map((row) => ({
      bucket: isoDate(row.bucket),
      mode: row.mode,
      active_count: count(row.active_count),
    })),
    entities,
    coverage: {
      maritime: {
        source: "AISstream",
        transport: "WebSocket",
        configured:
          enabledFromEnv("AISSTREAM_ENABLED") &&
          Boolean(process.env.AISSTREAM_API_KEY?.trim()),
        freshness_minutes: 120,
        movement_method:
          "Monitored-port geofences with 24-hour comparison windows.",
        cargo_method:
          "Cargo/tanker vessel departures are a movement proxy, not cargo volume.",
      },
      aviation: {
        source: "adsb.lol",
        transport: "REST",
        configured: enabledFromEnv("ADSB_LOL_POLL_ENABLED"),
        freshness_minutes: 20,
        license: "ODbL-1.0",
        poll_areas: configuredAdsbPollPoints().length,
      },
    },
  };
}

type TransportOverviewResult = Awaited<
  ReturnType<typeof loadTransportOverview>
>;

const transportOverviewCache = new Map<
  string,
  { expiresAt: number; value: TransportOverviewResult }
>();
const transportOverviewInflight = new Map<
  string,
  Promise<TransportOverviewResult>
>();

function transportOverviewCacheKey(options?: TransportOverviewOptions): string {
  return JSON.stringify({
    detail: options?.detail ?? "aggregate",
    mode: options?.mode ?? null,
    country: normalizeIso2(options?.country) ?? null,
    entityLimit: options?.entityLimit ?? null,
  });
}

function transportOverviewCacheMilliseconds(): number {
  return (
    boundedIntegerFromEnv("TRANSPORT_OVERVIEW_CACHE_SECONDS", 60, 10, 300) *
    1_000
  );
}

export async function getTransportOverview(
  options?: TransportOverviewOptions,
): Promise<TransportOverviewResult> {
  const key = transportOverviewCacheKey(options);
  const now = Date.now();
  const cached = transportOverviewCache.get(key);
  if (!options?.bypassCache && cached && cached.expiresAt > now) {
    transportOverviewCache.delete(key);
    transportOverviewCache.set(key, cached);
    return cached.value;
  }

  const existing = transportOverviewInflight.get(key);
  if (existing) return existing;

  const startedAt = Date.now();
  const pending = loadTransportOverview(options)
    .then((value) => {
      transportOverviewCache.set(key, {
        expiresAt: Date.now() + transportOverviewCacheMilliseconds(),
        value,
      });
      while (transportOverviewCache.size > OVERVIEW_CACHE_MAX_ENTRIES) {
        const oldestKey = transportOverviewCache.keys().next().value;
        if (!oldestKey) break;
        transportOverviewCache.delete(oldestKey);
      }
      const durationMs = Date.now() - startedAt;
      if (durationMs >= 750) {
        console.warn(
          JSON.stringify({
            event: "transport_overview_slow_refresh",
            duration_ms: durationMs,
            detail: options?.detail ?? "aggregate",
            mode: options?.mode ?? "all",
            country: normalizeIso2(options?.country),
          }),
        );
      }
      return value;
    })
    .finally(() => {
      transportOverviewInflight.delete(key);
    });
  transportOverviewInflight.set(key, pending);
  return pending;
}

export async function getTransportEntity(mode: TransportMode, entityId: string) {
  const entityResult = await query<TransportSnapshotRow>(
    `SELECT *
     FROM transport_snapshot
     WHERE mode = $1 AND entity_id = $2
     LIMIT 1`,
    [mode, entityId]
  );
  const entity = entityResult.rows[0];
  if (!entity) return null;
  const trackResult = await query<{
    latitude: number;
    longitude: number;
    heading: NullableNumber;
    speed: NullableNumber;
    altitude: NullableNumber;
    current_country_iso2: string | null;
    current_location_name: string | null;
    vehicle_category: string | null;
    observed_at: string | Date;
  }>(
    `SELECT
       latitude, longitude, heading, speed, altitude, current_country_iso2,
       current_location_name, vehicle_category, observed_at
     FROM transport_track_point
     WHERE mode = $1 AND entity_id = $2
       AND observed_at >= now() - interval '24 hours'
     ORDER BY observed_at ASC
     LIMIT 500`,
    [mode, entityId]
  );
  return {
    entity: {
      ...serializeEntity(entity),
      payload: entity.payload,
    },
    track: trackResult.rows.map((point) => ({
      ...point,
      observed_at: isoDate(point.observed_at),
    })),
  };
}

type RetentionTarget = {
  table: string;
  timestampColumn: string;
  retentionDays: number;
};

async function pruneTransportTable(target: RetentionTarget): Promise<number> {
  const batchSize = boundedIntegerFromEnv(
    "TRANSPORT_RETENTION_BATCH_SIZE",
    5_000,
    500,
    20_000,
  );
  const maxBatches = boundedIntegerFromEnv(
    "TRANSPORT_RETENTION_MAX_BATCHES",
    20,
    1,
    100,
  );
  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await query<{ deleted: string | number }>(
      `WITH doomed AS (
         SELECT ctid
         FROM ${target.table}
         WHERE ${target.timestampColumn} < now() - ($1 * interval '1 day')
         ORDER BY ${target.timestampColumn}
         LIMIT $2
       ),
       removed AS (
         DELETE FROM ${target.table} target
         USING doomed
         WHERE target.ctid = doomed.ctid
         RETURNING 1
       )
       SELECT COUNT(*) AS deleted
       FROM removed`,
      [target.retentionDays, batchSize],
    );
    const countDeleted = count(result.rows[0]?.deleted);
    deleted += countDeleted;
    if (countDeleted < batchSize) break;
  }
  return deleted;
}

async function pruneTransportHistory(): Promise<void> {
  const trackDays = boundedIntegerFromEnv(
    "TRANSPORT_TRACK_RETENTION_DAYS",
    7,
    2,
    30,
  );
  const aggregateDays = boundedIntegerFromEnv(
    "TRANSPORT_AGGREGATE_RETENTION_DAYS",
    90,
    7,
    730,
  );
  const snapshotDays = boundedIntegerFromEnv(
    "TRANSPORT_SNAPSHOT_RETENTION_DAYS",
    30,
    7,
    365,
  );
  const targets: RetentionTarget[] = [
    {
      table: "transport_track_point",
      timestampColumn: "observed_at",
      retentionDays: trackDays,
    },
    {
      table: "transport_movement_event",
      timestampColumn: "observed_at",
      retentionDays: aggregateDays,
    },
    {
      table: "transport_movement_hour",
      timestampColumn: "bucket",
      retentionDays: aggregateDays,
    },
    {
      table: "transport_entity_activity_hour",
      timestampColumn: "bucket",
      retentionDays: aggregateDays,
    },
    {
      table: "transport_snapshot",
      timestampColumn: "observed_at",
      retentionDays: snapshotDays,
    },
  ];
  const deleted: Record<string, number> = {};
  for (const target of targets) {
    deleted[target.table] = await pruneTransportTable(target);
  }

  const memoryCutoff = Date.now() - 2 * 24 * 60 * 60 * 1_000;
  for (const [key, observedAt] of lastTrackAt) {
    if (observedAt < memoryCutoff) lastTrackAt.delete(key);
  }
  for (const [mmsi, observedAt] of lastMaritimeQueuedAt) {
    if (observedAt >= memoryCutoff) continue;
    lastMaritimeQueuedAt.delete(mmsi);
    maritimeStatic.delete(mmsi);
    firstMaritimeCountry.delete(mmsi);
  }
  for (const [callsign, cached] of routeCache) {
    if (cached.expiresAt < Date.now()) routeCache.delete(callsign);
  }

  if (Object.values(deleted).some((value) => value > 0)) {
    console.info(
      JSON.stringify({
        event: "transport_retention_pruned",
        deleted,
      }),
    );
  }
}

function startTransportRetentionWorker(): void {
  if (transportRetentionTimer) return;
  const minutes = boundedIntegerFromEnv(
    "TRANSPORT_RETENTION_INTERVAL_MINUTES",
    60,
    15,
    1_440,
  );
  void pruneTransportHistory().catch((error) => {
    console.warn(
      `Initial transport retention pass failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  transportRetentionTimer = setInterval(() => {
    void pruneTransportHistory().catch((error) => {
      console.warn(
        `Transport retention pass failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }, minutes * 60_000);
  transportRetentionTimer.unref();
}

async function acquireTransportWorkerLock(): Promise<void> {
  try {
    const client = await pool.connect();
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [WORKER_LOCK_NAMESPACE, WORKER_LOCK_KEY]
    );
    if (!lock.rows[0]?.acquired) {
      client.release();
      console.info("Transport ingestion worker is active on another API replica.");
      return;
    }
    connectAisStream();
    startTransportRetentionWorker();
    aisFlushTimer = setInterval(() => {
      void flushMaritimeQueue();
    }, 5_000);
    aisFlushTimer.unref();

    const aviationEnabled = enabledFromEnv("ADSB_LOL_POLL_ENABLED");
    if (aviationEnabled) {
      void refreshAviationNow(true).catch((error) => {
        console.warn(
          `Initial adsb.lol refresh failed: ${error instanceof Error ? error.message : String(error)}`
        );
      });
      const seconds = Math.max(
        60,
        Math.min(
          Number.parseInt(process.env.ADSB_LOL_POLL_SECONDS || "300", 10) || 300,
          1_800,
        ),
      );
      const timer = setInterval(() => {
        void refreshAviationNow(true).catch((error) => {
          console.warn(
            `Scheduled adsb.lol refresh failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
      }, seconds * 1000);
      timer.unref();
    }
    // Keep the dedicated client checked out: the PostgreSQL session owns the
    // advisory lock and releases it automatically if this process exits.
  } catch (error) {
    console.warn(
      `Transport worker lock is unavailable; retrying: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    const timer = setTimeout(() => {
      void acquireTransportWorkerLock();
    }, 30_000);
    timer.unref();
  }
}

export function startTransportIngestionWorkers(): void {
  if (transportWorkerStarted) return;
  transportWorkerStarted = true;
  void acquireTransportWorkerLock();
}
