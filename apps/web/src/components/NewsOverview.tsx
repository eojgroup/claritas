import { useState } from "react";
import { ArrowUpRight, Newspaper, RadioTower } from "lucide-react";
import type { NewsItem } from "../lib/api";
import { latestNewsTimestamp, newsTopicFacets, type NewsTopic } from "./newsWorkspacePresentation";

type Props = {
  items: NewsItem[];
  visibleCount: number;
  scope: string;
  selectedTopic: Pick<NewsTopic, "code" | "label"> | null;
  onSelectTopic: (topic: Pick<NewsTopic, "code" | "label"> | null) => void;
  onOpenInvestigations: () => void;
  loading?: boolean;
};

export default function NewsOverview({ items, visibleCount, scope, selectedTopic, onSelectTopic, onOpenInvestigations, loading }: Props) {
  const [showAllTopics, setShowAllTopics] = useState(false);
  const topics = newsTopicFacets(items);
  const visibleTopics = showAllTopics ? topics : topics.slice(0, 8);
  const selectedFacet = topics.find((topic) => topic.code === selectedTopic?.code);
  if (selectedFacet && !visibleTopics.includes(selectedFacet)) visibleTopics.push(selectedFacet);
  const latest = latestNewsTimestamp(items);
  const linkedStories = items.filter((item) => item.linked_events?.length).length;
  const timeLabel = latest ? new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(latest)) : "No dated stories";

  return (
    <section className="news-overview" aria-label="Reporting at a glance" aria-busy={loading}>
      <div className="news-overview-heading">
        <div>
          <span className="news-overview-eyebrow">Your news desk · {scope}</span>
          <h2>Reporting at a glance</h2>
          <p>Browse reports in time order. Open any story to investigate its connections across all sources.</p>
        </div>
        <button type="button" className="news-overview-action" onClick={onOpenInvestigations}>
          <RadioTower aria-hidden="true" size={16} /> Explore event evidence <ArrowUpRight aria-hidden="true" size={15} />
        </button>
      </div>
      <dl className="news-overview-stats">
        <div><dt>Stories shown</dt><dd>{loading ? "—" : visibleCount.toLocaleString()} <span>of {items.length.toLocaleString()} loaded</span></dd></div>
        <div><dt>Topics</dt><dd>{loading ? "—" : topics.length.toLocaleString()} <span>in loaded reporting</span></dd></div>
        <div><dt>Linked to events</dt><dd>{loading ? "—" : linkedStories.toLocaleString()} <span>reports with context</span></dd></div>
        <div><dt>Latest source time</dt><dd className="news-overview-latest"><time dateTime={latest ?? undefined}>{loading ? "Updating…" : timeLabel}</time></dd></div>
      </dl>
      {(topics.length > 0 || selectedTopic) && (
        <div className="news-topic-section">
          <div className="news-topic-heading"><Newspaper size={14} aria-hidden="true" /><span>Topics in loaded reporting</span><small>Select to filter headlines</small></div>
          <div className="news-topic-list" role="group" aria-label="Filter reporting by topic">
            <button type="button" aria-pressed={!selectedTopic} onClick={() => onSelectTopic(null)}>All topics <span>{items.length}</span></button>
            {visibleTopics.map((topic) => (
              <button key={topic.code} type="button" aria-pressed={selectedTopic?.code === topic.code} onClick={() => onSelectTopic(selectedTopic?.code === topic.code ? null : topic)}>
                {topic.label} <span>{topic.count}</span>
              </button>
            ))}
          </div>
          {topics.length > 8 && <button type="button" className="news-topic-expand" aria-expanded={showAllTopics} onClick={() => setShowAllTopics(!showAllTopics)}>{showAllTopics ? "Show leading topics" : `Show all ${topics.length} topics`}</button>}
          {selectedTopic && <p className="news-topic-selection" role="status">Showing {visibleCount} {visibleCount === 1 ? "story" : "stories"} tagged “{selectedTopic.label}”. <button type="button" onClick={() => onSelectTopic(null)}>Clear topic</button></p>}
        </div>
      )}
    </section>
  );
}
