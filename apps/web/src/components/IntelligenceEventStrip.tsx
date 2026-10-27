import { useEffect, useState } from "react";
import { ArrowUpRight, Clock3, MapPin, RadioTower, Satellite } from "lucide-react";
import { fetchIntelligenceEvents, type IntelligenceEvent } from "../lib/api";
import { presentEvent } from "./eventPresentation";

type Props = {
  country?: string | null;
  onOpen: (eventId?: string) => void;
};

const severityClass: Record<IntelligenceEvent["severity"], string> = {
  critical: "event-severity-critical",
  high: "event-severity-high",
  medium: "event-severity-medium",
  low: "event-severity-low",
};

const formatExactTimestamp = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
};

export default function IntelligenceEventStrip({ country, onOpen }: Props) {
  const [events, setEvents] = useState<IntelligenceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setEvents([]);
    setError(null);
    fetchIntelligenceEvents({ limit: 4, country: country || undefined })
      .then((rows) => {
        if (active) setEvents(rows);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [country]);

  if (error) {
    return (
      <section className="app-card rounded-xl px-4 py-3 text-xs text-[color:var(--shell-muted)]">
        Cross-domain intelligence is temporarily unavailable. Existing source views remain unaffected.
      </section>
    );
  }

  return (
    <section className="app-card event-preview" aria-label="High-impact intelligence events" aria-busy={loading}>
      <div className="event-preview-heading">
        <div className="flex items-center gap-2 text-xs font-semibold text-[color:var(--shell-muted)]">
          <RadioTower className="h-4 w-4" />Priority events
        </div>
        <button type="button" onClick={() => onOpen()} className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-[color:var(--shell-accent)]">
          View all investigations <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
      {loading && <p className="text-xs text-[color:var(--shell-muted)]">Loading events across all sources…</p>}
      {!loading && !events.length && <p className="text-xs text-[color:var(--shell-muted)]">No current events in this scope</p>}
      {events.length > 0 && (
        <div className="event-preview-grid">
          {events.map((event) => {
            const presentation = presentEvent(event);
            const locationLabel = presentation.locationLabel === "Global" &&
              event.latitude != null && event.longitude != null
              ? `${Number(event.latitude).toFixed(2)}, ${Number(event.longitude).toFixed(2)}`
              : presentation.locationLabel;
            return (
              <button key={event.id} type="button" onClick={() => onOpen(event.id)}
                aria-label={`Investigate ${presentation.headline}`} className="event-preview-row">
                <span className={`event-preview-severity ${severityClass[event.severity]}`}>{event.severity} priority</span>
                <h3>{presentation.headline}</h3>
                <span className="event-preview-location"><MapPin size={12} />{locationLabel}
                  {event.earth_observation_available && <Satellite size={12} aria-label="Imagery available" />}
                </span>
                <time dateTime={event.last_activity_time}
                  title={`Last event activity: ${formatExactTimestamp(event.last_activity_time)}${event.expires_at ? ` · Current until ${formatExactTimestamp(event.expires_at)}` : ""}`}>
                  <Clock3 size={12} />Updated {new Date(event.last_activity_time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </time>
                <span className="event-preview-provenance">
                  <span>{event.evidence_count} linked records</span>
                  <span>{event.domain_count} source types</span>
                  <span>{Math.round(event.confidence * 100)}% confidence</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
