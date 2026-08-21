import { useId } from "react";
import type { NewsCategory, NewsCategoryFilter } from "../lib/api";
import { NEWS_CATEGORY_OPTIONS } from "./newsCategoryPresentation";

type NewsCategoryControlProps = {
  selected: NewsCategoryFilter;
  onSelect: (category: NewsCategoryFilter) => void;
  resultSummary: string;
  categoryCounts?: Partial<Record<NewsCategory, number>>;
  allCount?: number;
  loading?: boolean;
  compact?: boolean;
};

export default function NewsCategoryControl({
  selected,
  onSelect,
  resultSummary,
  categoryCounts,
  allCount,
  loading = false,
  compact = false,
}: NewsCategoryControlProps) {
  const labelId = useId();
  const statusId = useId();

  return (
    <div className={`news-category-control ${compact ? "is-compact" : ""}`}>
      <div className="news-category-control-heading">
        <span id={labelId}>Browse by category</span>
        <span id={statusId} role="status" aria-live="polite" aria-atomic="true">
          {loading ? "Updating reporting…" : resultSummary}
        </span>
      </div>
      <div
        className="news-category-scroll"
        role="group"
        aria-labelledby={labelId}
        aria-describedby={statusId}
        aria-busy={loading}
      >
        {NEWS_CATEGORY_OPTIONS.map((option) => {
          const active = option.id === selected;
          const count = option.id === "all" ? allCount : categoryCounts?.[option.id];
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(option.id)}
              className={`news-category-button ${active ? "is-active" : ""}`}
            >
              <span>{option.label}</span>
              {typeof count === "number" && (
                <span className="news-category-count" aria-label={`${count} stories`}>{count.toLocaleString()}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
