import { describe, expect, it } from "vitest";
import { parseDashboardSearch, stripDashboardSearchTopicTokens } from "./dashboardSearch";

describe("dashboard search commands", () => {
  it("selects recognized topics while preserving research-query case, phrases and exclusions", () => {
    const parsed = parseDashboardSearch('topic:news "Interest  Rates" Fed -inflation', "all");
    expect(parsed.topic).toBe("news");
    expect(parsed.newsQuery).toBe('"Interest  Rates" Fed -inflation');
    expect(parsed.terms).toEqual(['"interest', 'rates"', 'fed', '-inflation']);
  });

  it("keeps topic-like text inside quoted or excluded phrases as reporting content", () => {
    const raw = '"rates t:news  Growth" -"topic:markets returns" t:weather';
    const parsed = parseDashboardSearch(raw, "all");
    expect(parsed.topic).toBe("weather");
    expect(parsed.newsQuery).toBe('"rates t:news  Growth" -"topic:markets returns"');
    expect(stripDashboardSearchTopicTokens(raw)).toBe(parsed.newsQuery);
  });

  it("leaves malformed phrases and unknown commands for the server to interpret or reject", () => {
    expect(parseDashboardSearch('"rates t:news', "all")).toMatchObject({ topic: "all", newsQuery: '"rates t:news' });
    expect(parseDashboardSearch('topic:unknown "rates"Fed', "news").newsQuery).toBe('topic:unknown "rates"Fed');
    expect(stripDashboardSearchTopicTokens('"topic:news"')).toBe('"topic:news"');
  });

  it("retains source-lens aliases and handles topic-only queries", () => {
    expect(parseDashboardSearch("T:WX", "all")).toEqual({ topic: "weather", terms: [], newsQuery: "" });
    expect(parseDashboardSearch("storm t:audio", "all").topic).toBe("podcasts");
  });

  it("preserves paired smart-quoted phrases from phone and tablet keyboards", () => {
    const query = "“rates t:news  Growth” -“topic:markets returns” t:weather";
    expect(parseDashboardSearch(query, "all")).toMatchObject({
      topic: "weather",
      newsQuery: "“rates t:news  Growth” -“topic:markets returns”",
    });
  });

  it("leaves mismatched smart quote syntax intact for server validation", () => {
    expect(parseDashboardSearch('“rates t:news"', "all")).toMatchObject({
      topic: "all",
      newsQuery: '“rates t:news"',
    });
  });
});
