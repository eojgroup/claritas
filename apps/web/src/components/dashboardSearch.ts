export type SearchTopic = "all" | "news" | "podcasts" | "weather" | "markets";

const topicAliases: Record<string, SearchTopic> = {
  all: "all", news: "news", podcast: "podcasts", podcasts: "podcasts", audio: "podcasts",
  weather: "weather", market: "markets", markets: "markets", finance: "markets",
  financial: "markets", ai: "news", alerts: "news", wx: "weather",
};

/** Only standalone, unquoted topic commands belong to the application shell. */
export function parseDashboardSearch(raw: string, preferredTopic: SearchTopic) {
  let topic = preferredTopic;
  let cursor = 0;
  const parts: string[] = [];
  while (cursor < raw.length) {
    const start = cursor;
    if (/\s/.test(raw[cursor])) {
      while (cursor < raw.length && /\s/.test(raw[cursor])) cursor += 1;
      parts.push(raw.slice(start, cursor));
      continue;
    }
    let closingQuote: string | null = null;
    while (cursor < raw.length) {
      const character = raw[cursor];
      if (closingQuote) {
        if (character === closingQuote) closingQuote = null;
      } else if (character === '"' || character === "“") {
        closingQuote = character === "“" ? "”" : '"';
      }
      if (!closingQuote && /\s/.test(character)) break;
      cursor += 1;
    }
    const token = raw.slice(start, cursor);
    const command = token.match(/^(?:topic|t):([a-z]+)$/i);
    const selectedTopic = command ? topicAliases[command[1].toLowerCase()] : undefined;
    if (selectedTopic) topic = selectedTopic;
    else parts.push(token);
  }
  // Keep phrase spacing, case, exclusions, and malformed syntax intact for
  // the shared API parser. Local source lenses retain their existing terms.
  const newsQuery = parts.join("").trim();
  return {
    topic,
    terms: newsQuery.toLowerCase().split(/\s+/).filter(Boolean),
    newsQuery,
  };
}

export function stripDashboardSearchTopicTokens(raw: string) {
  return parseDashboardSearch(raw, "all").newsQuery;
}
