import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, FileText, Maximize2, X } from "lucide-react";
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
  const [panelStop, setPanelStop] = useState<"peek" | "half" | "full">("half");
  const panelDrag = useRef<{ y: number; stop: number } | null>(null);
  const suppressPanelClick = useRef(false);
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
    label: event.location_name ? (event.location_name.length > 18 ? `${event.location_name.slice(0, 17)}…` : event.location_name) : undefined,
    severity: event.severity, selected: event.id === selectedId, hasImagery: event.earth_observation_available || Boolean(event.imagery),
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
  const revealContext = () => setPanelStop((stop) => stop === "peek" ? "half" : stop);
  const selectEvent = (id: string | null) => { onSelect(id); if (id) { setProfileCountry(null); revealContext(); } };
  const selectCountry = (iso: string) => { setProfileCountry(iso); onSelect(null); props.onCountryChange(iso); revealContext(); };
  const changeScope = <T,>(setter: (value: T) => void) => (value: T) => { onSelect(null); setter(value); };
  const leadingCountries = [...countries].sort((a, b) => b.count - a.count).filter((item) => item.count > 0).slice(0, 4);
  const map = <WorldMapBubbles variant="default" data={countries} points={points} primaryCountry={country}
    dark={props.dark} onSelect={selectCountry} fillMode="relevance" scale="log" featuredCountry={leadingCountries[0]?.country} focusOnActivity
    featuredLabel={mapMetric === "priority" ? "Most high-priority activity" : "Most reported activity"}
    onSelectPoint={(point) => selectEvent(point.id)} showBubbles={false} showLabels legend
    legendLabel={mapMetric === "priority" ? "High-priority developments" : "Developments in selected period"} />;
  const stops = ["peek", "half", "full"] as const;
  const movePanel = (index: number) => setPanelStop(stops[Math.min(2, Math.max(0, index))]);
  const workspace = <div className={`situation-workspace situation-map-workspace panel-${panelStop}`}>
    <section className="situation-map-canvas" aria-label="Development map">
      {map}
      <div className="situation-map-heading"><span className="situation-eyebrow">Global signal map</span><h2>Where it’s happening</h2><span>{props.loading ? "Updating…" : overview?.snapshot?.status === "warming" ? "Preparing…" : `${countries.length} countries · ${points.length} located events`}</span></div>
      <div className="situation-map-actions">
        <button type="button" onClick={() => setExpandedMap(!expandedMap)} aria-label={expandedMap ? "Close expanded map" : "Expand map"}>{expandedMap ? <X size={18} /> : <Maximize2 size={18} />}</button>
      </div>
    </section>
    <aside className="situation-context-panel situation-stream" aria-label="Map context">
      <button type="button" className="situation-panel-handle" aria-label="Resize context panel" aria-controls="world-map-context" aria-expanded={panelStop !== "peek"}
        onClick={() => {
          if (suppressPanelClick.current) { suppressPanelClick.current = false; return; }
          movePanel((stops.indexOf(panelStop) + 1) % 3);
        }}
        onKeyDown={(event) => {
          if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            movePanel(event.key === "Home" ? 0 : event.key === "End" ? 2 : stops.indexOf(panelStop) + (event.key === "ArrowUp" ? 1 : -1));
          }
        }}
        onPointerDown={(event) => { suppressPanelClick.current = false; panelDrag.current = { y: event.clientY, stop: stops.indexOf(panelStop) }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
        onPointerCancel={() => { panelDrag.current = null; }}
        onPointerUp={(event) => {
          const start = panelDrag.current; panelDrag.current = null;
          if (start && Math.abs(event.clientY - start.y) > 36) {
            movePanel(start.stop + (event.clientY < start.y ? 1 : -1));
            // A drag must not also run the button's click cycle.
            suppressPanelClick.current = true;
            event.preventDefault();
          }
        }}><span /><span className="sr-only">Drag up for details; down for more map</span></button>
      <header className="situation-panel-heading"><div><h2>{selectedId ? "Event context" : profileCountry ? new Intl.DisplayNames(undefined, { type: "region" }).of(profileCountry) : "World overview"}</h2><p>{overview && scopeMatches ? `${overview.summary.event_count.toLocaleString()} developments · ` : ""}{props.hours === 24 ? "Past 24 hours" : props.hours === 72 ? "Past 3 days" : "Past 7 days"}</p></div>
        <button type="button" className="situation-panel-toggle" onClick={() => setPanelStop(panelStop === "peek" ? "half" : "peek")} aria-label={panelStop === "peek" ? "Show context" : "Show more map"} aria-expanded={panelStop !== "peek"} aria-controls="world-map-context">{panelStop === "peek" ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</button>
      </header>
      <div id="world-map-context" className="situation-context-scroll" inert={panelStop === "peek"}>
        <div className="situation-map-tools"><label>Country shading<select aria-label="Country shading" value={mapMetric} onChange={(event) => setMapMetric(event.target.value as "activity" | "priority")}><option value="activity">All selected activity</option><option value="priority">High-priority activity</option></select></label>{country && <button type="button" onClick={() => { setProfileCountry(null); changeScope(props.onCountryChange)(null); }}>Clear {country} ×</button>}</div>
        <p className="situation-map-key"><span><i />Event · colour = priority</span><span><i />Image available</span></p>
          <div id="world-event-stream" tabIndex={-1}>
            <SituationOverview variant="summary" {...props} selectedId={selectedId}
              onHoursChange={changeScope(props.onHoursChange)} onTopicChange={changeScope(props.onTopicChange)}
              onPriorityChange={changeScope(props.onPriorityChange)} onCountryChange={changeScope(props.onCountryChange)} />
          </div>
        {selectedId ? <section id="overview-event-context" tabIndex={-1} className="situation-detail" aria-label="Selected development">
          <header><span>Event context</span><button type="button" onClick={() => onSelect(null)}><X size={16} />Back to developments</button></header>
          <Suspense fallback={<p role="status">Loading development…</p>}>
            <IntelligenceWorkspace embedded initialEventId={selectedId}
              refreshVersion={events.find((event) => event.id === selectedId)?.last_activity_time}
              onEventLoaded={setSelectedEvent} onSelectEvent={selectEvent} onOpenImagery={props.onOpenImagery} />
          </Suspense>
        </section> : <>
          {profileCountry && <OverviewCountryProfile country={profileCountry} overview={overview} onClose={() => setProfileCountry(null)} />}
          <SituationOverview variant="history" {...props} selectedId={selectedId} />
          <section className="situation-briefing" aria-label="Daily briefing">
            <div className="situation-briefing-label"><FileText size={16} /><strong>Daily briefing</strong>{props.briefing?.published_at && <time dateTime={props.briefing.published_at}>{new Date(props.briefing.published_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>}</div>
            {props.briefing ? <>
              <h2>{props.briefing.title}</h2>
              {props.briefing.key_takeaways?.length ? <ul>{props.briefing.key_takeaways.slice(0, 3).map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
              {props.briefing.update_text && <details><summary>Read briefing</summary><p>{props.briefing.update_text}</p></details>}
            </> : <p>{props.briefingError ? "Briefing could not be loaded." : "No briefing published yet."}</p>}
            {props.briefingError && <button type="button" onClick={() => void props.onRefreshBriefing()}>Retry briefing</button>}
          </section>
          <SituationOverview variant="developments" {...props} onSelect={selectEvent} selectedId={selectedId} />
          {visuals.length > 0 && <section className="overview-visuals" aria-label="Images from this period"><h3>Images & location context</h3><div>{visuals.map((event) => event.imagery && <button type="button" key={event.id} onClick={() => selectEvent(event.id)}>
            <SatelliteImage sources={[event.imagery.preview_url]} alt={presentEvent(event).headline} className="overview-visual-image" />
            <strong>{presentEvent(event).headline}</strong><small>{event.imagery.source_kind === "publisher" ? "Publisher photo · capture unverified" : "Satellite context"} · {event.imagery.attribution}</small>
          </button>)}</div></section>}
          {leadingCountries.length > 0 && <div className="situation-country-pulse" aria-label="Leading country activity">{leadingCountries.map((item) => <button type="button" key={item.country} onClick={() => selectCountry(item.country)}><CountryFlag country={item.country} /><span>{new Intl.DisplayNames(undefined, { type: "region" }).of(item.country) || item.country}</span><strong>{item.count.toLocaleString()}</strong></button>)}</div>}
          <p className="situation-map-coverage">Country shading covers the full period. Pins show located events; country-only reports stay in the heatmap.</p>
        </>}
      </div>
    </aside>
  </div>;
  return <div className="situation-dashboard workspace-page situation-map-first">
    {expandedMap ? <ModalSurface label="Expanded development map" onClose={() => setExpandedMap(false)} className="situation-map-overlay" surfaceClassName="situation-expanded-map">{workspace}</ModalSurface> : workspace}
  </div>;
}
