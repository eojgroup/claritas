import type { ReactNode } from "react";
import { ArrowUpRight, ChevronDown, RadioTower, Satellite } from "lucide-react";
import {
  isNewsTranslationRequired,
  newsDisplaySummary,
  newsDisplayTitle,
  type NewsItem,
} from "../lib/api";

const LEADERSHIP_ROLE_PATTERN =
  "(?:president|prime minister|premier|chancellor|monarch|king|queen|head of state|head of government)";
const LEADERSHIP_TRANSITION_PATTERN =
  "(?:resign(?:s|ed|ation)?|steps? down|ousted|removed from office|sworn in|inaugurated|succeeds?|takes? office|dies|died|death)";
const LEADERSHIP_CHANGE_PATTERN = new RegExp(
  `(?:${LEADERSHIP_ROLE_PATTERN}.{0,60}${LEADERSHIP_TRANSITION_PATTERN}|${LEADERSHIP_TRANSITION_PATTERN}.{0,60}${LEADERSHIP_ROLE_PATTERN}|(?:appoint(?:s|ed)|named).{0,24}${LEADERSHIP_ROLE_PATTERN})`,
  "i",
);

const newsTimestampParts = (value: string | null | undefined) => {
  if (!value) return { date: "No date", time: "—", zone: "Zone unavailable", exact: "Timestamp unavailable" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value, time: "—", zone: "Zone unavailable", exact: value };
  const exactFormatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  return {
    date: new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date),
    time: new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date),
    zone: exactFormatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "Local time",
    exact: exactFormatter.format(date),
  };
};

function isLeadershipChangeStory(item: NewsItem): boolean {
  const text = `${newsDisplayTitle(item)} ${newsDisplaySummary(item) ?? ""} ${item.title ?? ""} ${item.summary ?? ""}`;
  return (
    /\bleadership (?:change|transition|succession)\b/i.test(text) ||
    /\b(?:new president|new prime minister|president-elect)\b/i.test(text) ||
    LEADERSHIP_CHANGE_PATTERN.test(text)
  );
}

type PriorityNewsListProps = {
  items: NewsItem[];
  selectedId: number | null;
  primaryCountry?: string | null;
  secondaryCountry?: string | null;
  emptyState: ReactNode;
  getImageUrl: (item: NewsItem) => string | undefined;
  getSourceLabel: (item: NewsItem) => string | undefined;
  getCountryName: (iso: string) => string;
  onToggle: (item: NewsItem, iso?: string) => void;
  onRequestTranslation?: (item: NewsItem) => void | Promise<void>;
  translationPendingIds?: Set<number>;
  translationErrorIds?: Set<number>;
  onSelectCountry: (iso: string) => void;
  onOpenWorkspace?: () => void;
  onOpenEvent?: (eventId: string) => void;
};

export default function PriorityNewsList({
  items,
  selectedId,
  primaryCountry,
  secondaryCountry,
  emptyState,
  getImageUrl,
  getSourceLabel,
  getCountryName,
  onToggle,
  onRequestTranslation,
  translationPendingIds,
  translationErrorIds,
  onSelectCountry,
  onOpenWorkspace,
  onOpenEvent,
}: PriorityNewsListProps) {
  const primaryIso = primaryCountry?.toUpperCase();
  const secondaryIso = secondaryCountry?.toUpperCase();

  return (
    <div className="priority-news-list">
      {items.length > 0 && (
        <div className="dashboard-news-columns" aria-hidden="true">
          <span>Priority</span>
          <span>Time</span>
          <span>Place</span>
          <span>Headline</span>
          <span>Source</span>
          <span />
        </div>
      )}
      {items.length === 0 && emptyState}
      {items.map((item, index) => {
        const img = getImageUrl(item);
        const sourceLabel = getSourceLabel(item);
        const iso = item.country_iso2?.toUpperCase();
        const payload =
          item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
            ? (item.payload as Record<string, unknown>)
            : null;
        const countryAttribution =
          typeof payload?.country_attribution === "string"
            ? payload.country_attribution
            : null;
        const isPublisherCountryFallback =
          countryAttribution === "publisher_country_fallback";
        const [publisherLabel, providerLabel] = sourceLabel?.split(" · via ") ?? [];
        const selectedStory = selectedId === item.id;
        const isPrimary = Boolean(iso && primaryIso === iso);
        const isSecondary = Boolean(iso && secondaryIso === iso);
        const priorityBand = index < 3 ? "P1" : index < 10 ? "P2" : "P3";
        const isLeadershipChange = isLeadershipChangeStory(item);
        const translationRequired = isNewsTranslationRequired(item);
        const translated = Boolean(item.translated_title?.trim());
        const displayTitle = newsDisplayTitle(item);
        const displaySummary = newsDisplaySummary(item);
        const translationPending = translationPendingIds?.has(item.id) ?? false;
        const translationUnavailable = Boolean(
          translationErrorIds?.has(item.id) &&
          item.translation?.summary_status !== "generated" &&
          item.translation?.summary_status !== "insufficient",
        );
        const linkedEvents = item.linked_events ?? [];
        const timestamp = newsTimestampParts(item.event_time);
        const satelliteState = linkedEvents.find((event) => (
          event.earth_observation_state && event.earth_observation_state !== "not_requested"
        ))?.earth_observation_state;
        const satelliteLabel = satelliteState === "imagery_available"
          ? "imagery available"
          : satelliteState === "processing"
            ? "imagery processing"
            : satelliteState === "queued"
              ? "imagery queued"
              : null;

        return (
          <article
            key={item.id}
            className={`dashboard-news-item ${selectedStory ? "is-selected" : ""} ${
              isPrimary ? "is-primary" : isSecondary ? "is-secondary" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => {
                if (!selectedStory && translationRequired) {
                  void onRequestTranslation?.(item);
                }
                onToggle(item, iso);
              }}
              className="dashboard-news-summary"
              aria-expanded={selectedStory}
            >
              <span
                className={`news-priority-marker ${index < 3 ? "is-high" : ""}`}
                title={`Priority band ${priorityBand}; rank ${index + 1}`}
              >
                <small>{priorityBand}</small>
                {String(index + 1).padStart(2, "0")}
              </span>
              <time
                className="dashboard-news-time"
                dateTime={item.event_time ?? undefined}
                title={timestamp.exact}
              >
                <strong>{timestamp.time}</strong>
                <small>{timestamp.date}</small>
                <small>{timestamp.zone}</small>
              </time>
              <span
                className="dashboard-news-country"
                data-inferred={isPublisherCountryFallback || undefined}
                title={
                  isPublisherCountryFallback
                    ? "Low-confidence geography fallback: publisher country; the story location was not resolved"
                    : iso
                      ? "Resolved story geography"
                      : "Story geography is not resolved"
                }
              >
                {iso ?? "—"}{isPublisherCountryFallback ? "~" : ""}
              </span>
              <span className="dashboard-news-headline">
                <strong>{displayTitle}</strong>
                {translated && item.translation ? (
                  <span
                    className="news-leadership-change"
                    title={`AI-translated headline · ${item.translation.provider}${item.translation.model ? ` / ${item.translation.model}` : ""}`}
                  >
                    AI translation · {item.language_code?.toUpperCase() ?? "SOURCE"}→{item.translation.target_language_code.toUpperCase()}
                  </span>
                ) : item.language_code ? (
                  <span
                    className="news-leadership-change"
                    title={translationRequired
                      ? translationPending
                        ? "English translation is being generated from the stored publisher text"
                        : translationUnavailable
                          ? "The optional English translation could not be generated; the original source remains available"
                          : "Original publisher language; English translation starts when this story is opened"
                      : "Original article language"}
                  >
                    {item.language_code.toUpperCase()}{translationRequired
                      ? translationPending
                        ? "→EN · translating"
                        : translationUnavailable
                          ? " source · English unavailable"
                          : " source · English on open"
                      : ""}
                  </span>
                ) : null}
                {isLeadershipChange && (
                  <span
                    className="news-leadership-change"
                    title="Leadership change reported by this news item"
                  >
                    Leadership change
                  </span>
                )}
                {linkedEvents.length > 0 && (
                  <span
                    className="news-leadership-change"
                    title={`${linkedEvents.length} event ${linkedEvents.length === 1 ? "investigation" : "investigations"} linked by the Claritas evidence graph`}
                  >
                    {linkedEvents.length} linked {linkedEvents.length === 1 ? "event" : "events"}
                    {satelliteLabel ? ` · ${satelliteLabel}` : ""}
                  </span>
                )}
                <small>
                  {translationPending
                    ? "Generating a short English summary from the available source excerpt…"
                    : displaySummary ??
                      (translationRequired
                        ? translationUnavailable
                          ? "English enrichment is temporarily unavailable. The original publisher report remains usable."
                          : "Open to translate the headline and available source excerpt."
                        : "Select for source and country context.")}
                </small>
                <span className="dashboard-news-mobile-source">
                  {publisherLabel || sourceLabel || "Unknown"}
                  {providerLabel ? ` · via ${providerLabel}` : ""}
                </span>
              </span>
              <span
                className="dashboard-news-source"
                title={sourceLabel ?? "Unknown source"}
              >
                <strong>{publisherLabel || sourceLabel || "Unknown"}</strong>
                {providerLabel && <small>via {providerLabel}</small>}
              </span>
              <ChevronDown
                className={`h-4 w-4 ${selectedStory ? "rotate-180" : ""}`}
              />
            </button>

            {selectedStory && (
              <div className="dashboard-news-detail">
                {img && (
                  <figure>
                    <img
                      src={img}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  </figure>
                )}
                <div>
                  <div className="dashboard-news-detail-meta">
                    <span>{sourceLabel ?? "Unknown source"}</span>
                    {item.language_code && <span>Language {item.language_code.toUpperCase()}</span>}
                    {translated && item.translation && (
                      <span>
                        AI translation · {item.translation.provider}
                        {item.translation.model ? ` / ${item.translation.model}` : ""}
                      </span>
                    )}
                    {item.source_country_iso2 && <span>Published in {item.source_country_iso2}</span>}
                    {isPublisherCountryFallback && (
                      <span>Geography inferred from publisher country · low confidence</span>
                    )}
                    {typeof item.tone === "number" && <span>Tone {item.tone.toFixed(1)}</span>}
                    <span>
                      {iso
                        ? `${getCountryName(iso)} · ${iso}`
                        : "Unmapped geography"}
                    </span>
                    <span>
                      {timestamp.exact}
                    </span>
                  </div>
                  {item.ai_summary && item.translation?.summary_status === "generated" && (
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">
                      AI-generated English summary · based only on source headline/excerpt
                    </div>
                  )}
                  <p>{
                    translationPending
                      ? "Generating a short English summary…"
                      : displaySummary ??
                        (item.translation?.summary_status === "insufficient"
                          ? "No English summary was generated because the available source excerpt was insufficient."
                          : "No English summary is available. Open the publisher source for the full story.")
                  }</p>
                  {translationRequired && (
                    <div className="mt-3 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface-muted)] p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">
                        Original publisher text · {item.language_code?.toUpperCase() ?? "unknown language"}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-[color:var(--shell-ink)]">
                        {item.title ?? item.url ?? "Untitled"}
                      </p>
                      {item.summary && (
                        <p className="mt-1 text-xs text-[color:var(--shell-muted)]">{item.summary}</p>
                      )}
                    </div>
                  )}
                  {translationRequired && translationUnavailable && !translationPending && (
                    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-[color:var(--signal-amber)] bg-[color:var(--signal-amber-soft)] p-3 text-xs text-[color:var(--shell-ink)]">
                      <span className="min-w-0 flex-1">
                        {translated
                          ? "The translated headline is available, but the optional English summary could not be generated."
                          : "Automatic English translation is temporarily unavailable."} No source text was discarded or replaced.
                      </span>
                      <button
                        type="button"
                        className="rounded-full border border-[color:var(--shell-border-strong)] px-3 py-1 font-semibold hover:border-[color:var(--shell-ink)]"
                        onClick={() => void onRequestTranslation?.(item)}
                      >
                        {translated ? "Retry English summary" : "Retry translation"}
                      </button>
                    </div>
                  )}
                  {iso && isPrimary && (
                    <div className="dashboard-news-link-state">
                      <span className="live-dot" />
                      Map, country profile, and analytics are linked to {iso}.
                    </div>
                  )}
                  {linkedEvents.length > 0 && (
                    <div className="mt-3 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--signal-sky-soft)] p-3">
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)]">
                        <RadioTower className="h-3.5 w-3.5" />
                        Event investigations
                      </div>
                      <div className="mt-2 space-y-2">
                        {linkedEvents.slice(0, 3).map((linkedEvent) => (
                          <button
                            key={linkedEvent.id}
                            type="button"
                            onClick={() => onOpenEvent?.(linkedEvent.id)}
                            className="flex w-full items-start gap-3 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-2 text-left hover:border-[color:var(--shell-ink)]"
                          >
                            <span className="mt-0.5 rounded-full border border-[color:var(--shell-border)] px-2 py-0.5 text-[9px] font-semibold uppercase text-[color:var(--shell-muted)]">
                              {linkedEvent.severity}
                            </span>
                            <span className="min-w-0 flex-1">
                              <strong className="block text-xs text-[color:var(--shell-ink)]">
                                {linkedEvent.title}
                              </strong>
                              <small className="mt-0.5 block text-[color:var(--shell-muted)]">
                                {linkedEvent.correlation_score == null
                                  ? "linked evidence"
                                  : `${Math.round(linkedEvent.correlation_score * 100)}% correlation score`}
                                {linkedEvent.earth_observation_state === "imagery_available"
                                  ? " · imagery available"
                                  : linkedEvent.earth_observation_state === "processing"
                                    ? " · imagery processing"
                                    : linkedEvent.earth_observation_state === "queued"
                                      ? " · imagery queued"
                                      : ""}
                              </small>
                            </span>
                            {linkedEvent.earth_observation_state === "imagery_available" ? (
                              <Satellite className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--signal-sky)]" />
                            ) : (
                              <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="dashboard-news-actions">
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open source
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {iso && (
                      <button
                        type="button"
                        onClick={() => onSelectCountry(iso)}
                      >
                        Open country context
                      </button>
                    )}
                    {onOpenWorkspace && (
                      <button type="button" onClick={onOpenWorkspace}>
                        Analyze in News
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
