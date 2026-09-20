// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import NewsHighlights from "./NewsHighlights";
import { fetchNews } from "../lib/api";
vi.mock("../lib/api", async (original) => ({ ...await original<typeof import("../lib/api")>(), fetchNews: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("requests a separate daily importance shortlist and keeps server ranking", async () => {
  vi.mocked(fetchNews).mockResolvedValue({ items: [
    { id: 1, title: "Important earlier story", event_time: "2026-09-20T08:00:00Z" },
    { id: 2, title: "Later story", event_time: "2026-09-20T09:00:00Z" },
  ] } as Awaited<ReturnType<typeof fetchNews>>);
  render(<NewsHighlights country="SE" category="all" />);
  await screen.findByText("Important earlier story");
  expect(fetchNews).toHaveBeenCalledWith(expect.objectContaining({ daily: true, sort: "importance", country: "SE", limit: 3 }), expect.any(AbortSignal));
  expect(screen.getAllByRole("listitem")[0].textContent).toContain("Important earlier story");
});
it("clears the previous scope when a different country fails", async () => {
  vi.mocked(fetchNews).mockResolvedValueOnce({ items: [{ id: 1, title: "Swedish story" }] } as Awaited<ReturnType<typeof fetchNews>>)
    .mockRejectedValueOnce(new Error("offline"));
  const { rerender } = render(<NewsHighlights country="SE" category="all" />);
  await screen.findByText("Swedish story");
  rerender(<NewsHighlights country="FR" category="all" />);
  expect(screen.queryByText("Swedish story")).toBeNull();
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("temporarily unavailable"));
});
