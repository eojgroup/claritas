import { useEffect, useState } from "react";
import { ArrowUpRight, RadioTower } from "lucide-react";
import { fetchIntelligenceEvents, type IntelligenceEvent } from "../lib/api";

type Props = {
  country?: string | null;
  onOpen: () => void;
};

const severityClass: Record<IntelligenceEvent["severity"], string> = {
  critical: "border-rose-300 bg-rose-50 text-rose-800",
  high: "border-amber-300 bg-amber-50 text-amber-800",
  medium: "border-sky-300 bg-sky-50 text-sky-800",
  low: "border-slate-300 bg-slate-50 text-slate-700",
};

export default function IntelligenceEventStrip({ country, onOpen }: Props) {
  const [events, setEvents] = useState<IntelligenceEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchIntelligenceEvents({ limit: 4, country: country || undefined })
      .then((rows) => {
        if (active) setEvents(rows);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
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
              Correlated event pulse
            </div>
            <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
              {events.length ? `${events.length} highest-relevance changes` : "No material correlated changes"}
            </div>
          </div>
        </div>
        <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--shell-ink)]">
          Open workspace <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
      {events.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {events.map((event) => (
            <button key={event.id} type="button" onClick={onOpen} className="rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3 text-left transition hover:border-[color:var(--shell-ink)]">
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${severityClass[event.severity]}`}>
                  {event.severity}
                </span>
                <span className="text-[10px] text-[color:var(--shell-muted)]">{Math.round(event.confidence * 100)}% confidence</span>
              </div>
              <div className="mt-2 line-clamp-2 text-sm font-semibold text-[color:var(--shell-ink)]">{event.title}</div>
              <div className="mt-1 text-[11px] text-[color:var(--shell-muted)]">
                {event.location_name || event.primary_country_iso2 || "Global"} · {event.domain_count} domains · {event.evidence_count} evidence
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
