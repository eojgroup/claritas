// @vitest-environment jsdom
import { CountryDataContext } from "./countryContext";
import type { CountryContext } from "../lib/api";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import EventVisualContext from "./EventVisualContext";
import type { IntelligenceEventDetail } from "../lib/api";
afterEach(cleanup);
const base = { event: { id: "example", location_name: "Example region" }, evidence: [], locations: [], earth_observations: [] } as unknown as IntelligenceEventDetail;
it("does not invent incident coordinates or connections when evidence is missing", () => {
  const { container } = render(<EventVisualContext detail={base} />);
  expect(screen.getByText(/No coordinates available/)).toBeTruthy();
  expect(screen.getByText(/No linked evidence/)).toBeTruthy();
  expect(container.querySelectorAll("circle")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Event map zoom"), { target: { value: "3" } });
  expect((screen.getByLabelText("Event map zoom") as HTMLInputElement).value).toBe("3");
});
it("shows estimated positions and publisher thumbnails with their limitations", () => {
  const detail = { ...base, understanding: { coordinates: { latitude: 0, longitude: 0, label: "Estimated place", basis: "estimated_mapped" } }, evidence: [{ id: "photo", domain: "news", relationship: "context", source_title: "Publisher photo", source_url: "https://example.com/report", image_url: "https://example.com/photo.jpg", source_name: "Publisher" }] } as IntelligenceEventDetail;
  render(<EventVisualContext detail={detail} />);
  expect(screen.getByText(/Estimated geography/)).toBeTruthy();
  expect(screen.getByAltText("Publisher photo").getAttribute("src")).toContain("proxy-image");
  expect(screen.getByText(/Publisher-supplied illustration/)).toBeTruthy();
  expect(screen.getByRole("img", { name: /Correlation network/ })).toBeTruthy();
});

it("uses Wikidata country context to center an unresolved map without adding an incident pin", () => {
  const context = { coordinates: { latitude: 4.7, longitude: -74, precision_degrees: 1, basis: "country_reference_point" } } as CountryContext;
  const detail = { ...base, event: { ...base.event, primary_country_iso2: "CO" } };
  const { container } = render(<CountryDataContext.Provider value={{ CO: context }}><EventVisualContext detail={detail} /></CountryDataContext.Provider>);
  expect(screen.getByText(/View centered on Wikidata/)).toBeTruthy();
  expect(container.querySelectorAll("circle")).toHaveLength(0);
});
