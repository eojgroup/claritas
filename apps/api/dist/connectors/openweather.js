"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestOpenWeatherCountryWeather = ingestOpenWeatherCountryWeather;
const world_countries_1 = __importDefault(require("world-countries"));
const db_1 = require("../db");
const ONE_CALL_BASE = "https://api.openweathermap.org/data/3.0/onecall";
const AIR_BASE = "https://api.openweathermap.org/data/2.5/air_pollution";
const ATTRIBUTION = "Weather data provided by OpenWeather";
const DEFAULT_COUNTRIES = [
    "US", "CA", "MX", "BR", "AR", "CL", "GB", "IE", "FR", "DE", "ES", "IT",
    "PT", "NL", "BE", "CH", "AT", "PL", "CZ", "SE", "NO", "DK", "FI", "UA",
    "RU", "TR", "IL", "SA", "AE", "EG", "NG", "KE", "ZA", "IN", "CN", "JP",
    "KR", "ID", "SG", "MY", "TH", "PH", "AU", "NZ", "PK", "BD", "VN", "GR",
];
function unix(value) {
    return new Date((value ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
}
function number(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function integer(value) {
    const parsed = number(value);
    return parsed == null ? null : Math.round(parsed);
}
function targets(countryIso2) {
    const requested = countryIso2?.trim().toUpperCase().replace(/^UK$/, "GB");
    const configured = process.env.WEATHER_COUNTRIES?.trim()
        ? process.env.WEATHER_COUNTRIES.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean)
        : DEFAULT_COUNTRIES;
    const codes = requested ? [requested] : configured;
    return Array.from(new Set(codes)).flatMap((iso2) => {
        const entry = world_countries_1.default.find((country) => country.cca2 === iso2);
        if (!entry?.latlng || entry.latlng.length < 2)
            return [];
        return [{
                iso2, iso3: entry.cca3 ?? null, name: entry.name?.common ?? iso2,
                region: entry.region ?? null, lat: entry.latlng[0], lon: entry.latlng[1],
            }];
    });
}
async function ensureSource() {
    const { rows } = await (0, db_1.query)(`INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ('openweather', $1, 'api_key', $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET api_base_url = EXCLUDED.api_base_url,
       auth_type = EXCLUDED.auth_type, metadata = EXCLUDED.metadata
     RETURNING id`, [ONE_CALL_BASE, JSON.stringify({
            provider: "openweather", product: "One Call API 3.0", source_kind: "forecast_model",
            attribution: ATTRIBUTION, attribution_url: "https://openweathermap.org/",
            license: "ODbL for self-service API subscriptions; attribution required",
            license_url: "https://openweathermap.org/terms", update_interval: "10 minutes",
            coverage: ["current", "hourly_48h", "daily_8d", "government_alerts", "air_pollution"],
        })]);
    return rows[0].id;
}
async function ensureCountry(target) {
    await (0, db_1.query)(`INSERT INTO country (iso2, iso3, name, region, centroid, ext)
     VALUES ($1::char(2), $2::char(3), $3, $4, $5, jsonb_build_object('lat',$6::double precision,'lon',$7::double precision))
     ON CONFLICT (iso2) DO UPDATE SET iso3 = COALESCE(country.iso3, EXCLUDED.iso3),
       centroid = COALESCE(country.centroid, EXCLUDED.centroid), ext = COALESCE(country.ext, '{}'::jsonb) || EXCLUDED.ext`, [target.iso2, target.iso3, target.name, target.region, `${target.lat},${target.lon}`, target.lat, target.lon]);
}
function openWeatherUrl(base, target, apiKey) {
    const url = new URL(base);
    url.searchParams.set("lat", String(target.lat));
    url.searchParams.set("lon", String(target.lon));
    url.searchParams.set("appid", apiKey);
    url.searchParams.set("units", "metric");
    url.searchParams.set("lang", "en");
    return url;
}
async function fetchJson(url, label) {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok)
        throw new Error(`${label} HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return await response.json();
}
async function storeTarget(sourceId, target, data, air) {
    await ensureCountry(target);
    const current = data.current ?? {};
    const observedAt = unix(current.dt);
    const condition = current.weather?.[0] ?? {};
    await (0, db_1.withTransaction)(async (client) => {
        await client.query(`INSERT INTO weather_snapshot (
         source_id, country_iso2, coord_lat, coord_lon, temp_c, feels_like_c,
         humidity, pressure, wind_speed, weather_main, weather_desc, observed_at,
         payload, dedupe_hash, apparent_temp_c, precipitation_mm, weather_code,
         cloud_cover, wind_direction, wind_gust, is_day, source_kind
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$6,$15,$16,$17,$18,$19,$20,'forecast_model')
       ON CONFLICT (source_id, country_iso2) DO UPDATE SET
         coord_lat=EXCLUDED.coord_lat, coord_lon=EXCLUDED.coord_lon, temp_c=EXCLUDED.temp_c,
         feels_like_c=EXCLUDED.feels_like_c, humidity=EXCLUDED.humidity, pressure=EXCLUDED.pressure,
         wind_speed=EXCLUDED.wind_speed, weather_main=EXCLUDED.weather_main, weather_desc=EXCLUDED.weather_desc,
         observed_at=EXCLUDED.observed_at, payload=EXCLUDED.payload, dedupe_hash=EXCLUDED.dedupe_hash,
         apparent_temp_c=EXCLUDED.apparent_temp_c, precipitation_mm=EXCLUDED.precipitation_mm,
         weather_code=EXCLUDED.weather_code, cloud_cover=EXCLUDED.cloud_cover,
         wind_direction=EXCLUDED.wind_direction, wind_gust=EXCLUDED.wind_gust,
         is_day=EXCLUDED.is_day, source_kind=EXCLUDED.source_kind, updated_at=now()`, [sourceId, target.iso2, data.lat ?? target.lat, data.lon ?? target.lon, number(current.temp),
            number(current.feels_like), integer(current.humidity), integer(current.pressure), number(current.wind_speed),
            condition.main ?? null, condition.description ?? null, observedAt,
            JSON.stringify({ provider: "openweather", product: "one-call-3.0", attribution: ATTRIBUTION,
                timezone: data.timezone ?? null, timezone_offset: data.timezone_offset ?? null, current }),
            `${target.iso2}|${observedAt}|${current.temp ?? ""}|${condition.id ?? ""}`,
            number(current.rain?.["1h"] ?? current.snow?.["1h"]), integer(condition.id), integer(current.clouds),
            integer(current.wind_deg), number(current.wind_gust),
            current.sunrise && current.sunset ? current.dt >= current.sunrise && current.dt < current.sunset : null]);
        for (const point of data.hourly ?? []) {
            const condition = point.weather?.[0] ?? {};
            await client.query(`INSERT INTO weather_forecast (
           source_id,country_iso2,granularity,forecast_time,temp_c,apparent_temp_c,humidity,
           precipitation_probability,precipitation_mm,rain_mm,snowfall_cm,weather_code,
           wind_speed,wind_gust,uv_index,visibility_m,payload
         ) VALUES ($1,$2,'hourly',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (source_id,country_iso2,granularity,forecast_time) DO UPDATE SET
           temp_c=EXCLUDED.temp_c,apparent_temp_c=EXCLUDED.apparent_temp_c,humidity=EXCLUDED.humidity,
           precipitation_probability=EXCLUDED.precipitation_probability,precipitation_mm=EXCLUDED.precipitation_mm,
           rain_mm=EXCLUDED.rain_mm,snowfall_cm=EXCLUDED.snowfall_cm,weather_code=EXCLUDED.weather_code,
           wind_speed=EXCLUDED.wind_speed,wind_gust=EXCLUDED.wind_gust,uv_index=EXCLUDED.uv_index,
           visibility_m=EXCLUDED.visibility_m,payload=EXCLUDED.payload,updated_at=now()`, [sourceId, target.iso2, unix(point.dt), number(point.temp), number(point.feels_like), integer(point.humidity),
                point.pop == null ? null : integer(point.pop * 100), number(point.rain?.["1h"] ?? point.snow?.["1h"]),
                number(point.rain?.["1h"]), number(point.snow?.["1h"]), integer(condition.id), number(point.wind_speed),
                number(point.wind_gust), number(point.uvi), number(point.visibility),
                JSON.stringify({ provider: "openweather", weather: point.weather ?? [], clouds: point.clouds ?? null })]);
        }
        for (const point of data.daily ?? []) {
            const condition = point.weather?.[0] ?? {};
            const feels = Object.values(point.feels_like ?? {}).filter((value) => typeof value === "number");
            await client.query(`INSERT INTO weather_forecast (
           source_id,country_iso2,granularity,forecast_time,temp_min_c,temp_max_c,
           apparent_temp_min_c,apparent_temp_max_c,precipitation_probability,precipitation_mm,
           rain_mm,snowfall_cm,weather_code,wind_speed,wind_gust,uv_index,sunrise_at,sunset_at,payload
         ) VALUES ($1,$2,'daily',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (source_id,country_iso2,granularity,forecast_time) DO UPDATE SET
           temp_min_c=EXCLUDED.temp_min_c,temp_max_c=EXCLUDED.temp_max_c,
           apparent_temp_min_c=EXCLUDED.apparent_temp_min_c,apparent_temp_max_c=EXCLUDED.apparent_temp_max_c,
           precipitation_probability=EXCLUDED.precipitation_probability,precipitation_mm=EXCLUDED.precipitation_mm,
           rain_mm=EXCLUDED.rain_mm,snowfall_cm=EXCLUDED.snowfall_cm,weather_code=EXCLUDED.weather_code,
           wind_speed=EXCLUDED.wind_speed,wind_gust=EXCLUDED.wind_gust,uv_index=EXCLUDED.uv_index,
           sunrise_at=EXCLUDED.sunrise_at,sunset_at=EXCLUDED.sunset_at,payload=EXCLUDED.payload,updated_at=now()`, [sourceId, target.iso2, unix(point.dt), number(point.temp?.min), number(point.temp?.max),
                feels.length ? Math.min(...feels) : null, feels.length ? Math.max(...feels) : null,
                point.pop == null ? null : integer(point.pop * 100), number(point.rain ?? point.snow), number(point.rain), number(point.snow),
                integer(condition.id), number(point.wind_speed), number(point.wind_gust), number(point.uvi),
                point.sunrise ? unix(point.sunrise) : null, point.sunset ? unix(point.sunset) : null,
                JSON.stringify({ provider: "openweather", summary: point.summary ?? null, weather: point.weather ?? [], humidity: point.humidity ?? null })]);
        }
        const airPoint = air?.list?.[0];
        if (airPoint) {
            const component = airPoint.components ?? {};
            const providerAqi = airPoint.main?.aqi == null ? null : airPoint.main.aqi;
            await client.query(`INSERT INTO air_quality_snapshot (
           source_id,country_iso2,observed_at,european_aqi,us_aqi,provider_aqi,aqi_scale,pm10,pm2_5,
           carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,payload
         ) VALUES ($1,$2,$3,NULL,NULL,$4,'OpenWeather 1-5',$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (source_id,country_iso2) DO UPDATE SET observed_at=EXCLUDED.observed_at,
           european_aqi=EXCLUDED.european_aqi,us_aqi=EXCLUDED.us_aqi,
           provider_aqi=EXCLUDED.provider_aqi,aqi_scale=EXCLUDED.aqi_scale,
           pm10=EXCLUDED.pm10,pm2_5=EXCLUDED.pm2_5,
           carbon_monoxide=EXCLUDED.carbon_monoxide,nitrogen_dioxide=EXCLUDED.nitrogen_dioxide,
           sulphur_dioxide=EXCLUDED.sulphur_dioxide,ozone=EXCLUDED.ozone,payload=EXCLUDED.payload,updated_at=now()`, [sourceId, target.iso2, unix(airPoint.dt), providerAqi, number(component.pm10), number(component.pm2_5),
                number(component.co), number(component.no2), number(component.so2), number(component.o3),
                JSON.stringify({ provider: "openweather", scale: "OpenWeather 1-5", raw_aqi: providerAqi })]);
        }
        for (const alert of data.alerts ?? []) {
            const externalId = `${target.iso2}:${alert.sender_name ?? "unknown"}:${alert.event ?? "alert"}:${alert.start ?? 0}:${alert.end ?? 0}`;
            await client.query(`INSERT INTO weather_alert (
           source_id,external_id,country_iso2,sender_name,event,severity,urgency,certainty,
           starts_at,ends_at,headline,description,instruction,area,payload
         ) VALUES ($1,$2,$3,$4,$5,NULL,NULL,NULL,$6,$7,$5,$8,NULL,NULL,$9)
         ON CONFLICT (source_id,external_id,country_iso2) DO UPDATE SET
           sender_name=EXCLUDED.sender_name,event=EXCLUDED.event,starts_at=EXCLUDED.starts_at,
           ends_at=EXCLUDED.ends_at,description=EXCLUDED.description,payload=EXCLUDED.payload,updated_at=now()`, [sourceId, externalId, target.iso2, alert.sender_name ?? "OpenWeather alert provider", alert.event ?? "Weather alert",
                unix(alert.start), unix(alert.end), alert.description ?? null,
                JSON.stringify({ provider: "openweather", tags: alert.tags ?? [], attribution: ATTRIBUTION })]);
        }
    });
}
async function ingestOpenWeatherCountryWeather(countryIso2) {
    const apiKey = process.env.OPENWEATHER_API_KEY?.trim();
    if (!apiKey)
        throw new Error("OPENWEATHER_API_KEY is not configured.");
    const sourceId = await ensureSource();
    const selected = targets(countryIso2);
    if (selected.length === 0)
        throw new Error("No valid weather country targets were selected.");
    let inserted = 0;
    let skipped = 0;
    let http_failures = 0;
    const failures = [];
    for (const target of selected) {
        try {
            const [weather, air] = await Promise.all([
                fetchJson(openWeatherUrl(ONE_CALL_BASE, target, apiKey), "OpenWeather One Call"),
                fetchJson(openWeatherUrl(AIR_BASE, target, apiKey), "OpenWeather air pollution").catch(() => null),
            ]);
            await storeTarget(sourceId, target, weather, air);
            inserted += 1;
        }
        catch (error) {
            skipped += 1;
            http_failures += 1;
            failures.push({ country: target.iso2, error: error instanceof Error ? error.message : String(error) });
        }
    }
    if (inserted === 0)
        throw new Error(`OpenWeather failed for every target: ${failures.slice(0, 3).map((failure) => `${failure.country}: ${failure.error}`).join("; ")}`);
    return { provider: "openweather", product: "one-call-3.0", inserted, updated: 0, skipped, http_failures, targets: selected.length, failures };
}
