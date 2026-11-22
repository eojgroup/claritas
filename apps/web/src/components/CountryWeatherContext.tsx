import type { CountryWeather } from "../lib/api";
const number = (value: number | null | undefined, unit: string) => value == null ? "—" : `${Math.round(value)}${unit}`;
export default function CountryWeatherContext({ weather }: { weather: CountryWeather }) {
  return <section className="country-weather-context" aria-label="Country weather">
    <header><h4>Weather outlook</h4><span>{weather.location_name || weather.country} · reference location</span></header>
    <dl className="overview-country-metrics">
      <div><dt>Temperature / feels like</dt><dd>{number(weather.temp_c, "°C")} / {number(weather.apparent_temp_c, "°C")}</dd></div>
      {weather.wind_speed != null && <div><dt>Wind / gusts</dt><dd>{number(weather.wind_speed, " m/s")} / {number(weather.wind_gust, " m/s")}</dd></div>}
      {weather.precipitation_mm != null && <div><dt>Precipitation</dt><dd>{number(weather.precipitation_mm, " mm")}</dd></div>}
      {weather.air_quality && <div><dt>Air quality</dt><dd>{weather.air_quality.label}</dd></div>}
    </dl>
    {Boolean(weather.forecast?.length) && <div className="country-weather-forecast" aria-label="Daily forecast">{weather.forecast!.slice(0, 7).map((day) => <article key={day.forecast_time}>
      <time dateTime={day.forecast_time}>{new Date(day.forecast_time).toLocaleDateString([], { weekday: "short" })}</time>
      <strong>{number(day.temp_min_c, "°")}–{number(day.temp_max_c, "°")}</strong><span>{day.weather_main}</span>
      {day.precipitation_probability != null && <small>{Math.round(day.precipitation_probability)}% rain</small>}
    </article>)}</div>}
    {weather.alerts?.map((alert, index) => <details key={`${alert.event}-${index}`} className="country-weather-alert"><summary>{alert.event} · {alert.area || alert.sender_name}</summary><p>{alert.headline || alert.description}</p>{alert.instruction && <p>{alert.instruction}</p>}<small>{alert.sender_name} · {new Date(alert.starts_at).toLocaleString()}</small></details>)}
    <small>{weather.attribution || weather.source_name} {weather.observed_at && <>· Updated {new Date(weather.observed_at).toLocaleString()}</>}</small>
  </section>;
}
