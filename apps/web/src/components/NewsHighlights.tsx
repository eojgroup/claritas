import { useEffect, useState } from "react";
import { fetchNews, newsDisplayTitle, newsDisplaySummary, type NewsCategory, type NewsItem } from "../lib/api";
import { newsChronology } from "./newsWorkspacePresentation";

/** A separate editorial shortlist: never changes the chronological reader feed. */
export default function NewsHighlights({ country, category }: { country: string | null; category: NewsCategory | "all" }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [scope, setScope] = useState("");
  const key = `${country ?? "global"}|${category}`;
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      setLoading(true);
      try {
        const result = await fetchNews({ limit: 3, country: country ?? undefined,
          category: category === "all" ? undefined : category,
          sort: "importance", daily: true, includeMetadata: false }, controller.signal);
        if (!controller.signal.aborted) {
          setItems(result.items);
          setScope(key);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) { setItems([]); setError(true); setScope(key); }
      } finally {
        running = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 300_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [country, category, key]);
  const visible = scope === key ? items : [];
  return <section className="news-highlights" aria-label="Top news from the past 24 hours">
    <div className="news-highlights-heading"><h2>Top news <span>· past 24 hours</span></h2>
      <small>Ranked by importance · refreshes every 5 minutes</small></div>
    {visible.length > 0 ? <ol>{visible.map((item, index) => <li key={item.id}>
      <span className="news-highlight-rank" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <div><small>{item.publisher || item.source_name || "Reporting source"} · {newsChronology(item).label} {newsChronology(item).timestamp && new Date(newsChronology(item).timestamp!).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
        {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{newsDisplayTitle(item)}</a> : <strong>{newsDisplayTitle(item)}</strong>}
        {newsDisplaySummary(item) && <p>{newsDisplaySummary(item)}</p>}
      </div></li>)}</ol> : <p role="status">{loading || scope !== key ? "Loading highlights…" : error ? "Highlights are temporarily unavailable. Latest reporting remains below." : "No stories in the past 24 hours for this scope."}</p>}
  </section>;
}
