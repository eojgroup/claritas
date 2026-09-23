// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SourceInvestigationLinks from "./SourceInvestigationLinks";

afterEach(cleanup);
it("opens the exact matched investigation rather than a broad country view", () => {
  const onOpenEvent = vi.fn();
  render(<SourceInvestigationLinks links={[{ id: "event-1", title: "Port outage", country_iso2: "SE", rationale: "Topic and time aligned" }]} onOpenEvent={onOpenEvent} />);
  fireEvent.click(screen.getByRole("button", { name: /Port outage.*Open investigation/i }));
  expect(onOpenEvent).toHaveBeenCalledWith("event-1");
});
it("labels unmatched sources and offers map exploration without inventing a link", () => {
  const onOpenMap = vi.fn();
  render(<SourceInvestigationLinks links={[]} onOpenMap={onOpenMap} />);
  expect(screen.getByText(/No investigation is linked yet/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Explore the signal map/ }));
  expect(onOpenMap).toHaveBeenCalledOnce();
});
