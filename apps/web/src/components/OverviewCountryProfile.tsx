import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { fetchCountryLeadership, fetchCountryMarketDetail, fetchCountryWeather,
  type CountryLeadership, type CountryMarketDetail, type CountryWeather, type IntelligenceOverview } from "../lib/api";
import CountryFlag from "./CountryFlag";
import CountryFacts from "./CountryFacts";

// Opened country context is optional work. Reuse the shared lists across taps
// and load one resource at a time instead of restoring the startup fan-out.
let reference: { at: number; leadership: CountryLeadership[]; weather: CountryWeather[] } | null = null;
export default function OverviewCountryProfile({ country, overview, onClose }: {
  country: string; overview: IntelligenceOverview | null; onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [state, setState] = useState<{ country: string; leadership?: CountryLeadership; weather?: CountryWeather; market?: CountryMarketDetail; loading: boolean; error: boolean }>({ country, loading: true, error: false });
  useEffect(() => {
    let active = true;
    panel.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    panel.current?.focus({ preventScroll: true });
    setState({ country, loading: true, error: false });
    void (async () => {
      let failed = false;
      let refs = reference;
      if (!refs || Date.now() - refs.at > 600_000) {
        const leadership = await fetchCountryLeadership().catch(() => { failed = true; return []; });
        if (!active) return;
        const weather = await fetchCountryWeather().catch(() => { failed = true; return []; });
        refs = { at: Date.now(), leadership, weather };
        if (!failed) reference = refs;
      }
      if (!active) return;
      setState({ country, leadership: refs.leadership.find((item) => item.country === country), weather: refs.weather.find((item) => item.country === country), loading: true, error: failed });
      const market = await fetchCountryMarketDetail(country).catch(() => { failed = true; return undefined; });
      if (active) setState({ country, leadership: refs.leadership.find((item) => item.country === country), weather: refs.weather.find((item) => item.country === country), market, loading: false, error: failed });
    })();
    return () => { active = false; };
  }, [country]);
  const data = state.country === country ? state : null;
  const name = new Intl.DisplayNames(undefined, { type: "region" }).of(country) || country;
  const count = overview?.countries?.find((item) => item.country_iso2 === country);
  const market = data?.market?.summary;
  return <section ref={panel} tabIndex={-1} className="overview-country-profile" aria-label="Country profile" aria-busy={data?.loading ?? true}>
    <header><h3><CountryFlag country={country} />{name} <small>Country profile</small></h3><button type="button" onClick={onClose} aria-label="Close country profile"><X size={18} /></button></header>
    {count && <p>{count.event_count.toLocaleString()} developments · {count.high_priority_count} high priority in this period</p>}
    <dl className="overview-country-metrics">
      {data?.weather && <div><dt>Weather</dt><dd>{data.weather.temp_c != null ? `${Math.round(data.weather.temp_c)}°C · ` : ""}{data.weather.weather_desc || data.weather.weather_main}</dd></div>}
      {market?.index_change_percent != null && <div><dt>{market.index_name || "National benchmark"}</dt><dd>{market.index_change_percent.toFixed(2)}% <small>{market.index_period_end}</small></dd></div>}
      {market?.gdp_growth != null && <div><dt>GDP growth · {market.gdp_year}</dt><dd>{market.gdp_growth.toFixed(1)}%</dd></div>}
      {market?.inflation != null && <div><dt>Inflation · {market.inflation_year}</dt><dd>{market.inflation.toFixed(1)}%</dd></div>}
    </dl>
    {data?.leadership && <><p>{data.leadership.summary}</p><dl className="overview-country-metrics">{data.leadership.roles.map((role) => <div key={role.role_type}><dt>{role.role_type.replace(/_/g, " ")}</dt><dd><a href={role.source_url} target="_blank" rel="noreferrer">{role.person_name}</a></dd></div>)}</dl>
      <details><summary>Country facts & reference maps</summary><CountryFacts context={data.leadership.country_context} country={country} name={name} /></details></>}
    {data?.loading && <p role="status">Loading country context…</p>}
    {data?.error && !data.loading && <p>Some country context could not be loaded. Developments and map filters remain available.</p>}
  </section>;
}
