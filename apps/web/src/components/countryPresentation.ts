import worldCountries from "world-countries";
import type { CountryContext } from "../lib/api";
const countryCodes = new Set((worldCountries as Array<{ cca2: string }>).map((country) => country.cca2));
export function countryIso(value?: string | null): string | null {
  const iso = value?.trim().toUpperCase();
  const canonical = iso === "UK" ? "GB" : iso;
  return canonical && countryCodes.has(canonical) ? canonical : null;
}
export function countryFlagEmoji(value?: string | null): string {
  const iso = countryIso(value);
  return iso ? [...iso].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("") : "";
}
/** Country reference points position country aggregates, never incident evidence. */
export function countryReferencePoint(context?: CountryContext | null): [number, number] | null {
  const point = context?.coordinates;
  if (!point || point.basis !== "country_reference_point" || typeof point.latitude !== "number" || typeof point.longitude !== "number"
    || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) return null;
  return [point.longitude, point.latitude];
}
