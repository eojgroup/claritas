import { useEffect, useState } from "react";
import { ArrowUpRight, Clock3, Link2, MapPin, RadioTower, Satellite } from "lucide-react";
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
    <section className="app-card rounded-xl px-4 py-3" aria-label="High-impact intelligence events">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <RadioTower className="h-4 w-4 text-[color:var(--signal-sky)]" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
              Priority events on the map
            </div>
            <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
              {loading ? "Linking reporting, location and observation…" : events.length ? `${events.length} current events ranked by attention` : "No material correlated changes"}
            </div>
          </div>
        </div>
        <button type="button" onClick={() => onOpen()} className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--shell-ink)]">
          View all investigations <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
      {events.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {events.map((event) => {
            const presentation = presentEvent(event);
            const locationLabel = presentation.locationLabel === "Global" &&
              event.latitude != null && event.longitude != null
              ? `${Number(event.latitude).toFixed(2)}, ${Number(event.longitude).toFixed(2)}`
              : presentation.locationLabel;
            return (
              <button
                key={event.id}
                type="button"
                onClick={() => onOpen(event.id)}
                aria-label={`Investigate ${presentation.headline}`}
                className="event-brief-card group flex min-h-44 flex-col rounded-xl border border-[color:var(--shell-border)] p-3 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${severityClass[event.severity]}`}>
                    {event.severity} priority
                  </span>
                  <span className="text-[10px] font-medium text-[color:var(--shell-muted)]">{Math.round(event.confidence * 100)}% confidence</span>
                </div>
                <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-accent)]">{presentation.typeLabel}</div>
                <h3 className="mt-1 line-clamp-2 text-[15px] font-semibold leading-5 text-[color:var(--shell-ink)]">{presentation.headline}</h3>
                {presentation.focus && <p className="mt-1 line-clamp-1 text-[11px] text-[color:var(--shell-muted)]">Signal focus · {presentation.focus}</p>}
                <p className="mt-2 line-clamp-1 text-xs leading-5 text-[color:var(--shell-muted)]">{presentation.summary}</p>
                <div className="mt-auto border-t border-[color:var(--shell-border)] pt-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[color:var(--shell-ink)]"><MapPin className="h-3.5 w-3.5 text-[color:var(--shell-accent-2)]" />{locationLabel}</div>
                  <time
                    dateTime={event.last_activity_time}
                    title={`Last event activity: ${formatExactTimestamp(event.last_activity_time)}`}
                    className="mt-1.5 flex items-center gap-1 text-[10px] text-[color:var(--shell-muted)]"
                  >
                    <Clock3 className="h-3 w-3" />
                    Updated {formatExactTimestamp(event.last_activity_time)}
                  </time>
                  {event.expires_at && (
                    <time
                      dateTime={event.expires_at}
                      className={`mt-1 flex items-center gap-1 text-[10px] ${event.freshness_state === "expiring" ? "text-[color:var(--shell-accent)]" : "text-[color:var(--shell-muted)]"}`}
                    >
                      Current until {formatExactTimestamp(event.expires_at)}
                    </time>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[color:var(--shell-muted)]">
                    <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" />{event.evidence_count} evidence</span>
                    <span>{Math.round(event.relevance_score * 100)}% relevance</span>
                    {event.earth_observation_available && <span className="inline-flex items-center gap-1 text-[color:var(--signal-emerald)]"><Satellite className="h-3 w-3" />Imagery</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
