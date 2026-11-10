import { useMemo, useState } from "react";
import { ArrowUpRight, MapPin, RefreshCw } from "lucide-react";
import type { IntelligenceOverview, OverviewTopic } from "../lib/api";
import SatelliteImage from "./SatelliteImage";
import CountryFlag from "./CountryFlag";
import { isHistoricalEvent } from "./eventPresentation";
import HeadlineTranslation from "./HeadlineTranslation";
import { displayHeadline } from "../lib/headlineTranslation";

const OVERVIEW_TOPICS: Array<{ key: OverviewTopic; label: string }> = [
  { key: "security", label: "Security" }, { key: "disasters", label: "Disasters" },
  { key: "weather", label: "Weather" }, { key: "transport", label: "Transport" },
  { key: "markets", label: "Markets" }, { key: "agriculture", label: "Agriculture" },
  { key: "developments", label: "Other developments" },
];
type Props = {
  variant?: "all" | "summary" | "timeline";
  overview: IntelligenceOverview | null;
  loading: boolean;
  error: string | null;
  hours: 24 | 72 | 168;
  topic: OverviewTopic | null;
  priority?: "high" | "all";
  onPriorityChange?: (priority: "high" | "all") => void;
  country?: string | null;
  selectedId?: string | null;
  onHoursChange: (hours: 24 | 72 | 168) => void;
  onTopicChange: (topic: OverviewTopic | null) => void;
  onCountryChange: (country: string | null) => void;
  onSelect: (eventId: string) => void;
  onOpenImagery: (eventId: string) => void;
  onRefresh: () => void;
};
function timeLabel(value: string, day = true) {
  return new Date(value).toLocaleString(undefined, { ...(day ? { month: "short", day: "numeric" } as const : {}), hour: "2-digit", minute: "2-digit" });
}
function periodLabel(hours: number) { return hours === 24 ? "24 hours" : `${hours / 24} days`; }
function changeLabel(change: number) { return change === 0 ? "the same as" : `${Math.abs(change)} ${change > 0 ? "more" : "fewer"} than`; }

export default function SituationOverview({ variant = "all", overview, loading, error, hours, topic, priority = "high", onPriorityChange, country, selectedId, onHoursChange, onTopicChange, onCountryChange, onSelect, onOpenImagery, onRefresh }: Props) {
  const [expanded, setExpanded] = useState(false);
  const scopeMatches = overview?.window.hours === hours && (overview.filters.topic ?? null) === topic
    && (overview.filters.priority ?? priority) === priority
    && (overview.filters.country ?? "").toUpperCase() === (country ?? "").toUpperCase();
  const data = scopeMatches ? overview : null;
  const timeline = useMemo(() => data?.timeline ?? [], [data]);
  const visible = expanded ? timeline : timeline.slice(0, 6);
  const maximum = Math.max(1, ...(data?.buckets ?? []).flatMap((item) => [item.event_count, ...(data?.coverage.comparison_available ? [item.previous_event_count] : [])]));
  const leadingTopic = data?.topics.reduce<IntelligenceOverview["topics"][number] | null>((largest, item) => item.event_count > (largest?.event_count ?? 0) ? item : largest, null);
  const resetTimeline = () => setExpanded(false);
  if (variant === "timeline" && (!data || data.snapshot?.status === "warming")) return null;

  return <section className="situation-overview app-card" aria-label={variant === "timeline" ? "Situation timeline" : "Situation overview"} aria-busy={loading}>
    {variant !== "timeline" && <>
    <header className="situation-heading">
      <div><span className="situation-eyebrow">One view across sources</span><h2>World overview{country ? <><CountryFlag country={country} /><span>{country.toUpperCase()}</span></> : null}</h2></div>
      <div className="situation-filters">
        {onPriorityChange && <div className="situation-priority-toggle" role="group" aria-label="Development priority">{(["high", "all"] as const).map((value) => <button key={value} type="button" aria-pressed={priority === value} onClick={() => { resetTimeline(); onPriorityChange(value); }}>{value === "high" ? "High priority" : "All developments"}</button>)}</div>}
        <label>Period<select value={hours} onChange={(event) => { resetTimeline(); onHoursChange(Number(event.target.value) as 24 | 72 | 168); }}><option value={24}>Past 24 hours</option><option value={72}>Past 3 days</option><option value={168}>Past 7 days</option></select></label>
        <label>Topic<select value={topic ?? "all"} onChange={(event) => { resetTimeline(); onTopicChange(event.target.value === "all" ? null : event.target.value as OverviewTopic); }}><option value="all">All topics</option>{OVERVIEW_TOPICS.map((item) => <option key={item.key} value={item.key}>{item.label}{!topic && data ? ` (${data.topics.find((entry) => entry.key === item.key)?.event_count ?? 0})` : ""}</option>)}</select></label>
        <button type="button" onClick={onRefresh} disabled={loading} aria-label="Refresh situation overview"><RefreshCw size={15} className={loading ? "animate-spin" : undefined} /><span>Refresh</span></button>
      </div>
    </header>
    {error && <div className="situation-message" role="alert">{data ? "Could not refresh. Showing the last loaded overview." : "The overview is temporarily unavailable."} <button type="button" onClick={onRefresh} disabled={loading}>Retry overview</button></div>}
    {!data && loading && <p role="status" className="situation-message">Loading the situation overview…</p>}
    </>}
    {data && <>
      {variant !== "timeline" && <>
      {data.snapshot?.status !== "warming" && <div className="situation-summary">
        <p><strong>{data.coverage.truncated ? "At least " : ""}{data.summary.event_count} {data.summary.event_count === 1 ? "development" : "developments"} updated</strong> in the past {periodLabel(hours)}{data.coverage.comparison_available ? ` — ${changeLabel(data.summary.change)} the previous ${periodLabel(hours)}.` : ". Period comparison unavailable."}</p>
        <p>{priority === "all" && <>{data.summary.high_priority_count} high-priority · </>}{data.summary.location_count} {data.summary.location_count === 1 ? "place" : "places"}{leadingTopic && !topic ? ` · Most updates: ${leadingTopic.label.toLowerCase()}` : ""}</p>
      </div>}
      {country && <div className="situation-places"><button type="button" onClick={() => { resetTimeline(); onCountryChange(null); }}>All countries ×</button></div>}
      {data.snapshot?.status === "stale" && <p className="situation-snapshot-state">Showing the latest available overview. A fresh update is being prepared.</p>}
      {data.snapshot?.status === "warming" && <p role="status" className="situation-snapshot-state">Preparing the first overview. It will appear here automatically.</p>}
      </>}
      {variant !== "summary" && <>
      {data.buckets.length > 0 && <details className="situation-activity-chart"><summary>Activity over time · {data.summary.event_count} updates</summary><div className="situation-timeline">
        <div className="situation-timeline-heading"><h3>Activity over time</h3><span><i />This period {data.coverage.comparison_available && <><i />Previous period</>}</span></div>
        <div className="situation-bars" role="group" aria-label="Development activity over the full period">{data.buckets.map((item) => <div key={item.start} role="img" aria-label={`${timeLabel(item.start)} to ${timeLabel(item.end)}: ${item.event_count} updates${data.coverage.comparison_available ? `; previous period ${item.previous_event_count}` : "; comparison unavailable"}`}><span className="situation-bar-track">{data.coverage.comparison_available && <span className="situation-bar-previous" style={{ height: `${item.previous_event_count / maximum * 100}%` }} />}<span className="situation-bar-current" style={{ height: `${item.event_count / maximum * 100}%` }} /></span></div>)}</div>
        <div className="situation-timeline-ends"><time dateTime={data.window.start}>{timeLabel(data.window.start)}</time><span>Full selected period</span><time dateTime={data.window.end}>{timeLabel(data.window.end)}</time></div>
      </div></details>}
      <div className="situation-activity-heading"><div><h3>Latest developments</h3><p>Select a development to see its sources and context.</p></div></div>
      <ol className="situation-activity">{visible.map((item) => {
        const event = data.events.find((event) => event.id === item.event_id);
        const archived = event && isHistoricalEvent(event);
        const description = event?.summary?.split(/(?<=[.!?])\s/)[0];
        return <li key={item.event_id} className={selectedId === item.event_id ? "is-selected" : ""}>
          <time dateTime={item.occurred_at}>Updated {timeLabel(item.occurred_at)}</time>
          <div className="situation-event">
            <div className="situation-event-tags"><span className={`event-severity-${item.severity}`}>{item.severity}</span><span>{item.topic_label}</span>{archived && <span>Archived</span>}</div>
            <button type="button" className="situation-event-title" dir="auto" onClick={() => onSelect(item.event_id)} aria-pressed={selectedId === item.event_id}>{displayHeadline(item, item.title)}<ArrowUpRight size={15} /></button>
            <HeadlineTranslation value={item} />
            {description && description !== item.title && <p className="situation-event-summary">{description.length > 180 ? `${description.slice(0, 177)}…` : description}</p>}
            {(item.location_name || item.country_iso2) && <p className="situation-event-place"><MapPin size={13} /><CountryFlag country={item.country_iso2} />{item.location_name || item.country_iso2}</p>}
            {item.source_refs.length > 0 && <details><summary>{item.source_refs.length} source{item.source_refs.length === 1 ? "" : "s"}</summary><div className="situation-event-sources">{item.source_refs.slice(0, 3).map((source, index) => <div key={`${source.domain}-${index}`}>{source.url && /^https?:\/\//i.test(source.url) ? <a dir="auto" href={source.url} target="_blank" rel="noreferrer">{displayHeadline(source, source.label)}</a> : <span dir="auto">{displayHeadline(source, source.label)}</span>}<HeadlineTranslation value={source} /></div>)}</div></details>}
            {item.priority_reasons.length > 0 && <details><summary>Why this needs attention</summary><ul>{item.priority_reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>}
          </div>
          {item.imagery && <button type="button" className="situation-event-image" onClick={() => onOpenImagery(item.event_id)} aria-label={`Inspect imagery for ${item.title}`}><SatelliteImage sources={[item.imagery.preview_url]} alt={`Location context for ${item.title}`} className="h-full w-full object-cover" /><span>{item.imagery.captured_at ? `Captured ${new Date(item.imagery.captured_at).toLocaleDateString()}` : "Location imagery"}<small>{item.imagery.attribution}</small></span></button>}
        </li>;
      })}</ol>
      {!timeline.length && <p className="situation-message">{data.snapshot?.status === "warming" ? "Preparing developments…" : priority === "high" ? "No high-priority developments in this selection. Choose All developments to broaden the view." : "No developments in this selection."}</p>}
      {timeline.length > 6 && <button type="button" className="situation-show-more" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show fewer developments" : `Show ${timeline.length - 6} more developments`}</button>}
      <footer><time dateTime={data.generated_at}>Updated {timeLabel(data.generated_at)}</time><details><summary>Coverage and how to read this</summary><p>{data.coverage.notice}</p><p>{data.coverage.comparison_notice}</p><p>{data.coverage.priority_notice}</p><p>Counts cover the full selected period. Up to 24 recent developments and 40 map events are shown. An update may concern an existing event. Imagery retains its acquisition date.</p></details></footer>
      </>}
    </>}
  </section>;
}
