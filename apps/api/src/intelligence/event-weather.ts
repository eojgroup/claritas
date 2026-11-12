import { query } from "../db";

/** One retained reference sample, never represented as weather at the incident. */
export async function getEventWeather(input: { primary_country_iso2?: string | null; last_activity_time: string | Date | null },
  read: (sql: string, params: any[]) => Promise<{ rows: any[] }> = query) {
  if (!input.primary_country_iso2 || !input.last_activity_time) return null;
  const { rows } = await read(`SELECT snapshot.country_iso2 AS country,
    COALESCE(snapshot.payload->>'location_name',snapshot.payload->>'timezone',snapshot.country_iso2) AS location_name,
    snapshot.coord_lat AS latitude,snapshot.coord_lon AS longitude,snapshot.observed_at,
    snapshot.temp_c,snapshot.precipitation_mm,snapshot.wind_speed,snapshot.wind_direction,snapshot.wind_gust,
    snapshot.weather_desc,source.name AS source_name,snapshot.source_kind,
    COALESCE(source.metadata->>'attribution',source.name) AS attribution,
    COALESCE((SELECT jsonb_agg(to_jsonb(point) ORDER BY forecast_time) FROM (
      SELECT forecast_time,temp_c FROM weather_forecast
      WHERE source_id=snapshot.source_id AND country_iso2=snapshot.country_iso2 AND granularity='hourly'
        AND forecast_time>=snapshot.observed_at AND forecast_time<=snapshot.observed_at+interval '24 hours'
        AND updated_at>=snapshot.observed_at-interval '12 hours' AND temp_c IS NOT NULL
      ORDER BY forecast_time LIMIT 12) point),'[]'::jsonb) AS forecast
    FROM weather_snapshot snapshot JOIN source ON source.id=snapshot.source_id
    WHERE snapshot.country_iso2=$1 AND snapshot.observed_at BETWEEN $2::timestamptz-interval '6 hours' AND $2::timestamptz+interval '6 hours'
      AND COALESCE(source.metadata->>'retired','false')<>'true'
      AND (snapshot.temp_c IS NOT NULL OR snapshot.precipitation_mm IS NOT NULL OR snapshot.wind_speed IS NOT NULL)
    ORDER BY abs(extract(epoch FROM snapshot.observed_at-$2::timestamptz)),snapshot.id DESC LIMIT 1`,
    [input.primary_country_iso2, input.last_activity_time]);
  if (!rows[0]) return null;
  return { ...rows[0], scope_label: "Country reference location · not the event site",
    notice: "Reference conditions within six hours of the development update. The temperature line is a forecast, not observed event history. Shared timing does not establish an effect on this event." };
}
