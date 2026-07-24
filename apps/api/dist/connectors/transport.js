"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.countryAtPosition = countryAtPosition;
exports.refreshAviationNow = refreshAviationNow;
exports.getTransportOverview = getTransportOverview;
exports.getTransportEntity = getTransportEntity;
exports.startTransportIngestionWorkers = startTransportIngestionWorkers;
const topojson_client_1 = require("topojson-client");
const world_countries_1 = __importDefault(require("world-countries"));
const ws_1 = __importDefault(require("ws"));
const mmsi_country_lookup_1 = require("mmsi-country-lookup");
const db_1 = require("../db");
const AIS_STREAM_URL = "wss://stream.aisstream.io/v0/stream";
const ADSB_BASE_URL = "https://api.adsb.lol";
const WORKER_LOCK_NAMESPACE = 9433;
const WORKER_LOCK_KEY = 21;
const TRANSPORT_TRACK_SAMPLE_MS = 3 * 60 * 1000;
const COUNTRY_REFERENCES = world_countries_1.default;
const COUNTRY_NAME_BY_ISO = new Map(COUNTRY_REFERENCES.flatMap((country) => country.cca2
    ? [[country.cca2.toUpperCase(), country.name?.common ?? country.cca2.toUpperCase()]]
    : []));
const VALID_ISO2 = new Set(COUNTRY_NAME_BY_ISO.keys());
const ISO_BY_NUMERIC = new Map(COUNTRY_REFERENCES.flatMap((country) => country.cca2 && country.ccn3
    ? [[country.ccn3.padStart(3, "0"), country.cca2.toUpperCase()]]
    : []));
// Runtime import keeps Natural Earth geography inside the API image.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const worldAtlas = require("world-atlas/countries-110m.json");
const COUNTRY_GEOMETRIES = buildCountryGeometries();
const MARITIME_PORT_COUNTRIES = [
    [/\b(?:USLAX|LOS ANGELES|LONG BEACH)\b/i, "US"],
    [/\b(?:USNYC|NEW YORK|NEWARK)\b/i, "US"],
    [/\b(?:CAVAN|VANCOUVER)\b/i, "CA"],
    [/\b(?:BRSSZ|SANTOS)\b/i, "BR"],
    [/\b(?:NLRTM|ROTTERDAM)\b/i, "NL"],
    [/\b(?:BEANR|ANTWERP)\b/i, "BE"],
    [/\b(?:DEHAM|HAMBURG)\b/i, "DE"],
    [/\b(?:GBFXT|FELIXSTOWE|GBSOU|SOUTHAMPTON)\b/i, "GB"],
    [/\b(?:ESALG|ALGECIRAS|ESVLC|VALENCIA)\b/i, "ES"],
    [/\b(?:GRPIR|PIRAEUS)\b/i, "GR"],
    [/\b(?:EGPSD|PORT SAID|SUEZ)\b/i, "EG"],
    [/\b(?:AEJEA|JEBEL ALI|DUBAI)\b/i, "AE"],
    [/\b(?:SGSIN|SINGAPORE)\b/i, "SG"],
    [/\b(?:CNSHA|SHANGHAI|CNNGB|NINGBO|CNSZX|SHENZHEN)\b/i, "CN"],
    [/\b(?:HKHKG|HONG KONG)\b/i, "HK"],
    [/\b(?:KRPUS|BUSAN)\b/i, "KR"],
    [/\b(?:JPYOK|YOKOHAMA|JPTYO|TOKYO)\b/i, "JP"],
    [/\b(?:MYPKG|PORT KLANG|TANJUNG PELEPAS)\b/i, "MY"],
    [/\b(?:LKCMB|COLOMBO)\b/i, "LK"],
    [/\b(?:INNSA|NHAVA SHEVA|MUNDRA)\b/i, "IN"],
    [/\b(?:AUSYD|SYDNEY|AUMEL|MELBOURNE)\b/i, "AU"],
    [/\b(?:ZADUR|DURBAN|ZACPT|CAPE TOWN)\b/i, "ZA"],
];
const NAVIGATION_STATUS = {
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
const maritimeQueue = new Map();
const maritimeStatic = new Map();
const firstMaritimeCountry = new Map();
const lastMaritimeQueuedAt = new Map();
const lastTrackAt = new Map();
const routeCache = new Map();
let aisSocket = null;
let aisReconnectTimer = null;
let aisFlushTimer = null;
let aisReconnectAttempt = 0;
let aviationRefresh = null;
let lastAviationRefreshAt = 0;
let transportWorkerStarted = false;
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
function asString(value) {
    if (typeof value !== "string" && typeof value !== "number")
        return null;
    const output = String(value).trim();
    return output || null;
}
function asFinite(value) {
    if (value == null || value === "" || typeof value === "boolean")
        return null;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function normalizeIso2(value) {
    const output = asString(value)?.toUpperCase() ?? "";
    return VALID_ISO2.has(output) ? output : null;
}
function isoDate(value, fallback = new Date()) {
    const date = value instanceof Date
        ? value
        : typeof value === "number"
            ? new Date(Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value)
            : typeof value === "string"
                ? new Date(value)
                : fallback;
    return Number.isFinite(date.getTime()) ? date.toISOString() : fallback.toISOString();
}
function count(value) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}
function boundsForGeometry(geometry) {
    const positions = geometry.type === "Polygon"
        ? geometry.coordinates.flat()
        : geometry.coordinates.flat(2);
    return positions.reduce((bounds, position) => [
        Math.min(bounds[0], Number(position[0])),
        Math.min(bounds[1], Number(position[1])),
        Math.max(bounds[2], Number(position[0])),
        Math.max(bounds[3], Number(position[1])),
    ], [180, 90, -180, -90]);
}
function buildCountryGeometries() {
    const collection = (0, topojson_client_1.feature)(worldAtlas, worldAtlas.objects.countries);
    return collection.features.flatMap((countryFeature) => {
        const iso2 = ISO_BY_NUMERIC.get(String(countryFeature.id ?? "").padStart(3, "0"));
        if (!iso2 || iso2 === "AQ")
            return [];
        if (countryFeature.geometry.type !== "Polygon" &&
            countryFeature.geometry.type !== "MultiPolygon") {
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
function pointInRing(longitude, latitude, ring) {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
        const currentPoint = ring[index];
        const previousPoint = ring[previous];
        const currentX = Number(currentPoint[0]);
        const currentY = Number(currentPoint[1]);
        const previousX = Number(previousPoint[0]);
        const previousY = Number(previousPoint[1]);
        const crosses = currentY > latitude !== previousY > latitude &&
            longitude <
                ((previousX - currentX) * (latitude - currentY)) /
                    (previousY - currentY || Number.EPSILON) +
                    currentX;
        if (crosses)
            inside = !inside;
    }
    return inside;
}
function pointInPolygon(longitude, latitude, polygon) {
    if (!polygon[0] || !pointInRing(longitude, latitude, polygon[0]))
        return false;
    return !polygon.slice(1).some((hole) => pointInRing(longitude, latitude, hole));
}
function countryAtPosition(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
        return null;
    for (const country of COUNTRY_GEOMETRIES) {
        const [minLon, minLat, maxLon, maxLat] = country.bounds;
        if (longitude < minLon ||
            longitude > maxLon ||
            latitude < minLat ||
            latitude > maxLat) {
            continue;
        }
        const polygons = country.geometry.type === "Polygon"
            ? [country.geometry.coordinates]
            : country.geometry.coordinates;
        if (polygons.some((polygon) => pointInPolygon(longitude, latitude, polygon))) {
            return country.iso2;
        }
    }
    return null;
}
function destinationCountryFromText(value) {
    if (!value)
        return null;
    const normalized = value.trim().toUpperCase();
    const unLocode = normalized.match(/(?:^|\s)([A-Z]{2})[A-Z]{3}(?:\s|$)/)?.[1];
    if (unLocode && VALID_ISO2.has(unLocode))
        return unLocode;
    for (const [pattern, iso2] of MARITIME_PORT_COUNTRIES) {
        if (pattern.test(normalized))
            return iso2;
    }
    for (const country of COUNTRY_REFERENCES) {
        const name = country.name?.common?.toUpperCase();
        if (name && normalized.includes(name) && country.cca2)
            return country.cca2.toUpperCase();
    }
    return null;
}
function resolveAisBoundingBoxes() {
    const configured = process.env.AISSTREAM_BOUNDING_BOXES?.trim();
    if (configured) {
        try {
            const parsed = JSON.parse(configured);
            if (Array.isArray(parsed) && parsed.length > 0)
                return parsed;
        }
        catch {
            console.warn("AISSTREAM_BOUNDING_BOXES is not valid JSON; using global coverage.");
        }
    }
    return [[[-90, -180], [90, 180]]];
}
function aisSampleMilliseconds() {
    const seconds = Number.parseInt(process.env.AISSTREAM_SAMPLE_SECONDS || "60", 10);
    return Math.max(15, Math.min(Number.isFinite(seconds) ? seconds : 60, 900)) * 1000;
}
function queueMaritimeMessage(message) {
    const envelope = asRecord(message);
    if (!envelope)
        return;
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
    const mmsi = asString(body.UserID) ??
        asString(reportA.UserID) ??
        asString(reportB.UserID) ??
        asString(metadata.MMSI);
    if (!mmsi || !/^\d{9}$/.test(mmsi))
        return;
    const latitude = asFinite(body.Latitude ?? metadata.latitude ?? metadata.Latitude);
    const longitude = asFinite(body.Longitude ?? metadata.longitude ?? metadata.Longitude);
    const observedAt = isoDate(metadata.time_utc);
    const now = Date.now();
    const isPosition = latitude != null &&
        longitude != null &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180;
    const displayName = asString(body.Name) ??
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
            destination_name: destinationName ?? maritimeStatic.get(mmsi)?.destination_name,
            destination_country_iso2: destinationCountry ?? maritimeStatic.get(mmsi)?.destination_country_iso2,
            route_label: destinationName
                ? `Destination ${destinationName}`
                : maritimeStatic.get(mmsi)?.route_label,
        });
    }
    if (isPosition && now - (lastMaritimeQueuedAt.get(mmsi) ?? 0) < aisSampleMilliseconds()) {
        return;
    }
    const staticData = maritimeStatic.get(mmsi);
    const registration = (0, mmsi_country_lookup_1.getCountryFromMMSI)(mmsi);
    const registrationCountry = registration.valid ? normalizeIso2(registration.alpha2) : null;
    const currentCountry = isPosition && latitude != null && longitude != null
        ? countryAtPosition(latitude, longitude)
        : null;
    if (currentCountry && !firstMaritimeCountry.has(mmsi)) {
        firstMaritimeCountry.set(mmsi, currentCountry);
    }
    const originCountry = staticData?.destination_country_iso2 &&
        firstMaritimeCountry.get(mmsi) !== staticData.destination_country_iso2
        ? firstMaritimeCountry.get(mmsi) ?? null
        : null;
    const navigationStatusNumber = asFinite(body.NavigationalStatus);
    const status = navigationStatusNumber == null
        ? null
        : NAVIGATION_STATUS[Math.round(navigationStatusNumber)] ??
            `Navigation status ${Math.round(navigationStatusNumber)}`;
    const alert = navigationStatusNumber != null &&
        [2, 6, 14].includes(Math.round(navigationStatusNumber));
    const linkageBasis = [
        currentCountry ? "position_country" : null,
        originCountry ? "voyage_origin" : null,
        staticData?.destination_country_iso2 ? "declared_destination" : null,
        registrationCountry ? "mmsi_flag" : null,
    ].filter((value) => Boolean(value));
    const snapshot = {
        mode: "maritime",
        entity_id: mmsi,
        display_name: displayName ?? staticData?.display_name ?? asString(metadata.ShipName),
        callsign: callsign ?? staticData?.callsign,
        registration: mmsi,
        vehicle_type: shipType ?? staticData?.vehicle_type ?? registration.type,
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
        route_label: staticData?.route_label,
        linkage_basis: linkageBasis,
        linkage_confidence: currentCountry || staticData?.destination_country_iso2
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
    if (isPosition)
        lastMaritimeQueuedAt.set(mmsi, now);
    const maximumQueue = Math.max(500, Math.min(Number.parseInt(process.env.AISSTREAM_MAX_QUEUE || "5000", 10) || 5000, 25000));
    if (maritimeQueue.size > maximumQueue) {
        const oldest = maritimeQueue.keys().next().value;
        if (oldest)
            maritimeQueue.delete(oldest);
    }
}
function connectAisStream() {
    const apiKey = process.env.AISSTREAM_API_KEY?.trim();
    if (!apiKey) {
        console.info("AISstream ingestion is disabled until AISSTREAM_API_KEY is configured.");
        return;
    }
    if (aisSocket &&
        (aisSocket.readyState === ws_1.default.OPEN || aisSocket.readyState === ws_1.default.CONNECTING)) {
        return;
    }
    const socket = new ws_1.default(AIS_STREAM_URL, {
        handshakeTimeout: 15_000,
    });
    aisSocket = socket;
    socket.on("open", () => {
        aisReconnectAttempt = 0;
        socket.send(JSON.stringify({
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
        }));
        console.info("AISstream transport subscription connected.");
    });
    socket.on("message", (raw) => {
        try {
            queueMaritimeMessage(JSON.parse(raw.toString()));
        }
        catch (error) {
            console.warn(`Skipped malformed AISstream message: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    socket.on("error", (error) => {
        console.warn(`AISstream connection error: ${error.message}`);
    });
    socket.on("close", () => {
        if (aisSocket === socket)
            aisSocket = null;
        scheduleAisReconnect();
    });
}
function scheduleAisReconnect() {
    if (aisReconnectTimer || !process.env.AISSTREAM_API_KEY?.trim())
        return;
    const delay = Math.min(60_000, 2_000 * 2 ** Math.min(aisReconnectAttempt, 5));
    aisReconnectAttempt += 1;
    aisReconnectTimer = setTimeout(() => {
        aisReconnectTimer = null;
        connectAisStream();
    }, delay);
    aisReconnectTimer.unref();
}
async function flushMaritimeQueue() {
    if (maritimeQueue.size === 0)
        return;
    const snapshots = Array.from(maritimeQueue.values());
    maritimeQueue.clear();
    try {
        await storeTransportSnapshots(snapshots);
    }
    catch (error) {
        console.error(`AISstream flush failed for ${snapshots.length} snapshots: ${error instanceof Error ? error.message : String(error)}`);
        snapshots.slice(-2000).forEach((snapshot) => maritimeQueue.set(snapshot.entity_id, snapshot));
    }
}
function configuredAdsbPollPoints() {
    const configured = process.env.ADSB_LOL_POLL_POINTS?.trim();
    if (!configured)
        return ADSB_POLL_POINTS;
    try {
        const parsed = JSON.parse(configured);
        if (!Array.isArray(parsed))
            return ADSB_POLL_POINTS;
        const valid = parsed.flatMap((point, index) => {
            const row = asRecord(point);
            const lat = asFinite(row?.lat);
            const lon = asFinite(row?.lon);
            const radius = asFinite(row?.radius) ?? 250;
            if (lat == null || lon == null)
                return [];
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
    }
    catch {
        console.warn("ADSB_LOL_POLL_POINTS is not valid JSON; using the default global hub grid.");
        return ADSB_POLL_POINTS;
    }
}
async function fetchJson(url, init) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
        const response = await fetch(url, {
            ...init,
            signal: controller.signal,
            headers: {
                accept: "application/json",
                "user-agent": process.env.ADSB_LOL_USER_AGENT?.trim() ||
                    "Claritas/1.0 (+https://app.claritas.info; engineering@claritas.info)",
                ...(init?.headers ?? {}),
            },
        });
        if (!response.ok) {
            throw new Error(`adsb.lol returned HTTP ${response.status}`);
        }
        return (await response.json());
    }
    finally {
        clearTimeout(timeout);
    }
}
async function mapWithConcurrency(values, concurrency, operation) {
    const output = new Array(values.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
        while (next < values.length) {
            const index = next++;
            output[index] = await operation(values[index], index);
        }
    }));
    return output;
}
async function getAdsbRoute(callsign, latitude, longitude) {
    const cached = routeCache.get(callsign);
    if (cached && cached.expiresAt > Date.now())
        return cached.value;
    try {
        const route = await fetchJson(`${ADSB_BASE_URL}/api/0/route/${encodeURIComponent(callsign)}/${latitude.toFixed(4)}/${longitude.toFixed(4)}`);
        const value = route && route.airport_codes && route.airport_codes !== "unknown" ? route : null;
        routeCache.set(callsign, {
            expiresAt: Date.now() + (value ? 20 * 60_000 : 2 * 60_000),
            value,
        });
        return value;
    }
    catch {
        routeCache.set(callsign, { expiresAt: Date.now() + 60_000, value: null });
        return null;
    }
}
function flightSnapshot(aircraft, route, observedAt) {
    const entityId = asString(aircraft.hex)?.toLowerCase();
    const latitude = asFinite(aircraft.lat);
    const longitude = asFinite(aircraft.lon);
    if (!entityId || latitude == null || longitude == null)
        return null;
    const callsign = asString(aircraft.flight)?.replace(/\s+/g, "");
    const airports = Array.isArray(route?._airports) ? route?._airports ?? [] : [];
    const origin = airports[0];
    const destination = airports.length > 1 ? airports[airports.length - 1] : undefined;
    const originCountry = normalizeIso2(origin?.countryiso2);
    const destinationCountry = normalizeIso2(destination?.countryiso2);
    const currentCountry = countryAtPosition(latitude, longitude);
    const routeNumber = asString(route?.number);
    const airlineCode = asString(route?.airline_code);
    const flightNumber = routeNumber && airlineCode ? `${airlineCode}${routeNumber}` : callsign;
    const squawk = asString(aircraft.squawk);
    const emergency = asString(aircraft.emergency)?.toLowerCase();
    const isAlert = Boolean(emergency && emergency !== "none" && emergency !== "no emergency") ||
        ["7500", "7600", "7700"].includes(squawk ?? "");
    const altitudeRaw = aircraft.alt_baro;
    const altitude = typeof altitudeRaw === "string" && altitudeRaw.toLowerCase() === "ground"
        ? 0
        : asFinite(altitudeRaw);
    const linkageBasis = [
        currentCountry ? "position_country" : null,
        originCountry ? "route_origin_airport" : null,
        destinationCountry ? "route_destination_airport" : null,
    ].filter((value) => Boolean(value));
    const routeLabel = asString(route?._airport_codes_iata) ??
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
        linkage_confidence: originCountry && destinationCountry ? "high" : currentCountry ? "medium" : "none",
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
async function runAviationRefresh() {
    const pointResults = await mapWithConcurrency(configuredAdsbPollPoints(), 4, async (point) => {
        try {
            return await fetchJson(`${ADSB_BASE_URL}/v2/point/${point.lat}/${point.lon}/${point.radius}`);
        }
        catch (error) {
            console.warn(`adsb.lol poll failed for ${point.label}: ${error instanceof Error ? error.message : String(error)}`);
            return { ac: [], now: Date.now() };
        }
    });
    const byHex = new Map();
    for (const result of pointResults) {
        const responseTime = asFinite(result.now) ?? Date.now();
        const responseTimeMs = Math.abs(responseTime) < 1_000_000_000_000 ? responseTime * 1000 : responseTime;
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
    const routeByHex = new Map();
    const routeCandidates = Array.from(byHex.values())
        .filter((entry) => {
        const hex = asString(entry.aircraft.hex)?.toLowerCase();
        const callsign = asString(entry.aircraft.flight)?.replace(/\s+/g, "");
        if (!hex || !callsign)
            return false;
        const cached = routeCache.get(callsign);
        if (cached && cached.expiresAt > Date.now()) {
            routeByHex.set(hex, cached.value);
            return false;
        }
        return true;
    })
        .slice(0, Math.max(10, Math.min(Number.parseInt(process.env.ADSB_LOL_MAX_ROUTE_LOOKUPS || "60", 10) || 60, 100)));
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
        if (hex)
            routeByHex.set(hex, routes[index]);
    });
    const snapshots = Array.from(byHex.values()).flatMap((entry) => {
        const hex = asString(entry.aircraft.hex)?.toLowerCase();
        const snapshot = flightSnapshot(entry.aircraft, hex ? routeByHex.get(hex) ?? null : null, entry.observedAt);
        return snapshot ? [snapshot] : [];
    });
    await storeTransportSnapshots(snapshots);
    lastAviationRefreshAt = Date.now();
    return { fetched: byHex.size, stored: snapshots.length };
}
async function refreshAviationNow(force = false) {
    const minimumSpacing = Math.max(30, Math.min(Number.parseInt(process.env.ADSB_LOL_MIN_REFRESH_SECONDS || "90", 10) || 90, 900));
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
async function storeTransportSnapshots(snapshots) {
    for (let offset = 0; offset < snapshots.length; offset += 100) {
        const batch = snapshots.slice(offset, offset + 100);
        if (batch.length === 0)
            continue;
        const values = [];
        const rows = batch.map((snapshot, index) => {
            const start = index * 31;
            values.push(snapshot.mode, snapshot.entity_id, snapshot.display_name ?? null, snapshot.callsign ?? null, snapshot.flight_number ?? null, snapshot.registration ?? null, snapshot.vehicle_type ?? null, snapshot.latitude ?? null, snapshot.longitude ?? null, snapshot.heading ?? null, snapshot.speed ?? null, snapshot.altitude ?? null, snapshot.vertical_rate ?? null, snapshot.current_country_iso2 ?? null, snapshot.origin_country_iso2 ?? null, snapshot.destination_country_iso2 ?? null, snapshot.registration_country_iso2 ?? null, snapshot.origin_name ?? null, snapshot.destination_name ?? null, snapshot.origin_latitude ?? null, snapshot.origin_longitude ?? null, snapshot.destination_latitude ?? null, snapshot.destination_longitude ?? null, snapshot.route_label ?? null, snapshot.linkage_basis ?? [], snapshot.linkage_confidence ?? "none", snapshot.status ?? null, snapshot.is_alert ?? false, snapshot.source_name, snapshot.observed_at, JSON.stringify(snapshot.payload));
            return `(${Array.from({ length: 31 }, (_, valueIndex) => `$${start + valueIndex + 1}`).join(", ")})`;
        });
        await (0, db_1.query)(`INSERT INTO transport_snapshot (
         mode, entity_id, display_name, callsign, flight_number, registration,
         vehicle_type, latitude, longitude, heading, speed, altitude, vertical_rate,
         current_country_iso2, origin_country_iso2, destination_country_iso2,
         registration_country_iso2, origin_name, destination_name, origin_latitude,
         origin_longitude, destination_latitude, destination_longitude, route_label,
         linkage_basis, linkage_confidence, status, is_alert, source_name, observed_at,
         payload
       ) VALUES ${rows.join(", ")}
       ON CONFLICT (mode, entity_id) DO UPDATE SET
         display_name = COALESCE(EXCLUDED.display_name, transport_snapshot.display_name),
         callsign = COALESCE(EXCLUDED.callsign, transport_snapshot.callsign),
         flight_number = COALESCE(EXCLUDED.flight_number, transport_snapshot.flight_number),
         registration = COALESCE(EXCLUDED.registration, transport_snapshot.registration),
         vehicle_type = COALESCE(EXCLUDED.vehicle_type, transport_snapshot.vehicle_type),
         latitude = COALESCE(EXCLUDED.latitude, transport_snapshot.latitude),
         longitude = COALESCE(EXCLUDED.longitude, transport_snapshot.longitude),
         heading = COALESCE(EXCLUDED.heading, transport_snapshot.heading),
         speed = COALESCE(EXCLUDED.speed, transport_snapshot.speed),
         altitude = COALESCE(EXCLUDED.altitude, transport_snapshot.altitude),
         vertical_rate = COALESCE(EXCLUDED.vertical_rate, transport_snapshot.vertical_rate),
         current_country_iso2 = COALESCE(EXCLUDED.current_country_iso2, transport_snapshot.current_country_iso2),
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
         payload = transport_snapshot.payload || EXCLUDED.payload`, values);
    }
    const trackPoints = snapshots.filter((snapshot) => {
        if (snapshot.latitude == null || snapshot.longitude == null)
            return false;
        const key = `${snapshot.mode}:${snapshot.entity_id}`;
        const observed = new Date(snapshot.observed_at).getTime();
        if (observed - (lastTrackAt.get(key) ?? 0) < TRANSPORT_TRACK_SAMPLE_MS)
            return false;
        lastTrackAt.set(key, observed);
        return true;
    });
    for (let offset = 0; offset < trackPoints.length; offset += 200) {
        const batch = trackPoints.slice(offset, offset + 200);
        const values = [];
        const rows = batch.map((snapshot, index) => {
            const start = index * 12;
            const observed = new Date(snapshot.observed_at);
            observed.setUTCSeconds(0, 0);
            values.push(snapshot.mode, snapshot.entity_id, snapshot.latitude, snapshot.longitude, snapshot.heading ?? null, snapshot.speed ?? null, snapshot.altitude ?? null, snapshot.current_country_iso2 ?? null, snapshot.origin_country_iso2 ?? null, snapshot.destination_country_iso2 ?? null, observed.toISOString(), snapshot.source_name);
            return `(${Array.from({ length: 12 }, (_, valueIndex) => `$${start + valueIndex + 1}`).join(", ")})`;
        });
        await (0, db_1.query)(`INSERT INTO transport_track_point (
         mode, entity_id, latitude, longitude, heading, speed, altitude,
         current_country_iso2, origin_country_iso2, destination_country_iso2,
         observed_at, source_name
       ) VALUES ${rows.join(", ")}
       ON CONFLICT (mode, entity_id, observed_at) DO NOTHING`, values);
    }
}
function activeTransportWhere(alias = "s") {
    return `(
    (${alias}.mode = 'maritime' AND ${alias}.observed_at >= now() - interval '2 hours')
    OR
    (${alias}.mode = 'aviation' AND ${alias}.observed_at >= now() - interval '20 minutes')
  )`;
}
function serializeEntity(row) {
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
async function getTransportOverview(options) {
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
    const params = [];
    if (mode)
        params.push(mode);
    if (country)
        params.push(country);
    const where = filters.join(" AND ");
    const [modeResult, countryResult, routeResult, activityResult] = await Promise.all([
        (0, db_1.query)(`SELECT
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
       ORDER BY s.mode`, params),
        (0, db_1.query)(`WITH linked AS (
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
       ORDER BY active_count DESC, country`, params),
        (0, db_1.query)(`SELECT
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
       LIMIT 100`, params),
        (0, db_1.query)(`SELECT
         date_trunc('hour', p.observed_at) AS bucket,
         p.mode,
         COUNT(DISTINCT p.entity_id) AS active_count
       FROM transport_track_point p
       WHERE p.observed_at >= now() - interval '24 hours'
         ${mode ? `AND p.mode = $1` : ""}
         ${country
            ? `AND (
                  p.current_country_iso2 = $${mode ? 2 : 1}
                  OR p.origin_country_iso2 = $${mode ? 2 : 1}
                  OR p.destination_country_iso2 = $${mode ? 2 : 1}
                )`
            : ""}
       GROUP BY bucket, p.mode
       ORDER BY bucket, p.mode`, params),
    ]);
    const countries = new Map();
    for (const row of countryResult.rows) {
        const iso2 = row.country.trim().toUpperCase();
        const aggregate = countries.get(iso2) ?? {
            country: iso2,
            country_name: COUNTRY_NAME_BY_ISO.get(iso2) ?? iso2,
            active_count: 0,
            maritime: { active: 0, current: 0, origins: 0, destinations: 0, flagged: 0 },
            aviation: { active: 0, current: 0, origins: 0, destinations: 0, registered: 0 },
        };
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
        }
        else {
            aggregate.aviation = {
                active,
                current: count(row.current_count),
                origins: count(row.origin_count),
                destinations: count(row.destination_count),
                registered: count(row.registration_count),
            };
        }
        countries.set(iso2, aggregate);
    }
    const summaryModes = {
        maritime: { active: 0, routed: 0, alerts: 0, latest_observed_at: null },
        aviation: { active: 0, routed: 0, alerts: 0, latest_observed_at: null },
    };
    for (const row of modeResult.rows) {
        summaryModes[row.mode] = {
            active: count(row.active_count),
            routed: count(row.routed_count),
            alerts: count(row.alert_count),
            latest_observed_at: row.latest_observed_at ? isoDate(row.latest_observed_at) : null,
        };
    }
    let entities = [];
    if (detail === "full") {
        const entityLimit = Math.max(25, Math.min(options?.entityLimit ?? 900, 2500));
        const entityResult = await (0, db_1.query)(`SELECT
         s.id, s.mode, s.entity_id, s.display_name, s.callsign, s.flight_number,
         s.registration, s.vehicle_type, s.latitude, s.longitude, s.heading,
         s.speed, s.altitude, s.vertical_rate, s.current_country_iso2,
         s.origin_country_iso2, s.destination_country_iso2,
         s.registration_country_iso2, s.origin_name, s.destination_name,
         s.origin_latitude, s.origin_longitude, s.destination_latitude,
         s.destination_longitude, s.route_label, s.linkage_basis,
         s.linkage_confidence, s.status, s.is_alert, s.source_name,
         s.observed_at, '{}'::jsonb AS payload
       FROM transport_snapshot s
       WHERE ${where}
       ORDER BY s.is_alert DESC, s.observed_at DESC
       LIMIT ${entityLimit}`, params);
        entities = entityResult.rows.map(serializeEntity);
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
        countries: Array.from(countries.values()).sort((left, right) => right.active_count - left.active_count),
        routes: routeResult.rows.map((row) => ({
            mode: row.mode,
            origin_country: row.origin_country.trim(),
            origin_name: COUNTRY_NAME_BY_ISO.get(row.origin_country.trim()) ?? row.origin_country.trim(),
            destination_country: row.destination_country.trim(),
            destination_name: COUNTRY_NAME_BY_ISO.get(row.destination_country.trim()) ??
                row.destination_country.trim(),
            active_count: count(row.active_count),
            examples: row.examples ?? [],
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
                configured: Boolean(process.env.AISSTREAM_API_KEY?.trim()),
                freshness_minutes: 120,
            },
            aviation: {
                source: "adsb.lol",
                transport: "REST",
                configured: true,
                freshness_minutes: 20,
                license: "ODbL-1.0",
                poll_areas: configuredAdsbPollPoints().length,
            },
        },
    };
}
async function getTransportEntity(mode, entityId) {
    const entityResult = await (0, db_1.query)(`SELECT *
     FROM transport_snapshot
     WHERE mode = $1 AND entity_id = $2
     LIMIT 1`, [mode, entityId]);
    const entity = entityResult.rows[0];
    if (!entity)
        return null;
    const trackResult = await (0, db_1.query)(`SELECT
       latitude, longitude, heading, speed, altitude, current_country_iso2, observed_at
     FROM transport_track_point
     WHERE mode = $1 AND entity_id = $2
       AND observed_at >= now() - interval '24 hours'
     ORDER BY observed_at ASC
     LIMIT 500`, [mode, entityId]);
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
async function acquireTransportWorkerLock() {
    try {
        const client = await db_1.pool.connect();
        const lock = await client.query("SELECT pg_try_advisory_lock($1, $2) AS acquired", [WORKER_LOCK_NAMESPACE, WORKER_LOCK_KEY]);
        if (!lock.rows[0]?.acquired) {
            client.release();
            console.info("Transport ingestion worker is active on another API replica.");
            return;
        }
        connectAisStream();
        aisFlushTimer = setInterval(() => {
            void flushMaritimeQueue();
        }, 5_000);
        aisFlushTimer.unref();
        const aviationEnabled = String(process.env.ADSB_LOL_POLL_ENABLED || "true").trim().toLowerCase() !== "false";
        if (aviationEnabled) {
            void refreshAviationNow(true).catch((error) => {
                console.warn(`Initial adsb.lol refresh failed: ${error instanceof Error ? error.message : String(error)}`);
            });
            const seconds = Math.max(60, Math.min(Number.parseInt(process.env.ADSB_LOL_POLL_SECONDS || "120", 10) || 120, 1800));
            const timer = setInterval(() => {
                void refreshAviationNow(true).catch((error) => {
                    console.warn(`Scheduled adsb.lol refresh failed: ${error instanceof Error ? error.message : String(error)}`);
                });
            }, seconds * 1000);
            timer.unref();
        }
        // Keep the dedicated client checked out: the PostgreSQL session owns the
        // advisory lock and releases it automatically if this process exits.
    }
    catch (error) {
        console.warn(`Transport worker lock is unavailable; retrying: ${error instanceof Error ? error.message : String(error)}`);
        const timer = setTimeout(() => {
            void acquireTransportWorkerLock();
        }, 30_000);
        timer.unref();
    }
}
function startTransportIngestionWorkers() {
    if (transportWorkerStarted)
        return;
    transportWorkerStarted = true;
    void acquireTransportWorkerLock();
}
