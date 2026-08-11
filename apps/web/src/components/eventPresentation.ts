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

export function eventTypeLabel(value: string) {
  return clean(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Developing signal";
}

export function eventLocationLabel(event: IntelligenceEvent) {
  return clean(event.location_name) || clean(event.primary_country_iso2) || "Global";
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
  headline: string;
  focus: string | null;
  summary: string;
  why: string;
};

export function presentEvent(event: IntelligenceEvent): EventPresentation {
  const typeLabel = eventTypeLabel(event.event_type);
  const locationLabel = eventLocationLabel(event);
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

  return { typeLabel, locationLabel, headline, focus, summary, why };
}
