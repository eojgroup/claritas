import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw, TrendingUp } from "lucide-react";
import {
  fetchCountryMarketDetail, fetchCountryMarketOverview, fetchMarketQuotes,
  type CountryMarketDetail, type CountryMarketOverviewResponse,
  type IntelligenceEvent, type MarketQuote,
} from "../lib/api";
import { readWithDeadline } from "../lib/readDeadline";
import CountryFlag from "./CountryFlag";
import CountryMarketHistory from "./CountryMarketHistory";

const cache: { overview?: { at: number; value: CountryMarketOverviewResponse }; quotes?: { at: number; value: MarketQuote[] } } = {};
const countryCache = new Map<string, { at: number; value: CountryMarketDetail }>();
const fresh = (at: number) => Date.now() - at < 600_000;
const percent = (value: number | null | undefined) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
const name = (country: string) => new Intl.DisplayNames(undefined, { type: "region" }).of(country) || country;
type Metric = "index" | "fx" | "economy";

/** A retained-data lens on the existing World scope; no provider refreshes. */
export default function MarketScopeContext({ country, expanded = false, onToggle, onSelectCountry, events = [], relatedEventIds = [], onOpenEvent }: {
  country?: string | null; expanded?: boolean; onToggle?: () => void;
  onSelectCountry?: (country: string) => void; events?: IntelligenceEvent[]; relatedEventIds?: string[]; onOpenEvent?: (id: string) => void;
}) {
  const iso = country?.toUpperCase() || null;
  const [overview, setOverview] = useState<CountryMarketOverviewResponse | null>(cache.overview?.value ?? null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [countryDetail, setDetail] = useState<CountryMarketDetail | null>(null);
  const detail = countryDetail?.summary.country === iso ? countryDetail : null;
  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [metric, setMetric] = useState<Metric>("index");
  const [countryLimit, setCountryLimit] = useState(24);
  const [instrumentLimit, setInstrumentLimit] = useState(24);
  useEffect(() => { setQuery(""); }, [iso]);
  useEffect(() => { setCountryLimit(24); setInstrumentLimit(24); }, [query, metric, iso]);

  useEffect(() => {
    const controller = new AbortController();
    setSummaryFailed(false);
    const read = cache.overview && fresh(cache.overview.at) ? Promise.resolve(cache.overview.value)
      : readWithDeadline(fetchCountryMarketOverview, controller.signal, 8_000);
    void read.then((value) => {
      if (controller.signal.aborted) return;
      cache.overview = { at: Date.now(), value }; setOverview(value);
    }).catch(() => { if (!controller.signal.aborted) setSummaryFailed(true); });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    setDetail(null); setQuotes([]); setDetailFailed(false); setLoadingDetails(false);
    if (!expanded) return;
    const controller = new AbortController();
    setLoadingDetails(true);
    const saved = iso ? countryCache.get(iso) : cache.quotes;
    const read = saved && fresh(saved.at) ? Promise.resolve(saved.value)
      : iso ? readWithDeadline((signal) => fetchCountryMarketDetail(iso, signal), controller.signal, 8_000)
        : readWithDeadline((signal) => fetchMarketQuotes({ refresh: false, signal }), controller.signal, 8_000);
    void read.then((value) => {
      if (controller.signal.aborted) return;
      if (iso) { const next = value as CountryMarketDetail; countryCache.set(iso, { at: Date.now(), value: next }); setDetail(next); }
      else { const next = value as MarketQuote[]; cache.quotes = { at: Date.now(), value: next }; setQuotes(next); }
      setLoadingDetails(false);
    }).catch(() => { if (!controller.signal.aborted) { setDetailFailed(true); setLoadingDetails(false); } });
    return () => controller.abort();
  }, [iso, expanded, retry]);

  const countries = overview?.countries ?? [];
  const selected = iso ? countries.find((row) => row.country === iso) : null;
  const glance = (iso ? countries.filter((row) => row.country === iso) : countries
    .filter((row) => row.index_change_percent != null || row.fx_change_percent != null)
    .sort((a, b) => Number(b.freshness === "current") - Number(a.freshness === "current")
      || Math.abs(b.index_change_percent ?? b.fx_change_percent ?? 0) - Math.abs(a.index_change_percent ?? a.fx_change_percent ?? 0))).slice(0, 3);
  const filteredCountries = countries.filter((row) => !query || `${row.country_name} ${row.country} ${row.index_name ?? ""} ${row.currency ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .filter((row) => metric === "index" ? row.index_value != null : metric === "fx" ? row.fx_rate != null : row.macro_latest_year != null)
    .sort((a, b) => metric === "economy" ? (b.gdp_growth ?? -Infinity) - (a.gdp_growth ?? -Infinity)
      : Math.abs(metric === "index" ? b.index_change_percent ?? 0 : b.fx_change_percent ?? 0) - Math.abs(metric === "index" ? a.index_change_percent ?? 0 : a.fx_change_percent ?? 0));
  const instruments = (detail?.related_instruments ?? (iso ? [] : quotes)).filter((quote) => !query || `${quote.symbol} ${quote.company_name ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const relatedIds = new Set(relatedEventIds);
  // Explicit IDs already come from the server's topic/country scope, including secondary or unresolved locations.
  const marketEvents = events.filter((event) => relatedIds.has(event.id)
    || ((!iso || event.primary_country_iso2 === iso) && (event.origin_domain === "market" || event.signal_domains?.includes("market")))).slice(0, 5);
  const refresh = () => { cache.overview = undefined; cache.quotes = undefined; if (iso) countryCache.delete(iso); setRetry((value) => value + 1); };

  return <section className="scope-market-context" aria-label={iso ? `Markets in ${name(iso)}` : "World markets"}>
    <header className="scope-context-heading"><h3><TrendingUp size={17} aria-hidden="true" />{iso ? `${name(iso)} · markets & economy` : "Markets at a glance"}</h3>
      {onToggle && <button type="button" onClick={onToggle} aria-expanded={expanded}>{expanded ? "Close market explorer" : "Explore markets"}{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>}
    </header>
    {!overview && !summaryFailed && <p role="status">Loading saved market overview…</p>}
    {summaryFailed && <p>Market overview could not be loaded. <button type="button" onClick={refresh}>Retry markets</button></p>}
    {overview && <>
      <div className="scope-market-glance">{glance.map((row) => <button key={row.country} type="button" onClick={() => onSelectCountry?.(row.country)} disabled={!onSelectCountry}>
        <span><CountryFlag country={row.country} />{row.country_name}</span>
        {row.index_value != null && <span><strong>{percent(row.index_change_percent)}</strong> {row.index_name || "National benchmark"}<small>{row.index_frequency || "Saved period"} · {row.index_period_end} · {row.index_source}</small></span>}
        {row.fx_rate != null && <span><strong>{percent(row.fx_change_percent)}</strong> {row.currency} vs EUR<small>{row.fx_period_end} · ECB</small></span>}
        {row.index_value == null && row.fx_rate == null && <span>Economic indicators available</span>}
      </button>)}</div>
      {!glance.length && <p>No saved benchmark or currency sample in this scope. Economic context remains available in the explorer.</p>}
      <p className="scope-context-note">{iso ? selected?.freshness === "stale" ? "Some saved market samples are stale. " : "" : `${overview.coverage.with_index} country benchmarks · ${overview.coverage.with_fx} currencies. `}Changes use each source’s stated period; these are not live quotes.</p>
    </>}
    {expanded && <div className="scope-market-explorer">
      <div className="scope-context-controls"><label>Find countries or instruments<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button type="button" onClick={refresh} aria-label="Reload saved market data"><RefreshCw size={16} />Reload saved data</button></div>
      {!iso && <>
        <div role="group" aria-label="Market data type" className="scope-context-controls">{([['index', 'Benchmarks'], ['fx', 'Currencies'], ['economy', 'Economy']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)}>{label}</button>)}</div>
        <div className="scope-context-table"><table><caption>{metric === "index" ? "Saved national benchmarks" : metric === "fx" ? "Currency rates against EUR" : "Annual economic indicators"}</caption><thead><tr><th>Country</th><th>{metric === "economy" ? "GDP growth" : "Latest level"}</th><th>{metric === "economy" ? "Inflation" : "Change"}</th><th>Period / source</th></tr></thead><tbody>
          {filteredCountries.slice(0, countryLimit).map((row) => <tr key={row.country}><th><button type="button" onClick={() => onSelectCountry?.(row.country)} disabled={!onSelectCountry}><CountryFlag country={row.country} />{row.country_name}</button></th>
            <td>{metric === "economy" ? `${percent(row.gdp_growth)} · ${row.gdp_year ?? "—"}` : number(metric === "index" ? row.index_value : row.fx_rate)}{metric === "fx" ? ` ${row.currency}` : ""}</td>
            <td>{metric === "economy" ? `${percent(row.inflation)} · ${row.inflation_year ?? "—"}` : percent(metric === "index" ? row.index_change_percent : row.fx_change_percent)}</td>
            <td>{metric === "index" ? `${row.index_name || "Benchmark"} · ${row.index_frequency || "Saved period"} · ${row.index_period_end} · ${row.index_source}` : metric === "fx" ? `${row.fx_period_end} · ECB` : row.macro_source || "World Bank"}</td></tr>)}
        </tbody></table></div>
        {filteredCountries.length > countryLimit && <button type="button" onClick={() => setCountryLimit((value) => value + 24)}>Show more countries · {filteredCountries.length - countryLimit} remaining</button>}
      </>}
      {loadingDetails && <p role="status">Loading saved {iso ? "country history" : "instruments"}…</p>}
      {detailFailed && <p>Some market details could not be loaded. <button type="button" onClick={refresh}>Retry market details</button></p>}
      {detail && <>
        <CountryMarketHistory label={detail.summary.index_name || "National benchmark"} points={detail.index_history} />
        <CountryMarketHistory label={`${detail.summary.currency || "Currency"} vs EUR`} points={detail.fx_history} />
        <dl className="scope-context-metrics"><div><dt>GDP growth · {detail.summary.gdp_year}</dt><dd>{percent(detail.summary.gdp_growth)}</dd></div><div><dt>Inflation · {detail.summary.inflation_year}</dt><dd>{percent(detail.summary.inflation)}</dd></div><div><dt>Unemployment · {detail.summary.unemployment_year}</dt><dd>{percent(detail.summary.unemployment)}</dd></div><div><dt>Current account · {detail.summary.current_account_year}</dt><dd>{percent(detail.summary.current_account)} GDP</dd></div></dl>
      </>}
      {instruments.length > 0 && <details open><summary>Market instruments · {instruments.length}</summary><div className="scope-context-table"><table><thead><tr><th>Instrument</th><th>Latest value</th><th>Change</th><th>Period / source</th></tr></thead><tbody>{instruments.slice(0, instrumentLimit).map((quote) => <tr key={quote.symbol}><th>{quote.company_name || quote.symbol}<small>{quote.symbol}</small></th><td>{number(quote.price)} {quote.currency || quote.unit}</td><td>{percent(quote.percent_change)}</td><td>{quote.period_end || quote.observed_at.slice(0, 10)} · {quote.frequency || "Saved observation"} · {quote.source_name}</td></tr>)}</tbody></table></div>{instruments.length > instrumentLimit && <button type="button" onClick={() => setInstrumentLimit((value) => value + 24)}>Show more instruments · {instruments.length - instrumentLimit} remaining</button>}</details>}
      {detail && detail.filings.length > 0 && <details><summary>Company filings · {detail.filings.length}</summary>{detail.filings.map((filing) => <article key={filing.id}><p>{filing.url ? <a href={filing.url} target="_blank" rel="noreferrer">{filing.title}</a> : filing.title}</p><small>{filing.company_name || filing.symbol} · {filing.event_time.slice(0, 10)} · {filing.source_name}</small></article>)}</details>}
      {marketEvents.length > 0 && <div className="scope-context-reporting"><h4>Related market developments</h4>{marketEvents.map((event) => <button type="button" key={event.id} onClick={() => onOpenEvent?.(event.id)} disabled={!onOpenEvent}>{event.title}<small>{event.location_name || event.primary_country_iso2 || "Global"} · {new Date(event.last_activity_time).toLocaleString()}</small></button>)}</div>}
      <p className="scope-context-note">{detail?.methodology?.macro || overview?.methodology.macro} Source periods and coverage differ. Reporting adds context and does not establish why a price changed.</p>
    </div>}
  </section>;
}
