// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { IntelligenceEventDetail } from "../lib/api";
import EventSignalVisuals from "./EventSignalVisuals";
afterEach(cleanup);
it("shows observed transport against its recorded baseline without requesting more data", () => {
  const detail = { evidence: [{ domain: "transport", evidence_type: "rolling_baseline_anomaly", metadata: { current: 187, baseline: 100 } }] } as unknown as IntelligenceEventDetail;
  render(<EventSignalVisuals detail={detail} />);
  expect(screen.getByRole("img", { name: "Observed 187 arrivals and departures; rolling baseline 100" })).toBeTruthy();
  expect(screen.getByText(/does not establish disruption/)).toBeTruthy();
});
it("omits empty charts and preserves publisher image provenance", () => {
  const detail = { evidence: [], news_images: [{ id: "photo", preview_url: "/api/news-images/photo/preview", caption: "Port entrance", publisher: "Port authority", article_url: "https://example.org/report" }] } as unknown as IntelligenceEventDetail;
  render(<EventSignalVisuals detail={detail} />);
  expect(screen.getByAltText("Port entrance")).toBeTruthy();
  expect(screen.getByText(/capture unverified/)).toBeTruthy();
  expect(screen.queryByRole("img", { name: /Observed/ })).toBeNull();
});
