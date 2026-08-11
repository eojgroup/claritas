import type { IntelligenceEvent } from "../lib/api";

const GENERIC_SIGNAL_TITLES = new Set([
  "civilian",
  "government",
  "leadership",
  "military",
  "official",
  "politics",
  "russia",
  "security",
  "transport",
]);

function clean(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

const GENERIC_LOCATIONS = new Set([
  "global",
  "international",
  "location not yet resolved",
  "unknown",
  "unspecified",
  "world",
  "worldwide",
]);

function isGenericLocation(value: string) {
  return GENERIC_LOCATIONS.has(value.toLocaleLowerCase());
}

function countryName(iso2: string) {
  type RegionDisplayNames = { of(code: string): string | undefined };
  type RegionDisplayNamesConstructor = new (
    locales: string[],
    options: { type: "region" },
  ) => RegionDisplayNames;
  const displayNames = (Intl as typeof Intl & { DisplayNames?: RegionDisplayNamesConstructor }).DisplayNames;
  if (!displayNames) return iso2;
  try {
    return new displayNames(["en"], { type: "region" }).of(iso2) || iso2;
  } catch {
    return iso2;
  }
}

function validCoordinate(latitude: unknown, longitude: unknown) {
  if (latitude == null || longitude == null || latitude === "" || longitude === "") return null;
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  return Number.isFinite(parsedLatitude)
    && Number.isFinite(parsedLongitude)
    && parsedLatitude >= -90
    && parsedLatitude <= 90
    && parsedLongitude >= -180
    && parsedLongitude <= 180
    ? { latitude: parsedLatitude, longitude: parsedLongitude }
    : null;
}

function coordinatePart(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`;
}

export function eventCoordinateContext(event: IntelligenceEvent) {
  const coordinate = validCoordinate(event.latitude, event.longitude);
  if (!coordinate) return null;
  const exact = event.metadata?.exact_geography === true;
  // A country reference point is useful for map navigation, but is not an
  // event location. Do not make it look like one unless source evidence
  // explicitly supplied the geography.
  if (!exact && clean(event.location_type).toLocaleLowerCase() === "country") return null;
  return {
    label: `${coordinatePart(coordinate.latitude, "N", "S")}, ${coordinatePart(coordinate.longitude, "E", "W")}`,
    basis: exact ? "Source-observed coordinates" : "Estimated mapped location",
    exact,
  };
}

export function eventTypeLabel(value: string) {
  return clean(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Developing signal";
}

export function eventLocationLabel(event: IntelligenceEvent) {
  const location = clean(event.location_name);
  if (location && !isGenericLocation(location)) return location;
  const country = clean(event.primary_country_iso2).toUpperCase();
  if (country) return countryName(country);
  if (eventCoordinateContext(event)) return "Mapped event location";
  return location || "Global";
}

function looksLikeRawTopic(event: IntelligenceEvent, title: string) {
  const normalized = title.toLocaleLowerCase();
  const location = eventLocationLabel(event).toLocaleLowerCase();
  const country = clean(event.primary_country_iso2).toLocaleLowerCase();
  const isUppercaseToken = title.length > 3
    && title === title.toLocaleUpperCase()
    && /[A-Z]/.test(title);
  return normalized === location
    || (country !== "" && normalized === country)
    || GENERIC_SIGNAL_TITLES.has(normalized)
    || isUppercaseToken;
}

export type EventPresentation = {
  typeLabel: string;
  locationLabel: string;
  coordinateLabel: string | null;
  locationBasis: string | null;
  headline: string;
  focus: string | null;
  summary: string;
  why: string;
};

export function presentEvent(event: IntelligenceEvent): EventPresentation {
  const typeLabel = eventTypeLabel(event.event_type);
  const locationLabel = eventLocationLabel(event);
  const coordinate = eventCoordinateContext(event);
  const sourceTitle = clean(event.title);
  const weakTitle = !sourceTitle || looksLikeRawTopic(event, sourceTitle);
  const headline = weakTitle
    ? `${typeLabel}${locationLabel === "Global" ? " under assessment" : ` in ${locationLabel}`}`
    : sourceTitle;
  const focus = weakTitle && sourceTitle && sourceTitle.toLocaleLowerCase() !== locationLabel.toLocaleLowerCase()
    ? sourceTitle.toLocaleLowerCase().replace(/\b\w/g, (letter) => letter.toLocaleUpperCase())
    : null;
  const summary = clean(event.summary) || `${typeLabel} is being assessed from the linked evidence.`;
  const relevance = Math.round(Number(event.relevance_score || 0) * 100);
  const urgency = Math.round(Number(event.urgency_score || 0) * 100);
  const evidence = `${event.evidence_count} linked ${event.evidence_count === 1 ? "item" : "items"} across ${event.domain_count} ${event.domain_count === 1 ? "domain" : "domains"}`;
  const why = `${event.severity[0].toUpperCase()}${event.severity.slice(1)} priority · ${relevance}% relevance · ${urgency}% urgency · ${evidence}.`;

  return {
    typeLabel,
    locationLabel,
    coordinateLabel: coordinate?.label ?? null,
    locationBasis: coordinate?.basis ?? null,
    headline,
    focus,
    summary,
    why,
  };
}
