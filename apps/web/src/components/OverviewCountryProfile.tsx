import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { fetchCountryLeadership, fetchCountryMarketDetail, fetchCountryWeather,
  type CountryLeadership, type CountryMarketDetail, type CountryWeather, type IntelligenceOverview } from "../lib/api";
import { readWithDeadline } from "../lib/readDeadline";
import CountryFlag from "./CountryFlag";
import CountryFacts from "./CountryFacts";

// Opened country context is optional work. Reuse the shared lists across taps
// without adding any work to startup. Each selected-country resource publishes
// independently, so one slow provider cannot hold the entire profile hostage.
const reference: { leadership?: { at: number; value: CountryLeadership[] }; weather?: { at: number; value: CountryWeather[] } } = {};
export default function OverviewCountryProfile({ country, overview, onClose }: {
  country: string; overview: IntelligenceOverview | null; onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [state, setState] = useState<{ country: string; leadership?: CountryLeadership; weather?: CountryWeather; market?: CountryMarketDetail; loading: boolean; error: boolean }>({ country, loading: true, error: false });
  useEffect(() => {
    const controller = new AbortController();
    const active = () => !controller.signal.aborted;
    panel.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    panel.current?.focus({ preventScroll: true });
    setState({ country, loading: true, error: false });
    const update = (patch: Partial<{ leadership: CountryLeadership; weather: CountryWeather; market: CountryMarketDetail; loading: boolean; error: boolean }>) => {
      if (active()) setState((current) => current.country === country ? { ...current, ...patch } : current);
    };
    const leadership = reference.leadership && Date.now() - reference.leadership.at < 600_000
      ? Promise.resolve(reference.leadership.value)
      : readWithDeadline(fetchCountryLeadership, controller.signal, 8_000).then((value) => {
          if (active()) reference.leadership = { at: Date.now(), value }; return value;
        });
    const weather = reference.weather && Date.now() - reference.weather.at < 600_000
      ? Promise.resolve(reference.weather.value)
      : readWithDeadline(fetchCountryWeather, controller.signal, 8_000).then((value) => {
          if (active()) reference.weather = { at: Date.now(), value }; return value;
        });
    void Promise.allSettled([
      leadership.then((items) => update({ leadership: items.find((item) => item.country === country) })),
      weather.then((items) => update({ weather: items.find((item) => item.country === country) })),
      readWithDeadline((signal) => fetchCountryMarketDetail(country, signal), controller.signal, 8_000)
        .then((market) => update({ market })),
    ]).then((results) => update({ loading: false, error: results.some((result) => result.status === "rejected") }));
    return () => controller.abort();
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
