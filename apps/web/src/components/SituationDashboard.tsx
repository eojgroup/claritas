import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, FileText, Maximize2, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import type { DailySignalBriefing, IntelligenceEvent, IntelligenceOverview, OverviewTopic } from "../lib/api";
import SituationOverview from "./SituationOverview";
import WorldMapBubbles from "./WorldMapBubbles";
import { eventCoordinateContext, presentEvent } from "./eventPresentation";
import OverviewCountryProfile from "./OverviewCountryProfile";
import CountryFlag from "./CountryFlag";
import ModalSurface from "./ModalSurface";
import { mapEventKind, MAP_EVENT_KINDS } from "./mapEventPresentation";

const IntelligenceWorkspace = lazy(() => import("./IntelligenceWorkspace"));
type Props = {
  overview: IntelligenceOverview | null; loading: boolean; error: string | null;
  hours: 24 | 72 | 168; topic: OverviewTopic | null; priority: "high" | "all";
  bucket?: number | null; onBucketChange?: (bucket: number | null) => void;
  country: string | null; selectedId: string | null; dark: boolean;
  briefing: DailySignalBriefing | null; briefingError: string | null;
  onHoursChange: (hours: 24 | 72 | 168) => void; onTopicChange: (topic: OverviewTopic | null) => void;
  onPriorityChange: (priority: "high" | "all") => void; onCountryChange: (country: string | null) => void;
  onSelect: (id: string | null, options?: { focus?: boolean }) => void; onOpenImagery: (id?: string) => void;
  onRefresh: () => void; onRefreshBriefing: () => Promise<void>;
};

export default function SituationDashboard(props: Props) {
  const { overview, country, selectedId, onSelect } = props;
  const [selectedEvent, setSelectedEvent] = useState<IntelligenceEvent | null>(null);
  const [profileCountry, setProfileCountry] = useState<string | null>(null);
  const [expandedMap, setExpandedMap] = useState(false);
  const [wideContext, setWideContext] = useState(false);
  const contextScroll = useRef<HTMLDivElement>(null);
  const [panelStop, setPanelStop] = useState<"peek" | "half" | "full">("half");
  const panelDrag = useRef<{ y: number; stop: number } | null>(null);
  const suppressPanelClick = useRef(false);
  const [mapMetric, setMapMetric] = useState<"attention" | "activity" | "priority">("attention");
  const scopeMatches = overview?.window.hours === props.hours && (overview.filters.topic ?? null) === props.topic
    && (overview.filters.country ?? "").toUpperCase() === (country ?? "").toUpperCase()
    && (overview.filters.priority ?? props.priority) === props.priority;
  const intervalMatches = (overview?.filters.bucket ?? null) === (props.bucket ?? null);
  const events = useMemo(() => {
    if (!scopeMatches || !overview) return [];
    const mapped = new Map((overview.map_events ?? overview.events).map((event) => [event.id, event]));
    for (const event of overview.visual_events ?? []) if (eventCoordinateContext(event)) mapped.set(event.id, event);
    return [...mapped.values()];
  }, [scopeMatches, overview]);
  const points = useMemo(() => (selectedEvent?.id === selectedId && !events.some((event) => event.id === selectedId) ? [...events, selectedEvent] : events).filter((event) => eventCoordinateContext(event)).map((event) => ({
    id: event.id, latitude: Number(event.latitude), longitude: Number(event.longitude),
    title: presentEvent(event).headline, subtitle: [event.location_name || event.primary_country_iso2, new Date(event.last_activity_time).toLocaleString()].filter(Boolean).join(" · "),
    imageUrl: event.imagery?.preview_url,
    kind: mapEventKind(event.event_type),
    label: `${MAP_EVENT_KINDS[mapEventKind(event.event_type)].label}${event.location_name ? ` · ${event.location_name}` : ""}`,
    severity: event.severity, selected: event.id === selectedId, hasImagery: event.earth_observation_available || Boolean(event.imagery),
  })), [events, selectedId, selectedEvent]);
  const countries = useMemo(() => {
    if (scopeMatches && overview?.countries) return overview.countries.map((item) => ({ country: item.country_iso2,
      count: mapMetric === "attention" ? item.attention_score ?? 0 : mapMetric === "priority" ? item.high_priority_count : item.event_count,
      meta: { subtitle: `${item.event_count.toLocaleString()} updates · ${item.high_priority_count} high priority`,
        lines: [`${item.attention_score ?? 0}/100 signal relevance`, `Previous period: ${item.previous_event_count ?? 0} updates`] } }));
    const counts = new Map<string, number>();
    for (const event of events) if (event.primary_country_iso2) {
      const iso = event.primary_country_iso2.toUpperCase();
      counts.set(iso, (counts.get(iso) ?? 0) + 1);
    }
    return [...counts].map(([iso, count]) => ({ country: iso, count, meta: { subtitle: `${count} mapped developments`, lines: [] as string[] } }));
  }, [events, overview, scopeMatches, mapMetric]);
  const revealContext = () => setPanelStop((stop) => stop === "peek" ? "half" : stop);
  const selectEvent = (id: string | null) => { onSelect(id); if (id) { setProfileCountry(null); revealContext(); } };
  const selectCountry = (iso: string) => { setProfileCountry(iso); onSelect(null, { focus: false }); props.onCountryChange(iso); revealContext(); contextScroll.current?.scrollTo?.({ top: 0 }); };
  const changeScope = <T,>(setter: (value: T) => void) => (value: T) => { onSelect(null); setProfileCountry(null); setter(value); };
  const leadingCountries = [...countries].sort((a, b) => b.count - a.count).filter((item) => item.count > 0).slice(0, 4);
  const mappedHighlight = [...events].sort((a, b) => (b.priority_score ?? b.relevance_score) - (a.priority_score ?? a.relevance_score))[0];
  const map = <WorldMapBubbles variant="default" data={countries} points={points} primaryCountry={country} allowsSingleFingerPan
    dark={props.dark} onSelect={selectCountry} fillMode="relevance" scale={mapMetric === "attention" ? "linear" : "log"} valueDomain={mapMetric === "attention" ? [0, 100] : undefined}
    focusOnActivity={Boolean(country)}
    featuredLabel={mapMetric === "attention" ? "Highest signal relevance" : mapMetric === "priority" ? "Most high-priority activity" : "Most reported activity"}
    onSelectPoint={(point) => selectEvent(point.id)} showBubbles={false} showLabels legend
    legendLabel={!intervalMatches ? "Previous selection · updating" : mapMetric === "attention" ? "Signal relevance" : mapMetric === "priority" ? "High-priority updates" : "Number of updates"}
    legendDescription={mapMetric === "attention" ? "Importance, high-priority share and unusual increases. Not a danger rating." : "Warmer = more updates, not more danger."} />;
  const stops = ["peek", "half", "full"] as const;
  const movePanel = (index: number) => setPanelStop(stops[Math.min(2, Math.max(0, index))]);
  const overviewControls = <>
        <p className="situation-map-key"><span><i />Pin = located event · colour = severity</span><span><i />Ring = image available</span></p>
          <div id="world-event-stream" tabIndex={-1}>
            <SituationOverview variant="summary" compact {...props} selectedId={selectedId}
              filterExtras={<label>Country shading<select aria-label="Country shading" value={mapMetric} onChange={(event) => setMapMetric(event.target.value as "attention" | "activity" | "priority")}><option value="attention">Signal relevance</option><option value="activity">Number of updates</option><option value="priority">High-priority updates</option></select></label>}
              onHoursChange={changeScope(props.onHoursChange)} onTopicChange={changeScope(props.onTopicChange)}
              onPriorityChange={changeScope(props.onPriorityChange)} onCountryChange={changeScope(props.onCountryChange)} />
          </div>
  </>;
  const workspace = <div className={`situation-workspace situation-map-workspace panel-${panelStop}${wideContext ? " context-wide" : ""}`}>
    <section className={`situation-map-canvas${!intervalMatches ? " is-updating" : ""}`} aria-busy={!intervalMatches} aria-label="Development map">
      {map}
      <div className="situation-map-heading"><span className="situation-eyebrow">Global signal map</span><h2>Where it’s happening</h2><span>{props.loading ? "Updating…" : overview?.snapshot?.status === "warming" ? "Preparing…" : `${countries.length} countries · ${points.length} located events`}</span>
        {!intervalMatches && <p className="situation-map-narrative">{props.error ? "Interval unavailable. Showing the previous map." : "Loading the selected interval. Showing the previous map."}</p>}
        {intervalMatches && leadingCountries[0] && <p className="situation-map-narrative">{mapMetric === "attention" ? "Highest signal relevance" : mapMetric === "priority" ? "Most high-priority updates" : "Most updates"}: {new Intl.DisplayNames(undefined, { type: "region" }).of(leadingCountries[0].country)} · {mapMetric === "attention" ? leadingCountries[0].meta?.subtitle : leadingCountries[0].count.toLocaleString()}{overview?.selection ? " in this interval" : " in this period"}</p>}
        {intervalMatches && mappedHighlight && <button type="button" className="situation-map-story" onClick={() => selectEvent(mappedHighlight.id)} aria-label={`Open mapped development: ${presentEvent(mappedHighlight).headline}`}>On the map: {presentEvent(mappedHighlight).headline}</button>}
      </div>
      <div className="situation-map-actions">
        <button type="button" onClick={() => setExpandedMap(!expandedMap)} aria-label={expandedMap ? "Close expanded map" : "Expand map"}>{expandedMap ? <X size={18} /> : <Maximize2 size={18} />}</button>
      </div>
    </section>
    <aside className="situation-context-panel situation-stream" aria-label="Map context">
      <button type="button" className="situation-panel-handle" aria-label="Resize context panel" aria-controls="world-map-context" aria-expanded={panelStop !== "peek"}
        onClick={(event) => {
          if (suppressPanelClick.current && event.detail > 0) { suppressPanelClick.current = false; return; }
          suppressPanelClick.current = false;
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
        {country && <button type="button" className="situation-country-clear" onClick={() => changeScope(props.onCountryChange)(null)}>Clear {country} ×</button>}
        <button type="button" className="situation-panel-widen" onClick={() => setWideContext(!wideContext)} aria-label={wideContext ? "Narrow context" : "Widen context"} aria-pressed={wideContext}>{wideContext ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}</button>
        <button type="button" className="situation-panel-toggle" onClick={() => setPanelStop(panelStop === "peek" ? "half" : "peek")} aria-label={panelStop === "peek" ? "Show context" : "Show more map"} aria-expanded={panelStop !== "peek"} aria-controls="world-map-context">{panelStop === "peek" ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</button>
      </header>
      <div ref={contextScroll} id="world-map-context" className="situation-context-scroll" inert={panelStop === "peek"}>
        {!selectedId && !profileCountry && overviewControls}
        {selectedId ? <><section id="overview-event-context" tabIndex={-1} className="situation-detail" aria-label="Selected development">
          <header><span>Event context</span><button type="button" onClick={() => onSelect(null)}><X size={16} />Back to developments</button></header>
          <Suspense fallback={<p role="status">Loading development…</p>}>
            <IntelligenceWorkspace embedded initialEventId={selectedId}
              refreshVersion={events.find((event) => event.id === selectedId)?.last_activity_time}
              onEventLoaded={setSelectedEvent} onSelectEvent={selectEvent} onOpenImagery={props.onOpenImagery} />
          </Suspense>
        </section>{overviewControls}</> : <>
          {profileCountry && <><OverviewCountryProfile country={profileCountry} overview={overview} onClose={() => setProfileCountry(null)} />{overviewControls}</>}
          <SituationOverview variant="history" {...props} onBucketChange={props.onBucketChange ? changeScope(props.onBucketChange) : undefined} selectedId={selectedId} />
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
          {leadingCountries.length > 0 && <div className="situation-country-pulse" aria-label="Leading country activity">{leadingCountries.map((item) => <button type="button" key={item.country} onClick={() => selectCountry(item.country)}><CountryFlag country={item.country} /><span>{new Intl.DisplayNames(undefined, { type: "region" }).of(item.country) || item.country}</span><strong>{item.count.toLocaleString()}</strong></button>)}</div>}
          <p className="situation-map-coverage">Country shading and pins follow your topic, priority, country and time selection. Reports without precise coordinates contribute to country shading. A dark country means no located reporting in this selection, not that nothing happened.</p>
        </>}
      </div>
    </aside>
  </div>;
  return <div className="situation-dashboard workspace-page situation-map-first">
    {expandedMap ? <ModalSurface label="Expanded development map" onClose={() => setExpandedMap(false)} className="situation-map-overlay" surfaceClassName="situation-expanded-map">{workspace}</ModalSurface> : workspace}
  </div>;
}
