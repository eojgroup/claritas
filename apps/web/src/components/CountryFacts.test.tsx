// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import CountryFacts from "./CountryFacts";
import type { CountryContext } from "../lib/api";
afterEach(cleanup);
it("shows sourced country facts and preserves coarse coordinate precision and map attribution", () => {
  const context: CountryContext = {
    capitals: [{ id: "Q90", name: "Paris", source_url: "https://www.wikidata.org/wiki/Q90" }],
    languages: [], currencies: [], neighbours: [], flag: null,
    coordinates: { latitude: 47, longitude: 2, precision_degrees: 1, basis: "country_reference_point" },
    locator_maps: [{ file_name: "France.svg", source_url: "https://commons.wikimedia.org/wiki/File:France.svg", license: "CC BY-SA 4.0", attribution: "Map author" }],
    source_url: "https://www.wikidata.org/wiki/Q142", source_license: "CC0", retrieved_at: "2026-10-05T00:00:00Z",
  };
  render(<CountryFacts country="FR" name="France" context={context} />);
  expect(screen.getByRole("link", { name: "Paris" }).getAttribute("href")).toBe("https://www.wikidata.org/wiki/Q90");
  expect(screen.getByText(/Source precision: 1°/).textContent).toContain("not an incident or its borders");
  expect(screen.getByRole("link", { name: "View locator map of France" })).toBeTruthy();
  expect(screen.getByText(/Map author/).textContent).toContain("CC BY-SA 4.0");
});
it("explains missing country context before the first successful refresh", () => {
  render(<CountryFacts country="FR" name="France" />);
  expect(screen.getByText(/next successful leadership refresh/)).toBeTruthy();
});
