import type { EventWeatherVisual as Weather } from "../lib/api";

export default function EventWeatherVisual({ weather }: { weather: Weather }) {
  const points = weather.forecast.filter((point) => Number.isFinite(point.temp_c) && Number.isFinite(Date.parse(point.forecast_time))).sort((a, b) => Date.parse(a.forecast_time) - Date.parse(b.forecast_time));
  const minimum = Math.min(...points.map((point) => point.temp_c));
  const maximum = Math.max(...points.map((point) => point.temp_c));
  const line = points.map((point) => `${20 + (Date.parse(point.forecast_time) - Date.parse(points[0].forecast_time)) / Math.max(1, Date.parse(points[points.length - 1].forecast_time) - Date.parse(points[0].forecast_time)) * 320},${80 - (point.temp_c - minimum) / Math.max(1, maximum - minimum) * 60}`).join(" ");
  return <figure className="event-weather-visual">
    <figcaption><strong>Weather · {weather.location_name}</strong><span>{weather.scope_label}</span></figcaption>
    <div className="event-weather-metrics">
      {weather.temp_c != null && <div><strong>{weather.temp_c.toLocaleString()}°C</strong><span>{weather.weather_desc || "Temperature"}</span></div>}
      {weather.precipitation_mm != null && <div><strong>{weather.precipitation_mm.toLocaleString()} mm</strong><span>Precipitation</span></div>}
      {weather.wind_speed != null && <div><strong>{weather.wind_speed.toLocaleString()} m/s</strong><span>Wind{weather.wind_gust != null ? ` · gusts ${weather.wind_gust} m/s` : ""}</span></div>}
      {weather.wind_direction != null && <div><svg viewBox="0 0 48 48" width="48" height="48" role="img" aria-label={`Wind from ${weather.wind_direction} degrees`}><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" opacity=".3"/><path d="M24 8L18 22H23V37H25V22H30Z" fill="currentColor" transform={`rotate(${weather.wind_direction} 24 24)`}/></svg><span>Wind from {weather.wind_direction}°</span></div>}
    </div>
    {points.length >= 2 && <div className="event-weather-forecast"><strong>Temperature forecast</strong><svg viewBox="0 0 360 100" role="img" aria-label={`Temperature forecast from ${minimum} to ${maximum} degrees Celsius`}><line x1="20" y1="90" x2="340" y2="90" stroke="currentColor" opacity=".2"/><polyline points={line} fill="none" stroke="var(--shell-accent)" strokeWidth="3" strokeLinejoin="round"/></svg><div><span>{new Date(points[0].forecast_time).toLocaleString()}</span><span>{new Date(points[points.length - 1].forecast_time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span></div><small>{minimum}–{maximum}°C · Forecast, not observed history</small></div>}
    <p>{weather.source_kind?.includes("model") ? "Modelled reference" : "Reference sample"} · {new Date(weather.observed_at).toLocaleString()} · {weather.attribution}</p>
    <details><summary>Scope & source</summary><p>{weather.notice}</p></details>
  </figure>;
}
