import worldCountries from "world-countries";
import { query, withTransaction } from "../db";

const PUBLIC_FORECAST_BASE = "https://api.open-meteo.com";
const CUSTOMER_FORECAST_BASE = "https://customer-api.open-meteo.com";
const PUBLIC_AIR_BASE = "https://air-quality-api.open-meteo.com";
const CUSTOMER_AIR_BASE = "https://customer-air-quality-api.open-meteo.com";
const PUBLIC_ARCHIVE_BASE = "https://archive-api.open-meteo.com";
const CUSTOMER_ARCHIVE_BASE = "https://customer-archive-api.open-meteo.com";
const PUBLIC_MARINE_BASE = "https://marine-api.open-meteo.com";
const CUSTOMER_MARINE_BASE = "https://customer-marine-api.open-meteo.com";
const ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)";

type WeatherTarget = { iso2: string; name: string; lat: number; lon: number };

type OpenMeteoForecastResponse = {
  latitude?: number;
  longitude?: number;
  location_id?: number;
  current_units?: Record<string, string>;
  current?: Record<string, number | string | null>;
  hourly_units?: Record<string, string>;
  hourly?: Record<string, Array<number | string | null>>;
  daily_units?: Record<string, string>;
  daily?: Record<string, Array<number | string | null>>;
  [key: string]: unknown;
};

type OpenMeteoAirResponse = {
  latitude?: number;
  longitude?: number;
  location_id?: number;
  current_units?: Record<string, string>;
  current?: Record<string, number | string | null>;
  [key: string]: unknown;
};

export type DailyForecast = {
  forecast_time: string;
  temp_min_c: number | null;
  temp_max_c: number | null;
  apparent_temp_min_c: number | null;
  apparent_temp_max_c: number | null;
  precipitation_probability: number | null;
  precipitation_mm: number | null;
  weather_code: number | null;
  weather_main: string | null;
  wind_speed: number | null;
  wind_gust: number | null;
  uv_index: number | null;
  sunrise_at: string | null;
  sunset_at: string | null;
};

export type AirQuality = {
  observed_at: string;
  european_aqi: number | null;
  us_aqi: number | null;
  pm10: number | null;
  pm2_5: number | null;
  carbon_monoxide: number | null;
  nitrogen_dioxide: number | null;
  sulphur_dioxide: number | null;
  ozone: number | null;
  label: string;
};

export type EnhancedCountryWeather = {
  country: string;
  temp_c: number | null;
  apparent_temp_c: number | null;
  humidity: number | null;
  precipitation_mm: number | null;
  observed_at: string;
  weather_main: string | null;
  weather_desc: string | null;
  weather_code: number | null;
  cloud_cover: number | null;
  wind_speed: number | null;
  wind_direction: number | null;
  wind_gust: number | null;
  is_day: boolean | null;
  source_name: string | null;
  source_kind: string | null;
  attribution: string | null;
  icon_code: string | null;
  forecast: DailyForecast[];
  air_quality: AirQuality | null;
};

export type WeatherForecastDetail = {
  country: string;
  generated_at: string;
  source_name: string;
  attribution: string;
  hourly: Array<Record<string, unknown>>;
  daily: DailyForecast[];
  air_quality: AirQuality | null;
};

export type HistoricalWeatherDetail = {
  country: string;
  start_date: string;
  end_date: string;
  source_name: "openmeteo";
  attribution: string;
  daily: Array<Record<string, number | string | null>>;
};

export type MarineWeatherDetail = {
  country: string;
  source_name: "openmeteo";
  attribution: string;
  current: Record<string, number | string | null>;
  hourly: Array<Record<string, number | string | null>>;
};

const WEATHER_CODES: Record<number, { main: string; description: string }> = {
  0: { main: "Clear", description: "Clear sky" },
  1: { main: "Mainly clear", description: "Mainly clear" },
  2: { main: "Partly cloudy", description: "Partly cloudy" },
  3: { main: "Overcast", description: "Overcast" },
  45: { main: "Fog", description: "Fog" },
  48: { main: "Fog", description: "Depositing rime fog" },
  51: { main: "Drizzle", description: "Light drizzle" },
  53: { main: "Drizzle", description: "Moderate drizzle" },
  55: { main: "Drizzle", description: "Dense drizzle" },
  56: { main: "Freezing drizzle", description: "Light freezing drizzle" },
  57: { main: "Freezing drizzle", description: "Dense freezing drizzle" },
  61: { main: "Rain", description: "Slight rain" },
  63: { main: "Rain", description: "Moderate rain" },
  65: { main: "Rain", description: "Heavy rain" },
  66: { main: "Freezing rain", description: "Light freezing rain" },
  67: { main: "Freezing rain", description: "Heavy freezing rain" },
  71: { main: "Snow", description: "Slight snowfall" },
  73: { main: "Snow", description: "Moderate snowfall" },
  75: { main: "Snow", description: "Heavy snowfall" },
  77: { main: "Snow", description: "Snow grains" },
  80: { main: "Rain showers", description: "Slight rain showers" },
  81: { main: "Rain showers", description: "Moderate rain showers" },
  82: { main: "Rain showers", description: "Violent rain showers" },
  85: { main: "Snow showers", description: "Slight snow showers" },
  86: { main: "Snow showers", description: "Heavy snow showers" },
  95: { main: "Thunderstorm", description: "Thunderstorm" },
  96: { main: "Thunderstorm", description: "Thunderstorm with slight hail" },
  99: { main: "Thunderstorm", description: "Thunderstorm with heavy hail" },
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asInt(value: unknown): number | null {
  const number = asNumber(value);
  return number == null ? null : Math.round(number);
}

function isoTimestamp(value: unknown): string {
  if (typeof value === "string" && value) {
    const withZone = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
    if (!Number.isNaN(Date.parse(withZone))) return new Date(withZone).toISOString();
  }
  return new Date().toISOString();
}

function nullableIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const withZone = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  return Number.isNaN(Date.parse(withZone)) ? null : new Date(withZone).toISOString();
}

function isoDateTimestamp(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  return isoTimestamp(value);
}

function arrayValue(values: Record<string, Array<number | string | null>> | undefined, key: string, index: number): unknown {
  return values?.[key]?.[index] ?? null;
}

function weatherDescription(code: number | null): { main: string | null; description: string | null } {
  const match = code == null ? null : WEATHER_CODES[code];
  return { main: match?.main ?? null, description: match?.description ?? null };
}

function airQualityLabel(value: number | null): string {
  if (value == null) return "Unknown";
  if (value <= 20) return "Good";
  if (value <= 40) return "Fair";
  if (value <= 60) return "Moderate";
  if (value <= 80) return "Poor";
  if (value <= 100) return "Very poor";
  return "Extremely poor";
}

function apiKey(): string | null {
  return process.env.OPEN_METEO_API_KEY?.trim() || null;
}

function forecastBase(): string {
  return (process.env.OPEN_METEO_BASE_URL || (apiKey() ? CUSTOMER_FORECAST_BASE : PUBLIC_FORECAST_BASE)).replace(/\/$/, "");
}

function airBase(): string {
  return (process.env.OPEN_METEO_AIR_QUALITY_BASE_URL || (apiKey() ? CUSTOMER_AIR_BASE : PUBLIC_AIR_BASE)).replace(/\/$/, "");
}

function archiveBase(): string {
  return (process.env.OPEN_METEO_ARCHIVE_BASE_URL || (apiKey() ? CUSTOMER_ARCHIVE_BASE : PUBLIC_ARCHIVE_BASE)).replace(/\/$/, "");
}

function marineBase(): string {
  return (process.env.OPEN_METEO_MARINE_BASE_URL || (apiKey() ? CUSTOMER_MARINE_BASE : PUBLIC_MARINE_BASE)).replace(/\/$/, "");
}

function recordsFromColumns(columns: Record<string, Array<number | string | null>> | undefined): Array<Record<string, number | string | null>> {
  const times = columns?.time ?? [];
  return times.map((time, index) => Object.fromEntries(
    Object.entries(columns ?? {}).map(([key, values]) => [key, values[index] ?? null])
  ) as Record<string, number | string | null>);
}

function parseDateOnly(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}

async function ensureSource(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO source (name, api_base_url, auth_type, metadata)
     VALUES ('openmeteo', $1, $2, $3::jsonb)
     ON CONFLICT (name) DO UPDATE SET api_base_url = EXCLUDED.api_base_url,
       auth_type = EXCLUDED.auth_type, metadata = EXCLUDED.metadata
     RETURNING id`,
    [forecastBase(), apiKey() ? "api_key" : "none", JSON.stringify({
      provider: "openmeteo", attribution: ATTRIBUTION,
      attribution_url: "https://open-meteo.com/", data_license: "CC BY 4.0",
      server_license: "AGPL-3.0-or-later", hosted_commercial_access: Boolean(apiKey()),
      source_kind: "forecast_model",
    })]
  );
  return rows[0].id;
}

async function ensureCountry(target: WeatherTarget): Promise<void> {
  const country = worldCountries.find((entry) => entry.cca2 === target.iso2);
  await query(
    `INSERT INTO country (iso2, iso3, name, region, centroid, ext)
     VALUES ($1::char(2), $2::char(3), $3, $4, $5,
             jsonb_build_object('lat', $6::double precision, 'lon', $7::double precision))
     ON CONFLICT (iso2) DO UPDATE SET
       iso3 = COALESCE(country.iso3, EXCLUDED.iso3),
       centroid = COALESCE(country.centroid, EXCLUDED.centroid),
       ext = COALESCE(country.ext, '{}'::jsonb) || EXCLUDED.ext`,
    [target.iso2, country?.cca3 ?? null, target.name, country?.region ?? null,
     `${target.lat},${target.lon}`, target.lat, target.lon]
  );
}

async function weatherTargets(countryIso2?: string): Promise<WeatherTarget[]> {
  const requested = countryIso2?.trim().toUpperCase();
  let iso2s: string[];
  if (requested) {
    iso2s = [requested === "UK" ? "GB" : requested];
  } else if (process.env.OPEN_METEO_COUNTRIES?.trim()) {
    iso2s = process.env.OPEN_METEO_COUNTRIES.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
  } else {
    const { rows } = await query<{ iso2: string }>(`SELECT iso2::text FROM country ORDER BY iso2`);
    iso2s = rows.map((row) => row.iso2.trim().toUpperCase());
  }
  return Array.from(new Set(iso2s)).map((iso2) => {
    const country = worldCountries.find((entry) => entry.cca2 === iso2);
    if (!country || !Array.isArray(country.latlng) || country.latlng.length < 2) return null;
    return { iso2, name: country.name.common, lat: country.latlng[0], lon: country.latlng[1] };
  }).filter((target): target is WeatherTarget => Boolean(target));
}

function addCoordinates(url: URL, targets: WeatherTarget[]): void {
  url.searchParams.set("latitude", targets.map((target) => target.lat.toFixed(4)).join(","));
  url.searchParams.set("longitude", targets.map((target) => target.lon.toFixed(4)).join(","));
  const key = apiKey();
  if (key) url.searchParams.set("apikey", key);
}

async function fetchForecast(targets: WeatherTarget[]): Promise<OpenMeteoForecastResponse[]> {
  const url = new URL(`${forecastBase()}/v1/forecast`);
  addCoordinates(url, targets);
  url.searchParams.set("current", [
    "temperature_2m", "relative_humidity_2m", "apparent_temperature", "is_day",
    "precipitation", "weather_code", "cloud_cover", "pressure_msl",
    "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
  ].join(","));
  url.searchParams.set("hourly", [
    "temperature_2m", "relative_humidity_2m", "apparent_temperature",
    "precipitation_probability", "precipitation", "rain", "snowfall",
    "weather_code", "wind_speed_10m", "wind_gusts_10m", "visibility", "uv_index",
  ].join(","));
  url.searchParams.set("daily", [
    "weather_code", "temperature_2m_max", "temperature_2m_min",
    "apparent_temperature_max", "apparent_temperature_min", "sunrise", "sunset",
    "uv_index_max", "precipitation_sum", "rain_sum", "snowfall_sum",
    "precipitation_probability_max", "wind_speed_10m_max", "wind_gusts_10m_max",
  ].join(","));
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("forecast_hours", "48");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timezone", "UTC");
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Open-Meteo forecast HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json() as OpenMeteoForecastResponse | OpenMeteoForecastResponse[];
  return Array.isArray(data) ? data : [data];
}

async function fetchAirQuality(targets: WeatherTarget[]): Promise<OpenMeteoAirResponse[]> {
  const url = new URL(`${airBase()}/v1/air-quality`);
  addCoordinates(url, targets);
  url.searchParams.set("current", [
    "european_aqi", "us_aqi", "pm10", "pm2_5", "carbon_monoxide",
    "nitrogen_dioxide", "sulphur_dioxide", "ozone",
  ].join(","));
  url.searchParams.set("timezone", "UTC");
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Open-Meteo air-quality HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json() as OpenMeteoAirResponse | OpenMeteoAirResponse[];
  return Array.isArray(data) ? data : [data];
}

function responseForIndex<T extends { location_id?: number }>(responses: T[], index: number): T | undefined {
  return responses.find((response, responseIndex) => (response.location_id ?? responseIndex) === index) ?? responses[index];
}

async function upsertTargetWeather(sourceId: number, target: WeatherTarget, data: OpenMeteoForecastResponse, air?: OpenMeteoAirResponse): Promise<void> {
  await ensureCountry(target);
  const current = data.current ?? {};
  const weatherCode = asInt(current.weather_code);
  const description = weatherDescription(weatherCode);
  const observedAt = isoTimestamp(current.time);
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO weather_snapshot (
         source_id, country_iso2, coord_lat, coord_lon, temp_c, feels_like_c,
         humidity, pressure, wind_speed, weather_main, weather_desc, observed_at,
         payload, dedupe_hash, apparent_temp_c, precipitation_mm, weather_code,
         cloud_cover, wind_direction, wind_gust, is_day, source_kind
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'forecast_model')
       ON CONFLICT (source_id, country_iso2) DO UPDATE SET
         coord_lat = EXCLUDED.coord_lat, coord_lon = EXCLUDED.coord_lon,
         temp_c = EXCLUDED.temp_c, feels_like_c = EXCLUDED.feels_like_c,
         humidity = EXCLUDED.humidity, pressure = EXCLUDED.pressure,
         wind_speed = EXCLUDED.wind_speed, weather_main = EXCLUDED.weather_main,
         weather_desc = EXCLUDED.weather_desc, observed_at = EXCLUDED.observed_at,
         payload = EXCLUDED.payload, dedupe_hash = EXCLUDED.dedupe_hash,
         apparent_temp_c = EXCLUDED.apparent_temp_c, precipitation_mm = EXCLUDED.precipitation_mm,
         weather_code = EXCLUDED.weather_code, cloud_cover = EXCLUDED.cloud_cover,
         wind_direction = EXCLUDED.wind_direction, wind_gust = EXCLUDED.wind_gust,
         is_day = EXCLUDED.is_day, source_kind = EXCLUDED.source_kind, updated_at = now()`,
      [sourceId, target.iso2, data.latitude ?? target.lat, data.longitude ?? target.lon,
       asNumber(current.temperature_2m), asNumber(current.apparent_temperature), asInt(current.relative_humidity_2m),
       asInt(current.pressure_msl), asNumber(current.wind_speed_10m), description.main, description.description,
       observedAt, JSON.stringify({ provider: "openmeteo", attribution: ATTRIBUTION, current, current_units: data.current_units ?? {} }),
       `${target.iso2}|${observedAt}|${current.temperature_2m ?? ""}|${weatherCode ?? ""}`,
       asNumber(current.apparent_temperature), asNumber(current.precipitation), weatherCode,
       asInt(current.cloud_cover), asInt(current.wind_direction_10m), asNumber(current.wind_gusts_10m),
       typeof current.is_day === "number" ? current.is_day === 1 : null]
    );

    const hourly = data.hourly ?? {};
    const hourlyTimes = hourly.time ?? [];
    for (let index = 0; index < hourlyTimes.length; index += 1) {
      const forecastTime = isoTimestamp(hourlyTimes[index]);
      const payload = Object.fromEntries(Object.entries(hourly).filter(([key]) => key !== "time").map(([key, values]) => [key, values[index] ?? null]));
      await client.query(
        `INSERT INTO weather_forecast (
           source_id, country_iso2, granularity, forecast_time, temp_c, apparent_temp_c,
           humidity, precipitation_probability, precipitation_mm, rain_mm, snowfall_cm,
           weather_code, wind_speed, wind_gust, uv_index, visibility_m, payload
         ) VALUES ($1,$2,'hourly',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (source_id, country_iso2, granularity, forecast_time) DO UPDATE SET
           temp_c = EXCLUDED.temp_c, apparent_temp_c = EXCLUDED.apparent_temp_c,
           humidity = EXCLUDED.humidity, precipitation_probability = EXCLUDED.precipitation_probability,
           precipitation_mm = EXCLUDED.precipitation_mm, rain_mm = EXCLUDED.rain_mm,
           snowfall_cm = EXCLUDED.snowfall_cm, weather_code = EXCLUDED.weather_code,
           wind_speed = EXCLUDED.wind_speed, wind_gust = EXCLUDED.wind_gust,
           uv_index = EXCLUDED.uv_index, visibility_m = EXCLUDED.visibility_m,
           payload = EXCLUDED.payload, updated_at = now()`,
        [sourceId, target.iso2, forecastTime, asNumber(arrayValue(hourly, "temperature_2m", index)),
         asNumber(arrayValue(hourly, "apparent_temperature", index)), asInt(arrayValue(hourly, "relative_humidity_2m", index)),
         asInt(arrayValue(hourly, "precipitation_probability", index)), asNumber(arrayValue(hourly, "precipitation", index)),
         asNumber(arrayValue(hourly, "rain", index)), asNumber(arrayValue(hourly, "snowfall", index)),
         asInt(arrayValue(hourly, "weather_code", index)), asNumber(arrayValue(hourly, "wind_speed_10m", index)),
         asNumber(arrayValue(hourly, "wind_gusts_10m", index)), asNumber(arrayValue(hourly, "uv_index", index)),
         asNumber(arrayValue(hourly, "visibility", index)), JSON.stringify(payload)]
      );
    }

    const daily = data.daily ?? {};
    const dailyTimes = daily.time ?? [];
    for (let index = 0; index < dailyTimes.length; index += 1) {
      const forecastTime = isoDateTimestamp(dailyTimes[index]);
      const payload = Object.fromEntries(Object.entries(daily).filter(([key]) => key !== "time").map(([key, values]) => [key, values[index] ?? null]));
      await client.query(
        `INSERT INTO weather_forecast (
           source_id, country_iso2, granularity, forecast_time, temp_min_c, temp_max_c,
           apparent_temp_min_c, apparent_temp_max_c, precipitation_probability,
           precipitation_mm, rain_mm, snowfall_cm, weather_code, wind_speed, wind_gust,
           uv_index, sunrise_at, sunset_at, payload
         ) VALUES ($1,$2,'daily',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (source_id, country_iso2, granularity, forecast_time) DO UPDATE SET
           temp_min_c = EXCLUDED.temp_min_c, temp_max_c = EXCLUDED.temp_max_c,
           apparent_temp_min_c = EXCLUDED.apparent_temp_min_c,
           apparent_temp_max_c = EXCLUDED.apparent_temp_max_c,
           precipitation_probability = EXCLUDED.precipitation_probability,
           precipitation_mm = EXCLUDED.precipitation_mm, rain_mm = EXCLUDED.rain_mm,
           snowfall_cm = EXCLUDED.snowfall_cm, weather_code = EXCLUDED.weather_code,
           wind_speed = EXCLUDED.wind_speed, wind_gust = EXCLUDED.wind_gust,
           uv_index = EXCLUDED.uv_index, sunrise_at = EXCLUDED.sunrise_at,
           sunset_at = EXCLUDED.sunset_at, payload = EXCLUDED.payload, updated_at = now()`,
        [sourceId, target.iso2, forecastTime, asNumber(arrayValue(daily, "temperature_2m_min", index)),
         asNumber(arrayValue(daily, "temperature_2m_max", index)), asNumber(arrayValue(daily, "apparent_temperature_min", index)),
         asNumber(arrayValue(daily, "apparent_temperature_max", index)), asInt(arrayValue(daily, "precipitation_probability_max", index)),
         asNumber(arrayValue(daily, "precipitation_sum", index)), asNumber(arrayValue(daily, "rain_sum", index)),
         asNumber(arrayValue(daily, "snowfall_sum", index)), asInt(arrayValue(daily, "weather_code", index)),
         asNumber(arrayValue(daily, "wind_speed_10m_max", index)), asNumber(arrayValue(daily, "wind_gusts_10m_max", index)),
         asNumber(arrayValue(daily, "uv_index_max", index)), nullableIsoTimestamp(arrayValue(daily, "sunrise", index)),
         nullableIsoTimestamp(arrayValue(daily, "sunset", index)), JSON.stringify(payload)]
      );
    }

    if (air?.current) {
      const currentAir = air.current;
      const airTime = isoTimestamp(currentAir.time);
      await client.query(
        `INSERT INTO air_quality_snapshot (
           source_id, country_iso2, observed_at, european_aqi, us_aqi, pm10, pm2_5,
           carbon_monoxide, nitrogen_dioxide, sulphur_dioxide, ozone, payload
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (source_id, country_iso2) DO UPDATE SET
           observed_at = EXCLUDED.observed_at, european_aqi = EXCLUDED.european_aqi,
           us_aqi = EXCLUDED.us_aqi, pm10 = EXCLUDED.pm10, pm2_5 = EXCLUDED.pm2_5,
           carbon_monoxide = EXCLUDED.carbon_monoxide, nitrogen_dioxide = EXCLUDED.nitrogen_dioxide,
           sulphur_dioxide = EXCLUDED.sulphur_dioxide, ozone = EXCLUDED.ozone,
           payload = EXCLUDED.payload, updated_at = now()`,
        [sourceId, target.iso2, airTime, asNumber(currentAir.european_aqi), asNumber(currentAir.us_aqi),
         asNumber(currentAir.pm10), asNumber(currentAir.pm2_5), asNumber(currentAir.carbon_monoxide),
         asNumber(currentAir.nitrogen_dioxide), asNumber(currentAir.sulphur_dioxide), asNumber(currentAir.ozone),
         JSON.stringify({ provider: "openmeteo", attribution: ATTRIBUTION, current: currentAir, current_units: air.current_units ?? {} })]
      );
    }

    await client.query(
      `DELETE FROM weather_forecast
       WHERE source_id = $1 AND country_iso2 = $2
         AND (forecast_time < now() - interval '2 days' OR forecast_time > now() + interval '17 days')`,
      [sourceId, target.iso2]
    );
  });
}

export async function ingestOpenMeteoCountryWeather(countryIso2?: string): Promise<Record<string, unknown>> {
  const sourceId = await ensureSource();
  const targets = await weatherTargets(countryIso2);
  let inserted = 0;
  let skipped = 0;
  const errors: Array<{ countries: string[]; error: string }> = [];
  for (let offset = 0; offset < targets.length; offset += 25) {
    const chunk = targets.slice(offset, offset + 25);
    try {
      const [forecast, airResult] = await Promise.allSettled([fetchForecast(chunk), fetchAirQuality(chunk)]);
      if (forecast.status === "rejected") throw forecast.reason;
      const air = airResult.status === "fulfilled" ? airResult.value : [];
      for (let index = 0; index < chunk.length; index += 1) {
        const forecastRow = responseForIndex(forecast.value, index);
        if (!forecastRow) { skipped += 1; continue; }
        await upsertTargetWeather(sourceId, chunk[index], forecastRow, responseForIndex(air, index));
        inserted += 1;
      }
      if (airResult.status === "rejected") {
        errors.push({ countries: chunk.map((target) => target.iso2), error: `Air quality: ${airResult.reason instanceof Error ? airResult.reason.message : String(airResult.reason)}` });
      }
    } catch (error) {
      skipped += chunk.length;
      errors.push({ countries: chunk.map((target) => target.iso2), error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { provider: "openmeteo", inserted, updated: 0, skipped, countries: targets.map((target) => target.iso2), errors, commercial_api_key_configured: Boolean(apiKey()) };
}

export async function getCountryWeatherLatest(): Promise<EnhancedCountryWeather[]> {
  const { rows } = await query<EnhancedCountryWeather & { forecast: unknown; air_quality: unknown }>(
    `WITH ranked AS (
       SELECT ws.*, s.name AS source_name, s.metadata AS source_metadata,
              row_number() OVER (
                PARTITION BY ws.country_iso2
                ORDER BY CASE s.name WHEN 'openmeteo' THEN 0 WHEN 'openweather' THEN 1 ELSE 9 END,
                         ws.observed_at DESC
              ) AS source_rank
       FROM weather_snapshot ws JOIN source s ON s.id = ws.source_id
     )
     SELECT r.country_iso2 AS country, r.temp_c,
            COALESCE(r.apparent_temp_c, r.feels_like_c) AS apparent_temp_c,
            r.humidity, r.precipitation_mm, r.observed_at, r.weather_main, r.weather_desc,
            r.weather_code, r.cloud_cover, r.wind_speed, r.wind_direction, r.wind_gust,
            r.is_day, r.source_name, r.source_kind,
            COALESCE(r.source_metadata->>'attribution', r.source_name) AS attribution,
            CASE WHEN r.source_name = 'openweather' THEN (r.payload->'weather'->0->>'icon') ELSE NULL END AS icon_code,
            COALESCE(f.forecast, '[]'::jsonb) AS forecast,
            aq.air_quality
     FROM ranked r
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'forecast_time', x.forecast_time, 'temp_min_c', x.temp_min_c, 'temp_max_c', x.temp_max_c,
         'apparent_temp_min_c', x.apparent_temp_min_c, 'apparent_temp_max_c', x.apparent_temp_max_c,
         'precipitation_probability', x.precipitation_probability, 'precipitation_mm', x.precipitation_mm,
         'weather_code', x.weather_code,
         'weather_main', CASE
           WHEN x.weather_code = 0 THEN 'Clear' WHEN x.weather_code IN (1,2) THEN 'Partly cloudy'
           WHEN x.weather_code = 3 THEN 'Overcast' WHEN x.weather_code IN (45,48) THEN 'Fog'
           WHEN x.weather_code BETWEEN 51 AND 57 THEN 'Drizzle'
           WHEN x.weather_code BETWEEN 61 AND 67 THEN 'Rain'
           WHEN x.weather_code BETWEEN 71 AND 77 THEN 'Snow'
           WHEN x.weather_code BETWEEN 80 AND 82 THEN 'Rain showers'
           WHEN x.weather_code BETWEEN 85 AND 86 THEN 'Snow showers'
           WHEN x.weather_code >= 95 THEN 'Thunderstorm' ELSE NULL END,
         'wind_speed', x.wind_speed, 'wind_gust', x.wind_gust, 'uv_index', x.uv_index,
         'sunrise_at', x.sunrise_at, 'sunset_at', x.sunset_at
       ) ORDER BY x.forecast_time) AS forecast
       FROM (
         SELECT * FROM weather_forecast wf
         WHERE wf.source_id = r.source_id AND wf.country_iso2 = r.country_iso2
           AND wf.granularity = 'daily' AND wf.forecast_time >= date_trunc('day', now())
         ORDER BY wf.forecast_time LIMIT 7
       ) x
     ) f ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_build_object(
         'observed_at', a.observed_at, 'european_aqi', a.european_aqi, 'us_aqi', a.us_aqi,
         'pm10', a.pm10, 'pm2_5', a.pm2_5, 'carbon_monoxide', a.carbon_monoxide,
         'nitrogen_dioxide', a.nitrogen_dioxide, 'sulphur_dioxide', a.sulphur_dioxide,
         'ozone', a.ozone,
         'label', CASE WHEN a.european_aqi IS NULL THEN 'Unknown' WHEN a.european_aqi <= 20 THEN 'Good'
                       WHEN a.european_aqi <= 40 THEN 'Fair' WHEN a.european_aqi <= 60 THEN 'Moderate'
                       WHEN a.european_aqi <= 80 THEN 'Poor' WHEN a.european_aqi <= 100 THEN 'Very poor'
                       ELSE 'Extremely poor' END
       ) AS air_quality
       FROM air_quality_snapshot a WHERE a.country_iso2 = r.country_iso2
       ORDER BY CASE WHEN a.source_id = r.source_id THEN 0 ELSE 1 END, a.observed_at DESC LIMIT 1
     ) aq ON true
     WHERE r.source_rank = 1 ORDER BY r.country_iso2`
  );
  return rows.map((row) => ({
    ...row,
    forecast: Array.isArray(row.forecast) ? row.forecast as DailyForecast[] : [],
    air_quality: row.air_quality && typeof row.air_quality === "object" ? row.air_quality as AirQuality : null,
  }));
}

export async function getCountryWeatherForecast(countryIso2: string, hours = 48): Promise<WeatherForecastDetail | null> {
  const country = countryIso2.trim().toUpperCase();
  const hourLimit = Math.min(Math.max(Math.trunc(hours), 1), 168);
  const [hourly, daily, air] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT forecast_time, temp_c, apparent_temp_c, humidity, precipitation_probability,
              precipitation_mm, rain_mm, snowfall_cm, weather_code, wind_speed, wind_gust,
              uv_index, visibility_m
       FROM weather_forecast wf JOIN source s ON s.id = wf.source_id
       WHERE wf.country_iso2 = $1 AND wf.granularity = 'hourly' AND wf.forecast_time >= now() - interval '1 hour'
       ORDER BY CASE s.name WHEN 'openmeteo' THEN 0 ELSE 1 END, wf.forecast_time LIMIT $2`,
      [country, hourLimit]
    ),
    query<DailyForecast>(
      `SELECT wf.forecast_time, wf.temp_min_c, wf.temp_max_c, wf.apparent_temp_min_c,
              wf.apparent_temp_max_c, wf.precipitation_probability, wf.precipitation_mm,
              wf.weather_code, NULL::text AS weather_main, wf.wind_speed, wf.wind_gust,
              wf.uv_index, wf.sunrise_at, wf.sunset_at
       FROM weather_forecast wf JOIN source s ON s.id = wf.source_id
       WHERE wf.country_iso2 = $1 AND wf.granularity = 'daily'
         AND wf.forecast_time >= date_trunc('day', now())
       ORDER BY CASE s.name WHEN 'openmeteo' THEN 0 ELSE 1 END, wf.forecast_time LIMIT 16`, [country]
    ),
    query<AirQuality & { source_name: string }>(
      `SELECT a.observed_at, a.european_aqi, a.us_aqi, a.pm10, a.pm2_5,
              a.carbon_monoxide, a.nitrogen_dioxide, a.sulphur_dioxide, a.ozone,
              s.name AS source_name, ''::text AS label
       FROM air_quality_snapshot a JOIN source s ON s.id = a.source_id
       WHERE a.country_iso2 = $1 ORDER BY a.observed_at DESC LIMIT 1`, [country]
    ),
  ]);
  if (hourly.rows.length === 0 && daily.rows.length === 0) return null;
  const airRow = air.rows[0] ? { ...air.rows[0], label: airQualityLabel(air.rows[0].european_aqi) } : null;
  return {
    country, generated_at: new Date().toISOString(), source_name: "openmeteo",
    attribution: ATTRIBUTION, hourly: hourly.rows,
    daily: daily.rows.map((row) => ({ ...row, weather_main: weatherDescription(row.weather_code).main })),
    air_quality: airRow,
  };
}

export async function getHistoricalWeather(
  countryIso2: string,
  startDate: string,
  endDate: string,
): Promise<HistoricalWeatherDetail | null> {
  const start = parseDateOnly(startDate, "start_date");
  const end = parseDateOnly(endDate, "end_date");
  if (start > end) throw new Error("start_date must not be after end_date.");
  const target = (await weatherTargets(countryIso2))[0];
  if (!target) return null;
  const url = new URL(`${archiveBase()}/v1/archive`);
  addCoordinates(url, [target]);
  url.searchParams.set("start_date", start);
  url.searchParams.set("end_date", end);
  url.searchParams.set("daily", [
    "weather_code", "temperature_2m_max", "temperature_2m_min", "temperature_2m_mean",
    "apparent_temperature_max", "apparent_temperature_min", "precipitation_sum",
    "rain_sum", "snowfall_sum", "wind_speed_10m_max", "wind_gusts_10m_max",
  ].join(","));
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timezone", "UTC");
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Open-Meteo archive HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json() as OpenMeteoForecastResponse;
  return { country: target.iso2, start_date: start, end_date: end, source_name: "openmeteo", attribution: ATTRIBUTION, daily: recordsFromColumns(data.daily) };
}

export async function getMarineWeather(countryIso2: string, hours = 48): Promise<MarineWeatherDetail | null> {
  const target = (await weatherTargets(countryIso2))[0];
  if (!target) return null;
  const url = new URL(`${marineBase()}/v1/marine`);
  addCoordinates(url, [target]);
  url.searchParams.set("current", [
    "wave_height", "wave_direction", "wave_period", "wind_wave_height",
    "wind_wave_direction", "wind_wave_period", "swell_wave_height",
    "swell_wave_direction", "swell_wave_period", "sea_surface_temperature",
  ].join(","));
  url.searchParams.set("hourly", [
    "wave_height", "wave_direction", "wave_period", "wind_wave_height",
    "swell_wave_height", "swell_wave_direction", "swell_wave_period", "sea_surface_temperature",
  ].join(","));
  url.searchParams.set("forecast_hours", String(Math.min(Math.max(Math.trunc(hours), 1), 168)));
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("cell_selection", "sea");
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Open-Meteo marine HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json() as OpenMeteoForecastResponse;
  return {
    country: target.iso2,
    source_name: "openmeteo",
    attribution: ATTRIBUTION,
    current: data.current ?? {},
    hourly: recordsFromColumns(data.hourly),
  };
}
