"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertWeatherSnapshot = upsertWeatherSnapshot;
exports.ingestOpenWeatherCountryCurrent = ingestOpenWeatherCountryCurrent;
exports.getCountryWeatherLatest = getCountryWeatherLatest;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("../db");
async function ensureSource(name, apiBaseUrl) {
    const { rows } = await (0, db_1.query)(`INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ($1, $2, 'api_key', jsonb_build_object('provider','openweather'))
     ON CONFLICT (name) DO UPDATE SET api_base_url = EXCLUDED.api_base_url
     RETURNING id, name`, [name, apiBaseUrl]);
    return rows[0];
}
// Ensure a country row exists to satisfy FK on weather_snapshot
async function ensureCountry(iso2) {
    const code = (iso2 || "").toUpperCase();
    if (!code || code.length !== 2)
        return;
    await (0, db_1.query)(`INSERT INTO country (iso2, name)
     VALUES ($1::char(2), $2::text)
     ON CONFLICT (iso2) DO NOTHING`, [code, code]);
}
function toISO(ts) {
    const d = ts ? new Date(ts * 1000) : new Date();
    return d.toISOString();
}
async function upsertWeatherSnapshot(params) {
    const temp_c = params.main?.temp ?? null;
    const feels_like_c = params.main?.feels_like ?? null;
    const temp_min_c = params.main?.temp_min ?? null;
    const temp_max_c = params.main?.temp_max ?? null;
    const humidity = params.main?.humidity ?? null;
    const pressure = params.main?.pressure ?? null;
    const wind_speed = params.wind?.speed ?? null;
    const weather_main = params.weather?.[0]?.main ?? null;
    const weather_desc = params.weather?.[0]?.description ?? null;
    const dedupeBase = `${params.countryIso2}|${params.observedAtISO}|${temp_c ?? ""}|${weather_main ?? ""}`;
    const dedupe_hash = node_crypto_1.default.createHash("sha256").update(dedupeBase).digest("hex");
    await (0, db_1.query)(`INSERT INTO weather_snapshot (
       source_id, country_iso2, coord_lat, coord_lon,
       temp_c, feels_like_c, temp_min_c, temp_max_c,
       humidity, pressure, wind_speed, weather_main, weather_desc,
       observed_at, payload, dedupe_hash
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8,
       $9, $10, $11, $12, $13,
       $14, $15, $16
     )
     ON CONFLICT (source_id, country_iso2)
     DO UPDATE SET
       coord_lat = EXCLUDED.coord_lat,
       coord_lon = EXCLUDED.coord_lon,
       temp_c = EXCLUDED.temp_c,
       feels_like_c = EXCLUDED.feels_like_c,
       temp_min_c = EXCLUDED.temp_min_c,
       temp_max_c = EXCLUDED.temp_max_c,
       humidity = EXCLUDED.humidity,
       pressure = EXCLUDED.pressure,
       wind_speed = EXCLUDED.wind_speed,
       weather_main = EXCLUDED.weather_main,
       weather_desc = EXCLUDED.weather_desc,
       observed_at = EXCLUDED.observed_at,
       payload = EXCLUDED.payload,
       dedupe_hash = EXCLUDED.dedupe_hash,
       updated_at = now()
    `, [
        params.sourceId,
        params.countryIso2,
        params.coord?.lat ?? null,
        params.coord?.lon ?? null,
        temp_c,
        feels_like_c,
        temp_min_c,
        temp_max_c,
        humidity,
        pressure,
        wind_speed,
        weather_main,
        weather_desc,
        params.observedAtISO,
        JSON.stringify(params.raw ?? {}),
        dedupe_hash,
    ]);
}
const OW_BASE = "https://api.openweathermap.org/data/2.5/weather";
async function ingestOpenWeatherCountryCurrent(countryIso2) {
    const apiKey = process.env.OPENWEATHER_API_KEY || "";
    if (!apiKey)
        throw new Error("OPENWEATHER_API_KEY not set");
    const source = await ensureSource("openweather", "https://api.openweathermap.org");
    const targets = [];
    if (countryIso2) {
        // Use the comprehensive seed when a specific country is requested too
        const seed = {
            US: [39.8283, -98.5795],
            GB: [55.3781, -3.4360],
            UK: [55.3781, -3.4360],
            FR: [46.2276, 2.2137],
            DE: [51.1657, 10.4515],
            ES: [40.4637, -3.7492],
            IT: [41.8719, 12.5674],
            SE: [60.1282, 18.6435],
            NO: [60.4720, 8.4689],
            NL: [52.1326, 5.2913],
            BE: [50.5039, 4.4699],
            PL: [51.9194, 19.1451],
            UA: [48.3794, 31.1656],
            RU: [61.5240, 105.3188],
            TR: [38.9637, 35.2433],
            CN: [35.8617, 104.1954],
            JP: [36.2048, 138.2529],
            KR: [35.9078, 127.7669],
            IN: [20.5937, 78.9629],
            ID: [-0.7893, 113.9213],
            AU: [-25.2744, 133.7751],
            NZ: [-40.9006, 174.8860],
            ZA: [-30.5595, 22.9375],
            EG: [26.8206, 30.8025],
            NG: [9.0820, 8.6753],
            KE: [0.0236, 37.9062],
            BR: [-14.2350, -51.9253],
            AR: [-38.4161, -63.6167],
            MX: [23.6345, -102.5528],
            CA: [56.1304, -106.3468],
            SG: [1.3521, 103.8198],
            AE: [23.4241, 53.8478],
            SA: [23.8859, 45.0792],
            PT: [39.3999, -8.2245],
            IE: [53.1424, -7.6921],
            FI: [61.9241, 25.7482],
            DK: [56.2639, 9.5018],
            CH: [46.8182, 8.2275],
            AT: [47.5162, 14.5501],
            CZ: [49.8175, 15.4730],
            MY: [4.2105, 101.9758],
            PH: [12.8797, 121.7740],
            TH: [15.8700, 100.9925],
            CL: [-35.6751, -71.5430],
        };
        const iso = countryIso2.toUpperCase();
        const [lat, lon] = seed[iso] ?? [0, 0];
        targets.push({ iso2: iso, lat, lon });
    }
    else {
        // Default: a pragmatic global sample seed; can be expanded or sourced from DB later.
        const seed = {
            US: [39.8283, -98.5795],
            GB: [55.3781, -3.4360],
            FR: [46.2276, 2.2137],
            DE: [51.1657, 10.4515],
            ES: [40.4637, -3.7492],
            IT: [41.8719, 12.5674],
            SE: [60.1282, 18.6435],
            NO: [60.4720, 8.4689],
            NL: [52.1326, 5.2913],
            BE: [50.5039, 4.4699],
            PL: [51.9194, 19.1451],
            UA: [48.3794, 31.1656],
            RU: [61.5240, 105.3188],
            TR: [38.9637, 35.2433],
            CN: [35.8617, 104.1954],
            JP: [36.2048, 138.2529],
            KR: [35.9078, 127.7669],
            IN: [20.5937, 78.9629],
            ID: [-0.7893, 113.9213],
            AU: [-25.2744, 133.7751],
            NZ: [-40.9006, 174.8860],
            ZA: [-30.5595, 22.9375],
            EG: [26.8206, 30.8025],
            NG: [9.0820, 8.6753],
            KE: [0.0236, 37.9062],
            BR: [-14.2350, -51.9253],
            AR: [-38.4161, -63.6167],
            MX: [23.6345, -102.5528],
            CA: [56.1304, -106.3468],
            SG: [1.3521, 103.8198],
            AE: [23.4241, 53.8478],
            SA: [23.8859, 45.0792],
        };
        for (const [iso2, [lat, lon]] of Object.entries(seed)) {
            targets.push({ iso2, lat, lon });
        }
    }
    let inserted = 0, updated = 0, skipped = 0;
    let http_failures = 0, db_errors = 0;
    let last_http_status = null;
    let last_http_error = null;
    let last_db_error = null;
    for (const t of targets) {
        const url = new URL(OW_BASE);
        url.searchParams.set("lat", String(t.lat));
        url.searchParams.set("lon", String(t.lon));
        url.searchParams.set("appid", apiKey);
        url.searchParams.set("units", "metric");
        try {
            const resp = await fetch(url.toString());
            if (!resp.ok) {
                skipped++;
                http_failures++;
                last_http_status = resp.status;
                try {
                    // Try to capture a short error message body without leaking secrets
                    const t = await resp.text();
                    last_http_error = (t || "").slice(0, 200);
                }
                catch {
                    /* ignore */
                }
                continue;
            }
            const data = (await resp.json());
            const iso = (data.sys?.country || t.iso2 || "").toUpperCase();
            if (!iso) {
                skipped++;
                continue;
            }
            const observedAtISO = toISO(data.dt);
            try {
                // Defensive: make sure FK target exists even if migrations missed seeding
                await ensureCountry(iso);
                await upsertWeatherSnapshot({
                    sourceId: source.id,
                    countryIso2: iso,
                    coord: { lat: data.coord?.lat ?? null, lon: data.coord?.lon ?? null },
                    main: data.main,
                    wind: data.wind,
                    weather: data.weather,
                    observedAtISO,
                    raw: data,
                });
                // Cannot easily tell insert vs update with ON CONFLICT without checking, so treat as inserted
                inserted++;
            }
            catch (e) {
                skipped++;
                db_errors++;
                try {
                    const msg = e?.message || String(e);
                    last_db_error = String(msg).slice(0, 300);
                    // Also log server-side for inspection in pod logs
                    // eslint-disable-next-line no-console
                    console.error("openweather upsert error:", msg);
                }
                catch {
                    /* ignore */
                }
            }
        }
        catch (e) {
            // Network or fetch error (no HTTP response)
            skipped++;
            http_failures++;
            last_http_error = String(e?.message || e);
        }
    }
    return { inserted, updated, skipped, http_failures, db_errors, last_http_status, last_http_error, last_db_error };
}
async function getCountryWeatherLatest() {
    const { rows } = await (0, db_1.query)(`SELECT country_iso2 AS country, temp_c, humidity, observed_at, weather_main
     FROM weather_snapshot
     ORDER BY country_iso2`);
    return rows.map(r => ({
        country: r.country,
        temp_c: r.temp_c,
        humidity: r.humidity,
        observed_at: r.observed_at,
        weather_main: r.weather_main,
    }));
}
