import { useState } from "react";
import { MapPin, Satellite } from "lucide-react";
import type { IntelligenceEvent } from "../lib/api";
import { eventCoordinateContext, presentEvent } from "./eventPresentation";
import { sourceFamilyLabel } from "./eventSourcePresentation";

type Props = {
  events: IntelligenceEvent[];
  country?: string | null;
  selectedId?: string | null;
  includeExpired: boolean;
  loading: boolean;
  error?: string | null;
  onSelect: (id: string) => void;
  onArchiveChange: (include: boolean) => void;
  onRefresh: () => void;
};

export default function WorldEventStream({ events, country, selectedId, includeExpired, loading, error, onSelect, onArchiveChange, onRefresh }: Props) {
  const [expanded, setExpanded] = useState(false);
  const scoped = events.filter((event) => !country || event.primary_country_iso2?.toUpperCase() === country.toUpperCase());
  const visible = expanded ? scoped : scoped.slice(0, 6);
  return <section className="world-event-stream" aria-label="What's happening around the world" aria-busy={loading}>
    <header>
      <div><h2>What’s happening{country ? ` · ${country.toUpperCase()}` : " around the world"}</h2><p>Choose an event here or on the map to follow its sources, places and imagery.</p></div>
      <div className="world-event-controls">
        <label>Time <select value={includeExpired ? "archive" : "current"} onChange={(event) => onArchiveChange(event.target.value === "archive")}><option value="current">Current events</option><option value="archive">Include archive</option></select></label>
        <button type="button" onClick={onRefresh} disabled={loading}>Refresh events</button>
      </div>
    </header>
    {error && <p role="alert">Unable to refresh events. {events.length ? "Showing the last loaded events." : "Use Refresh events to retry."}</p>}
    {loading && !events.length && <p role="status">Loading the world situation…</p>}
    {!loading && !error && !scoped.length && <p>No events in this scope yet. Source feeds remain available below.</p>}
    <div className="world-event-rows">
      {visible.map((event) => {
        const presentation = presentEvent(event);
        const selected = selectedId === event.id;
        return <button key={event.id} type="button" className={`world-event-row ${selected ? "is-selected" : ""}`} aria-pressed={selected} aria-controls="overview-event-context" onClick={() => onSelect(event.id)}>
          <span className={`world-event-priority event-severity-${event.severity}`}>{event.severity}</span>
          <span className="world-event-story"><strong>{presentation.headline}</strong><span><MapPin size={12} />{presentation.locationLabel}{!eventCoordinateContext(event) && " · precise location unavailable"}</span></span>
          <span className="world-event-sources">{(event.signal_domains ?? []).slice(0, 3).map(sourceFamilyLabel).join(" · ") || `${event.domain_count} source types`}<small>{event.evidence_count} linked records{event.earth_observation_available && <><Satellite size={12} /> Imagery</>}</small></span>
          <span className="world-event-time"><time dateTime={event.last_activity_time}>{new Date(event.last_activity_time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><small>{selected ? "Viewing context" : event.freshness_state === "expired" ? "Archived event" : "Explore event →"}</small></span>
        </button>;
      })}
    </div>
    {scoped.length > 6 && <button type="button" className="world-event-more" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show fewer events" : `Show ${scoped.length - 6} more events in this view`}</button>}
    {events.length >= 100 && <p>Showing up to 100 prioritized events. Country selection narrows this loaded view.</p>}
  </section>;
}
