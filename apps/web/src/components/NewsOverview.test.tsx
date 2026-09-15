// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import NewsOverview from "./NewsOverview";
import { newsTopicFacets, filterNewsByTopic } from "./newsWorkspacePresentation";
import type { NewsItem } from "../lib/api";
afterEach(cleanup);
const items = [
  { id: 1, tags: [{ kind: "topic", code: "energy", label: "Energy" }, { kind: "topic", code: "energy", label: "Energy" }] },
  { id: 2, tags: [{ kind: "topic", code: "energy", label: "Energy" }, { kind: "topic", code: "trade", label: "Trade" }] },
] as NewsItem[];
it("counts stories once per topic and filters the same loaded stories", () => {
  expect(newsTopicFacets(items)).toEqual([{ code: "energy", label: "Energy", count: 2 }, { code: "trade", label: "Trade", count: 1 }]);
  expect(filterNewsByTopic(items, "trade").map(item => item.id)).toEqual([2]);
  expect(filterNewsByTopic(items, null)).toHaveLength(2);
});
it("topic and investigation controls navigate and clear selected scope", () => {
  const select = vi.fn(); const open = vi.fn();
  render(<NewsOverview items={items} visibleCount={1} scope="Global" selectedTopic={{ code: "trade", label: "Trade" }} onSelectTopic={select} onOpenInvestigations={open} />);
  fireEvent.click(screen.getByRole("button", { name: "Energy 2" }));
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ code: "energy" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear topic" }));
  expect(select).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByRole("button", { name: /Explore event evidence/ }));
  expect(open).toHaveBeenCalledOnce();
});
