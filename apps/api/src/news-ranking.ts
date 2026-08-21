export const NEWS_CATEGORIES = ["markets", "economy", "companies", "geopolitics", "policy", "energy", "technology", "climate"] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

type RankedNews = {
  title?: string | null; summary?: string | null; event_time?: string | Date | null;
  publisher?: string | null; source_name?: string | null; tone?: number | string | null;
  payload?: Record<string, unknown> | null;
  linked_events?: Array<{ severity?: string; relevance_score?: number; domain_count?: number }>;
};

const RULES: Array<[NewsCategory, RegExp]> = [
  ["markets", /\b(stock|bond|yield|currency|forex|market|index|shares?|commodity|investor|trading)\b/i],
  ["economy", /\b(inflation|gdp|jobs?|employment|recession|growth|economy|economic|central bank|interest rate)\b/i],
  ["companies", /\b(earnings|revenue|profit|merger|acquisition|ipo|chief executive|company|corporate)\b/i],
  ["geopolitics", /\b(war|conflict|sanction|military|missile|election|diplomatic|border|ceasefire)\b/i],
  ["policy", /\b(government|minister|regulation|regulator|law|tariff|tax|policy|parliament|congress)\b/i],
  ["energy", /\b(oil|gas|energy|power|electricity|opec|pipeline|lng|nuclear)\b/i],
  ["technology", /\b(ai|artificial intelligence|technology|semiconductor|chip|cyber|software|data center)\b/i],
  ["climate", /\b(climate|wildfire|flood|storm|hurricane|earthquake|drought|weather)\b/i],
];

const AUTHORITY = /\b(reuters|bloomberg|associated press|financial times|wall street journal|bbc|central bank|treasury|government|sec|world bank|imf)\b/i;

export function enrichAndRankNews<T extends RankedNews>(items: T[], now = new Date()): Array<T & {
  category: NewsCategory; tags: string[]; importance_score: number; importance_reasons: string[];
}> {
  return items.map((item) => {
    const payload = item.payload && typeof item.payload === "object" ? item.payload : {};
    const sourceCategory = typeof payload.category === "string" ? payload.category.toLowerCase() : "";
    const text = `${item.title ?? ""} ${item.summary ?? ""} ${sourceCategory}`;
    const category = RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? "policy";
    const event = item.linked_events?.[0];
    const severityPoints: Record<string, number> = { critical: 32, high: 24, medium: 12, low: 4 };
    const ageHours = item.event_time ? Math.max(0, (now.getTime() - new Date(item.event_time).getTime()) / 36e5) : 168;
    const freshness = Math.max(0, 24 - Math.min(24, ageHours));
    const reasons: string[] = [];
    let score = freshness;
    if (freshness >= 18) reasons.push("Breaking / recent");
    if (event) {
      score += severityPoints[event.severity?.toLowerCase() ?? ""] ?? 8;
      score += Math.min(18, Math.max(0, Number(event.relevance_score ?? 0) * 18));
      score += Math.min(10, Math.max(0, Number(event.domain_count ?? 0) * 2));
      reasons.push(`${event.severity ?? "Corroborated"} linked event`);
      if ((event.domain_count ?? 0) > 1) reasons.push("Cross-source evidence");
    }
    const source = `${item.publisher ?? ""} ${item.source_name ?? ""}`;
    if (AUTHORITY.test(source)) { score += 12; reasons.push("Established source"); }
    const tone = Math.abs(Number(item.tone ?? 0));
    if (tone >= 5) { score += Math.min(8, tone); reasons.push("High-impact tone"); }
    const tags = [category[0].toUpperCase() + category.slice(1)];
    if (event?.severity && ["critical", "high"].includes(event.severity.toLowerCase())) tags.push(event.severity.toUpperCase());
    if (ageHours <= 6) tags.push("Developing");
    if ((event?.domain_count ?? 0) > 1) tags.push("Corroborated");
    return { ...item, category, tags, importance_score: Math.round(Math.min(100, score)), importance_reasons: reasons.slice(0, 3) };
  }).sort((a, b) => b.importance_score - a.importance_score || String(b.event_time ?? "").localeCompare(String(a.event_time ?? "")));
}
