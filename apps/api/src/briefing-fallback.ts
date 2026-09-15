import { LlmProviderError, type LlmClient, type LlmStructuredRequest, type LlmStructuredResponse } from "./llm";

type Source = { title?: unknown; publisher?: unknown; source_name?: unknown; event_time?: unknown; url?: unknown };
export type BriefingFallbackContext = {
  briefing_date: string;
  news: Source[];
  intelligence_events: { title: string }[];
  counts: Record<string, number>;
};

/** Keep publication available during provider outages without changing models or billing policy. */
export async function generateBriefingWithFallback<T>(
  client: LlmClient,
  request: LlmStructuredRequest,
  context: BriefingFallbackContext,
): Promise<LlmStructuredResponse<T>> {
  try {
    return await client.generateStructured<T>(request);
  } catch (error) {
    if (!(error instanceof LlmProviderError) || !(
      error.status === 429 || (error.status != null && error.status >= 500) ||
      /no endpoints (available|found)|APIError \((404|429|5\d\d)\)/i.test(error.message)
    )) throw error;
    const clean = (value: unknown, max = 140) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
    const reports = context.news.slice(0, 5).map((item) => {
      const title = clean(item.title);
      if (!title) return null;
      const source = clean(item.publisher || item.source_name, 50) || "Source report";
      const time = clean(item.event_time, 40);
      return `${source}: ${title}${time ? ` (${time})` : ""}`;
    }).filter((value): value is string => Boolean(value));
    const events = context.intelligence_events.slice(0, 3).map((event) => clean(event.title)).filter(Boolean);
    const coverage = Object.entries(context.counts).filter(([, count]) => count > 0).map(([name, count]) => `${count} ${name.replace(/_/g, " ")}`).join(", ");
    return {
      provider: "deterministic",
      model: null,
      output: {
        title: `Daily source digest · ${context.briefing_date}`,
        update_text: [
          "Source digest: automated narrative generation is temporarily unavailable. This is a summary of retained coverage, not a synthesized assessment.",
          coverage ? `Coverage in this briefing window: ${coverage}.` : "No source coverage was retained in this briefing window.",
          events.length ? `Investigations to review: ${events.join("; ")}.` : "No linked investigations are available in this window.",
          "Review linked evidence before drawing conclusions. Social and podcast claims remain attributed statements, not independent corroboration.",
        ].join(" "),
        key_takeaways: reports.length ? reports : ["No dated publisher reports are available in this briefing window; review source coverage."],
        data_quality_notes: ["Provider unavailable; source digest published without AI synthesis. No confidence assessment or causal inference was added."],
      } as T,
      metadata: {
        fallback: true,
        fallback_reason: "generation_provider_unavailable",
        source_references: context.news.slice(0, 5).map(({ title, publisher, source_name, url, event_time }) => ({ title, publisher, source_name, url, event_time })),
      },
    };
  }
}
