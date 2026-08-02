import type { ReactNode } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { NewsItem } from "../lib/api";

const LEADERSHIP_ROLE_PATTERN =
  "(?:president|prime minister|premier|chancellor|monarch|king|queen|head of state|head of government)";
const LEADERSHIP_TRANSITION_PATTERN =
  "(?:resign(?:s|ed|ation)?|steps? down|ousted|removed from office|sworn in|inaugurated|succeeds?|takes? office|dies|died|death)";
const LEADERSHIP_CHANGE_PATTERN = new RegExp(
  `(?:${LEADERSHIP_ROLE_PATTERN}.{0,60}${LEADERSHIP_TRANSITION_PATTERN}|${LEADERSHIP_TRANSITION_PATTERN}.{0,60}${LEADERSHIP_ROLE_PATTERN}|(?:appoint(?:s|ed)|named).{0,24}${LEADERSHIP_ROLE_PATTERN})`,
  "i",
);

function isLeadershipChangeStory(item: NewsItem): boolean {
  const text = `${item.title ?? ""} ${item.summary ?? ""}`;
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
  onSelectCountry: (iso: string) => void;
  onOpenWorkspace?: () => void;
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
  onSelectCountry,
  onOpenWorkspace,
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
        const selectedStory = selectedId === item.id;
        const isPrimary = Boolean(iso && primaryIso === iso);
        const isSecondary = Boolean(iso && secondaryIso === iso);
        const priorityBand = index < 3 ? "P1" : index < 10 ? "P2" : "P3";
        const isLeadershipChange = isLeadershipChangeStory(item);

        return (
          <article
            key={item.id}
            className={`dashboard-news-item ${selectedStory ? "is-selected" : ""} ${
              isPrimary ? "is-primary" : isSecondary ? "is-secondary" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => onToggle(item, iso)}
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
              <span className="dashboard-news-time">
                <strong>
                  {item.event_time
                    ? new Date(item.event_time).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </strong>
                <small>
                  {item.event_time
                    ? new Date(item.event_time).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })
                    : "No time"}
                </small>
              </span>
              <span className="dashboard-news-country">{iso ?? "—"}</span>
              <span className="dashboard-news-headline">
                <strong>{item.title || item.url || "Untitled"}</strong>
                {isLeadershipChange && (
                  <span
                    className="news-leadership-change"
                    title="Leadership change reported by this news item"
                  >
                    Leadership change
                  </span>
                )}
                <small>
                  {item.summary ?? "Select for source and country context."}
                </small>
              </span>
              <span className="dashboard-news-source">
                {sourceLabel ?? "Unknown"}
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
                    <span>
                      {iso
                        ? `${getCountryName(iso)} · ${iso}`
                        : "Unmapped geography"}
                    </span>
                    <span>
                      {item.event_time
                        ? new Date(item.event_time).toLocaleString()
                        : "Timestamp unavailable"}
                    </span>
                  </div>
                  <p>
                    {item.summary ??
                      "No publisher summary is available. Open the source for the full story."}
                  </p>
                  {iso && isPrimary && (
                    <div className="dashboard-news-link-state">
                      <span className="live-dot" />
                      Map, country profile, and analytics are linked to {iso}.
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
