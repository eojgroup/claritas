import { lazy, Suspense, useMemo, useState } from "react";
import { FileText, X } from "lucide-react";
import type { DailySignalBriefing, IntelligenceEvent, IntelligenceOverview, OverviewTopic } from "../lib/api";
import SituationOverview from "./SituationOverview";
import WorldMapBubbles from "./WorldMapBubbles";
import { eventCoordinateContext, presentEvent } from "./eventPresentation";

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
  const scopeMatches = overview?.window.hours === props.hours && (overview.filters.topic ?? null) === props.topic
    && (overview.filters.country ?? "").toUpperCase() === (country ?? "").toUpperCase()
    && (overview.filters.priority ?? props.priority) === props.priority;
  const events = useMemo(() => {
    if (!scopeMatches || !overview) return [];
    const developmentIds = new Set(overview.timeline.map((item) => item.event_id));
    return overview.events.filter((event) => developmentIds.has(event.id));
  }, [scopeMatches, overview]);
  const points = useMemo(() => (selectedEvent?.id === selectedId && !events.some((event) => event.id === selectedId) ? [...events, selectedEvent] : events).filter((event) => eventCoordinateContext(event)).map((event) => ({
    id: event.id, latitude: Number(event.latitude), longitude: Number(event.longitude),
    title: presentEvent(event).headline, subtitle: event.location_name || event.primary_country_iso2 || undefined,
    label: (event.location_name || event.primary_country_iso2 || "Mapped place").length > 18 ? `${(event.location_name || event.primary_country_iso2 || "").slice(0, 17)}…` : event.location_name || event.primary_country_iso2 || "Mapped place",
    severity: event.severity, selected: event.id === selectedId, hasImagery: event.earth_observation_available,
  })), [events, selectedId, selectedEvent]);
  const countries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) if (event.primary_country_iso2) {
      const iso = event.primary_country_iso2.toUpperCase();
      counts.set(iso, (counts.get(iso) ?? 0) + 1);
    }
    return [...counts].map(([iso, count]) => ({ country: iso, count }));
  }, [events]);
  const changeScope = <T,>(setter: (value: T) => void) => (value: T) => { onSelect(null); setter(value); };
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
      <section className="situation-map app-card" aria-label="Development map">
        <header><h2>Where it’s happening</h2><span>{props.loading ? "Loading…" : overview?.snapshot?.status === "warming" ? "Preparing…" : `${points.length} located ${points.length === 1 ? "development" : "developments"}`}</span></header>
        <div className="situation-map-stage">
          <WorldMapBubbles variant="compact" data={countries} points={points} primaryCountry={country}
            dark={props.dark} onSelect={(iso) => changeScope(props.onCountryChange)(iso === country ? null : iso)}
            onSelectPoint={(point) => onSelect(point.id)} showBubbles={false} showLabels legend={false} />
        </div>
        <footer>Choose a place or development to focus the overview.{country && <button type="button" onClick={() => changeScope(props.onCountryChange)(null)}>Clear {country} ×</button>}</footer>
      </section>
      <SituationOverview variant="timeline" {...props} selectedId={selectedId} />
    </div>
    {selectedId && <section id="overview-event-context" tabIndex={-1} className="situation-detail app-card" aria-label="Selected development">
      <header><span>Selected development</span><button type="button" onClick={() => onSelect(null)}><X size={16} />Close</button></header>
      <Suspense fallback={<p role="status">Loading development…</p>}>
        <IntelligenceWorkspace embedded initialEventId={selectedId}
          refreshVersion={events.find((event) => event.id === selectedId)?.last_activity_time}
          onEventLoaded={setSelectedEvent} onSelectEvent={onSelect} onOpenImagery={props.onOpenImagery} />
      </Suspense>
    </section>}
  </div>;
}
