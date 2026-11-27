import type { TransportMapState } from "./TransportScopeContext";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, FileText, Maximize2, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import type { DailySignalBriefing, IntelligenceEvent, IntelligenceOverview, TransportPositionSelection, IntelligenceEventDetail, TransportEntity, OverviewTopic } from "../lib/api";
import { fetchIntelligenceOverview } from "../lib/api";
import { readWithDeadline } from "../lib/readDeadline";
import SituationOverview from "./SituationOverview";
import WorldMapBubbles from "./WorldMapBubbles";
import { eventCoordinateContext, presentEvent } from "./eventPresentation";
import OverviewCountryProfile from "./OverviewCountryProfile";
import CountryFlag from "./CountryFlag";
import ModalSurface from "./ModalSurface";
import { mapEventKind, MAP_EVENT_KINDS } from "./mapEventPresentation";


const IntelligenceWorkspace = lazy(() => import("./IntelligenceWorkspace"));
const TransportScopeContext = lazy(() => import("./TransportScopeContext"));
type Props = {
  overview: IntelligenceOverview | null; loading: boolean; error: string | null;
  searchQuery?: string; onSearchChange?: (query:string)=>void;
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
  const [searchDraft,setSearchDraft] = useState(props.searchQuery ?? "");
  useEffect(()=>setSearchDraft(props.searchQuery ?? ""),[props.searchQuery]);
  const [selectedEvent, setSelectedEvent] = useState<IntelligenceEvent | null>(null);
  const [profileCountry, setProfileCountry] = useState<string | null>(null);
  const [countryContextOpen, setCountryContextOpen] = useState(false);
  const [scopeView, setScopeView] = useState<"developments" | "transport">("developments");
  const [transportMap,setTransportMap] = useState<TransportMapState|null>(null);
  const [transportSelection,setTransportSelection] = useState<TransportPositionSelection>({mode:"all",corridor:"",port:"",window:null});
  const [mappedVehicle,setMappedVehicle] = useState<TransportEntity|null>(null);
  const [eventLinks,setEventLinks] = useState<{id:string;countries:string[]} | null>(null);
  const receiveEvent = useCallback((event:IntelligenceEvent, detail?:IntelligenceEventDetail)=>{
    setSelectedEvent(event);
    const countries = [...new Set([event.primary_country_iso2,...(detail?.locations??[]).filter(row=>row.confidence>=.5).map(row=>row.country_iso2)].filter((iso):iso is string=>Boolean(iso&&/^[A-Z]{2}$/.test(iso))))];
    setEventLinks({id:event.id,countries});
  },[]);
  const [scopeReporting, setScopeReporting] = useState<{ key: string; events: IntelligenceEvent[] }>({ key: "", events: [] });
  const reportingKey = `${country ?? "global"}|${props.hours}|${scopeView}`;
  useEffect(() => {
    if (scopeView === "developments" || selectedId) return;
    const controller = new AbortController();
    let warmingRetry: ReturnType<typeof setTimeout> | undefined;
    const read = () => void readWithDeadline((signal) => fetchIntelligenceOverview({ hours: props.hours, country: country || undefined, topic: scopeView, priority: "all" }, signal), controller.signal, 8_000)
      .then((value) => {
        if (controller.signal.aborted) return;
        setScopeReporting({ key: reportingKey, events: [...value.events, ...(value.map_events ?? []), ...(value.visual_events ?? [])] });
        if (value.snapshot?.status === "warming") warmingRetry = setTimeout(read, 15_000);
      })
      .catch(() => { /* The current overview remains usable if optional topic reporting is unavailable. */ });
    read();
    return () => { controller.abort(); clearTimeout(warmingRetry); };
  }, [country, props.hours, scopeView, selectedId, reportingKey]);
  const relatedEvents = useMemo(() => [...new Map([...(overview?.events ?? []), ...(overview?.map_events ?? []), ...(overview?.visual_events ?? []),
    ...(scopeReporting.key === reportingKey ? scopeReporting.events : [])].map((event) => [event.id, event])).values()], [overview, scopeReporting, reportingKey]);
  const relatedEventIds = scopeReporting.key === reportingKey ? scopeReporting.events.map((event) => event.id) : [];
  useEffect(() => {
    if (country && !selectedId) setProfileCountry(country);
    else if (!country) setProfileCountry(null);
  }, [country, selectedId]);
  const [expandedMap, setExpandedMap] = useState(false);
  const [wideContext, setWideContext] = useState(false);
  const contextScroll = useRef<HTMLDivElement>(null);
  const [panelStop, setPanelStop] = useState<"peek" | "half" | "full">("half");
  const panelDrag = useRef<{ y: number; stop: number } | null>(null);
  const suppressPanelClick = useRef(false);
  const [mapMetric, setMapMetric] = useState<"attention" | "activity" | "priority">("attention");
  const scopeMatches = overview?.window.hours === props.hours && (overview.filters.topic ?? null) === props.topic
    && (overview.filters.country ?? "").toUpperCase() === (country ?? "").toUpperCase()
    && (overview.filters.priority ?? props.priority) === props.priority
    && (overview.filters.q ?? "") === (props.searchQuery ?? "");
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
    imageUrl: event.imagery?.preview_url, imageCapturedAt:event.imagery?.captured_at, imageAttribution:event.imagery?.attribution, locationLabel:event.location_name||event.primary_country_iso2||undefined,
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
  const selectCountry = (iso: string) => { setScopeView("developments"); setCountryContextOpen(false); setMappedVehicle(null); setTransportSelection({mode:"all",corridor:"",port:"",window:null}); setProfileCountry(iso); onSelect(null, { focus: false }); props.onCountryChange(iso); revealContext(); contextScroll.current?.scrollTo?.({ top: 0 }); };
  const changeScope = <T,>(setter: (value: T) => void) => (value: T) => { onSelect(null); setProfileCountry(null); setter(value); };
  const leadingCountries = [...countries].sort((a, b) => b.count - a.count).filter((item) => item.count > 0).slice(0, 4);
  const mappedHighlight = [...events].sort((a, b) => (b.priority_score ?? b.relevance_score) - (a.priority_score ?? a.relevance_score))[0];
  const isTransport = scopeView === "transport";
  const currentTransport = transportMap?.country === (country || undefined) && JSON.stringify(transportMap?.selection)===JSON.stringify(transportSelection) ? transportMap : null;
  const positionEntities = currentTransport?.positions?.entities ?? [];
  const displayedVehicles = mappedVehicle ? positionEntities.filter(row=>row.id===mappedVehicle.id) : positionEntities;
  const linkedCountries = selectedId && eventLinks?.id===selectedId ? eventLinks.countries : [];
  const scopedLinks = country && scopeMatches ? overview?.country_links ?? [] : [];
  const isScopedHeat = !isTransport && linkedCountries.length < 2 && scopedLinks.length > 0;
  const mapCountries = isTransport ? currentTransport?.countries ?? [] : linkedCountries.length>1 ? linkedCountries.map(country=>({country,count:100})) : isScopedHeat ? scopedLinks.map(row=>({country:row.country_iso2,count:mapMetric === "priority" ? row.high_priority_count : row.event_count})) : countries;
  const selectTransportCountry = (iso:string) => {
    selectCountry(iso);
    setScopeView("transport");
  };
  const focus = useMemo<[number,number]|undefined>(()=>{
    if(mappedVehicle?.latitude!=null&&mappedVehicle.longitude!=null)return [mappedVehicle.longitude,mappedVehicle.latitude];
    const port=currentTransport?.ports.find(port=>port.name===transportSelection.port);return port?[port.longitude,port.latitude]:undefined;
  },[mappedVehicle,currentTransport?.ports,transportSelection.port]);
  const map = <WorldMapBubbles variant="default" data={mapCountries} transportLayer={isTransport}
    points={isTransport ? [...displayedVehicles.map(vehicle=>({vehicleMode:vehicle.mode,vehicleHeading:vehicle.heading,id:`vehicle:${vehicle.id}`,latitude:vehicle.latitude!,longitude:vehicle.longitude!,title:vehicle.display_name||vehicle.flight_number||vehicle.entity_id,subtitle:`${vehicle.mode==='aviation'?'Aircraft':'Vessel'} · ${new Date(vehicle.observed_at).toLocaleString()}`,selected:vehicle.id===mappedVehicle?.id})),...(currentTransport?.ports??[]).map(port=>({id:`port:${port.country}:${port.name}`,latitude:port.latitude,longitude:port.longitude,title:port.name,label:port.name,portName:port.name,subtitle:`${port.departures} recorded departures · past 24h`,selected:port.name===transportSelection.port}))] : points}
    primaryCountry={country} allowsSingleFingerPan focusCoordinate={focus}
    dark={props.dark} onSelect={isTransport?selectTransportCountry:selectCountry} fillMode="relevance" scale={isTransport||isScopedHeat?"log":mapMetric === "attention" ? "linear" : "log"} valueDomain={isTransport||isScopedHeat?undefined:mapMetric === "attention" ? [0,100] : undefined}
    focusOnActivity={!isTransport&&Boolean(country)}
    featuredLabel={mapMetric === "attention" ? "Highest signal relevance" : "Most reported activity"}
    onSelectPoint={point=>{if(point.portName){setMappedVehicle(null);setTransportSelection({mode:"maritime",port:point.portName,corridor:"",window:null});}else if(point.id.startsWith("vehicle:")){const vehicle=positionEntities.find(row=>`vehicle:${row.id}`===point.id);onSelect(null);setMappedVehicle(vehicle?{...vehicle}:null);revealContext();}else selectEvent(point.id);}} showBubbles={false} showLabels legend={linkedCountries.length<2 || isTransport}
    legendLabel={isScopedHeat?"Countries linked to these developments":isTransport?currentTransport?.heatLabel??"Transport country links":linkedCountries.length>1?"Countries linked to this event":!intervalMatches?"Previous selection · updating":mapMetric==="attention"?"Signal relevance":"Number of updates"}
    legendDescription={isScopedHeat?"Warmer = more selected developments with an explicit location in that country. Location links do not establish impact or cause.":isTransport?currentTransport?.heatNotice??"Select a transport visual to filter current positions.":linkedCountries.length>1?"Source-linked event locations. A connection does not establish cause or an observed route.":"Importance, high-priority share and unusual increases. Not a danger rating."}/>;
  const stops = ["peek", "half", "full"] as const;
  const movePanel = (index: number) => setPanelStop(stops[Math.min(2, Math.max(0, index))]);
  const overviewControls = <>
        <p className="situation-map-key"><span><i />Pin = located event · colour = severity</span><span><i />Ring = image available</span></p>
          {props.onSearchChange && <form className="situation-topic-search" role="search" aria-label="Search developments" onSubmit={event=>{event.preventDefault();props.onSearchChange?.(searchDraft.trim());}}><input aria-label="Search developments" placeholder="Search topics, events or places" maxLength={200} value={searchDraft} onChange={event=>setSearchDraft(event.target.value)}/><button type="submit">Search</button>{props.searchQuery && <button type="button" onClick={()=>{setSearchDraft("");props.onSearchChange?.("");}}>Clear search</button>}<small>Search the current map scope and period · use quotes for an exact phrase</small></form>}
          <div id="world-event-stream" tabIndex={-1}>
            <SituationOverview variant="summary" compact {...props} selectedId={selectedId}
              filterExtras={<label>Country shading<select aria-label="Country shading" value={mapMetric} onChange={(event) => setMapMetric(event.target.value as "attention" | "activity" | "priority")}><option value="attention">{isScopedHeat ? "Linked developments" : "Signal relevance"}</option><option value="activity">Number of updates</option><option value="priority">High-priority updates</option></select></label>}
              onHoursChange={changeScope(props.onHoursChange)} onTopicChange={changeScope(props.onTopicChange)}
              onPriorityChange={changeScope(props.onPriorityChange)} onCountryChange={changeScope(props.onCountryChange)} />
          </div>
  </>;
  const workspace = <div className={`situation-workspace situation-map-workspace panel-${panelStop}${wideContext ? " context-wide" : ""}`}>
    <section className={`situation-map-canvas${!intervalMatches ? " is-updating" : ""}`} aria-busy={!intervalMatches} aria-label="Development map">
      {map}
      <div className="situation-map-heading"><span className="situation-eyebrow">Global signal map</span><h2>{scopeView === "transport" ? "Live transport tracking" : "Where it’s happening"}</h2><span>{isTransport ? `${displayedVehicles.length} current positions · ${mapCountries.length} linked countries` : props.loading ? "Updating…" : overview?.snapshot?.status === "warming" ? "Preparing…" : `${countries.length} countries · ${points.length} located events`}</span>
        {!isTransport && linkedCountries.length>1 && <p className="situation-map-narrative">Linked countries: {linkedCountries.map(iso=>new Intl.DisplayNames(undefined,{type:"region"}).of(iso)).join(" · ")}</p>}
        {scopeView === "transport" && <p className="situation-map-narrative">Current positions · country shading follows the selected transport activity</p>}
        {!intervalMatches && <p className="situation-map-narrative">{props.error ? "Interval unavailable. Showing the previous map." : "Loading the selected interval. Showing the previous map."}</p>}
        {!isTransport && intervalMatches && leadingCountries[0] && <p className="situation-map-narrative">{mapMetric === "attention" ? "Highest signal relevance" : mapMetric === "priority" ? "Most high-priority updates" : "Most updates"}: {new Intl.DisplayNames(undefined, { type: "region" }).of(leadingCountries[0].country)} · {mapMetric === "attention" ? leadingCountries[0].meta?.subtitle : leadingCountries[0].count.toLocaleString()}{overview?.selection ? " in this interval" : " in this period"}</p>}
        {!isTransport && intervalMatches && mappedHighlight && <button type="button" className="situation-map-story" onClick={() => selectEvent(mappedHighlight.id)} aria-label={`Open mapped development: ${presentEvent(mappedHighlight).headline}`}>On the map: {presentEvent(mappedHighlight).headline}</button>}
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
        {!selectedId && <>
          <nav className="scope-view-switch" aria-label="Explore selected scope">
            {([['developments', 'Developments'], ['transport', 'Transport']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={scopeView === key} onClick={() => { setScopeView(key); revealContext(); }}>{label}</button>)}
          </nav>
        </>}
        {!selectedId && isTransport && <Suspense fallback={<p role="status">Loading transport visuals…</p>}><TransportScopeContext country={country} selection={transportSelection} onSelectionChange={setTransportSelection} onMapChange={setTransportMap} onSelectVehicle={setMappedVehicle} selectedVehicle={mappedVehicle} events={relatedEvents} relatedEventIds={relatedEventIds} onSelectCountry={iso=>{selectCountry(iso);setScopeView("transport");}} onOpenEvent={selectEvent}/></Suspense>}
        {(selectedId || scopeView === "developments") && <>
        {!selectedId && !profileCountry && overviewControls}
        {selectedId ? <><section id="overview-event-context" tabIndex={-1} className="situation-detail" aria-label="Selected development">
          <header><span>Event context</span><button type="button" onClick={() => onSelect(null)}><X size={16} />{scopeView === "developments" ? "Back to developments" : `Back to ${scopeView}`}</button></header>
          {linkedCountries.length>1 && <div className="transport-selection-chips" aria-label="Countries linked to selected development">{linkedCountries.map(iso=><button key={iso} type="button" onClick={()=>selectCountry(iso)}>{new Intl.DisplayNames(undefined,{type:"region"}).of(iso)}</button>)}</div>}
          <Suspense fallback={<p role="status">Loading development…</p>}>
            <IntelligenceWorkspace embedded initialEventId={selectedId}
              refreshVersion={events.find((event) => event.id === selectedId)?.last_activity_time}
              onEventLoaded={receiveEvent} onSelectEvent={selectEvent} onOpenImagery={props.onOpenImagery} />
          </Suspense>
        </section>{overviewControls}</> : <>
          {profileCountry && <>
            {overviewControls}
            <button type="button" className="scope-context-related-event" aria-expanded={countryContextOpen} aria-controls="selected-country-reference" onClick={() => setCountryContextOpen(!countryContextOpen)}>Weather, markets & country profile {countryContextOpen ? "−" : "+"}</button>
            {countryContextOpen && <div id="selected-country-reference"><OverviewCountryProfile country={profileCountry} overview={overview} onClose={() => setCountryContextOpen(false)} /></div>}
          </>}
          <SituationOverview variant="history" {...props} onBucketChange={props.onBucketChange ? changeScope(props.onBucketChange) : undefined} selectedId={selectedId} />
          {profileCountry && <SituationOverview variant="developments" {...props} onSelect={selectEvent} selectedId={selectedId} />}
          <section className="situation-briefing" aria-label="Daily briefing">
            <div className="situation-briefing-label"><FileText size={16} /><strong>Daily briefing</strong>{props.briefing?.published_at && <time dateTime={props.briefing.published_at}>{new Date(props.briefing.published_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>}</div>
            {props.briefing ? <>
              <h2>{props.briefing.title}</h2>
              {props.briefing.key_takeaways?.length ? <ul>{props.briefing.key_takeaways.slice(0, 3).map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
              {props.briefing.update_text && <details><summary>Read briefing</summary><p>{props.briefing.update_text}</p></details>}
            </> : <p>{props.briefingError ? "Briefing could not be loaded." : "No briefing published yet."}</p>}
            {props.briefingError && <button type="button" onClick={() => void props.onRefreshBriefing()}>Retry briefing</button>}
          </section>
          {!profileCountry && <SituationOverview variant="developments" {...props} onSelect={selectEvent} selectedId={selectedId} />}
          {leadingCountries.length > 0 && <div className="situation-country-pulse" aria-label="Leading country activity">{leadingCountries.map((item) => <button type="button" key={item.country} onClick={() => selectCountry(item.country)}><CountryFlag country={item.country} /><span>{new Intl.DisplayNames(undefined, { type: "region" }).of(item.country) || item.country}</span><strong>{item.count.toLocaleString()}</strong></button>)}</div>}
          <p className="situation-map-coverage">Country shading and pins follow your topic, priority, country and time selection. Reports without precise coordinates contribute to country shading. A dark country means no located reporting in this selection, not that nothing happened.</p>
        </>}
        </>}
      </div>
    </aside>
  </div>;
  return <div className="situation-dashboard workspace-page situation-map-first">
    {expandedMap ? <ModalSurface label="Expanded development map" onClose={() => setExpandedMap(false)} className="situation-map-overlay" surfaceClassName="situation-expanded-map">{workspace}</ModalSurface> : workspace}
  </div>;
}
