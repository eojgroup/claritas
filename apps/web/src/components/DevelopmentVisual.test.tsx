// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import DevelopmentVisual from "./DevelopmentVisual";
afterEach(cleanup);
it("renders observed transport and its actual baseline without fetching detail", () => {
  render(<DevelopmentVisual visual={{ kind: "transport", current: 30, baseline: 50, observed_at: "2026-11-17T10:00:00Z", label: "Same completed UTC hours" }} />);
  expect(screen.getByRole("img", { name: "Observed 30 movements; rolling baseline 50" })).toBeTruthy();
  expect(screen.getByText(/Same completed UTC hours/)).toBeTruthy();
});
it("omits invalid transport measurements", () => {
  const { container } = render(<DevelopmentVisual visual={{ kind: "transport", current: -1, baseline: 50, observed_at: "2026-11-17T10:00:00Z", label: "Transport" }} />);
  expect(container.textContent).toBe("");
});
