import { lazy, Suspense, useMemo, useState } from "react";
import { FileText, Maximize2, X } from "lucide-react";
import type { DailySignalBriefing, IntelligenceEvent, IntelligenceOverview, OverviewTopic } from "../lib/api";
import SituationOverview from "./SituationOverview";
import WorldMapBubbles from "./WorldMapBubbles";
import { eventCoordinateContext, presentEvent } from "./eventPresentation";
import SatelliteImage from "./SatelliteImage";
import OverviewCountryProfile from "./OverviewCountryProfile";
import CountryFlag from "./CountryFlag";
import ModalSurface from "./ModalSurface";

const IntelligenceWorkspace = lazy(() => import("./IntelligenceWorkspace"));
type Props = {
  overview: IntelligenceOverview | null; loading: boolean; error: string | null;
  hours: 24 | 72 | 168; topic: OverviewTopic | null; priority: "high" | "all";
  country: string | null; selectedId: string | null; dark: boolean;
  briefing: DailySignalBriefing | null; briefingError: string | null;
  onHoursChange: (hours: 24 | 72 | 168) => void; onTopicChange: (topic: OverviewTopic | null) => void;
  onPriorityChange: (priority: "high" | "all") => void; onCountryChange: (country: string | null) => void;
  onSelect: (id: string | null) => void; onOpenImagery: (id?: string) => void;
  onRefresh: () => void; onRefreshBriefing: () => Promise<void>;
};

export default function SituationDashboard(props: Props) {
  const { overview, country, selectedId, onSelect } = props;
  const [selectedEvent, setSelectedEvent] = useState<IntelligenceEvent | null>(null);
  const [profileCountry, setProfileCountry] = useState<string | null>(null);
  const [expandedMap, setExpandedMap] = useState(false);
  const [mapMetric, setMapMetric] = useState<"activity" | "priority">("activity");
  const scopeMatches = overview?.window.hours === props.hours && (overview.filters.topic ?? null) === props.topic
    && (overview.filters.country ?? "").toUpperCase() === (country ?? "").toUpperCase()
    && (overview.filters.priority ?? props.priority) === props.priority;
  const events = useMemo(() => {
    if (!scopeMatches || !overview) return [];
    return overview.map_events ?? overview.events;
  }, [scopeMatches, overview]);
  const points = useMemo(() => (selectedEvent?.id === selectedId && !events.some((event) => event.id === selectedId) ? [...events, selectedEvent] : events).filter((event) => eventCoordinateContext(event)).map((event) => ({
    id: event.id, latitude: Number(event.latitude), longitude: Number(event.longitude),
    title: presentEvent(event).headline, subtitle: event.location_name || event.primary_country_iso2 || undefined,
    label: (event.location_name || event.primary_country_iso2 || "Mapped place").length > 18 ? `${(event.location_name || event.primary_country_iso2 || "").slice(0, 17)}…` : event.location_name || event.primary_country_iso2 || "Mapped place",
    severity: event.severity, selected: event.id === selectedId, hasImagery: event.earth_observation_available,
  })), [events, selectedId, selectedEvent]);
  const countries = useMemo(() => {
    if (scopeMatches && overview?.countries) return overview.countries.map((item) => ({ country: item.country_iso2,
      count: mapMetric === "priority" ? item.high_priority_count : item.event_count,
      meta: { subtitle: `${item.event_count.toLocaleString()} developments · ${item.high_priority_count} high priority` } }));
    const counts = new Map<string, number>();
    for (const event of events) if (event.primary_country_iso2) {
      const iso = event.primary_country_iso2.toUpperCase();
      counts.set(iso, (counts.get(iso) ?? 0) + 1);
    }
    return [...counts].map(([iso, count]) => ({ country: iso, count }));
  }, [events, overview, scopeMatches, mapMetric]);
  const visuals = scopeMatches ? (overview?.visual_events ?? overview?.events.filter((event) => event.imagery) ?? []) : [];
  const selectCountry = (iso: string) => { setExpandedMap(false); setProfileCountry(iso); onSelect(null); props.onCountryChange(iso); };
  const changeScope = <T,>(setter: (value: T) => void) => (value: T) => { onSelect(null); setter(value); };
  const leadingCountries = [...countries].sort((a, b) => b.count - a.count).filter((item) => item.count > 0).slice(0, 4);
  const map = (expanded = false) => <WorldMapBubbles variant={expanded ? "default" : "compact"} data={countries} points={points} primaryCountry={country}
    dark={props.dark} onSelect={selectCountry} fillMode="relevance" scale="log" featuredCountry={leadingCountries[0]?.country}
    featuredLabel={mapMetric === "priority" ? "Most high-priority activity" : "Most reported activity"}
    onSelectPoint={(point) => { setExpandedMap(false); onSelect(point.id); }} showBubbles={false} showLabels legend
    legendLabel={mapMetric === "priority" ? "High-priority developments" : "Developments in selected period"} />;
  return <div className="situation-dashboard workspace-page">
    <div id="world-event-stream" tabIndex={-1}>
      <SituationOverview variant="summary" {...props} selectedId={selectedId}
        onHoursChange={changeScope(props.onHoursChange)} onTopicChange={changeScope(props.onTopicChange)}
        onPriorityChange={changeScope(props.onPriorityChange)} onCountryChange={changeScope(props.onCountryChange)} />
    </div>
    <section className="situation-briefing app-card" aria-label="Daily briefing">
      <div className="situation-briefing-label"><FileText size={16} /><strong>Daily briefing</strong>{props.briefing?.published_at && <time dateTime={props.briefing.published_at}>{new Date(props.briefing.published_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>}</div>
      {props.briefing ? <>
        <h2>{props.briefing.title}</h2>
        {props.briefing.key_takeaways?.length ? <ul>{props.briefing.key_takeaways.slice(0, 3).map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
        {props.briefing.update_text && <details><summary>Read briefing</summary><p>{props.briefing.update_text}</p></details>}
      </> : <p>{props.briefingError ? "Briefing could not be loaded." : "No briefing published yet."}</p>}
      {props.briefingError && <button type="button" onClick={() => void props.onRefreshBriefing()}>Retry briefing</button>}
    </section>
    <div className="situation-workspace">
      <div className="situation-geography">
      <section className="situation-map app-card" aria-label="Development map">
        <header><div><span className="situation-eyebrow">Global signal map</span><h2>Where it’s happening</h2></div><span>{props.loading ? "Loading…" : overview?.snapshot?.status === "warming" ? "Preparing…" : `${countries.length} countries · ${points.length} located events`}</span></header>
        <div className="situation-map-tools"><label>Country shading<select aria-label="Country shading" value={mapMetric} onChange={(event) => setMapMetric(event.target.value as "activity" | "priority")}><option value="activity">All selected activity</option><option value="priority">High-priority activity</option></select></label><button type="button" onClick={() => setExpandedMap(true)}><Maximize2 size={15} />Expand map</button></div>
        <div className="situation-map-stage">
          {map()}
        </div>
        {leadingCountries.length > 0 && <div className="situation-country-pulse" aria-label="Leading country activity">{leadingCountries.map((item) => <button type="button" key={item.country} onClick={() => selectCountry(item.country)}><CountryFlag country={item.country} /><span>{new Intl.DisplayNames(undefined, { type: "region" }).of(item.country) || item.country}</span><strong>{item.count.toLocaleString()}</strong></button>)}</div>}
        <footer>Country shading covers the full period. Pins show located events; country-only reports stay in the heatmap.{country && <button type="button" onClick={() => { setProfileCountry(null); changeScope(props.onCountryChange)(null); }}>Clear {country} ×</button>}</footer>
      </section>
      {visuals.length > 0 && <section className="overview-visuals app-card" aria-label="Images from this period"><h3>Images & location context</h3><div>{visuals.map((event) => event.imagery && <button type="button" key={event.id} onClick={() => onSelect(event.id)}>
        <SatelliteImage sources={[event.imagery.preview_url]} alt={presentEvent(event).headline} className="overview-visual-image" />
        <strong>{presentEvent(event).headline}</strong><small>{event.imagery.source_kind === "publisher" ? "Publisher photo · capture unverified" : "Satellite context"} · {event.imagery.attribution}</small>
      </button>)}</div></section>}
      </div>
      <div className="situation-stream">
        <SituationOverview variant="history" {...props} selectedId={selectedId} />
        {profileCountry && !selectedId && <OverviewCountryProfile country={profileCountry} overview={overview} onClose={() => setProfileCountry(null)} />}
        {selectedId ? <section id="overview-event-context" tabIndex={-1} className="situation-detail app-card" aria-label="Selected development">
          <header><span>Event context</span><button type="button" onClick={() => onSelect(null)}><X size={16} />Back to developments</button></header>
          <Suspense fallback={<p role="status">Loading development…</p>}>
            <IntelligenceWorkspace embedded initialEventId={selectedId}
              refreshVersion={events.find((event) => event.id === selectedId)?.last_activity_time}
              onEventLoaded={setSelectedEvent} onSelectEvent={onSelect} onOpenImagery={props.onOpenImagery} />
          </Suspense>
        </section> : <SituationOverview variant="developments" {...props} selectedId={selectedId} />}
      </div>
    </div>
    {expandedMap && <ModalSurface label="Expanded development map" onClose={() => setExpandedMap(false)} className="situation-map-overlay" surfaceClassName="situation-expanded-map app-card">
      <header><h2>Global signal map</h2><button type="button" onClick={() => setExpandedMap(false)}><X size={18} />Close expanded map</button></header>
      <div>{map(true)}</div>
    </ModalSurface>}
  </div>;
}
