"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCountryWeatherLatest = getCountryWeatherLatest;
exports.getCountryWeatherForecast = getCountryWeatherForecast;
const db_1 = require("../db");
function weatherMain(code) {
    if (code == null)
        return null;
    if (code >= 200 && code < 300)
        return "Thunderstorm";
    if (code >= 300 && code < 400)
        return "Drizzle";
    if (code >= 500 && code < 600)
        return "Rain";
    if (code >= 600 && code < 700)
        return "Snow";
    if (code >= 700 && code < 800)
        return "Atmosphere";
    if (code === 800)
        return "Clear";
    if (code > 800)
        return "Clouds";
    return null;
}
function airLabel(value, scale) {
    if (value == null)
        return "Unknown";
    if (scale?.toLowerCase().startsWith("openweather")) {
        return ["Unknown", "Good", "Fair", "Moderate", "Poor", "Very poor"][Math.trunc(value)] ?? "Unknown";
    }
    if (value <= 25)
        return "Good";
    if (value <= 50)
        return "Fair";
    if (value <= 75)
        return "Moderate";
    if (value <= 100)
        return "Poor";
    return "Very poor";
}
async function getCountryWeatherLatest() {
    const { rows } = await (0, db_1.query)(`WITH ranked AS (
       SELECT ws.*, s.name AS source_name, s.metadata,
              row_number() OVER (PARTITION BY ws.country_iso2 ORDER BY ws.observed_at DESC) AS source_rank
       FROM weather_snapshot ws JOIN source s ON s.id=ws.source_id
       WHERE COALESCE(s.metadata->>'retired','false') <> 'true'
     )
     SELECT upper(r.country_iso2::text) AS country, r.temp_c, r.apparent_temp_c, r.humidity,
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
         SELECT s.name AS source_name,w.sender_name,w.event,w.severity,w.urgency,w.starts_at,w.ends_at,
           w.headline,w.description,w.instruction,w.area
         FROM weather_alert w JOIN source s ON s.id=w.source_id
         WHERE w.country_iso2=r.country_iso2 AND COALESCE(w.ends_at,now()+interval '1 day') >= now()
         ORDER BY CASE w.severity WHEN 'Extreme' THEN 0 WHEN 'Severe' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END,w.starts_at
         LIMIT 20
       ) x
     ) wa ON true
     WHERE r.source_rank=1 ORDER BY r.country_iso2`);
    return rows.map((row) => ({
        ...row,
        forecast: (Array.isArray(row.forecast) ? row.forecast : []).map((forecast) => ({ ...forecast, weather_main: weatherMain(forecast.weather_code) })),
        air_quality: row.air_quality ? {
            ...row.air_quality,
            label: airLabel(row.air_quality.provider_aqi ?? row.air_quality.european_aqi ?? row.air_quality.us_aqi, row.air_quality.aqi_scale),
        } : null,
        alerts: Array.isArray(row.alerts) ? row.alerts : [], alert_count: Number(row.alert_count ?? 0),
    }));
}
async function getCountryWeatherForecast(countryIso2, hours = 48) {
    const country = countryIso2.trim().toUpperCase();
    const source = await (0, db_1.query)(`SELECT ws.source_id,s.name AS source_name,s.metadata->>'attribution' AS attribution
     FROM weather_snapshot ws JOIN source s ON s.id=ws.source_id
     WHERE upper(ws.country_iso2::text)=$1 AND COALESCE(s.metadata->>'retired','false') <> 'true'
     ORDER BY ws.observed_at DESC LIMIT 1`, [country]);
    const preferred = source.rows[0];
    if (!preferred)
        return null;
    const [hourly, daily, air, alerts] = await Promise.all([
        (0, db_1.query)(`SELECT forecast_time,temp_c,apparent_temp_c,humidity,precipitation_probability,precipitation_mm,
        rain_mm,snowfall_cm,weather_code,wind_speed,wind_gust,uv_index,visibility_m
       FROM weather_forecast WHERE source_id=$1 AND upper(country_iso2::text)=$2 AND granularity='hourly'
         AND forecast_time >= now()-interval '1 hour' ORDER BY forecast_time LIMIT $3`, [preferred.source_id, country, Math.min(Math.max(Math.trunc(hours), 1), 168)]),
        (0, db_1.query)(`SELECT forecast_time,temp_min_c,temp_max_c,apparent_temp_min_c,apparent_temp_max_c,
        precipitation_probability,precipitation_mm,weather_code,NULL::text AS weather_main,
        wind_speed,wind_gust,uv_index,sunrise_at,sunset_at
       FROM weather_forecast WHERE source_id=$1 AND upper(country_iso2::text)=$2 AND granularity='daily'
         AND forecast_time >= date_trunc('day',now()) ORDER BY forecast_time LIMIT 8`, [preferred.source_id, country]),
        (0, db_1.query)(`SELECT observed_at,european_aqi,us_aqi,provider_aqi,aqi_scale,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,
        sulphur_dioxide,ozone,''::text AS label FROM air_quality_snapshot
       WHERE upper(country_iso2::text)=$1 ORDER BY observed_at DESC LIMIT 1`, [country]),
        (0, db_1.query)(`SELECT s.name AS source_name,w.sender_name,w.event,w.severity,w.urgency,w.starts_at,w.ends_at,
        w.headline,w.description,w.instruction,w.area FROM weather_alert w JOIN source s ON s.id=w.source_id
       WHERE upper(w.country_iso2::text)=$1 AND COALESCE(w.ends_at,now()+interval '1 day') >= now()
       ORDER BY CASE w.severity WHEN 'Extreme' THEN 0 WHEN 'Severe' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END,w.starts_at`, [country]),
    ]);
    const airRow = air.rows[0] ? {
        ...air.rows[0],
        label: airLabel(air.rows[0].provider_aqi ?? air.rows[0].european_aqi ?? air.rows[0].us_aqi, air.rows[0].aqi_scale),
    } : null;
    return { country, generated_at: new Date().toISOString(), source_name: preferred.source_name,
        attribution: preferred.attribution ?? preferred.source_name, hourly: hourly.rows,
        daily: daily.rows.map((row) => ({ ...row, weather_main: weatherMain(row.weather_code) })), air_quality: airRow, alerts: alerts.rows };
}
