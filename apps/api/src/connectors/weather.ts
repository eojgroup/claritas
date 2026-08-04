import { query } from "../db";

export type DailyForecast = {
  forecast_time: string; temp_min_c: number | null; temp_max_c: number | null;
  apparent_temp_min_c: number | null; apparent_temp_max_c: number | null;
  precipitation_probability: number | null; precipitation_mm: number | null;
  weather_code: number | null; weather_main: string | null; wind_speed: number | null;
  wind_gust: number | null; uv_index: number | null; sunrise_at: string | null; sunset_at: string | null;
};

export type AirQuality = {
  observed_at: string; european_aqi: number | null; us_aqi: number | null;
  provider_aqi: number | null; aqi_scale: string | null; pm10: number | null;
  pm2_5: number | null; carbon_monoxide: number | null; nitrogen_dioxide: number | null;
  sulphur_dioxide: number | null; ozone: number | null; label: string;
};

export type WeatherAlert = {
  country: string;
  source_name: string; sender_name: string; event: string; severity: string | null;
  urgency: string | null; starts_at: string; ends_at: string | null; headline: string | null;
  description: string | null; instruction: string | null; area: string | null;
};

export type EnhancedCountryWeather = {
  country: string; temp_c: number | null; apparent_temp_c: number | null; humidity: number | null;
  pressure_hpa: number | null; visibility_m: number | null; location_name: string | null;
  precipitation_mm: number | null; observed_at: string; weather_main: string | null;
  weather_desc: string | null; weather_code: number | null; cloud_cover: number | null;
  wind_speed: number | null; wind_direction: number | null; wind_gust: number | null;
  is_day: boolean | null; source_name: string | null; source_kind: string | null;
  attribution: string | null; icon_code: string | null; forecast: DailyForecast[];
  air_quality: AirQuality | null; alerts: WeatherAlert[]; alert_count: number;
};

export type WeatherForecastDetail = {
  country: string; generated_at: string; source_name: string; attribution: string;
  hourly: Array<Record<string, unknown>>; daily: DailyForecast[];
  air_quality: AirQuality | null; alerts: WeatherAlert[];
};

function weatherMain(code: number | null): string | null {
  if (code == null) return null;
  if (code >= 200 && code < 300) return "Thunderstorm";
  if (code >= 300 && code < 400) return "Drizzle";
  if (code >= 500 && code < 600) return "Rain";
  if (code >= 600 && code < 700) return "Snow";
  if (code >= 700 && code < 800) return "Atmosphere";
  if (code === 800) return "Clear";
  if (code > 800) return "Clouds";
  return null;
}

function airLabel(value: number | null, scale?: string | null): string {
  if (value == null) return "Unknown";
  if (scale?.toLowerCase().startsWith("openweather")) {
    return ["Unknown", "Good", "Fair", "Moderate", "Poor", "Very poor"][Math.trunc(value)] ?? "Unknown";
  }
  if (value <= 25) return "Good";
  if (value <= 50) return "Fair";
  if (value <= 75) return "Moderate";
  if (value <= 100) return "Poor";
  return "Very poor";
}

export async function getCountryWeatherLatest(): Promise<EnhancedCountryWeather[]> {
  const { rows } = await query<EnhancedCountryWeather>(
    `WITH ranked AS (
       SELECT ws.*, s.name AS source_name, s.metadata,
              row_number() OVER (PARTITION BY ws.country_iso2 ORDER BY ws.observed_at DESC) AS source_rank
       FROM weather_snapshot ws JOIN source s ON s.id=ws.source_id
       WHERE COALESCE(s.metadata->>'retired','false') <> 'true'
     )
     SELECT upper(r.country_iso2::text) AS country, r.temp_c, r.apparent_temp_c, r.humidity,
       r.pressure AS pressure_hpa,
       CASE WHEN (r.payload->'current'->>'visibility') ~ '^[0-9]+(\\.[0-9]+)?$'
            THEN (r.payload->'current'->>'visibility')::double precision ELSE NULL END AS visibility_m,
       COALESCE(r.payload->>'location_name', r.payload->>'timezone') AS location_name,
       r.precipitation_mm, r.observed_at, r.weather_main, r.weather_desc, r.weather_code,
       r.cloud_cover, r.wind_speed, r.wind_direction, r.wind_gust, r.is_day,
       r.source_name, r.source_kind, r.metadata->>'attribution' AS attribution,
       r.payload->'current'->'weather'->0->>'icon' AS icon_code,
       COALESCE(f.forecast,'[]'::jsonb) AS forecast, aq.air_quality,
       COALESCE(wa.alerts,'[]'::jsonb) AS alerts, COALESCE(wa.alert_count,0)::int AS alert_count
     FROM ranked r
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(to_jsonb(x) ORDER BY x.forecast_time) AS forecast FROM (
         SELECT wf.forecast_time,wf.temp_min_c,wf.temp_max_c,wf.apparent_temp_min_c,
           wf.apparent_temp_max_c,wf.precipitation_probability,wf.precipitation_mm,wf.weather_code,
           NULL::text AS weather_main,wf.wind_speed,wf.wind_gust,wf.uv_index,wf.sunrise_at,wf.sunset_at
         FROM weather_forecast wf WHERE wf.source_id=r.source_id AND wf.country_iso2=r.country_iso2
           AND wf.granularity='daily' AND wf.forecast_time >= date_trunc('day',now())
         ORDER BY wf.forecast_time LIMIT 8
       ) x
     ) f ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_build_object('observed_at',a.observed_at,'european_aqi',a.european_aqi,
         'us_aqi',a.us_aqi,'provider_aqi',a.provider_aqi,'aqi_scale',a.aqi_scale,
         'pm10',a.pm10,'pm2_5',a.pm2_5,'carbon_monoxide',a.carbon_monoxide,
         'nitrogen_dioxide',a.nitrogen_dioxide,'sulphur_dioxide',a.sulphur_dioxide,'ozone',a.ozone,'label','') AS air_quality
       FROM air_quality_snapshot a WHERE a.country_iso2=r.country_iso2 ORDER BY a.observed_at DESC LIMIT 1
     ) aq ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(to_jsonb(x) ORDER BY x.starts_at) AS alerts, count(*) AS alert_count FROM (
         SELECT upper(w.country_iso2::text) AS country,s.name AS source_name,w.sender_name,w.event,w.severity,w.urgency,w.starts_at,w.ends_at,
           w.headline,w.description,w.instruction,w.area
         FROM weather_alert w JOIN source s ON s.id=w.source_id
         WHERE w.country_iso2=r.country_iso2 AND COALESCE(w.ends_at,now()+interval '1 day') >= now()
         ORDER BY CASE w.severity WHEN 'Extreme' THEN 0 WHEN 'Severe' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END,w.starts_at
         LIMIT 20
       ) x
     ) wa ON true
     WHERE r.source_rank=1 ORDER BY r.country_iso2`
  );
  return rows.map((row) => ({
    ...row,
    forecast: (Array.isArray(row.forecast) ? row.forecast : []).map((forecast) => ({ ...forecast, weather_main: weatherMain(forecast.weather_code) })),
    air_quality: row.air_quality ? {
      ...row.air_quality,
      label: airLabel(
        row.air_quality.provider_aqi ?? row.air_quality.european_aqi ?? row.air_quality.us_aqi,
        row.air_quality.aqi_scale,
      ),
    } : null,
    alerts: Array.isArray(row.alerts) ? row.alerts : [], alert_count: Number(row.alert_count ?? 0),
  }));
}

export async function getCountryWeatherForecast(countryIso2: string, hours=48): Promise<WeatherForecastDetail | null> {
  const country = countryIso2.trim().toUpperCase();
  const source = await query<{ source_id: number; source_name: string; attribution: string | null }>(
    `SELECT ws.source_id,s.name AS source_name,s.metadata->>'attribution' AS attribution
     FROM weather_snapshot ws JOIN source s ON s.id=ws.source_id
     WHERE upper(ws.country_iso2::text)=$1 AND COALESCE(s.metadata->>'retired','false') <> 'true'
     ORDER BY ws.observed_at DESC LIMIT 1`, [country]
  );
  const preferred = source.rows[0];
  if (!preferred) return null;
  const [hourly,daily,air,alerts] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT forecast_time,temp_c,apparent_temp_c,humidity,precipitation_probability,precipitation_mm,
        rain_mm,snowfall_cm,weather_code,wind_speed,wind_gust,uv_index,visibility_m
       FROM weather_forecast WHERE source_id=$1 AND upper(country_iso2::text)=$2 AND granularity='hourly'
         AND forecast_time >= now()-interval '1 hour' ORDER BY forecast_time LIMIT $3`,
      [preferred.source_id,country,Math.min(Math.max(Math.trunc(hours),1),168)]
    ),
    query<DailyForecast>(
      `SELECT forecast_time,temp_min_c,temp_max_c,apparent_temp_min_c,apparent_temp_max_c,
        precipitation_probability,precipitation_mm,weather_code,NULL::text AS weather_main,
        wind_speed,wind_gust,uv_index,sunrise_at,sunset_at
       FROM weather_forecast WHERE source_id=$1 AND upper(country_iso2::text)=$2 AND granularity='daily'
         AND forecast_time >= date_trunc('day',now()) ORDER BY forecast_time LIMIT 8`, [preferred.source_id,country]
    ),
    query<AirQuality>(
      `SELECT observed_at,european_aqi,us_aqi,provider_aqi,aqi_scale,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,
        sulphur_dioxide,ozone,''::text AS label FROM air_quality_snapshot
       WHERE upper(country_iso2::text)=$1 ORDER BY observed_at DESC LIMIT 1`, [country]
    ),
    query<WeatherAlert>(
      `SELECT upper(w.country_iso2::text) AS country,s.name AS source_name,w.sender_name,w.event,w.severity,w.urgency,w.starts_at,w.ends_at,
        w.headline,w.description,w.instruction,w.area FROM weather_alert w JOIN source s ON s.id=w.source_id
       WHERE upper(w.country_iso2::text)=$1 AND COALESCE(w.ends_at,now()+interval '1 day') >= now()
       ORDER BY CASE w.severity WHEN 'Extreme' THEN 0 WHEN 'Severe' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END,w.starts_at`, [country]
    ),
  ]);
  const airRow = air.rows[0] ? {
    ...air.rows[0],
    label: airLabel(
      air.rows[0].provider_aqi ?? air.rows[0].european_aqi ?? air.rows[0].us_aqi,
      air.rows[0].aqi_scale,
    ),
  } : null;
  return { country,generated_at:new Date().toISOString(),source_name:preferred.source_name,
    attribution:preferred.attribution ?? preferred.source_name,hourly:hourly.rows,
    daily:daily.rows.map((row) => ({ ...row,weather_main:weatherMain(row.weather_code) })),air_quality:airRow,alerts:alerts.rows };
}
