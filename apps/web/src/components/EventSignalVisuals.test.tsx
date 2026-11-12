// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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
it("surfaces retained location imagery without pretending it is evidence of the selected event", () => {
  const onOpenEvent = vi.fn();
  const detail = { evidence: [], context_images: [{ id: "retained", kind: "satellite", preview_url: "/api/earth-observation/assets/retained", title: "Earlier port view", captured_at: "2026-11-01T10:00:00Z", attribution: "Copernicus", notice: "Historical location context; not evidence of this event.", license: "Open data", source_event_id: "earlier-event" }] } as unknown as IntelligenceEventDetail;
  render(<EventSignalVisuals detail={detail} onOpenEvent={onOpenEvent} />);
  expect(screen.getByAltText("Earlier port view")).toBeTruthy();
  expect(screen.getByText("Retained location context")).toBeTruthy();
  fireEvent.click(screen.getByText("Image source & limits"));
  expect(screen.getByText(/not evidence of this event/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open original event" }));
  expect(onOpenEvent).toHaveBeenCalledWith("earlier-event");
});
it("shows an available natural-colour satellite preview without expanding technical assessment", () => {
  const detail = { event: { location_name: "Port" }, evidence: [], earth_observations: [{ id: "scene", product_type: "true_color", status: "available", capture_start: "2026-11-10T10:00:00Z", captured_at: "2026-11-10T10:00:00Z", mission: "Sentinel-2", assets: [{ asset_type: "preview", url: "/api/earth-observation/assets/scene" }] }] } as unknown as IntelligenceEventDetail;
  render(<EventSignalVisuals detail={detail} />);
  expect(screen.getByAltText("Satellite view of Port")).toBeTruthy();
  expect(screen.getByText(/Event-linked satellite view/)).toBeTruthy();
});
