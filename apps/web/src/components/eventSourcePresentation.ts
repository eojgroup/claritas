import type { IntelligenceEvent, IntelligenceEvidence } from "../lib/api";

export const sourceFamilies = [
  { domain: "news", label: "News" },
  { domain: "earth_observation", label: "Earth observation" },
  { domain: "imagery", label: "Imagery" },
  { domain: "transport", label: "Transport" },
  { domain: "podcast", label: "Podcasts" },
  { domain: "social", label: "Socials" },
  { domain: "weather", label: "Weather" },
  { domain: "market", label: "Markets" },
  { domain: "official", label: "Official sources" },
  { domain: "model_interpretation", label: "Model interpretation" },
];

export function sourceFamily(domain: string | undefined | null, recordType = ""): string {
  if (recordType === "earth_observation") return "imagery";
  const value = `${domain ?? ""} ${recordType}`.toLowerCase().replace(/[_-]/g, " ");
  if (/model interpretation/.test(value)) return "model_interpretation";
  if (/imagery|satellite image|earth observation scene/.test(value)) return "imagery";
  if (/weather|forecast|meteorolog/.test(value)) return "weather";
  if (/transport|aviation|maritime|flight|vessel|ais|adsb/.test(value)) return "transport";
  if (/podcast|episode/.test(value)) return "podcast";
  if (/social/.test(value)) return "social";
  if (/news|article|publisher/.test(value)) return "news";
  if (/earth|satellite|firms|disaster|seismic/.test(value)) return "earth_observation";
  if (/market|economic|finance/.test(value)) return "market";
  if (/official|government/.test(value)) return "official";
  return domain || "official";
}

export function sourceFamilyLabel(domain: string | null | undefined): string {
  const family = sourceFamily(domain);
  return sourceFamilies.find((entry) => entry.domain === family)?.label ?? family.replace(/_/g, " ");
}

export function eventOrigin(event: IntelligenceEvent): string | null {
  const domain = event.origin_domain ?? event.metadata?.origin_domain ?? event.metadata?.seed_domain;
  return typeof domain === "string" && domain ? sourceFamilyLabel(domain) : null;
}

export function evidenceFamily(item: IntelligenceEvidence): string {
  const family = sourceFamily(item.domain, item.source_record_type);
  return item.relationship.trim().toLowerCase() === "model_interpretation" && family !== "podcast"
    ? "model_interpretation" : family;
}

export function isCoverageAssessment(item: IntelligenceEvidence): boolean {
  if (item.relationship.trim().toLowerCase() === "assessment") return true;
  const status = item.metadata?.coverage_status ?? item.metadata?.classification
    ?? item.correlation_factors?.coverage_status ?? item.correlation_factors?.classification;
  if (["no_local_sample", "comparison_pending", "no_nearby_coverage", "insufficient_comparable_coverage"].includes(String(status))) return true;
  if (item.evidence_type === "event_area_weather_unavailable") return true;
  const text = `${item.title ?? item.source_title ?? ""} ${item.summary ?? item.source_summary ?? ""}`;
  return item.evidence_type === "event_area_activity_comparison"
    && /comparison pending|complete post-event hour|no transport track points|no nearby (transport )?coverage|baseline is too small|insufficient (comparable|nearby).*coverage/i.test(text);
}
