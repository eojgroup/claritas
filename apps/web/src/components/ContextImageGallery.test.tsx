// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ContextImageGallery from "./ContextImageGallery";
import type { ContextImage } from "../lib/api";

afterEach(cleanup);
const satellite: ContextImage = {
  id: "retained-scene", kind: "satellite", preview_url: "/api/earth-observation/assets/preview",
  thumbnail_url: "/api/earth-observation/assets/thumbnail", width: 1024, height: 768,
  captured_at: "2026-10-20T08:00:00Z", published_at: null, collected_at: null,
  source_event_id: "original-event", source_event_title: "Earlier port disruption", source_url: "https://example.test/sentinel",
  title: "Sentinel-2 true colour", attribution: "Contains modified Copernicus Sentinel data", license: "Copernicus terms",
  location_name: "Port", match_reason: "rendered_area_contains_location", notice: "Location context only; this image does not establish conditions during this event.",
};
it("shows acquisition provenance, uses the thumbnail and opens the original investigation", () => {
  const onOpenEvent = vi.fn();
  render(<ContextImageGallery images={[satellite]} onOpenEvent={onOpenEvent} />);
  expect(screen.getByText("Stored satellite context")).toBeTruthy();
  expect(screen.getByText("Retained scene covers this location")).toBeTruthy();
  expect(screen.getByAltText(satellite.title).getAttribute("src")).toBe(satellite.thumbnail_url);
  expect(screen.getByText(/Captured/).querySelector("time")?.getAttribute("datetime")).toBe(satellite.captured_at);
  expect(screen.getByText(satellite.notice)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Original investigation/ }));
  expect(onOpenEvent).toHaveBeenCalledWith("original-event");
});
it("keeps article publication separate from an unverified image capture time", () => {
  render(<ContextImageGallery images={[{ ...satellite, id: "photo", kind: "news", captured_at: null, published_at: "2026-10-21T10:00:00Z", match_reason: "same_specific_location" }]} />);
  expect(screen.getByText("Earlier reporting image")).toBeTruthy();
  expect(screen.getByText("Capture time and image location unverified")).toBeTruthy();
  expect(screen.getByText(/Article published/)).toBeTruthy();
  expect(screen.queryByText(/^Captured/)).toBeNull();
});
