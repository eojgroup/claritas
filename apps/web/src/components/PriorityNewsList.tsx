import type { ReactNode } from "react";
import { ArrowUpRight, ChevronDown, RadioTower, Satellite } from "lucide-react";
import {
  isNewsTranslationRequired,
  newsDisplaySummary,
  newsDisplayTitle,
  type NewsItem,
  type NewsTag,
} from "../lib/api";
import { presentEventLinkage } from "./eventLinkagePresentation";

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

const newsTimeBasisLabel = (item: NewsItem) => {
  const payload =
    item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
      ? (item.payload as Record<string, unknown>)
      : null;
  const basis = item.time?.basis || (typeof payload?.time_basis === "string" ? payload.time_basis : "");
  if (basis === "provider_first_seen") return "First seen";
  if (basis === "publisher_published_or_provider_discovered") return "Source time";
  if (basis.startsWith("publisher_")) return "Published";
  return item.time?.is_publisher_verified ? "Published" : "Reported";
};

function isLeadershipChangeStory(item: NewsItem): boolean {
  const text = `${newsDisplayTitle(item)} ${newsDisplaySummary(item) ?? ""} ${item.title ?? ""} ${item.summary ?? ""}`;
  return (
    /\bleadership (?:change|transition|succession)\b/i.test(text) ||
    /\b(?:new president|new prime minister|president-elect)\b/i.test(text) ||
    LEADERSHIP_CHANGE_PATTERN.test(text)
  );
}

const NEWS_TAG_PRESENTATION_PRIORITY: Record<NewsTag["kind"], number> = {
  event: 0,
  evidence: 1,
  topic: 2,
  category: 3,
};

function presentationTags(tags: NewsTag[] | undefined): NewsTag[] {
  const seen = new Set<string>();
  return (tags ?? [])
    .map((tag, index) => ({ tag, index }))
    .filter(({ tag }) => {
      const code = tag.code.trim().toLocaleLowerCase();
      if (!code || !tag.label.trim() || seen.has(code)) return false;
      seen.add(code);
      return true;
    })
    .sort((left, right) => (
      NEWS_TAG_PRESENTATION_PRIORITY[left.tag.kind] - NEWS_TAG_PRESENTATION_PRIORITY[right.tag.kind]
      || left.index - right.index
    ))
    .slice(0, 3)
    .map(({ tag }) => tag);
}

type PriorityNewsListProps = {
  items: NewsItem[];
  selectedId: number | null;
  primaryCountry?: string | null;
  secondaryCountry?: string | null;
  emptyState: ReactNode;
  getImageUrl: (item: NewsItem) => string | undefined;
  getSourceLabel: (item: NewsItem) => string | undefined;
  getCountries: (item: NewsItem) => string[];
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
  getCountries,
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
          <span>Importance</span>
          <span>Time</span>
          <span>Place</span>
          <span>Headline</span>
          <span>Source</span>
          <span />
        </div>
      )}
      {items.length === 0 && emptyState}
      {items.map((item) => {
        const img = getImageUrl(item);
        const sourceLabel = getSourceLabel(item);
        const countries = getCountries(item);
        const iso = primaryIso && countries.includes(primaryIso)
          ? primaryIso
          : secondaryIso && countries.includes(secondaryIso)
            ? secondaryIso
            : countries[0];
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
        const isPrimary = Boolean(primaryIso && countries.includes(primaryIso));
        const isSecondary = Boolean(secondaryIso && countries.includes(secondaryIso));
        const rankingPending = !item.importance || item.importance.is_fallback === true;
        const importanceTier = rankingPending ? null : item.importance?.tier ?? null;
        const importanceTierLabel = importanceTier
          ? `${importanceTier[0].toUpperCase()}${importanceTier.slice(1)}`
          : "Unranked";
        const firstImportanceReason = item.importance?.reasons.find((reason) => reason.label.trim())?.label.trim() ?? null;
        const importanceReason = rankingPending
          ? firstImportanceReason && !/assessment pending/i.test(firstImportanceReason)
            ? `Assessment pending · ${firstImportanceReason}`
            : "Assessment pending"
          : firstImportanceReason;
        const evidenceTags = presentationTags(item.tags);
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
        const timeBasisLabel = newsTimeBasisLabel(item);
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
                className={`news-priority-marker ${importanceTier ? `is-${importanceTier}` : "is-unranked"}`}
                aria-label={rankingPending
                  ? "Unranked: assessment pending"
                  : `Importance ${importanceTierLabel}${importanceReason ? `: ${importanceReason}` : ""}`}
              >
                <small>{rankingPending ? "Assessment" : "Importance"}</small>
                <span>{importanceTierLabel}</span>
              </span>
              <time
                className="dashboard-news-time"
                dateTime={item.event_time ?? undefined}
                title={timestamp.exact}
              >
                <strong>{timestamp.time}</strong>
                <small>{timeBasisLabel} · {timestamp.date}</small>
                <small>{timestamp.zone}</small>
              </time>
              <span
                className="dashboard-news-country"
                data-inferred={isPublisherCountryFallback || undefined}
                title={
                  isPublisherCountryFallback
                    ? "Low-confidence geography fallback: publisher country; the story location was not resolved"
                    : countries.length > 0
                      ? "Resolved story geography"
                      : "Story geography is not resolved"
                }
              >
                {countries.length > 0 ? countries.join(" · ") : "—"}{isPublisherCountryFallback ? "~" : ""}
              </span>
              <span className="dashboard-news-headline">
                <strong>{displayTitle}</strong>
                {importanceReason && (
                  <span className="news-importance-reason">
                    {rankingPending ? "Ranking status" : "Why it ranks"}: {importanceReason}
                  </span>
                )}
                {evidenceTags.length > 0 && (
                  <span className="news-evidence-tags" aria-label="Story tags">
                    {evidenceTags.map((tag) => (
                      <span key={tag.code} className="news-evidence-tag">{tag.label}</span>
                    ))}
                  </span>
                )}
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
                    className="news-event-link-summary"
                    title={`${linkedEvents.length} likely linked ${linkedEvents.length === 1 ? "event investigation" : "event investigations"}. Claritas shows the matching rationale after the story is opened.`}
                  >
                    {linkedEvents.length} likely linked {linkedEvents.length === 1 ? "event" : "events"}
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
                  {timestamp.time} · {countries.length > 0 ? countries.join("/") : "Global"} · {" "}
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
                  <figure className="dashboard-news-image">
                    <img
                      src={img}
                      alt={`Image supplied with the report: ${displayTitle}`}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                    <figcaption>Image supplied with this report · it is not evidence for a linked event by itself.</figcaption>
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
                      {rankingPending
                        ? "Unranked · assessment pending"
                        : item.importance
                          ? `${importanceTierLabel} importance · ${Math.round(Math.max(0, Math.min(1, item.importance.confidence)) * 100)}% confidence`
                          : "Unranked · assessment pending"}
                    </span>
                    <span>
                      {countries.length > 0
                        ? countries.map((country) => `${getCountryName(country)} · ${country}`).join(" / ")
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
                        Likely linked investigations
                      </div>
                      <p className="event-link-panel-intro">These connections are ranked from matching evidence such as location, timing, or entities. They are not claims that one signal caused another.</p>
                      <div className="mt-2 space-y-2">
                        {linkedEvents.slice(0, 3).map((linkedEvent) => {
                          const linkage = presentEventLinkage(
                            linkedEvent.correlation_score,
                            linkedEvent.correlation_factors,
                          );
                          return (
                            <button
                              key={linkedEvent.id}
                              type="button"
                              disabled={!onOpenEvent}
                              onClick={() => onOpenEvent?.(linkedEvent.id)}
                              aria-label={`Open ${linkage.label.toLocaleLowerCase()} event investigation: ${linkedEvent.title}`}
                              className="event-link-card flex w-full items-start gap-3 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <span className="mt-0.5 rounded-full border border-[color:var(--shell-border)] px-2 py-0.5 text-[9px] font-semibold uppercase text-[color:var(--shell-muted)]">
                                {linkedEvent.severity}
                              </span>
                              <span className="min-w-0 flex-1">
                                <strong className="block text-xs text-[color:var(--shell-ink)]">
                                  {linkedEvent.title}
                                </strong>
                                <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px]">
                                  <span className="event-link-chip">{linkage.label} event</span>
                                  {linkedEvent.earth_observation_state === "imagery_available"
                                    ? <span className="text-[color:var(--signal-emerald)]">Imagery available</span>
                                    : linkedEvent.earth_observation_state === "processing"
                                      ? <span>Imagery processing</span>
                                      : linkedEvent.earth_observation_state === "queued"
                                        ? <span>Imagery queued</span>
                                        : null}
                                </span>
                                <small className="event-link-reason">Why shown: {linkage.shortReason}</small>
                              </span>
                              {linkedEvent.earth_observation_state === "imagery_available" ? (
                                <Satellite className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--signal-sky)]" />
                              ) : (
                                <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0" />
                              )}
                            </button>
                          );
                        })}
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
