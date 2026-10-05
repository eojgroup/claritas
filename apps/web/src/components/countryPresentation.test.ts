import { expect, it } from "vitest";
import { countryFlagEmoji, countryReferencePoint } from "./countryPresentation";
import type { CountryContext } from "../lib/api";
it("uses compact flags for known countries and preserves UK aliases without inventing unknown flags", () => {
  expect(countryFlagEmoji("se")).toBe("🇸🇪");
  expect(countryFlagEmoji("UK")).toBe("🇬🇧");
  expect(countryFlagEmoji("XX")).toBe("");
  expect(countryFlagEmoji(null)).toBe("");
});
it("only uses valid country reference points with longitude first for maps", () => {
  const context = { coordinates: { latitude: 12, longitude: -30, precision_degrees: .1, basis: "country_reference_point" } } as CountryContext;
  expect(countryReferencePoint(context)).toEqual([-30, 12]);
  expect(countryReferencePoint({ ...context, coordinates: { ...context.coordinates!, latitude: NaN } })).toBeNull();
  expect(countryReferencePoint()).toBeNull();
});
