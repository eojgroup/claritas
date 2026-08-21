import { feature } from "topojson-client";
import worldCountries from "world-countries";
import type { FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson";
import type { GeometryCollection, Properties, Topology } from "topojson-specification";
import WebSocket from "ws";
import { createConnection, type Socket } from "node:net";
import { getCountryFromMMSI } from "mmsi-country-lookup";
import { pool, query } from "../db";
import {
  prioritizeAdsbRouteLookups,
  type AdsbRouteLookup,
} from "./transport-route-enrichment";
import {
  GLOBAL_AIS_BOUNDING_BOX,
  aisReconnectDelayMilliseconds,
  buildAisSubscription,
  isAisCoordinateMessageType,
  normalizeAisBoundingBoxes,
  normalizeAisObservedAt,
  shouldQueueAisSnapshot,
  type AisBoundingBox,
} from "./ais-subscription";
import {
  parseDigitrafficMaritimeObservations,
  type DigitrafficMaritimeObservation,
} from "./digitraffic-maritime";
import {
  parseBarentsWatchMaritimeObservations,
  parseBarentsWatchToken,
  type BarentsWatchMaritimeObservation,
  type BarentsWatchToken,
} from "./barentswatch-maritime";
import {
  parseMpaMaritimeObservations,
  type MpaMaritimeObservation,
} from "./mpa-maritime";
import {
  MARITIME_SOURCE_DEFINITIONS,
  maritimeStaticCacheKey,
  shouldAcceptSampledMaritimeSnapshot,
  shouldReplaceMaritimeSnapshot,
  type MaritimeSourceName,
  type RegionalMaritimeSourceName,
} from "./maritime-source";
import {
  RegionalAisNmeaDecoder,
  parseRegionalAisNmeaLine,
  type RegionalAisObservation,
} from "./regional-ais-nmea";
import {
  transportHistoryModeValue,
  transportHistoryWindow,
} from "./transport-history";
import {
  buildTransportRuntimeHealth,
  transportRetentionBudgetAvailable,
  type TransportRetentionHealth,
} from "./transport-runtime-health";

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
  source_name: MaritimeSourceName | "adsb_lol";
  observed_at: string;
  payload: JsonRecord;
};

type MaritimeTransportSnapshotInput = Omit<
  TransportSnapshotInput,
  "source_name"
> & { source_name: MaritimeSourceName };

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
  flag_origin_count: string | number;
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

type HistoricalActivityRow = {
  bucket: string | Date;
  maritime_entities: string | number;
  aviation_entities: string | number;
  observed_hours: string | number;
  source_names: string[] | null;
};

type HistoricalMovementRow = {
  bucket: string | Date;
  ship_departures: string | number;
  ship_arrivals: string | number;
  cargo_vessel_departures: string | number;
};

type HistoricalCorridorRow = {
  bucket: string | Date;
  maritime_entities: string | number;
  aviation_entities: string | number;
  observed_hours: string | number;
  observed_origins: string | number;
  flag_proxy_origins: string | number;
  source_names: string[] | null;
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
  destination_latitude?: number | null;
  destination_longitude?: number | null;
  route_label?: string | null;
};

type RegionalMaritimeObservation =
  | DigitrafficMaritimeObservation
  | BarentsWatchMaritimeObservation
  | MpaMaritimeObservation
  | RegionalAisObservation;

type MaritimePort = {
  name: string;
  iso2: string;
  latitude: number;
  longitude: number;
  radius_km: number;
  pattern: RegExp;
};

const AIS_STREAM_URL = "wss://stream.aisstream.io/v0/stream";
const DIGITRAFFIC_MARITIME_BASE_URL = "https://meri.digitraffic.fi/api/ais/v1";
const BARENTSWATCH_TOKEN_URL = "https://id.barentswatch.no/connect/token";
const BARENTSWATCH_AIS_URL =
  "https://live.ais.barentswatch.no/v1/latest/combined?modelType=Full";
const MPA_OCEANS_X_AIS_URL =
  "https://oceans-x.mpa.gov.sg/api/v1/vessel/positions/1.0.0/snapshot";
const ADSB_BASE_URL = "https://api.adsb.lol";
const ADSB_STANDING_DATA_BASE_URL = "https://vrs-standing-data.adsb.lol";
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
const firstMaritimePosition = new Map<
  string,
  { latitude: number; longitude: number }
>();
const lastMaritimeQueuedAt = new Map<string, number>();
const lastMaritimeSnapshot = new Map<
  string,
  { observed_at: string; source_name: MaritimeSourceName }
>();
const lastTrackAt = new Map<string, number>();
const routeCache = new Map<string, { expiresAt: number; value: AdsbRoute | null }>();

let aisSocket: WebSocket | null = null;
let aisReconnectTimer: NodeJS.Timeout | null = null;
let aisFlushTimer: NodeJS.Timeout | null = null;
let aisWatchdogTimer: NodeJS.Timeout | null = null;
let aisSubscriptionBoxes: AisBoundingBox[] | null = null;
let aisReconnectAttempt = 0;
let aisConnectedAt: number | null = null;
let aisLastMessageAt: number | null = null;
let aisLastSnapshotAt: number | null = null;
let aisLastStoredAt: number | null = null;
let aisLastPositionAt: number | null = null;
let aisLastPositionStoredAt: number | null = null;
let aisLastFlushAt: number | null = null;
let aisLastError: string | null = null;
let aisLastFlushError: string | null = null;
let aisFlushRunning = false;
let aisMessagesReceived = 0;
let aisSnapshotsAccepted = 0;
let aisSnapshotsStored = 0;
let aisSnapshotsDropped = 0;
let aisMalformedMessages = 0;
let aisLastProgressLogAt = 0;
type RegionalMaritimeRuntimeState = {
  lastRefreshAt: number | null;
  lastSnapshotAt: number | null;
  lastStoredAt: number | null;
  lastError: string | null;
  snapshotsAccepted: number;
  snapshotsStored: number;
};

const regionalMaritimeRuntime: Record<
  RegionalMaritimeSourceName,
  RegionalMaritimeRuntimeState
> = {
  digitraffic: regionalMaritimeRuntimeState(),
  barentswatch: regionalMaritimeRuntimeState(),
  mpa_oceans_x: regionalMaritimeRuntimeState(),
  kystverket: regionalMaritimeRuntimeState(),
};
let digitrafficRefresh: Promise<{ fetched: number; queued: number }> | null = null;
let digitrafficTimer: NodeJS.Timeout | null = null;
let barentswatchRefresh: Promise<{ fetched: number; queued: number }> | null = null;
let barentswatchTimer: NodeJS.Timeout | null = null;
let barentswatchToken: BarentsWatchToken | null = null;
let mpaOceansXRefresh: Promise<{ fetched: number; queued: number }> | null = null;
let mpaOceansXTimer: NodeJS.Timeout | null = null;
let kystverketSocket: Socket | null = null;
let kystverketReconnectTimer: NodeJS.Timeout | null = null;
let kystverketReconnectAttempt = 0;
let kystverketLineBuffer = "";
let kystverketDecoder: RegionalAisNmeaDecoder | null = null;
let aviationRefresh: Promise<{ fetched: number; stored: number }> | null = null;
let lastAviationRefreshAt = 0;
let aviationRouteLookupGeneration = 0;
let adsbRouteProviderFailures = 0;
let adsbRouteProviderUnavailableUntil = 0;
let transportWorkerStarted = false;
let transportWorkerLeader = false;
let transportWorkerLockRetryTimer: NodeJS.Timeout | null = null;
let transportRetentionTimer: NodeJS.Timeout | null = null;
let transportRetentionRun: Promise<void> | null = null;
let transportRetentionTargetOffset = 0;
let transportRetentionHealth: TransportRetentionHealth = {
  running: false,
  last_pass_at: null,
  duration_ms: null,
  deleted_rows: 0,
  batches: 0,
  backlog: false,
  backlog_tables: [],
  oldest_expired_at: null,
  budget_exhausted: false,
  error: false,
};

function enabledFromEnv(name: string, fallback = true): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "no", "off"].includes(value);
}

function deleteMaritimeStatic(mmsi: string): void {
  for (const sourceName of Object.keys(
    MARITIME_SOURCE_DEFINITIONS,
  ) as MaritimeSourceName[]) {
    maritimeStatic.delete(maritimeStaticCacheKey(sourceName, mmsi));
  }
}

function regionalMaritimeRuntimeState(): RegionalMaritimeRuntimeState {
  return {
    lastRefreshAt: null,
    lastSnapshotAt: null,
    lastStoredAt: null,
    lastError: null,
    snapshotsAccepted: 0,
    snapshotsStored: 0,
  };
}

function regionalSourceConfigured(source: RegionalMaritimeSourceName): boolean {
  switch (source) {
    case "digitraffic":
      return enabledFromEnv("DIGITRAFFIC_MARITIME_ENABLED");
    case "barentswatch":
      return (
        enabledFromEnv("BARENTSWATCH_AIS_ENABLED") &&
        Boolean(process.env.BARENTSWATCH_AIS_CLIENT_ID?.trim()) &&
        Boolean(process.env.BARENTSWATCH_AIS_CLIENT_SECRET?.trim())
      );
    case "mpa_oceans_x":
      return (
        enabledFromEnv("MPA_OCEANS_X_ENABLED") &&
        Boolean(process.env.MPA_OCEANS_X_API_KEY?.trim())
      );
    case "kystverket":
      return enabledFromEnv("KYSTVERKET_AIS_TCP_ENABLED", false);
  }
}

function regionalTransport(source: RegionalMaritimeSourceName): "https" | "tcp" {
  return source === "kystverket" ? "tcp" : "https";
}

function regionalRuntimeHealthSources() {
  return (
    Object.keys(regionalMaritimeRuntime) as RegionalMaritimeSourceName[]
  ).map((id) => {
    const definition = MARITIME_SOURCE_DEFINITIONS[id];
    const runtime = regionalMaritimeRuntime[id];
    return {
      id,
      provider: definition.provider,
      configured: regionalSourceConfigured(id),
      readinessEligible: id !== "kystverket",
      transport: regionalTransport(id),
      lastRefreshAt: runtime.lastRefreshAt,
      lastSnapshotAt: runtime.lastSnapshotAt,
      lastStoredAt: runtime.lastStoredAt,
      error: Boolean(runtime.lastError),
      coverage: definition.coverage,
      license: definition.license,
      global: false,
    };
  });
}

function mostRecentRuntimeTimestamp(
  values: Array<number | null>,
): number | null {
  const present = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  return present.length ? Math.max(...present) : null;
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
    boundedIntegerFromEnv("TRANSPORT_TRACK_SAMPLE_SECONDS", 600, 60, 1_800) *
    1_000
  );
}

function transportCorridorPairsPerDayMode(): number {
  return boundedIntegerFromEnv(
    "TRANSPORT_CORRIDOR_PAIRS_PER_DAY_MODE",
    1_000,
    100,
    2_000,
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

function normalizedHeading(...values: unknown[]): number | null {
  for (const value of values) {
    const heading = asFinite(value);
    if (heading != null && heading >= 0 && heading < 360) return heading;
  }
  return null;
}

function normalizedTransportSpeed(
  mode: TransportMode,
  value: unknown,
): number | null {
  const speed = asFinite(value);
  if (speed == null || speed < 0) return null;
  // AIS encodes 102.3 knots as "speed not available".
  if (mode === "maritime" && speed >= 102.3) return null;
  return speed;
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

function maritimeCoverageRuntime(latestObservedAt: string | null) {
  const runtimeFreshnessMilliseconds =
    boundedIntegerFromEnv(
      "TRANSPORT_RUNTIME_FRESHNESS_SECONDS",
      900,
      60,
      1_800,
    ) * 1_000;
  const primaryConfigured =
    enabledFromEnv("AISSTREAM_ENABLED") &&
    Boolean(process.env.AISSTREAM_API_KEY?.trim());
  const regionalSources = (
    Object.keys(regionalMaritimeRuntime) as RegionalMaritimeSourceName[]
  ).map((sourceName) => {
    const runtime = regionalMaritimeRuntime[sourceName];
    const definition = MARITIME_SOURCE_DEFINITIONS[sourceName];
    const sourceDetails =
      sourceName === "barentswatch"
        ? {
            terms_url: "https://www.barentswatch.no/en/articles/api-terms-and-conditions/",
            attribution:
              "Data delivered by BarentsWatch; source: Norwegian Coastal Administration",
          }
        : sourceName === "mpa_oceans_x"
          ? {
              terms_url: "https://oceans-x.mpa.gov.sg/api-terms-of-service",
              attribution:
                "Source: Maritime and Port Authority of Singapore OCEANS-X",
            }
          : sourceName === "digitraffic"
            ? {
                terms_url: "https://creativecommons.org/licenses/by/4.0/",
                attribution: "Source: Fintraffic Digitraffic",
              }
            : {
                terms_url: "https://data.norge.no/nlod/en/2.0",
                attribution: "Source: Norwegian Coastal Administration",
              };
    return {
      source_name: sourceName,
      provider: definition.provider,
      transport: regionalTransport(sourceName),
      coverage: definition.coverage,
      configured: regionalSourceConfigured(sourceName),
      readiness_eligible: sourceName !== "kystverket",
      last_refresh_at: runtime.lastRefreshAt
        ? isoDate(runtime.lastRefreshAt)
        : null,
      last_snapshot_at: runtime.lastSnapshotAt
        ? isoDate(runtime.lastSnapshotAt)
        : null,
      last_stored_at: runtime.lastStoredAt
        ? isoDate(runtime.lastStoredAt)
        : null,
      error: Boolean(runtime.lastError),
      snapshots_accepted: runtime.snapshotsAccepted,
      snapshots_stored: runtime.snapshotsStored,
      license: definition.license,
      global: false,
      source_url: definition.sourceUrl,
      ...sourceDetails,
    };
  });
  const configuredRegionalSources = regionalSources.filter(
    (source) => source.configured && source.readiness_eligible,
  );
  const fallbackConfigured = configuredRegionalSources.length > 0;
  const configured = primaryConfigured || fallbackConfigured;
  const latestObservedMilliseconds = latestObservedAt
    ? Date.parse(latestObservedAt)
    : Number.NaN;
  const hasFreshStoredData =
    Number.isFinite(latestObservedMilliseconds) &&
    Date.now() - latestObservedMilliseconds <= runtimeFreshnessMilliseconds;
  const connected = aisSocket?.readyState === WebSocket.OPEN;
  const recentlyReceiving =
    aisLastPositionAt != null &&
    Date.now() - aisLastPositionAt <= runtimeFreshnessMilliseconds;
  const fallbackLastSnapshotAt = mostRecentRuntimeTimestamp(
    configuredRegionalSources.map((source) =>
      source.last_snapshot_at ? Date.parse(source.last_snapshot_at) : null,
    ),
  );
  const fallbackLastStoredAt = mostRecentRuntimeTimestamp(
    configuredRegionalSources.map((source) =>
      source.last_stored_at ? Date.parse(source.last_stored_at) : null,
    ),
  );
  const fallbackRecentlyReceiving =
    fallbackLastSnapshotAt != null &&
    Date.now() - fallbackLastSnapshotAt <= runtimeFreshnessMilliseconds;
  const subscriptionBoxes = getAisSubscriptionBoxes();
  const upstreamStalled = Boolean(
    connected &&
    aisConnectedAt &&
    Date.now() - aisConnectedAt > 45_000 &&
    (!aisLastPositionAt || aisLastPositionAt < aisConnectedAt),
  );
  const primaryStatus = !primaryConfigured
    ? "disabled"
    : recentlyReceiving
      ? "live"
      : upstreamStalled
        ? "upstream_stalled"
        : connected
          ? "connecting"
          : "reconnecting";
  const status = !configured
    ? "disabled"
    : hasFreshStoredData
      ? "live"
      : recentlyReceiving || fallbackRecentlyReceiving
        ? "receiving"
        : upstreamStalled
          ? "upstream_stalled"
          : connected
            ? "connecting"
            : "reconnecting";
  return {
    configured,
    primary_source: "AISstream",
    primary_coverage: "best_effort_global",
    primary_service_level: "beta_no_sla",
    primary_configured: primaryConfigured,
    primary_status: primaryStatus,
    connected,
    status,
    last_message_at: aisLastMessageAt ? isoDate(aisLastMessageAt) : null,
    last_snapshot_at: aisLastSnapshotAt ? isoDate(aisLastSnapshotAt) : null,
    last_stored_at: aisLastStoredAt ? isoDate(aisLastStoredAt) : null,
    last_position_at: aisLastPositionAt ? isoDate(aisLastPositionAt) : null,
    last_position_stored_at: aisLastPositionStoredAt
      ? isoDate(aisLastPositionStoredAt)
      : null,
    last_flush_at: aisLastFlushAt ? isoDate(aisLastFlushAt) : null,
    last_error: aisLastError,
    persistence_error: Boolean(aisLastFlushError),
    queue_depth: maritimeQueue.size,
    messages_received: aisMessagesReceived,
    snapshots_accepted: aisSnapshotsAccepted,
    snapshots_stored: aisSnapshotsStored,
    snapshots_dropped: aisSnapshotsDropped,
    malformed_messages: aisMalformedMessages,
    subscription_batch: 1,
    subscription_batches: 1,
    subscription_boxes: subscriptionBoxes.length,
    fallback_source: "Official regional AIS providers",
    fallback_coverage: configuredRegionalSources.length
      ? configuredRegionalSources.map((source) => source.coverage).join("; ")
      : "No regional source is currently configured",
    global_fallback_available: false,
    fallback_configured: fallbackConfigured,
    fallback_last_snapshot_at: fallbackLastSnapshotAt
      ? isoDate(fallbackLastSnapshotAt)
      : null,
    fallback_last_stored_at: fallbackLastStoredAt
      ? isoDate(fallbackLastStoredAt)
      : null,
    fallback_error:
      configuredRegionalSources.length > 0 &&
      configuredRegionalSources.every((source) => source.error),
    fallback_snapshots_accepted: configuredRegionalSources.reduce(
      (sum, source) => sum + source.snapshots_accepted,
      0,
    ),
    fallback_snapshots_stored: configuredRegionalSources.reduce(
      (sum, source) => sum + source.snapshots_stored,
      0,
    ),
    fallback_license: "Provider-specific; see regional_sources",
    regional_sources: regionalSources,
    coverage_note:
      "No verified regional source supplies complete global live AIS. AISstream remains a best-effort beta source; each official fallback covers only its stated region and attribution terms.",
  };
}

export function getTransportRuntimeHealth() {
  const now = Date.now();
  return buildTransportRuntimeHealth({
    now,
    freshnessMilliseconds:
      boundedIntegerFromEnv(
        "TRANSPORT_RUNTIME_FRESHNESS_SECONDS",
        900,
        60,
        1_800,
      ) * 1_000,
    workerStarted: transportWorkerStarted,
    workerLeader: transportWorkerLeader,
    primaryConfigured:
      enabledFromEnv("AISSTREAM_ENABLED") &&
      Boolean(process.env.AISSTREAM_API_KEY?.trim()),
    primaryConnected: aisSocket?.readyState === WebSocket.OPEN,
    primaryLastMessageAt: aisLastMessageAt,
    primaryLastSnapshotAt: aisLastPositionAt,
    primaryLastStoredAt: aisLastPositionStoredAt,
    primaryError: Boolean(aisLastError || aisLastFlushError),
    regionalSources: regionalRuntimeHealthSources(),
    retention: {
      ...transportRetentionHealth,
      running: transportRetentionRun != null,
    },
  });
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

function destinationPortFromText(value: string | null): MaritimePort | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return MARITIME_PORTS.find((port) => port.pattern.test(normalized)) ?? null;
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

function getAisSubscriptionBoxes(): AisBoundingBox[] {
  if (aisSubscriptionBoxes) return aisSubscriptionBoxes;
  const configured = process.env.AISSTREAM_BOUNDING_BOXES?.trim();
  if (configured) {
    try {
      const boxes = normalizeAisBoundingBoxes(JSON.parse(configured));
      if (boxes.length > 0) {
        aisSubscriptionBoxes = boxes.slice(0, 12);
        if (boxes.length > aisSubscriptionBoxes.length) {
          console.warn("AISSTREAM_BOUNDING_BOXES was capped at 12 provider areas.");
        }
        return aisSubscriptionBoxes;
      }
    } catch {
      // The warning below covers both malformed JSON and malformed boxes.
    }
    console.warn(
      "AISSTREAM_BOUNDING_BOXES is invalid; using the documented global subscription.",
    );
  }
  aisSubscriptionBoxes = [GLOBAL_AIS_BOUNDING_BOX];
  return aisSubscriptionBoxes;
}

function aisFlushBatchSize(): number {
  return boundedIntegerFromEnv("AISSTREAM_FLUSH_BATCH_SIZE", 250, 50, 1_000);
}

function aisFlushBatchesPerCycle(): number {
  return boundedIntegerFromEnv("AISSTREAM_FLUSH_BATCHES_PER_CYCLE", 2, 1, 10);
}

function sendAisSubscription(socket: WebSocket, apiKey: string): void {
  if (socket !== aisSocket || socket.readyState !== WebSocket.OPEN) return;
  const boundingBoxes = getAisSubscriptionBoxes();
  socket.send(JSON.stringify(buildAisSubscription(apiKey, boundingBoxes)));
  console.info(
    JSON.stringify({
      event: "aisstream_subscription_started",
      mode: boundingBoxes.length === 1 && boundingBoxes[0] === GLOBAL_AIS_BOUNDING_BOX
        ? "global"
        : "configured",
      boxes: boundingBoxes.length,
      rotating: false,
    }),
  );
}

function aisSampleMilliseconds(): number {
  return (
    boundedIntegerFromEnv("AISSTREAM_SAMPLE_SECONDS", 600, 60, 900) * 1_000
  );
}

function aisIdleTimeoutMilliseconds(): number {
  return (
    boundedIntegerFromEnv("AISSTREAM_IDLE_TIMEOUT_SECONDS", 120, 45, 900) *
    1_000
  );
}

function startAisWatchdog(): void {
  if (aisWatchdogTimer) return;
  aisWatchdogTimer = setInterval(() => {
    const socket = aisSocket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !aisConnectedAt) return;
    // Static/voyage metadata can keep a socket noisy while the live map has no
    // positions. Only a usable coordinate postpones the position watchdog.
    const lastActivity = Math.max(aisLastPositionAt ?? 0, aisConnectedAt);
    const idleMilliseconds = Date.now() - lastActivity;
    if (idleMilliseconds <= aisIdleTimeoutMilliseconds()) return;
    aisLastError = `No usable AIS vessel snapshots received for ${Math.round(idleMilliseconds / 1_000)} seconds`;
    console.warn(
      JSON.stringify({
        event: "aisstream_idle_reconnect",
        idle_seconds: Math.round(idleMilliseconds / 1_000),
      }),
    );
    socket.terminate();
  }, 30_000);
  aisWatchdogTimer.unref();
}

function canQueueMaritimeSnapshot(
  mmsi: string,
  sourceName: MaritimeSourceName,
  observedAt: string,
  now: number,
): boolean {
  const candidate = { source_name: sourceName, observed_at: observedAt };
  const lastAccepted = lastMaritimeSnapshot.get(mmsi);
  // Preserve the global per-vessel sampling budget. Inside that window an
  // official source may replace a lower-priority source, but providers may not
  // alternate on every poll merely because their timestamps differ slightly.
  if (
    !shouldAcceptSampledMaritimeSnapshot({
      candidate,
      current: lastAccepted,
      now,
      lastQueuedAt: lastMaritimeQueuedAt.get(mmsi),
      sampleMilliseconds: aisSampleMilliseconds(),
    })
  ) return false;
  const queued = maritimeQueue.get(mmsi);
  if (
    queued &&
    queued.source_name !== "adsb_lol" &&
    !shouldReplaceMaritimeSnapshot(candidate, {
      source_name: queued.source_name,
      observed_at: queued.observed_at,
    })
  ) {
    return false;
  }
  return true;
}

function enqueueMaritimeSnapshot(
  snapshot: MaritimeTransportSnapshotInput,
  now: number,
): boolean {
  if (
    !canQueueMaritimeSnapshot(
      snapshot.entity_id,
      snapshot.source_name,
      snapshot.observed_at,
      now,
    )
  ) {
    return false;
  }
  maritimeQueue.set(snapshot.entity_id, snapshot);
  lastMaritimeQueuedAt.set(snapshot.entity_id, now);
  lastMaritimeSnapshot.set(snapshot.entity_id, {
    observed_at: snapshot.observed_at,
    source_name: snapshot.source_name,
  });
  const maximumQueue = Math.max(
    500,
    Math.min(
      Number.parseInt(process.env.AISSTREAM_MAX_QUEUE || "5000", 10) || 5_000,
      25_000,
    ),
  );
  if (maritimeQueue.size > maximumQueue) {
    const oldest = maritimeQueue.keys().next().value;
    if (oldest) {
      maritimeQueue.delete(oldest);
      lastMaritimeQueuedAt.delete(oldest);
      lastMaritimeSnapshot.delete(oldest);
      aisSnapshotsDropped += 1;
    }
  }
  return true;
}

function queueMaritimeMessage(message: unknown): void {
  const envelope = asRecord(message);
  if (!envelope) return;
  const providerError = envelope.error ?? envelope.Error;
  if (providerError != null) {
    const message =
      asString(providerError) ??
      (typeof providerError === "object"
        ? JSON.stringify(providerError).slice(0, 500)
        : "Unknown subscription error");
    aisLastError = message;
    console.warn(`AISstream subscription error: ${message}`);
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

  const now = Date.now();
  const observedAt = normalizeAisObservedAt(
    metadata.time_utc,
    now,
    boundedIntegerFromEnv(
      "AISSTREAM_FRESHNESS_MINUTES",
      15,
      5,
      120,
    ) * 60_000,
  );
  if (!observedAt) return;
  const coordinateMessage = isAisCoordinateMessageType(messageType);
  const latitude = coordinateMessage
    ? asFinite(body.Latitude ?? metadata.latitude ?? metadata.Latitude)
    : null;
  const longitude = coordinateMessage
    ? asFinite(body.Longitude ?? metadata.longitude ?? metadata.Longitude)
    : null;
  const isPosition =
    coordinateMessage && shouldQueueAisSnapshot(latitude, longitude);

  const displayName =
    asString(body.Name) ??
    asString(reportA.Name) ??
    asString(metadata.ShipName);
  const callsign = asString(body.CallSign ?? reportB.CallSign);
  const destinationName = asString(body.Destination);
  const shipType = asString(body.Type ?? reportB.ShipType);
  const staticKey = maritimeStaticCacheKey("aisstream", mmsi);

  if (displayName || callsign || destinationName || shipType) {
    const destinationPort = destinationPortFromText(destinationName);
    const destinationCountry =
      destinationPort?.iso2 ?? destinationCountryFromText(destinationName);
    maritimeStatic.set(staticKey, {
      ...maritimeStatic.get(staticKey),
      display_name: displayName ?? maritimeStatic.get(staticKey)?.display_name,
      callsign: callsign ?? maritimeStatic.get(staticKey)?.callsign,
      vehicle_type: shipType ?? maritimeStatic.get(staticKey)?.vehicle_type,
      vehicle_category:
        maritimeCategory(shipType) ?? maritimeStatic.get(staticKey)?.vehicle_category,
      destination_name:
        destinationName ?? maritimeStatic.get(staticKey)?.destination_name,
      destination_country_iso2:
        destinationCountry ??
        maritimeStatic.get(staticKey)?.destination_country_iso2,
      destination_latitude:
        destinationPort?.latitude ??
        maritimeStatic.get(staticKey)?.destination_latitude,
      destination_longitude:
        destinationPort?.longitude ??
        maritimeStatic.get(staticKey)?.destination_longitude,
      route_label: destinationName
        ? `Destination ${destinationName}`
        : maritimeStatic.get(staticKey)?.route_label,
    });
  }

  // ShipStaticData and StaticDataReport enrich the in-memory vessel profile,
  // but a coordinate-free record must not replace a fresh/current database
  // position. The next usable position carries the cached static fields.
  if (!isPosition) return;
  // Recovery is proven by a decoded coordinate, not merely by a WebSocket
  // handshake or control/static frame. Update this before the sampling gate so
  // a healthy busy vessel cannot be mistaken for an idle upstream.
  aisLastPositionAt = now;
  aisReconnectAttempt = 0;
  aisLastError = null;
  if (!canQueueMaritimeSnapshot(mmsi, "aisstream", observedAt, now)) return;

  const staticData = maritimeStatic.get(staticKey);
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
  if (
    isPosition &&
    latitude != null &&
    longitude != null &&
    !firstMaritimePosition.has(mmsi)
  ) {
    firstMaritimePosition.set(mmsi, { latitude, longitude });
  }
  const originCountry =
    staticData?.destination_country_iso2 &&
    firstMaritimeCountry.get(mmsi) !== staticData.destination_country_iso2
      ? firstMaritimeCountry.get(mmsi) ?? null
      : null;
  const originPosition = firstMaritimePosition.get(mmsi);
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

  const snapshot: MaritimeTransportSnapshotInput = {
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
    heading: normalizedHeading(body.TrueHeading, body.Cog),
    speed: normalizedTransportSpeed("maritime", body.Sog),
    current_country_iso2: currentCountry,
    origin_country_iso2: originCountry,
    destination_country_iso2: staticData?.destination_country_iso2,
    registration_country_iso2: registrationCountry,
    origin_name: originCountry ? COUNTRY_NAME_BY_ISO.get(originCountry) ?? originCountry : null,
    destination_name: staticData?.destination_name,
    origin_latitude: originPosition?.latitude,
    origin_longitude: originPosition?.longitude,
    destination_latitude: staticData?.destination_latitude,
    destination_longitude: staticData?.destination_longitude,
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

  if (!enqueueMaritimeSnapshot(snapshot, now)) return;
  aisSnapshotsAccepted += 1;
  aisLastSnapshotAt = now;
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
    perMessageDeflate: false,
    maxPayload: 2 * 1024 * 1024,
  });
  aisSocket = socket;

  socket.on("open", () => {
    aisConnectedAt = Date.now();
    sendAisSubscription(socket, apiKey);
    console.info("AISstream transport subscription connected.");
  });

  socket.on("message", (raw) => {
    aisMessagesReceived += 1;
    aisLastMessageAt = Date.now();
    try {
      queueMaritimeMessage(JSON.parse(raw.toString()));
    } catch (error) {
      aisMalformedMessages += 1;
      console.warn(
        `Skipped malformed AISstream message: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  socket.on("error", (error) => {
    aisLastError = error.message;
    console.warn(`AISstream connection error: ${error.message}`);
  });

  socket.on("close", (code, reason) => {
    if (aisSocket === socket) {
      aisSocket = null;
      aisConnectedAt = null;
      if (code !== 1000 && !aisLastError) {
        aisLastError = `AISstream closed with code ${code}${reason.length ? `: ${reason.toString()}` : ""}`;
      }
    }
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
  const delay = aisReconnectDelayMilliseconds(aisReconnectAttempt);
  aisReconnectAttempt += 1;
  aisReconnectTimer = setTimeout(() => {
    aisReconnectTimer = null;
    connectAisStream();
  }, delay);
  aisReconnectTimer.unref();
}

function logAisProgressIfDue(): void {
  if (Date.now() - aisLastProgressLogAt < 60_000) return;
  aisLastProgressLogAt = Date.now();
  console.info(
    JSON.stringify({
      event: "aisstream_ingestion_progress",
      connected: aisSocket?.readyState === WebSocket.OPEN,
      messages_received: aisMessagesReceived,
      snapshots_accepted: aisSnapshotsAccepted,
      snapshots_stored: aisSnapshotsStored,
      snapshots_dropped: aisSnapshotsDropped,
      malformed_messages: aisMalformedMessages,
      queue_depth: maritimeQueue.size,
      subscription_batch: 1,
      subscription_batches: 1,
      subscription_boxes: getAisSubscriptionBoxes().length,
      last_stream_error: aisLastError,
      last_flush_error: aisLastFlushError,
      regional_sources: Object.fromEntries(
        (Object.keys(regionalMaritimeRuntime) as RegionalMaritimeSourceName[]).map(
          (sourceName) => [sourceName, regionalMaritimeRuntime[sourceName]],
        ),
      ),
    }),
  );
}

async function flushMaritimeQueue(): Promise<void> {
  logAisProgressIfDue();
  if (aisFlushRunning || maritimeQueue.size === 0) return;
  aisFlushRunning = true;
  try {
    for (let batchNumber = 0; batchNumber < aisFlushBatchesPerCycle(); batchNumber += 1) {
      const entries = Array.from(maritimeQueue.entries()).slice(0, aisFlushBatchSize());
      if (entries.length === 0) break;
      for (const [entityId, snapshot] of entries) {
        if (maritimeQueue.get(entityId) === snapshot) maritimeQueue.delete(entityId);
      }
      const snapshots = entries.map(([, snapshot]) => snapshot);
      try {
        await storeTransportSnapshots(snapshots);
        const storedAt = Date.now();
        const aisStored = snapshots.filter(
          (snapshot) => snapshot.source_name === "aisstream",
        ).length;
        const aisPositionsStored = snapshots.filter(
          (snapshot) => snapshot.source_name === "aisstream"
            && snapshot.latitude != null
            && snapshot.longitude != null,
        ).length;
        aisSnapshotsStored += aisStored;
        if (aisStored > 0) aisLastStoredAt = storedAt;
        if (aisPositionsStored > 0) aisLastPositionStoredAt = storedAt;
        for (const sourceName of Object.keys(
          regionalMaritimeRuntime,
        ) as RegionalMaritimeSourceName[]) {
          const stored = snapshots.filter(
            (snapshot) => snapshot.source_name === sourceName,
          ).length;
          if (stored === 0) continue;
          const runtime = regionalMaritimeRuntime[sourceName];
          runtime.snapshotsStored += stored;
          runtime.lastStoredAt = storedAt;
        }
        aisLastFlushAt = storedAt;
        aisLastFlushError = null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        aisLastFlushAt = Date.now();
        aisLastFlushError = message;
        console.error(
          `AISstream flush failed for ${snapshots.length} snapshots: ${message}`,
        );
        for (const snapshot of snapshots) {
          const queued = maritimeQueue.get(snapshot.entity_id);
          if (
            !queued ||
            (snapshot.source_name !== "adsb_lol" &&
              queued.source_name !== "adsb_lol" &&
              shouldReplaceMaritimeSnapshot(
                {
                  source_name: snapshot.source_name,
                  observed_at: snapshot.observed_at,
                },
                {
                  source_name: queued.source_name,
                  observed_at: queued.observed_at,
                },
              ))
          ) {
            maritimeQueue.set(snapshot.entity_id, snapshot);
          }
        }
        break;
      }
    }
    logAisProgressIfDue();
  } finally {
    aisFlushRunning = false;
  }
}

function queueRegionalMaritimeObservation(
  observation: RegionalMaritimeObservation,
  sourceName: RegionalMaritimeSourceName,
): boolean {
  const now = Date.now();
  if (
    !canQueueMaritimeSnapshot(
      observation.mmsi,
      sourceName,
      observation.observedAt,
      now,
    )
  ) return false;
  const destinationPort = destinationPortFromText(observation.destination);
  const destinationCountry =
    destinationPort?.iso2 ?? destinationCountryFromText(observation.destination);
  const registration = getCountryFromMMSI(observation.mmsi);
  const registrationCountry = registration.valid
    ? normalizeIso2(registration.alpha2)
    : null;
  const currentPort = maritimePortAtPosition(
    observation.latitude,
    observation.longitude,
  );
  const currentCountry =
    currentPort?.iso2 ??
    countryAtPosition(observation.latitude, observation.longitude);
  if (currentCountry && !firstMaritimeCountry.has(observation.mmsi)) {
    firstMaritimeCountry.set(observation.mmsi, currentCountry);
  }
  if (!firstMaritimePosition.has(observation.mmsi)) {
    firstMaritimePosition.set(observation.mmsi, {
      latitude: observation.latitude,
      longitude: observation.longitude,
    });
  }
  const originCountry =
    destinationCountry && firstMaritimeCountry.get(observation.mmsi) !== destinationCountry
      ? firstMaritimeCountry.get(observation.mmsi) ?? null
      : null;
  const originPosition = firstMaritimePosition.get(observation.mmsi);
  const navigationStatus = observation.navigationStatus == null
    ? null
    : Math.round(observation.navigationStatus);
  const linkageBasis = [
    currentCountry && !currentPort ? "position_country" : null,
    currentPort ? "port_geofence" : null,
    originCountry ? "voyage_origin" : null,
    destinationCountry ? "declared_destination" : null,
    registrationCountry ? "mmsi_flag" : null,
  ].filter((value): value is string => Boolean(value));
  const staticKey = maritimeStaticCacheKey(sourceName, observation.mmsi);
  maritimeStatic.set(staticKey, {
    ...maritimeStatic.get(staticKey),
    display_name:
      observation.displayName ?? maritimeStatic.get(staticKey)?.display_name,
    callsign:
      observation.callsign ?? maritimeStatic.get(staticKey)?.callsign,
    vehicle_type:
      observation.shipType == null
        ? maritimeStatic.get(staticKey)?.vehicle_type
        : String(observation.shipType),
    vehicle_category:
      maritimeCategory(
        observation.shipType == null ? null : String(observation.shipType),
      ) ?? maritimeStatic.get(staticKey)?.vehicle_category,
    destination_name:
      observation.destination ?? maritimeStatic.get(staticKey)?.destination_name,
    destination_country_iso2:
      destinationCountry ??
      maritimeStatic.get(staticKey)?.destination_country_iso2,
    destination_latitude:
      destinationPort?.latitude ??
      maritimeStatic.get(staticKey)?.destination_latitude,
    destination_longitude:
      destinationPort?.longitude ??
      maritimeStatic.get(staticKey)?.destination_longitude,
    route_label: observation.destination
      ? `Destination ${observation.destination}`
      : maritimeStatic.get(staticKey)?.route_label,
  });
  const staticData = maritimeStatic.get(staticKey);
  const snapshot: MaritimeTransportSnapshotInput = {
    mode: "maritime",
    entity_id: observation.mmsi,
    display_name: observation.displayName ?? staticData?.display_name,
    callsign: observation.callsign ?? staticData?.callsign,
    registration: observation.mmsi,
    vehicle_type:
      observation.shipType == null
        ? staticData?.vehicle_type ?? registration.type
        : String(observation.shipType),
    vehicle_category:
      maritimeCategory(
        observation.shipType == null ? null : String(observation.shipType),
      ) ?? staticData?.vehicle_category,
    latitude: observation.latitude,
    longitude: observation.longitude,
    heading: normalizedHeading(observation.heading, observation.course),
    speed: normalizedTransportSpeed("maritime", observation.speed),
    current_country_iso2: currentCountry,
    origin_country_iso2: originCountry,
    destination_country_iso2: destinationCountry,
    registration_country_iso2: registrationCountry,
    origin_name: originCountry
      ? COUNTRY_NAME_BY_ISO.get(originCountry) ?? originCountry
      : null,
    destination_name: observation.destination,
    origin_latitude: originPosition?.latitude,
    origin_longitude: originPosition?.longitude,
    destination_latitude: destinationPort?.latitude,
    destination_longitude: destinationPort?.longitude,
    current_location_name: currentPort?.name,
    route_label: staticData?.route_label,
    linkage_basis: linkageBasis,
    linkage_confidence:
      currentCountry || destinationCountry
        ? "high"
        : registrationCountry
          ? "medium"
          : "none",
    status:
      navigationStatus == null
        ? null
        : NAVIGATION_STATUS[navigationStatus] ??
          `Navigation status ${navigationStatus}`,
    is_alert: navigationStatus != null && [2, 6, 14].includes(navigationStatus),
    source_name: sourceName,
    observed_at: observation.observedAt,
    payload: {
      provider: MARITIME_SOURCE_DEFINITIONS[sourceName].provider,
      license: MARITIME_SOURCE_DEFINITIONS[sourceName].license,
      source_url: MARITIME_SOURCE_DEFINITIONS[sourceName].sourceUrl,
      attribution:
        sourceName === "barentswatch"
          ? "Data delivered by BarentsWatch; source: Norwegian Coastal Administration"
          : sourceName === "mpa_oceans_x"
            ? "Source: Maritime and Port Authority of Singapore OCEANS-X"
            : sourceName === "kystverket"
              ? "Source: Norwegian Coastal Administration"
              : "Source: Fintraffic Digitraffic",
      mmsi_type: registration.type,
    },
  };
  if (!enqueueMaritimeSnapshot(snapshot, now)) return false;
  const runtime = regionalMaritimeRuntime[sourceName];
  runtime.lastSnapshotAt = Math.max(
    runtime.lastSnapshotAt ?? 0,
    Date.parse(observation.observedAt),
  );
  runtime.snapshotsAccepted += 1;
  return true;
}

async function fetchDigitrafficJson(path: string): Promise<unknown> {
  const response = await fetch(`${DIGITRAFFIC_MARITIME_BASE_URL}/${path}`, {
    headers: {
      accept: "application/json",
      "accept-encoding": "gzip",
      "digitraffic-user": "Claritas/1.0",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Digitraffic maritime API HTTP ${response.status}`);
  }
  return response.json();
}

async function runDigitrafficMaritimeRefresh(): Promise<{
  fetched: number;
  queued: number;
}> {
  if (!enabledFromEnv("DIGITRAFFIC_MARITIME_ENABLED")) {
    return { fetched: 0, queued: 0 };
  }
  try {
    const [locations, vessels] = await Promise.all([
      fetchDigitrafficJson("locations"),
      fetchDigitrafficJson("vessels"),
    ]);
    const observations = parseDigitrafficMaritimeObservations(
      locations,
      vessels,
      Date.now(),
      boundedIntegerFromEnv(
        "DIGITRAFFIC_MARITIME_FRESHNESS_MINUTES",
        15,
        5,
        120,
      ) * 60_000,
    );
    let queued = 0;
    for (const observation of observations) {
      if (queueRegionalMaritimeObservation(observation, "digitraffic")) queued += 1;
    }
    regionalMaritimeRuntime.digitraffic.lastRefreshAt = Date.now();
    regionalMaritimeRuntime.digitraffic.lastError = null;
    console.info(
      JSON.stringify({
        event: "digitraffic_maritime_refresh",
        fetched: observations.length,
        queued,
        queue_depth: maritimeQueue.size,
      }),
    );
    return { fetched: observations.length, queued };
  } catch (error) {
    regionalMaritimeRuntime.digitraffic.lastError =
      error instanceof Error ? error.message : String(error);
    console.warn(
      `Digitraffic maritime refresh failed: ${regionalMaritimeRuntime.digitraffic.lastError}`,
    );
    return { fetched: 0, queued: 0 };
  }
}

function refreshDigitrafficMaritime(): Promise<{ fetched: number; queued: number }> {
  if (!digitrafficRefresh) {
    digitrafficRefresh = runDigitrafficMaritimeRefresh().finally(() => {
      digitrafficRefresh = null;
    });
  }
  return digitrafficRefresh;
}

function startDigitrafficMaritimeWorker(): void {
  if (!enabledFromEnv("DIGITRAFFIC_MARITIME_ENABLED") || digitrafficTimer) return;
  void refreshDigitrafficMaritime();
  digitrafficTimer = setInterval(() => {
    void refreshDigitrafficMaritime();
  }, boundedIntegerFromEnv("DIGITRAFFIC_MARITIME_POLL_SECONDS", 60, 60, 900) * 1_000);
  digitrafficTimer.unref();
}

async function getBarentsWatchAccessToken(): Promise<string> {
  const now = Date.now();
  if (barentswatchToken && barentswatchToken.expiresAt > now) {
    return barentswatchToken.accessToken;
  }
  const clientId = process.env.BARENTSWATCH_AIS_CLIENT_ID?.trim();
  const clientSecret = process.env.BARENTSWATCH_AIS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("BarentsWatch AIS OAuth credentials are not configured");
  }
  const response = await fetch(BARENTSWATCH_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "ais",
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`BarentsWatch OAuth HTTP ${response.status}`);
  }
  const parsed = parseBarentsWatchToken(await response.json(), now);
  if (!parsed) throw new Error("BarentsWatch OAuth response was invalid");
  barentswatchToken = parsed;
  return parsed.accessToken;
}

async function runBarentsWatchMaritimeRefresh(): Promise<{
  fetched: number;
  queued: number;
}> {
  if (!regionalSourceConfigured("barentswatch")) {
    return { fetched: 0, queued: 0 };
  }
  try {
    const accessToken = await getBarentsWatchAccessToken();
    const response = await fetch(BARENTSWATCH_AIS_URL, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      if (response.status === 401) barentswatchToken = null;
      throw new Error(`BarentsWatch live AIS HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("BarentsWatch live AIS returned an invalid snapshot");
    }
    const observations = parseBarentsWatchMaritimeObservations(
      payload,
      Date.now(),
      boundedIntegerFromEnv(
        "BARENTSWATCH_AIS_FRESHNESS_MINUTES",
        15,
        5,
        120,
      ) * 60_000,
    );
    let queued = 0;
    for (const observation of observations) {
      if (queueRegionalMaritimeObservation(observation, "barentswatch")) {
        queued += 1;
      }
    }
    const runtime = regionalMaritimeRuntime.barentswatch;
    runtime.lastRefreshAt = Date.now();
    runtime.lastError = null;
    console.info(
      JSON.stringify({
        event: "barentswatch_maritime_refresh",
        fetched: observations.length,
        queued,
        queue_depth: maritimeQueue.size,
      }),
    );
    return { fetched: observations.length, queued };
  } catch (error) {
    const runtime = regionalMaritimeRuntime.barentswatch;
    runtime.lastError = error instanceof Error ? error.message : String(error);
    console.warn(`BarentsWatch maritime refresh failed: ${runtime.lastError}`);
    return { fetched: 0, queued: 0 };
  }
}

function refreshBarentsWatchMaritime(): Promise<{
  fetched: number;
  queued: number;
}> {
  if (!barentswatchRefresh) {
    barentswatchRefresh = runBarentsWatchMaritimeRefresh().finally(() => {
      barentswatchRefresh = null;
    });
  }
  return barentswatchRefresh;
}

function startBarentsWatchMaritimeWorker(): void {
  if (barentswatchTimer) return;
  if (!regionalSourceConfigured("barentswatch")) {
    if (enabledFromEnv("BARENTSWATCH_AIS_ENABLED")) {
      console.info(
        "BarentsWatch AIS fallback is disabled until both OAuth credentials are configured.",
      );
    }
    return;
  }
  void refreshBarentsWatchMaritime();
  barentswatchTimer = setInterval(() => {
    void refreshBarentsWatchMaritime();
  }, boundedIntegerFromEnv("BARENTSWATCH_AIS_POLL_SECONDS", 60, 60, 900) * 1_000);
  barentswatchTimer.unref();
}

async function runMpaOceansXMaritimeRefresh(): Promise<{
  fetched: number;
  queued: number;
}> {
  if (!regionalSourceConfigured("mpa_oceans_x")) {
    return { fetched: 0, queued: 0 };
  }
  try {
    const apiKey = process.env.MPA_OCEANS_X_API_KEY?.trim();
    if (!apiKey) throw new Error("MPA OCEANS-X API key is not configured");
    const response = await fetch(MPA_OCEANS_X_AIS_URL, {
      headers: {
        accept: "application/json",
        ApiKey: apiKey,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`MPA OCEANS-X vessel snapshot HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("MPA OCEANS-X returned an invalid vessel snapshot");
    }
    const observations = parseMpaMaritimeObservations(
      payload,
      Date.now(),
      boundedIntegerFromEnv(
        "MPA_OCEANS_X_FRESHNESS_MINUTES",
        15,
        5,
        120,
      ) * 60_000,
    );
    let queued = 0;
    for (const observation of observations) {
      if (queueRegionalMaritimeObservation(observation, "mpa_oceans_x")) {
        queued += 1;
      }
    }
    const runtime = regionalMaritimeRuntime.mpa_oceans_x;
    runtime.lastRefreshAt = Date.now();
    runtime.lastError = null;
    console.info(
      JSON.stringify({
        event: "mpa_oceans_x_maritime_refresh",
        fetched: observations.length,
        queued,
        queue_depth: maritimeQueue.size,
      }),
    );
    return { fetched: observations.length, queued };
  } catch (error) {
    const runtime = regionalMaritimeRuntime.mpa_oceans_x;
    runtime.lastError = error instanceof Error ? error.message : String(error);
    console.warn(`MPA OCEANS-X maritime refresh failed: ${runtime.lastError}`);
    return { fetched: 0, queued: 0 };
  }
}

function refreshMpaOceansXMaritime(): Promise<{
  fetched: number;
  queued: number;
}> {
  if (!mpaOceansXRefresh) {
    mpaOceansXRefresh = runMpaOceansXMaritimeRefresh().finally(() => {
      mpaOceansXRefresh = null;
    });
  }
  return mpaOceansXRefresh;
}

function startMpaOceansXMaritimeWorker(): void {
  if (mpaOceansXTimer) return;
  if (!regionalSourceConfigured("mpa_oceans_x")) {
    if (enabledFromEnv("MPA_OCEANS_X_ENABLED")) {
      console.info(
        "MPA OCEANS-X AIS fallback is disabled until an API key is configured.",
      );
    }
    return;
  }
  void refreshMpaOceansXMaritime();
  mpaOceansXTimer = setInterval(() => {
    void refreshMpaOceansXMaritime();
  }, boundedIntegerFromEnv("MPA_OCEANS_X_POLL_SECONDS", 180, 180, 900) * 1_000);
  mpaOceansXTimer.unref();
}

function kystverketFreshnessMilliseconds(): number {
  return (
    boundedIntegerFromEnv(
      "KYSTVERKET_AIS_TCP_FRESHNESS_MINUTES",
      15,
      5,
      120,
    ) * 60_000
  );
}

function handleKystverketLine(line: string): void {
  const now = Date.now();
  const parsed = parseRegionalAisNmeaLine(line);
  const observedAt = parsed?.timestampMilliseconds ?? now;
  if (
    parsed &&
    observedAt <= now + 5 * 60_000 &&
    now - observedAt <= kystverketFreshnessMilliseconds()
  ) {
    const runtime = regionalMaritimeRuntime.kystverket;
    runtime.lastRefreshAt = now;
    runtime.lastError = null;
  }
  const observation = kystverketDecoder?.consumeLine(line, now);
  if (!observation) return;
  kystverketReconnectAttempt = 0;
  if (enabledFromEnv("KYSTVERKET_AIS_TCP_PERSIST_ENABLED", false)) {
    queueRegionalMaritimeObservation(observation, "kystverket");
    return;
  }
  // The public raw socket is unauthenticated plaintext. Decode it for endpoint
  // diagnostics, but require a separate explicit opt-in before its positions
  // can enter the shared vessel store.
  const runtime = regionalMaritimeRuntime.kystverket;
  runtime.lastSnapshotAt = Math.max(
    runtime.lastSnapshotAt ?? 0,
    Date.parse(observation.observedAt),
  );
  runtime.snapshotsAccepted += 1;
}

function scheduleKystverketReconnect(): void {
  if (
    kystverketReconnectTimer ||
    !regionalSourceConfigured("kystverket")
  ) {
    return;
  }
  const delay = aisReconnectDelayMilliseconds(kystverketReconnectAttempt);
  kystverketReconnectAttempt += 1;
  kystverketReconnectTimer = setTimeout(() => {
    kystverketReconnectTimer = null;
    connectKystverketAisTcp();
  }, delay);
  kystverketReconnectTimer.unref();
}

function connectKystverketAisTcp(): void {
  if (!regionalSourceConfigured("kystverket") || kystverketSocket) return;
  const host =
    process.env.KYSTVERKET_AIS_TCP_HOST?.trim() || "153.44.253.27";
  const port = boundedIntegerFromEnv(
    "KYSTVERKET_AIS_TCP_PORT",
    5_631,
    1,
    65_535,
  );
  const socket = createConnection({ host, port, timeout: 15_000 });
  kystverketSocket = socket;
  socket.setEncoding("utf8");
  socket.setKeepAlive(true, 30_000);

  socket.on("connect", () => {
    kystverketLineBuffer = "";
    socket.setTimeout(180_000);
    console.info(`Kystverket regional AIS TCP connected to ${host}:${port}.`);
  });

  socket.on("data", (chunk) => {
    kystverketLineBuffer += chunk.toString();
    if (kystverketLineBuffer.length > 256 * 1_024) {
      regionalMaritimeRuntime.kystverket.lastError =
        "Kystverket AIS line buffer exceeded its safety limit";
      socket.destroy(new Error("Kystverket AIS line buffer overflow"));
      return;
    }
    let newlineIndex = kystverketLineBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = kystverketLineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      kystverketLineBuffer = kystverketLineBuffer.slice(newlineIndex + 1);
      if (line) handleKystverketLine(line);
      newlineIndex = kystverketLineBuffer.indexOf("\n");
    }
  });

  socket.on("timeout", () => {
    socket.destroy(new Error("Kystverket AIS TCP stream timed out"));
  });

  socket.on("error", (error) => {
    regionalMaritimeRuntime.kystverket.lastError = error.message;
    console.warn(`Kystverket regional AIS TCP error: ${error.message}`);
  });

  socket.on("close", () => {
    if (kystverketSocket === socket) {
      kystverketSocket = null;
      kystverketLineBuffer = "";
    }
    scheduleKystverketReconnect();
  });
}

function startKystverketMaritimeWorker(): void {
  if (!regionalSourceConfigured("kystverket")) return;
  if (!kystverketDecoder) {
    kystverketDecoder = new RegionalAisNmeaDecoder({
      freshnessMilliseconds: kystverketFreshnessMilliseconds(),
    });
  }
  connectKystverketAisTcp();
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

class AdsbHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMilliseconds = 12_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
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
      throw new AdsbHttpError(
        `adsb.lol returned HTTP ${response.status}`,
        response.status,
      );
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
): Promise<AdsbRoute | null> {
  const cached = routeCache.get(callsign);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (adsbRouteProviderUnavailableUntil > Date.now()) return null;
  try {
    const normalizedCallsign = callsign.trim().toUpperCase();
    const prefix = encodeURIComponent(normalizedCallsign.slice(0, 2));
    const route = await fetchJson<AdsbRoute>(
      `${ADSB_STANDING_DATA_BASE_URL}/routes/${prefix}/${encodeURIComponent(normalizedCallsign)}.json`,
      undefined,
      5_000,
    );
    const value = usableAdsbRoute(route);
    adsbRouteProviderFailures = 0;
    adsbRouteProviderUnavailableUntil = 0;
    routeCache.set(callsign, {
      expiresAt: Date.now() + 20 * 60_000,
      value,
    });
    return value;
  } catch (error) {
    if (error instanceof AdsbHttpError && error.status === 404) {
      adsbRouteProviderFailures = 0;
      adsbRouteProviderUnavailableUntil = 0;
      routeCache.set(callsign, {
        expiresAt: Date.now() + 20 * 60_000,
        value: null,
      });
      return null;
    }
    adsbRouteProviderFailures += 1;
    routeCache.set(callsign, { expiresAt: Date.now() + 60_000, value: null });
    if (
      adsbRouteProviderFailures >= 12 &&
      adsbRouteProviderUnavailableUntil <= Date.now()
    ) {
      adsbRouteProviderUnavailableUntil = Date.now() + 60_000;
      console.warn(
        JSON.stringify({
          event: "adsb_route_provider_circuit_open",
          failures: adsbRouteProviderFailures,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return null;
  }
}

function usableAdsbRoute(route: AdsbRoute | null | undefined): AdsbRoute | null {
  return route?.airport_codes &&
    route.airport_codes.toLowerCase() !== "unknown" &&
    route.plausible !== false
    ? route
    : null;
}

async function enrichAdsbRoutes(
  lookups: AdsbRouteLookup[],
): Promise<void> {
  await mapWithConcurrency(lookups, 20, (lookup) =>
    getAdsbRoute(lookup.callsign),
  );
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
    heading: normalizedHeading(aircraft.track),
    speed: normalizedTransportSpeed("aviation", aircraft.gs),
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

  const uncachedByCallsign = new Map<string, AdsbRouteLookup>();
  for (const entry of byHex.values()) {
    const callsign = asString(entry.aircraft.flight)?.replace(/\s+/g, "");
    const latitude = asFinite(entry.aircraft.lat);
    const longitude = asFinite(entry.aircraft.lon);
    if (!callsign || latitude == null || longitude == null) continue;
    const cached = routeCache.get(callsign);
    if (cached && cached.expiresAt > Date.now()) continue;
    if (uncachedByCallsign.has(callsign)) continue;
    uncachedByCallsign.set(callsign, {
      callsign,
      latitude,
      longitude,
      scope: countryAtPosition(latitude, longitude) ?? TRANSPORT_SCOPE_GLOBAL,
    });
  }
  const routeLookupLimit = boundedIntegerFromEnv(
    "ADSB_LOL_MAX_ROUTE_LOOKUPS",
    750,
    10,
    5_000,
  );
  const routeCandidates = prioritizeAdsbRouteLookups(
    Array.from(uncachedByCallsign.values()),
    routeLookupLimit,
    aviationRouteLookupGeneration,
  );
  aviationRouteLookupGeneration += 1;
  await enrichAdsbRoutes(routeCandidates);
  const snapshots = Array.from(byHex.values()).flatMap((entry) => {
    const callsign = asString(entry.aircraft.flight)?.replace(/\s+/g, "");
    const cachedRoute = callsign ? routeCache.get(callsign) : null;
    const snapshot = flightSnapshot(
      entry.aircraft,
      cachedRoute && cachedRoute.expiresAt > Date.now()
        ? cachedRoute.value
        : null,
      entry.observedAt
    );
    return snapshot ? [snapshot] : [];
  });
  await storeTransportSnapshots(snapshots);
  console.info(
    JSON.stringify({
      event: "adsb_route_enrichment",
      aircraft: byHex.size,
      uncached_callsigns: uncachedByCallsign.size,
      lookup_candidates: routeCandidates.length,
      routed_snapshots: snapshots.filter(
        (snapshot) =>
          snapshot.origin_country_iso2 && snapshot.destination_country_iso2,
      ).length,
    }),
  );
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

export async function storeTransportSnapshots(
  snapshots: TransportSnapshotInput[],
): Promise<void> {
  const sourcePrioritySql = (alias: string) =>
    `CASE ${alias}.source_name ${Object.entries(MARITIME_SOURCE_DEFINITIONS)
      .map(([sourceName, definition]) =>
        `WHEN '${sourceName}' THEN ${definition.priority}`,
      )
      .join(" ")} ELSE 0 END`;
  const candidateWinsSql = `(
    EXCLUDED.observed_at > transport_snapshot.observed_at
    OR (
      EXCLUDED.observed_at = transport_snapshot.observed_at
      AND ${sourcePrioritySql("EXCLUDED")} >= ${sourcePrioritySql("transport_snapshot")}
    )
  )`;
  const coherentNullableSql = (column: string) => `CASE
    WHEN EXCLUDED.source_name = transport_snapshot.source_name
      THEN COALESCE(EXCLUDED.${column}, transport_snapshot.${column})
    ELSE EXCLUDED.${column}
  END`;
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
         display_name = ${coherentNullableSql("display_name")},
         callsign = ${coherentNullableSql("callsign")},
         flight_number = ${coherentNullableSql("flight_number")},
         registration = ${coherentNullableSql("registration")},
         vehicle_type = ${coherentNullableSql("vehicle_type")},
         latitude = ${coherentNullableSql("latitude")},
         longitude = ${coherentNullableSql("longitude")},
         heading = ${coherentNullableSql("heading")},
         speed = ${coherentNullableSql("speed")},
         altitude = ${coherentNullableSql("altitude")},
         vertical_rate = ${coherentNullableSql("vertical_rate")},
         current_country_iso2 = ${coherentNullableSql("current_country_iso2")},
         origin_country_iso2 = ${coherentNullableSql("origin_country_iso2")},
         destination_country_iso2 = ${coherentNullableSql("destination_country_iso2")},
         registration_country_iso2 = ${coherentNullableSql("registration_country_iso2")},
         origin_name = ${coherentNullableSql("origin_name")},
         destination_name = ${coherentNullableSql("destination_name")},
         origin_latitude = ${coherentNullableSql("origin_latitude")},
         origin_longitude = ${coherentNullableSql("origin_longitude")},
         destination_latitude = ${coherentNullableSql("destination_latitude")},
         destination_longitude = ${coherentNullableSql("destination_longitude")},
         route_label = ${coherentNullableSql("route_label")},
         linkage_basis = CASE
           WHEN EXCLUDED.source_name = transport_snapshot.source_name
             AND cardinality(EXCLUDED.linkage_basis) = 0
             THEN transport_snapshot.linkage_basis
           ELSE EXCLUDED.linkage_basis
         END,
         linkage_confidence = CASE
           WHEN EXCLUDED.source_name = transport_snapshot.source_name
             AND EXCLUDED.linkage_confidence = 'none'
             THEN transport_snapshot.linkage_confidence
           ELSE EXCLUDED.linkage_confidence
         END,
         status = CASE
           WHEN EXCLUDED.source_name = transport_snapshot.source_name
             THEN COALESCE(EXCLUDED.status, transport_snapshot.status)
           ELSE EXCLUDED.status
         END,
         is_alert = CASE
           WHEN EXCLUDED.source_name = transport_snapshot.source_name
             AND EXCLUDED.status IS NULL
             THEN transport_snapshot.is_alert
           ELSE EXCLUDED.is_alert
         END,
         source_name = EXCLUDED.source_name,
         observed_at = EXCLUDED.observed_at,
         payload = EXCLUDED.payload,
         vehicle_category = ${coherentNullableSql("vehicle_category")},
         current_location_name = ${coherentNullableSql("current_location_name")}
       WHERE ${candidateWinsSql}`,
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
         source_name = CASE
           WHEN EXCLUDED.last_observed_at >
               transport_entity_activity_hour.last_observed_at
             OR (
               EXCLUDED.last_observed_at =
                 transport_entity_activity_hour.last_observed_at
               AND ${sourcePrioritySql("EXCLUDED")} >=
                 ${sourcePrioritySql("transport_entity_activity_hour")}
             )
             THEN EXCLUDED.source_name
           ELSE transport_entity_activity_hour.source_name
         END,
         vehicle_category = CASE
           WHEN EXCLUDED.last_observed_at >
               transport_entity_activity_hour.last_observed_at
             OR (
               EXCLUDED.last_observed_at =
                 transport_entity_activity_hour.last_observed_at
               AND ${sourcePrioritySql("EXCLUDED")} >=
                 ${sourcePrioritySql("transport_entity_activity_hour")}
             )
             THEN COALESCE(
               EXCLUDED.vehicle_category,
               transport_entity_activity_hour.vehicle_category
             )
           ELSE transport_entity_activity_hour.vehicle_category
         END`,
      values,
    );
  }

  const countryDaily = new Map<
    string,
    {
      bucket: string;
      mode: TransportMode;
      country: string;
      entities: Set<string>;
      hourMask: bigint;
      firstObservedAt: string;
      lastObservedAt: string;
      sources: Set<string>;
    }
  >();
  for (const row of activityRows) {
    if (row.country === TRANSPORT_SCOPE_GLOBAL) continue;
    const observedAt = new Date(row.snapshot.observed_at);
    const bucket = new Date(observedAt);
    bucket.setUTCHours(0, 0, 0, 0);
    const key = [bucket.toISOString(), row.snapshot.mode, row.country].join(":");
    const existing = countryDaily.get(key) ?? {
      bucket: bucket.toISOString().slice(0, 10),
      mode: row.snapshot.mode,
      country: row.country,
      entities: new Set<string>(),
      hourMask: 0n,
      firstObservedAt: row.snapshot.observed_at,
      lastObservedAt: row.snapshot.observed_at,
      sources: new Set<string>(),
    };
    existing.entities.add(row.snapshot.entity_id);
    existing.hourMask |= 1n << BigInt(observedAt.getUTCHours());
    if (row.snapshot.observed_at < existing.firstObservedAt) {
      existing.firstObservedAt = row.snapshot.observed_at;
    }
    if (row.snapshot.observed_at > existing.lastObservedAt) {
      existing.lastObservedAt = row.snapshot.observed_at;
    }
    existing.sources.add(row.snapshot.source_name);
    countryDaily.set(key, existing);
  }
  const countryAggregates = Array.from(countryDaily.values());
  for (let offset = 0; offset < countryAggregates.length; offset += 500) {
    const batch = countryAggregates.slice(offset, offset + 500);
    const values: unknown[] = [];
    const rows = batch.map((row, index) => {
      const start = index * 9;
      values.push(
        row.bucket,
        row.mode,
        row.country,
        row.entities.size,
        row.hourMask.toString(),
        row.firstObservedAt,
        row.lastObservedAt,
        Array.from(row.sources).sort(),
        1,
      );
      return `(${Array.from(
        { length: 9 },
        (_, valueIndex) => `$${start + valueIndex + 1}`,
      ).join(", ")})`;
    });
    await query(
      `INSERT INTO transport_country_activity_day (
         bucket, mode, country_iso2, peak_active_entities,
         observed_hour_mask, first_observed_at, last_observed_at,
         source_names, observation_batches
       ) VALUES ${rows.join(", ")}
       ON CONFLICT (bucket, mode, country_iso2) DO UPDATE SET
         peak_active_entities = GREATEST(
           transport_country_activity_day.peak_active_entities,
           EXCLUDED.peak_active_entities
         ),
         observed_hour_mask =
           transport_country_activity_day.observed_hour_mask |
           EXCLUDED.observed_hour_mask,
         observation_batches =
           transport_country_activity_day.observation_batches + 1,
         first_observed_at = LEAST(
           transport_country_activity_day.first_observed_at,
           EXCLUDED.first_observed_at
         ),
         last_observed_at = GREATEST(
           transport_country_activity_day.last_observed_at,
           EXCLUDED.last_observed_at
         ),
         source_names = ARRAY(
           SELECT DISTINCT source
           FROM unnest(
             transport_country_activity_day.source_names || EXCLUDED.source_names
           ) source
           ORDER BY source
         )`,
      values,
    );
  }

  const corridorRows = trackPoints.flatMap((snapshot) => {
    const explicitOrigin = normalizeIso2(snapshot.origin_country_iso2);
    const flagOrigin =
      snapshot.mode === "maritime"
        ? normalizeIso2(snapshot.registration_country_iso2)
        : null;
    const origin = explicitOrigin ?? flagOrigin;
    const destination = normalizeIso2(snapshot.destination_country_iso2);
    if (!origin || !destination) return [];
    if (origin === destination) return [];
    const observedAt = new Date(snapshot.observed_at);
    const hourMask = 1n << BigInt(observedAt.getUTCHours());
    const bucket = new Date(observedAt);
    bucket.setUTCHours(0, 0, 0, 0);
    return [{
      snapshot,
      origin,
      destination,
      bucket: bucket.toISOString().slice(0, 10),
      hourMask,
      originBasis: explicitOrigin ? "observed" : "flag_fallback",
    }];
  });
  const corridorAggregates = new Map<
    string,
    {
      bucket: string;
      mode: TransportMode;
      origin: string;
      destination: string;
      entities: Set<string>;
      observedOrigins: Set<string>;
      flagProxyOrigins: Set<string>;
      hourMask: bigint;
      firstObservedAt: string;
      lastObservedAt: string;
      sources: Set<string>;
    }
  >();
  for (const row of corridorRows) {
    const key = [row.bucket, row.snapshot.mode, row.origin, row.destination].join(":");
    const existing = corridorAggregates.get(key) ?? {
      bucket: row.bucket,
      mode: row.snapshot.mode,
      origin: row.origin,
      destination: row.destination,
      entities: new Set<string>(),
      observedOrigins: new Set<string>(),
      flagProxyOrigins: new Set<string>(),
      hourMask: 0n,
      firstObservedAt: row.snapshot.observed_at,
      lastObservedAt: row.snapshot.observed_at,
      sources: new Set<string>(),
    };
    existing.entities.add(row.snapshot.entity_id);
    (row.originBasis === "observed"
      ? existing.observedOrigins
      : existing.flagProxyOrigins
    ).add(row.snapshot.entity_id);
    existing.hourMask |= row.hourMask;
    if (row.snapshot.observed_at < existing.firstObservedAt) {
      existing.firstObservedAt = row.snapshot.observed_at;
    }
    if (row.snapshot.observed_at > existing.lastObservedAt) {
      existing.lastObservedAt = row.snapshot.observed_at;
    }
    existing.sources.add(row.snapshot.source_name);
    corridorAggregates.set(key, existing);
  }
  const aggregates = Array.from(corridorAggregates.values()).sort(
    (left, right) => right.entities.size - left.entities.size,
  );
  for (let offset = 0; offset < aggregates.length; offset += 500) {
    const batch = aggregates.slice(offset, offset + 500);
    const values: unknown[] = [];
    const rows = batch.map((row, index) => {
      const start = index * 12;
      values.push(
        row.bucket,
        row.mode,
        row.origin,
        row.destination,
        row.entities.size,
        row.observedOrigins.size,
        row.flagProxyOrigins.size,
        row.hourMask.toString(),
        row.firstObservedAt,
        row.lastObservedAt,
        Array.from(row.sources).sort(),
        transportCorridorPairsPerDayMode(),
      );
      return `(${Array.from(
        { length: 12 },
        (_, valueIndex) => `$${start + valueIndex + 1}`,
      ).join(", ")})`;
    });
    await query(
      `WITH incoming AS (
         SELECT raw.bucket::date AS bucket,
                raw.mode::text AS mode,
                raw.origin_country_iso2::char(2) AS origin_country_iso2,
                raw.destination_country_iso2::char(2) AS destination_country_iso2,
                raw.peak_active_entities::integer AS peak_active_entities,
                raw.peak_observed_origins::integer AS peak_observed_origins,
                raw.peak_flag_proxy_origins::integer AS peak_flag_proxy_origins,
                raw.observed_hour_mask::bigint AS observed_hour_mask,
                raw.first_observed_at::timestamptz AS first_observed_at,
                raw.last_observed_at::timestamptz AS last_observed_at,
                raw.source_names::text[] AS source_names,
                raw.daily_cap::integer AS daily_cap
         FROM (VALUES ${rows.join(", ")}) AS raw (
           bucket, mode, origin_country_iso2, destination_country_iso2,
           peak_active_entities, peak_observed_origins,
           peak_flag_proxy_origins, observed_hour_mask, first_observed_at,
           last_observed_at, source_names, daily_cap
         )
       ),
       ranked AS (
         SELECT incoming.*,
                EXISTS (
                  SELECT 1 FROM transport_corridor_activity_day current
                  WHERE current.bucket = incoming.bucket
                    AND current.mode = incoming.mode
                    AND current.origin_country_iso2 = incoming.origin_country_iso2
                    AND current.destination_country_iso2 = incoming.destination_country_iso2
                ) AS already_present,
                ROW_NUMBER() OVER (
                  PARTITION BY incoming.bucket, incoming.mode
                  ORDER BY incoming.peak_active_entities DESC,
                           incoming.origin_country_iso2,
                           incoming.destination_country_iso2
                ) AS admission_rank
         FROM incoming
       ),
       eligible AS (
         SELECT ranked.*
         FROM ranked
         WHERE already_present OR (
           SELECT COUNT(*)
           FROM transport_corridor_activity_day current
           WHERE current.bucket = ranked.bucket
             AND current.mode = ranked.mode
         ) + admission_rank <= ranked.daily_cap
       )
       INSERT INTO transport_corridor_activity_day (
         bucket, mode, origin_country_iso2, destination_country_iso2,
         peak_active_entities, peak_observed_origins,
         peak_flag_proxy_origins, observed_hour_mask, observation_batches,
         first_observed_at, last_observed_at, source_names
       )
       SELECT bucket, mode, origin_country_iso2, destination_country_iso2,
              peak_active_entities, peak_observed_origins,
              peak_flag_proxy_origins, observed_hour_mask, 1,
              first_observed_at, last_observed_at, source_names
       FROM eligible
       ON CONFLICT (bucket, mode, origin_country_iso2, destination_country_iso2)
       DO UPDATE SET
         peak_active_entities = GREATEST(
           transport_corridor_activity_day.peak_active_entities,
           EXCLUDED.peak_active_entities
         ),
         peak_observed_origins = GREATEST(
           transport_corridor_activity_day.peak_observed_origins,
           EXCLUDED.peak_observed_origins
         ),
         peak_flag_proxy_origins = GREATEST(
           transport_corridor_activity_day.peak_flag_proxy_origins,
           EXCLUDED.peak_flag_proxy_origins
         ),
         observed_hour_mask =
           transport_corridor_activity_day.observed_hour_mask |
           EXCLUDED.observed_hour_mask,
         observation_batches =
           transport_corridor_activity_day.observation_batches + 1,
         first_observed_at = LEAST(
           transport_corridor_activity_day.first_observed_at,
           EXCLUDED.first_observed_at
         ),
         last_observed_at = GREATEST(
           transport_corridor_activity_day.last_observed_at,
           EXCLUDED.last_observed_at
         ),
         source_names = ARRAY(
           SELECT DISTINCT source
           FROM unnest(
             transport_corridor_activity_day.source_names || EXCLUDED.source_names
           ) source
           ORDER BY source
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
    heading: normalizedHeading(row.heading),
    speed: normalizedTransportSpeed(row.mode, row.speed),
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

function transportDailyHistoryRetentionDays(): number {
  return boundedIntegerFromEnv(
    "TRANSPORT_DAILY_HISTORY_RETENTION_DAYS",
    100,
    90,
    120,
  );
}

function utcDay(value: string | Date): string {
  return isoDate(value).slice(0, 10);
}

async function loadTransportHistory(
  country: string,
  corridorCountry: string | null,
  mode: TransportMode | null,
) {
  const historyDays = 90;
  const modeClause = mode
    ? "AND mode = $2"
    : "AND mode IN ('maritime', 'aviation')";
  const modeParams = mode ? [country, mode] : [country];
  const activityResult = await query<HistoricalActivityRow>(
    `WITH country_rows AS (
       SELECT *
       FROM transport_country_activity_day
       WHERE country_iso2 = $1
         AND bucket >= date_trunc('day', now()) - interval '89 days'
         ${modeClause}
     ),
     metrics AS (
       SELECT
         date_trunc('day', bucket) AS bucket,
         SUM(peak_active_entities) FILTER (WHERE mode = 'maritime') AS maritime_entities,
         SUM(peak_active_entities) FILTER (WHERE mode = 'aviation') AS aviation_entities,
         bit_count(bit_or(observed_hour_mask)::bit(64)) AS observed_hours
       FROM country_rows
       GROUP BY date_trunc('day', bucket)
     ),
     sources AS (
       SELECT
         date_trunc('day', row.bucket) AS bucket,
         ARRAY_AGG(DISTINCT source ORDER BY source) AS source_names
       FROM country_rows row
       CROSS JOIN LATERAL unnest(row.source_names) source
       GROUP BY date_trunc('day', row.bucket)
     )
     SELECT metrics.*, COALESCE(sources.source_names, ARRAY[]::text[]) AS source_names
     FROM metrics
     LEFT JOIN sources USING (bucket)
     ORDER BY bucket`,
    modeParams,
  );
  const [movementResult, corridorResult] = await Promise.all([
    mode === "aviation"
      ? Promise.resolve({ rows: [] as HistoricalMovementRow[] })
      : query<HistoricalMovementRow>(
          `SELECT
             date_trunc('day', bucket) AS bucket,
             SUM(departures) AS ship_departures,
             SUM(arrivals) AS ship_arrivals,
             SUM(cargo_vessel_departures) AS cargo_vessel_departures
           FROM transport_movement_hour
           WHERE country_iso2 = $1
             AND bucket >= date_trunc('day', now()) - interval '89 days'
           GROUP BY date_trunc('day', bucket)
           ORDER BY bucket`,
          [country],
        ),
    corridorCountry
      ? query<HistoricalCorridorRow>(
          `WITH corridor_rows AS (
             SELECT *
             FROM transport_corridor_activity_day
             WHERE bucket >= date_trunc('day', now()) - interval '89 days'
               AND (
                 (origin_country_iso2 = $1 AND destination_country_iso2 = $2)
                 OR
                 (origin_country_iso2 = $2 AND destination_country_iso2 = $1)
               )
               ${mode ? "AND mode = $3" : ""}
           ),
           metrics AS (
             SELECT
               date_trunc('day', bucket) AS bucket,
               SUM(peak_active_entities) FILTER (WHERE mode = 'maritime') AS maritime_entities,
               SUM(peak_active_entities) FILTER (WHERE mode = 'aviation') AS aviation_entities,
               bit_count(bit_or(observed_hour_mask)::bit(64)) AS observed_hours,
               SUM(peak_observed_origins) AS observed_origins,
               SUM(peak_flag_proxy_origins) AS flag_proxy_origins
             FROM corridor_rows
             GROUP BY date_trunc('day', bucket)
           ),
           sources AS (
             SELECT
               date_trunc('day', row.bucket) AS bucket,
               ARRAY_AGG(DISTINCT source ORDER BY source) AS source_names
             FROM corridor_rows row
             CROSS JOIN LATERAL unnest(row.source_names) source
             GROUP BY date_trunc('day', row.bucket)
           )
           SELECT metrics.*, COALESCE(sources.source_names, ARRAY[]::text[]) AS source_names
           FROM metrics
           LEFT JOIN sources USING (bucket)
           ORDER BY bucket`,
          mode ? [country, corridorCountry, mode] : [country, corridorCountry],
        )
      : Promise.resolve({ rows: [] as HistoricalCorridorRow[] }),
  ]);

  const activity = new Map(activityResult.rows.map((row) => [utcDay(row.bucket), row]));
  const movements = new Map(movementResult.rows.map((row) => [utcDay(row.bucket), row]));
  const corridors = new Map(corridorResult.rows.map((row) => [utcDay(row.bucket), row]));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const series = Array.from({ length: historyDays }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (historyDays - index - 1));
    const day = date.toISOString().slice(0, 10);
    const activityRow = activity.get(day);
    const movementRow = movements.get(day);
    const corridorRow = corridors.get(day);
    return {
      bucket: date.toISOString(),
      maritime_entities: activityRow
        ? transportHistoryModeValue(
            mode,
            "maritime",
            count(activityRow.maritime_entities),
          )
        : null,
      aviation_entities: activityRow
        ? transportHistoryModeValue(
            mode,
            "aviation",
            count(activityRow.aviation_entities),
          )
        : null,
      observed_hours: activityRow ? count(activityRow.observed_hours) : 0,
      ship_departures: movementRow ? count(movementRow.ship_departures) : null,
      ship_arrivals: movementRow ? count(movementRow.ship_arrivals) : null,
      cargo_vessel_departures: movementRow
        ? count(movementRow.cargo_vessel_departures)
        : null,
      corridor_maritime_entities: corridorRow
        ? transportHistoryModeValue(
            mode,
            "maritime",
            count(corridorRow.maritime_entities),
          )
        : null,
      corridor_aviation_entities: corridorRow
        ? transportHistoryModeValue(
            mode,
            "aviation",
            count(corridorRow.aviation_entities),
          )
        : null,
      corridor_observed_hours: corridorRow ? count(corridorRow.observed_hours) : 0,
      corridor_observed_origins: corridorRow
        ? count(corridorRow.observed_origins)
        : null,
      corridor_flag_proxy_origins: corridorRow
        ? count(corridorRow.flag_proxy_origins)
        : null,
      source_names: Array.from(
        new Set([
          ...(activityRow?.source_names ?? []),
          ...(corridorRow?.source_names ?? []),
        ]),
      ),
    };
  });
  const corridorScoped = Boolean(corridorCountry);
  const observedSeries = series.filter((point) =>
    corridorScoped
      ? point.corridor_observed_hours > 0
      : point.observed_hours > 0 ||
        point.ship_departures != null ||
        point.ship_arrivals != null,
  );
  return {
    scope: corridorScoped ? ("corridor" as const) : ("country" as const),
    country,
    corridor_country: corridorCountry,
    requested_days: historyDays,
    retention_days: transportDailyHistoryRetentionDays(),
    available_from: observedSeries[0]?.bucket ?? null,
    available_to: observedSeries.at(-1)?.bucket ?? null,
    observed_days: observedSeries.length,
    windows: ([7, 30, 90] as const).map((days) =>
      transportHistoryWindow(series, days, corridorScoped),
    ),
    series,
    methodology: corridorScoped
      ? "Daily sum of directional peak samples with resolved endpoints in either corridor direction. It is not a daily-unique vehicle count. Storage is capped at the first 1,000 admitted country pairs per mode/day, prioritising higher-volume pairs only within each ingestion flush. Later pairs can be omitted regardless of volume, creating an early-cycle sampling bias; this is not a complete corridor ranking. Maritime flag state remains separately labelled as proxy origin evidence. Missing days mean no persisted observations, not zero traffic."
      : "Daily peak sampled vehicles linked to the selected country, plus separately retained monitored-port transitions. Values are not daily-unique national traffic. Missing days mean no persisted observations, not zero traffic.",
  };
}

type TransportOverviewOptions = {
  detail?: TransportDetailLevel;
  mode?: TransportMode;
  country?: string;
  corridorCountry?: string;
  entityLimit?: number;
  bypassCache?: boolean;
};

async function loadTransportOverview(options?: TransportOverviewOptions) {
  const detail = options?.detail ?? "aggregate";
  const mode = options?.mode ?? null;
  const country = normalizeIso2(options?.country) ?? null;
  const corridorCountry = normalizeIso2(options?.corridorCountry) ?? null;
  const countryParameter = `$${mode ? 2 : 1}`;
  const filters = [
    activeTransportWhere("s"),
    mode ? `s.mode = $1` : null,
    country
      ? `(s.current_country_iso2 = ${countryParameter}
          OR s.origin_country_iso2 = ${countryParameter}
          OR s.destination_country_iso2 = ${countryParameter}
          OR s.registration_country_iso2 = ${countryParameter})`
      : null,
  ].filter(Boolean);
  const params: unknown[] = [];
  if (mode) params.push(mode);
  if (country) params.push(country);
  const where = filters.join(" AND ");
  const routeWhere = [
    activeTransportWhere("s"),
    mode ? `s.mode = $1` : null,
    country
      ? `(COALESCE(
           s.origin_country_iso2,
           CASE WHEN s.mode = 'maritime' THEN s.registration_country_iso2 END
         ) = ${countryParameter}
         OR s.destination_country_iso2 = ${countryParameter})`
      : null,
  ]
    .filter(Boolean)
    .join(" AND ");

  const trendCountryParams = country ? [country] : [];
  // The overview used to launch four aggregate scans at once. On the
  // production two-vCPU database that made individually bounded queries
  // compete with each other (and with briefing collection) until PostgreSQL's
  // statement timeout cancelled one of them. Keep the snapshot scans in a
  // small first wave, then read the hourly activity table separately.
  const [modeResult, countryResult] = await Promise.all([
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
  ]);
  const [routeResult, activityResult] = await Promise.all([
    query<RouteAggregateRow>(
      `SELECT
         s.mode,
         COALESCE(
           s.origin_country_iso2,
           CASE WHEN s.mode = 'maritime' THEN s.registration_country_iso2 END
         ) AS origin_country,
         s.destination_country_iso2 AS destination_country,
         COUNT(*) AS active_count,
         COUNT(*) FILTER (
           WHERE s.mode = 'maritime' AND s.origin_country_iso2 IS NULL
         ) AS flag_origin_count,
         (ARRAY_AGG(
           COALESCE(s.flight_number, s.callsign, s.display_name, s.entity_id)
           ORDER BY s.observed_at DESC
         ))[1:5] AS examples
       FROM transport_snapshot s
       WHERE ${routeWhere}
         AND s.destination_country_iso2 IS NOT NULL
         AND COALESCE(
           s.origin_country_iso2,
           CASE WHEN s.mode = 'maritime' THEN s.registration_country_iso2 END
         ) IS NOT NULL
       GROUP BY s.mode, origin_country, destination_country
       ORDER BY active_count DESC
       LIMIT ${country ? 500 : 100}`,
      params
    ),
    query<ActivityRow>(
      `SELECT
         a.bucket,
         a.mode,
         COUNT(DISTINCT a.entity_id) AS active_count
       FROM transport_entity_activity_hour a
       WHERE a.bucket >= date_trunc('hour', now()) - interval '23 hours'
         AND a.country_iso2 = ${
           country ? `$${mode ? 2 : 1}` : `'${TRANSPORT_SCOPE_GLOBAL}'`
         }
         ${mode ? `AND a.mode = $1` : "AND a.mode IN ('maritime', 'aviation')"}
       GROUP BY a.bucket, a.mode
       ORDER BY a.bucket, a.mode`,
      params
    ),
  ]);

  // Maritime trend and port reads share the compact hourly table. Run them
  // together, then give the larger aviation presence aggregate its own query
  // slot so an overview never creates more than two concurrent DB reads.
  const [movementTrendResult, portTrendResult] = await Promise.all([
    mode === "aviation"
      ? Promise.resolve({ rows: [] as TransportTrendRow[] })
      : query<TransportTrendRow>(
          `SELECT
             CASE
               WHEN GROUPING(h.country_iso2) = 1 THEN NULL
               ELSE BTRIM(h.country_iso2::text)
             END AS country,
             SUM(h.departures) FILTER (
               WHERE h.bucket >= date_trunc('hour', now()) - interval '23 hours'
             ) AS departures_current,
             SUM(h.departures) FILTER (
               WHERE h.bucket < date_trunc('hour', now()) - interval '23 hours'
             ) AS departures_previous,
             SUM(h.cargo_vessel_departures) FILTER (
               WHERE h.bucket >= date_trunc('hour', now()) - interval '23 hours'
             ) AS cargo_departures_current,
             SUM(h.cargo_vessel_departures) FILTER (
               WHERE h.bucket < date_trunc('hour', now()) - interval '23 hours'
             ) AS cargo_departures_previous,
             SUM(h.arrivals) FILTER (
               WHERE h.bucket >= date_trunc('hour', now()) - interval '23 hours'
             ) AS arrivals_current,
             SUM(h.arrivals) FILTER (
               WHERE h.bucket < date_trunc('hour', now()) - interval '23 hours'
             ) AS arrivals_previous
           FROM transport_movement_hour h
           WHERE h.bucket >= date_trunc('hour', now()) - interval '47 hours'
             ${country ? "AND h.country_iso2 = $1" : ""}
           GROUP BY GROUPING SETS ((h.country_iso2), ())`,
          trendCountryParams
        ),
    mode === "aviation"
      ? Promise.resolve({ rows: [] as PortTrendRow[] })
      : query<PortTrendRow>(
          `SELECT
             BTRIM(h.country_iso2::text) AS country,
             h.location_name,
             SUM(h.departures) AS departures_current,
             SUM(h.arrivals) AS arrivals_current,
             SUM(h.cargo_vessel_departures) AS cargo_departures_current
           FROM transport_movement_hour h
           WHERE h.bucket >= date_trunc('hour', now()) - interval '23 hours'
             ${country ? "AND h.country_iso2 = $1" : ""}
           GROUP BY h.country_iso2, h.location_name
           ORDER BY SUM(h.departures + h.arrivals) DESC, location_name
           LIMIT 20`,
          trendCountryParams
        ),
  ]);
  const aviationTrendResult =
    mode === "maritime"
      ? { rows: [] as AviationTrendRow[] }
      : await query<AviationTrendRow>(
          `WITH entity_windows AS (
             SELECT
               a.country_iso2,
               a.entity_id,
               MIN(a.bucket) AS first_bucket,
               MAX(a.bucket) AS last_bucket
             FROM transport_entity_activity_hour a
             WHERE a.mode = 'aviation'
               AND a.bucket >= date_trunc('hour', now()) - interval '47 hours'
               ${country ? "AND a.country_iso2 = $1" : ""}
             GROUP BY a.country_iso2, a.entity_id
           )
           SELECT
             CASE
               WHEN GROUPING(country_iso2) = 1
                 OR country_iso2 = '${TRANSPORT_SCOPE_GLOBAL}' THEN NULL
               ELSE country_iso2
             END AS country,
             COUNT(*) FILTER (
               WHERE last_bucket >= date_trunc('hour', now()) - interval '23 hours'
             ) AS flights_current,
             COUNT(*) FILTER (
               WHERE first_bucket < date_trunc('hour', now()) - interval '23 hours'
             ) AS flights_previous
           FROM entity_windows
           GROUP BY ${country ? "GROUPING SETS ((country_iso2), ())" : "country_iso2"}`,
          trendCountryParams
        );
  const history = country
    ? await loadTransportHistory(country, corridorCountry, mode)
    : null;

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
  const countryAggregates = Array.from(countries.values());
  const maxLinkedEntities = Math.max(
    0,
    ...countryAggregates.map((entry) => entry.active_count)
  );
  const maxShipMovements = Math.max(
    0,
    ...countryAggregates.map(
      (entry) =>
        entry.trend.ship_departures.current + entry.trend.ship_arrivals.current
    )
  );
  const maxTrackedFlights = Math.max(
    0,
    ...countryAggregates.map((entry) => entry.trend.tracked_flights.current)
  );
  const rankingComponents = [
    {
      id: "linked_entities" as const,
      weight: 0.3,
      available: maxLinkedEntities > 0,
    },
    {
      id: "ship_movements" as const,
      weight: 0.35,
      available: mode !== "aviation" && maxShipMovements > 0,
    },
    {
      id: "tracked_flights" as const,
      weight: 0.35,
      available: mode !== "maritime" && maxTrackedFlights > 0,
    },
  ].filter((component) => component.available);
  const availableWeight = rankingComponents.reduce(
    (total, component) => total + component.weight,
    0
  );
  const rankingCandidates = countryAggregates.map((entry) => {
    const shipMovements =
      entry.trend.ship_departures.current + entry.trend.ship_arrivals.current;
    const previousShipMovements =
      entry.trend.ship_departures.previous + entry.trend.ship_arrivals.previous;
    const trackedFlights = entry.trend.tracked_flights.current;
    const previousTrackedFlights = entry.trend.tracked_flights.previous;
    const currentObservedMovements = shipMovements + trackedFlights;
    const previousObservedMovements =
      previousShipMovements + previousTrackedFlights;
    const rawIndex =
      availableWeight > 0
        ? rankingComponents.reduce((total, component) => {
            const value =
              component.id === "linked_entities"
                ? entry.active_count / maxLinkedEntities
                : component.id === "ship_movements"
                  ? shipMovements / maxShipMovements
                  : trackedFlights / maxTrackedFlights;
            return total + value * component.weight;
          }, 0) / availableWeight
        : 0;
    const mixTotal = shipMovements + trackedFlights;
    return {
      country: entry.country,
      country_name: entry.country_name,
      raw_index: rawIndex,
      current: {
        linked_entities: entry.active_count,
        ship_movements: shipMovements,
        ship_departures: entry.trend.ship_departures.current,
        ship_arrivals: entry.trend.ship_arrivals.current,
        cargo_vessel_departures:
          entry.trend.cargo_vessel_departures.current,
        tracked_flights: trackedFlights,
        observed_movements: currentObservedMovements,
      },
      previous: {
        ship_movements: previousShipMovements,
        tracked_flights: previousTrackedFlights,
        observed_movements: previousObservedMovements,
      },
      momentum: transportTrendMetric(
        currentObservedMovements,
        previousObservedMovements
      ),
      mode_mix: {
        maritime_pct:
          mixTotal > 0 ? Math.round((shipMovements / mixTotal) * 1_000) / 10 : null,
        aviation_pct:
          mixTotal > 0 ? Math.round((trackedFlights / mixTotal) * 1_000) / 10 : null,
      },
    };
  });
  const strongestRawIndex = Math.max(
    0,
    ...rankingCandidates.map((entry) => entry.raw_index)
  );
  const rankedCountries = rankingCandidates
    .sort(
      (left, right) =>
        right.raw_index - left.raw_index ||
        right.current.observed_movements - left.current.observed_movements ||
        right.current.linked_entities - left.current.linked_entities ||
        left.country.localeCompare(right.country)
    )
    .map(({ raw_index, ...entry }, index) => ({
      rank: index + 1,
      activity_index:
        strongestRawIndex > 0
          ? Math.round((raw_index / strongestRawIndex) * 1_000) / 10
          : 0,
      ...entry,
    }));
  const rankingHighlights: string[] = [];
  const rankingLeader = rankedCountries[0];
  if (rankingLeader) {
    rankingHighlights.push(
      `${rankingLeader.country_name} ranks first for tracked transport activity (${rankingLeader.activity_index.toFixed(1)}/100): ${rankingLeader.current.ship_movements} ship movements, ${rankingLeader.current.tracked_flights} tracked flights, and ${rankingLeader.current.linked_entities} currently linked entities.`
    );
  }
  const accelerationLeader = [...rankedCountries]
    .filter(
      (entry) =>
        entry.momentum.current > entry.momentum.previous &&
        entry.momentum.current >= 3
    )
    .sort(
      (left, right) =>
        right.momentum.current - right.momentum.previous -
          (left.momentum.current - left.momentum.previous) ||
        right.momentum.current - left.momentum.current
    )[0];
  if (accelerationLeader) {
    rankingHighlights.push(
      `${accelerationLeader.country_name} has the largest absolute 24-hour activity gain: ${accelerationLeader.momentum.current} observed movements versus ${accelerationLeader.momentum.previous} in the previous window${
        accelerationLeader.momentum.change_pct == null
          ? " (new comparison baseline)"
          : ` (${accelerationLeader.momentum.change_pct >= 0 ? "+" : ""}${accelerationLeader.momentum.change_pct.toFixed(1)}%)`
      }.`
    );
  }
  const maritimeLeader = [...rankedCountries].sort(
    (left, right) =>
      right.current.ship_movements - left.current.ship_movements
  )[0];
  const aviationLeader = [...rankedCountries].sort(
    (left, right) =>
      right.current.tracked_flights - left.current.tracked_flights
  )[0];
  if (
    maritimeLeader?.current.ship_movements &&
    aviationLeader?.current.tracked_flights &&
    maritimeLeader.country !== aviationLeader.country
  ) {
    rankingHighlights.push(
      `${maritimeLeader.country_name} leads monitored ship movements (${maritimeLeader.current.ship_movements}), while ${aviationLeader.country_name} leads tracked flights (${aviationLeader.current.tracked_flights}).`
    );
  }
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
    countries: rankedCountries.map((ranking) => countries.get(ranking.country)!),
    activity_ranking: {
      window_hours: 24,
      comparison: "previous_24_hours" as const,
      countries: rankedCountries,
      highlights: rankingHighlights,
      methodology: {
        index:
          "Relative country index (top country = 100) combining normalized live linked entities (30%), monitored ship departures plus arrivals (35%), and uniquely tracked flights (35%). Missing or filtered modes are excluded and remaining weights are rebalanced.",
        momentum:
          "Momentum compares observed ship movements plus uniquely tracked flights with the previous 24-hour window; it is not freight volume, passenger volume, or complete national traffic.",
        coverage:
          "Rankings reflect Claritas AIS geofences and configured ADS-B polling coverage, so they compare observed activity inside this system rather than total country transport activity.",
      },
    },
    routes: routeResult.rows.map((row) => ({
      mode: row.mode,
      origin_country: row.origin_country.trim(),
      origin_name: COUNTRY_NAME_BY_ISO.get(row.origin_country.trim()) ?? row.origin_country.trim(),
      destination_country: row.destination_country.trim(),
      destination_name:
        COUNTRY_NAME_BY_ISO.get(row.destination_country.trim()) ??
        row.destination_country.trim(),
      active_count: count(row.active_count),
      origin_basis:
        count(row.flag_origin_count) === 0
          ? "observed"
          : count(row.flag_origin_count) === count(row.active_count)
            ? "flag_fallback"
            : "mixed",
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
    history,
    entities,
    coverage: {
      maritime: {
        source: "AISstream",
        transport: "WebSocket",
        ...maritimeCoverageRuntime(summaryModes.maritime.latest_observed_at),
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
    corridorCountry: normalizeIso2(options?.corridorCountry) ?? null,
    entityLimit: options?.entityLimit ?? null,
  });
}

function transportOverviewCacheMilliseconds(): number {
  return (
    boundedIntegerFromEnv("TRANSPORT_OVERVIEW_CACHE_SECONDS", 120, 10, 300) *
    1_000
  );
}

function emptyTransportOverview(): TransportOverviewResult {
  return {
    generated_at: new Date().toISOString(),
    detail: "aggregate",
    summary: {
      active: 0,
      routed: 0,
      alerts: 0,
      linked_countries: 0,
      modes: {
        maritime: {
          active: 0,
          routed: 0,
          alerts: 0,
          latest_observed_at: null,
        },
        aviation: {
          active: 0,
          routed: 0,
          alerts: 0,
          latest_observed_at: null,
        },
      },
    },
    countries: [],
    activity_ranking: {
      window_hours: 24,
      comparison: "previous_24_hours",
      countries: [],
      highlights: [],
      methodology: {
        index:
          "Relative country index (top country = 100) combining normalized live linked entities (30%), monitored ship departures plus arrivals (35%), and uniquely tracked flights (35%). Missing or filtered modes are excluded and remaining weights are rebalanced.",
        momentum:
          "Momentum compares observed ship movements plus uniquely tracked flights with the previous 24-hour window; it is not freight volume, passenger volume, or complete national traffic.",
        coverage:
          "Rankings reflect Claritas AIS geofences and configured ADS-B polling coverage, so they compare observed activity inside this system rather than total country transport activity.",
      },
    },
    routes: [],
    trends: {
      window_hours: 24,
      comparison: "previous_24_hours",
      maritime: {
        ship_departures: transportTrendMetric(0, 0),
        cargo_vessel_departures: transportTrendMetric(0, 0),
        ship_arrivals: transportTrendMetric(0, 0),
      },
      aviation: {
        tracked_flights: transportTrendMetric(0, 0),
      },
    },
    takeaways: [],
    ports: [],
    activity: [],
    history: null,
    entities: [],
    coverage: {
      maritime: {
        source: "AISstream",
        transport: "WebSocket",
        ...maritimeCoverageRuntime(null),
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

/**
 * Transport is useful briefing evidence, but it must not prevent every other
 * source from producing a briefing or email. Prefer the last successful
 * aggregate during a transient database timeout and otherwise return an
 * explicit empty transport context.
 */
export async function getTransportOverviewForBriefing(): Promise<TransportOverviewResult> {
  const options: TransportOverviewOptions = { detail: "aggregate" };
  try {
    return await getTransportOverview(options);
  } catch (error) {
    const cached = transportOverviewCache.get(transportOverviewCacheKey(options));
    console.warn(
      JSON.stringify({
        event: "briefing_transport_context_fallback",
        fallback: cached ? "stale_cache" : "empty_context",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return cached?.value ?? emptyTransportOverview();
  }
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
      heading: normalizedHeading(point.heading),
      speed: normalizedTransportSpeed(mode, point.speed),
      observed_at: isoDate(point.observed_at),
    })),
  };
}

type RetentionTarget = {
  table: string;
  timestampColumn: string;
  retentionDays: number;
};

type RetentionBatchResult = {
  deleted: number;
  oldestExpiredAt: string | null;
};

async function pruneTransportTableBatch(
  target: RetentionTarget,
  batchSize: number,
): Promise<RetentionBatchResult> {
  const result = await query<{
    deleted: string | number;
    oldest_expired_at: string | Date | null;
  }>(
    `WITH candidates AS MATERIALIZED (
       SELECT ctid, ${target.timestampColumn} AS expired_at
       FROM ${target.table}
       WHERE ${target.timestampColumn} < now() - ($1 * interval '1 day')
       ORDER BY ${target.timestampColumn}, ctid
       LIMIT ($2 + 1)
       FOR UPDATE SKIP LOCKED
     ),
     doomed AS (
       SELECT ctid
       FROM candidates
       ORDER BY expired_at, ctid
       LIMIT $2
     ),
     removed AS (
       DELETE FROM ${target.table} target
       USING doomed
       WHERE target.ctid = doomed.ctid
       RETURNING 1
     )
     SELECT
       COUNT(*) AS deleted,
       (
         SELECT MIN(candidate.expired_at)
         FROM candidates candidate
         LEFT JOIN doomed USING (ctid)
         WHERE doomed.ctid IS NULL
       ) AS oldest_expired_at
     FROM removed`,
    [target.retentionDays, batchSize],
  );
  const oldest = result.rows[0]?.oldest_expired_at;
  return {
    deleted: count(result.rows[0]?.deleted),
    oldestExpiredAt: oldest == null ? null : isoDate(oldest),
  };
}

async function pruneTransportHistory(): Promise<void> {
  const startedAt = Date.now();
  const deadline =
    startedAt +
    boundedIntegerFromEnv(
      "TRANSPORT_RETENTION_BUDGET_SECONDS",
      30,
      5,
      120,
    ) *
      1_000;
  const batchSize = boundedIntegerFromEnv(
    "TRANSPORT_RETENTION_BATCH_SIZE",
    5_000,
    500,
    20_000,
  );
  const maximumBatches = boundedIntegerFromEnv(
    "TRANSPORT_RETENTION_MAX_BATCHES",
    10,
    1,
    100,
  );
  const trackDays = boundedIntegerFromEnv(
    "TRANSPORT_TRACK_RETENTION_DAYS",
    3,
    2,
    30,
  );
  const aggregateDays = boundedIntegerFromEnv(
    "TRANSPORT_AGGREGATE_RETENTION_DAYS",
    60,
    30,
    730,
  );
  const dailyHistoryDays = transportDailyHistoryRetentionDays();
  const snapshotDays = boundedIntegerFromEnv(
    "TRANSPORT_SNAPSHOT_RETENTION_DAYS",
    14,
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
      // This is already a compact port/hour aggregate (no entity IDs or raw
      // payload), so retain it alongside the bounded daily history. Otherwise
      // a 90-day country window would silently lose its final 30 days of port
      // movement context while still advertising a 90-day scope.
      retentionDays: dailyHistoryDays,
    },
    {
      table: "transport_entity_activity_hour",
      timestampColumn: "bucket",
      retentionDays: aggregateDays,
    },
    {
      table: "transport_country_activity_day",
      timestampColumn: "bucket",
      retentionDays: dailyHistoryDays,
    },
    {
      table: "transport_corridor_activity_day",
      timestampColumn: "bucket",
      retentionDays: dailyHistoryDays,
    },
    {
      table: "transport_snapshot",
      timestampColumn: "observed_at",
      retentionDays: snapshotDays,
    },
  ];
  const offset = transportRetentionTargetOffset % targets.length;
  transportRetentionTargetOffset = (transportRetentionTargetOffset + 1) % targets.length;
  const pending = [...targets.slice(offset), ...targets.slice(0, offset)];
  const deleted: Record<string, number> = Object.fromEntries(
    targets.map((target) => [target.table, 0]),
  );
  const oldestExpiredByTable = new Map<string, string>();
  let batches = 0;
  let activeTarget: RetentionTarget | null = null;

  try {
    while (
      pending.length > 0 &&
      transportRetentionBudgetAvailable({
        now: Date.now(),
        deadline,
        batches,
        maximumBatches,
      })
    ) {
      const target = pending.shift();
      if (!target) break;
      activeTarget = target;
      const result = await pruneTransportTableBatch(target, batchSize);
      activeTarget = null;
      batches += 1;
      deleted[target.table] += result.deleted;
      if (result.oldestExpiredAt) {
        oldestExpiredByTable.set(target.table, result.oldestExpiredAt);
        pending.push(target);
      } else {
        oldestExpiredByTable.delete(target.table);
      }
    }

    const backlogTables = Array.from(
      new Set(pending.map((target) => target.table)),
    ).sort();
    const oldestExpiredAt = Array.from(oldestExpiredByTable.values()).sort()[0] ?? null;
    const budgetExhausted = pending.length > 0;
    transportRetentionHealth = {
      running: false,
      last_pass_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      deleted_rows: Object.values(deleted).reduce((sum, value) => sum + value, 0),
      batches,
      backlog: backlogTables.length > 0,
      backlog_tables: backlogTables,
      oldest_expired_at: oldestExpiredAt,
      budget_exhausted: budgetExhausted,
      error: false,
    };
  } catch (error) {
    const backlogTables = Array.from(
      new Set([
        ...(activeTarget ? [activeTarget.table] : []),
        ...pending.map((target) => target.table),
      ]),
    ).sort();
    transportRetentionHealth = {
      running: false,
      last_pass_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      deleted_rows: Object.values(deleted).reduce((sum, value) => sum + value, 0),
      batches,
      backlog: true,
      backlog_tables: backlogTables.length > 0 ? backlogTables : ["unknown"],
      oldest_expired_at:
        Array.from(oldestExpiredByTable.values()).sort()[0] ?? null,
      budget_exhausted: false,
      error: true,
    };
    throw error;
  }

  const memoryCutoff = Date.now() - 2 * 24 * 60 * 60 * 1_000;
  for (const [key, observedAt] of lastTrackAt) {
    if (observedAt < memoryCutoff) lastTrackAt.delete(key);
  }
  for (const [mmsi, observedAt] of lastMaritimeQueuedAt) {
    if (observedAt >= memoryCutoff) continue;
    lastMaritimeQueuedAt.delete(mmsi);
    lastMaritimeSnapshot.delete(mmsi);
    deleteMaritimeStatic(mmsi);
    firstMaritimeCountry.delete(mmsi);
    firstMaritimePosition.delete(mmsi);
  }
  for (const [callsign, cached] of routeCache) {
    if (cached.expiresAt < Date.now()) routeCache.delete(callsign);
  }

  if (
    transportRetentionHealth.deleted_rows > 0 ||
    transportRetentionHealth.backlog
  ) {
    console.info(
      JSON.stringify({
        event: "transport_retention_pruned",
        deleted,
        ...transportRetentionHealth,
      }),
    );
  }
}

function runTransportRetentionPass(): Promise<void> {
  if (transportRetentionRun) return transportRetentionRun;
  transportRetentionHealth = {
    ...transportRetentionHealth,
    running: true,
  };
  transportRetentionRun = pruneTransportHistory().finally(() => {
    transportRetentionRun = null;
  });
  return transportRetentionRun;
}

function startTransportRetentionWorker(): void {
  if (transportRetentionTimer) return;
  const minutes = boundedIntegerFromEnv(
    "TRANSPORT_RETENTION_INTERVAL_MINUTES",
    180,
    15,
    1_440,
  );
  void runTransportRetentionPass().catch((error) => {
    console.warn(
      `Initial transport retention pass failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  transportRetentionTimer = setInterval(() => {
    void runTransportRetentionPass().catch((error) => {
      console.warn(
        `Transport retention pass failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }, minutes * 60_000);
  transportRetentionTimer.unref();
}

function scheduleTransportWorkerLockRetry(delayMilliseconds: number): void {
  if (transportWorkerLockRetryTimer) return;
  transportWorkerLockRetryTimer = setTimeout(() => {
    transportWorkerLockRetryTimer = null;
    void acquireTransportWorkerLock();
  }, delayMilliseconds);
  transportWorkerLockRetryTimer.unref();
}

async function acquireTransportWorkerLock(): Promise<void> {
  try {
    const client = await pool.connect();
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [WORKER_LOCK_NAMESPACE, WORKER_LOCK_KEY]
    );
    if (!lock.rows[0]?.acquired) {
      transportWorkerLeader = false;
      client.release();
      console.info(
        "Transport ingestion worker is active on another API replica; retrying lock transfer.",
      );
      scheduleTransportWorkerLockRetry(
        boundedIntegerFromEnv("TRANSPORT_WORKER_LOCK_RETRY_SECONDS", 10, 5, 60) *
          1_000,
      );
      return;
    }
    transportWorkerLeader = true;
    connectAisStream();
    startAisWatchdog();
    startDigitrafficMaritimeWorker();
    startBarentsWatchMaritimeWorker();
    startMpaOceansXMaritimeWorker();
    startKystverketMaritimeWorker();
    startTransportRetentionWorker();
    aisFlushTimer = setInterval(() => {
      void flushMaritimeQueue();
    }, boundedIntegerFromEnv("AISSTREAM_FLUSH_INTERVAL_SECONDS", 5, 2, 30) * 1_000);
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
          Number.parseInt(process.env.ADSB_LOL_POLL_SECONDS || "600", 10) || 600,
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
    transportWorkerLeader = false;
    console.warn(
      `Transport worker lock is unavailable; retrying: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    scheduleTransportWorkerLockRetry(30_000);
  }
}

export function startTransportIngestionWorkers(): void {
  if (transportWorkerStarted) return;
  transportWorkerStarted = true;
  void acquireTransportWorkerLock();
}
