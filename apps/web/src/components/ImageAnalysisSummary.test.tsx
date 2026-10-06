// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ImageAnalysisSummary from "./ImageAnalysisSummary";
afterEach(cleanup);
it("distinguishes unresolved truck counts from vessel estimate ranges and shows the baseline", () => {
  render(<ImageAnalysisSummary analysis={{ object_counts: [
    { object_type: "truck",area: "port_yard",status: "not_resolvable",count_min: null,count_max: null,confidence: 0,reason: "10 m pixels cannot resolve trucks",boxes: [] },
    { object_type: "vessel",area: "offshore",status: "estimated",count_min: 8,count_max: 10,confidence: .7,reason: "Eight distinguishable hulls",boxes: [] },
  ], count_changes: [{ object_type: "vessel",area: "offshore",baseline_id: "before",baseline_captured_at: "2026-10-05T10:00:00Z",delta_min: 5,delta_max: 8,direction: "increase" }],visual_signal_score: .04 }} />);
  expect(screen.getByText("Not resolvable")).toBeTruthy();
  expect(screen.getByText("8–10")).toBeTruthy();
  expect(screen.getByText(/Vessel count change/).textContent).toContain("+5 to +8");
  expect(screen.getByText(/Signal relevance contribution/).textContent).toContain("+4 points");
  expect(screen.getByText(/snapshot does not establish/)).toBeTruthy();
});
