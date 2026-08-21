import type { NewsCategoryFilter } from "../lib/api";

export const NEWS_CATEGORY_OPTIONS: ReadonlyArray<{
  id: NewsCategoryFilter;
  label: string;
}> = [
  { id: "all", label: "All categories" },
  { id: "markets", label: "Markets" },
  { id: "economy", label: "Economy" },
  { id: "companies", label: "Companies" },
  { id: "geopolitics", label: "Geopolitics" },
  { id: "policy", label: "Policy" },
  { id: "energy", label: "Energy" },
  { id: "technology", label: "Technology" },
  { id: "climate_disasters", label: "Climate & disasters" },
  { id: "health", label: "Health" },
  { id: "transport", label: "Transport" },
  { id: "other", label: "Other" },
];

export function newsCategoryLabel(category: NewsCategoryFilter): string {
  return NEWS_CATEGORY_OPTIONS.find((option) => option.id === category)?.label ?? "All categories";
}
