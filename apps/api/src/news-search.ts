export const NEWS_SEARCH_MAX_CHARACTERS = 400;
export const NEWS_SEARCH_MAX_TERMS = 12;

export class NewsSearchValidationError extends Error {
  constructor(message: string) { super(message); this.name = "NewsSearchValidationError"; }
}

export type NewsSearchTerm = { text: string; excluded: boolean };

/** Small, explicit query language shared by every news reader client. */
export function parseNewsSearchQuery(query: string): NewsSearchTerm[] {
  if (query.length > NEWS_SEARCH_MAX_CHARACTERS) {
    throw new NewsSearchValidationError(`News search must be ${NEWS_SEARCH_MAX_CHARACTERS} characters or fewer.`);
  }
  if (query.includes("\u0000")) throw new NewsSearchValidationError("News search cannot contain a NUL character.");
  const terms: NewsSearchTerm[] = [];
  let cursor = 0;
  while (cursor < query.length) {
    while (/\s/.test(query[cursor] ?? "") && cursor < query.length) cursor += 1;
    if (cursor === query.length) break;
    const excluded = query[cursor] === "-";
    if (excluded) cursor += 1;
    let text: string;
    if (query[cursor] === '"') {
      const start = ++cursor;
      const end = query.indexOf('"', start);
      if (end === -1) throw new NewsSearchValidationError("News search has an unclosed quoted phrase.");
      text = query.slice(start, end).trim();
      cursor = end + 1;
      if (cursor < query.length && !/\s/.test(query[cursor])) {
        throw new NewsSearchValidationError("Separate news search terms and quoted phrases with spaces.");
      }
    } else {
      const start = cursor;
      while (cursor < query.length && !/\s/.test(query[cursor])) cursor += 1;
      text = query.slice(start, cursor);
      if (text.includes('"')) throw new NewsSearchValidationError("Place double quotes around a complete news search phrase.");
    }
    if (!text) throw new NewsSearchValidationError("News search phrases and exclusions cannot be empty.");
    terms.push({ text, excluded });
    if (terms.length > NEWS_SEARCH_MAX_TERMS) {
      throw new NewsSearchValidationError(`News search supports at most ${NEWS_SEARCH_MAX_TERMS} terms or quoted phrases.`);
    }
  }
  return terms;
}

const NEWS_SEARCH_FIELDS = [
  "i.title", "i.summary", "translation.translated_title", "translation.generated_summary",
  "i.payload->>'source'", "i.payload->>'publisher'", "i.payload->>'domain'", "i.payload->>'provider'", "s.name",
  "canonical_news_publisher_key(i.url,i.payload,s.name)",
] as const;

/** Fixed SQL fields and one bound literal-substring pattern per query clause. */
export function buildNewsSearchPredicate(query: string, firstParameterIndex = 1): { sql: string | null; params: string[] } {
  if (!Number.isSafeInteger(firstParameterIndex) || firstParameterIndex < 1) throw new RangeError("Invalid news search bind index.");
  const terms = parseNewsSearchQuery(query);
  const params = terms.map(({ text }) => `%${text.replace(/[!%_]/g, "!$&")}%`);
  const clauses = terms.map(({ excluded }, index) => {
    // An explicit non-backslash escape keeps backslashes literal as well.
    // COALESCE makes exclusion work even when a source has no excerpt or
    // current translation; NOT(NULL OR false) would otherwise hide it.
    const match = NEWS_SEARCH_FIELDS.map((field) => `COALESCE(${field},'') ILIKE $${firstParameterIndex + index} ESCAPE '!'`).join(" OR ");
    return `${excluded ? "NOT " : ""}(${match})`;
  });
  return { sql: clauses.length ? `(${clauses.join(" AND ")})` : null, params };
}
