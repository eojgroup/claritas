type GdeltPresentationInput = {
  eventCode?: unknown;
  eventRootCode?: unknown;
  actor1?: unknown;
  actor2?: unknown;
  location?: unknown;
  countryIso2?: unknown;
  mentionCount?: unknown;
  sourceCount?: unknown;
  articleCount?: unknown;
};

const CAMEO_ACTIONS: Record<string, string> = {
  "01": "public statement",
  "02": "appeal",
  "03": "intent to cooperate",
  "04": "consultation",
  "05": "diplomatic cooperation",
  "06": "material cooperation",
  "07": "aid",
  "08": "concession",
  "09": "investigation",
  "10": "demand",
  "11": "disapproval",
  "12": "rejection",
  "13": "threat",
  "14": "protest",
  "15": "force posture",
  "16": "reduced relations",
  "17": "coercion",
  "18": "assault",
  "19": "armed conflict",
  "20": "mass violence",
};

function boundedText(value: unknown, maxLength = 180): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength).trim() : null;
}

function count(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
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

function countryName(value: unknown): string | null {
  const iso2 = boundedText(value, 2)?.toUpperCase();
  if (!iso2 || !/^[A-Z]{2}$/.test(iso2)) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(iso2) || iso2;
  } catch {
    return iso2;
  }
}

function eventCoordinate(event: Record<string, unknown>) {
  if (event.latitude == null || event.longitude == null
    || event.latitude === "" || event.longitude === "") return null;
  const latitude = Number(event.latitude);
  const longitude = Number(event.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const metadata = event.metadata && typeof event.metadata === "object"
    ? event.metadata as Record<string, unknown>
    : {};
  const exact = metadata.exact_geography === true;
  if (!exact && boundedText(event.location_type, 30)?.toLowerCase() === "country") return null;
  const part = (coordinate: number, positive: string, negative: string) => (
    `${Math.abs(coordinate).toFixed(4)}° ${coordinate >= 0 ? positive : negative}`
  );
  return {
    latitude,
    longitude,
    label: `${part(latitude, "N", "S")}, ${part(longitude, "E", "W")}`,
    basis: exact ? "source_observed" as const : "estimated_mapped" as const,
  };
}

function actionRoot(input: GdeltPresentationInput): string | null {
  const root = boundedText(input.eventRootCode, 2);
  if (root && /^\d{2}$/.test(root)) return root;
  const code = boundedText(input.eventCode, 3);
  return code && /^\d{2,3}$/.test(code) ? code.slice(0, 2) : null;
}

export function gdeltActionLabel(eventCode: unknown, eventRootCode?: unknown): string {
  const root = actionRoot({ eventCode, eventRootCode });
  return (root && CAMEO_ACTIONS[root]) || "interaction";
}

export function humanizeGdeltActor(value: unknown): string | null {
  const actor = boundedText(value);
  if (!actor) return null;
  if (actor !== actor.toUpperCase()) return actor;
  return actor
    .toLowerCase()
    .replace(/(^|[\s\-/])\p{L}/gu, (letter) => letter.toUpperCase())
    .replace(/\bUsa\b/g, "USA")
    .replace(/\bUs\b/g, "US")
    .replace(/\bEu\b/g, "EU")
    .replace(/\bUn\b/g, "UN")
    .replace(/\bNato\b/g, "NATO");
}

export function buildGdeltEventPresentation(input: GdeltPresentationInput) {
  const action = gdeltActionLabel(input.eventCode, input.eventRootCode);
  const actors = [humanizeGdeltActor(input.actor1), humanizeGdeltActor(input.actor2)]
    .filter((value): value is string => Boolean(value));
  const location = boundedText(input.location) || boundedText(input.countryIso2, 2) || "unspecified location";
  const subject = actors.length ? actors.join(" / ") : "Unspecified actors";
  const article = /^[aeiou]/i.test(action) ? "an" : "a";
  const title = `Reported ${action}: ${subject} — ${location}`.slice(0, 300);
  const sources = count(input.sourceCount);
  const articles = count(input.articleCount);
  const mentions = count(input.mentionCount);
  const coverage = [
    sources && sources > 0 ? `${sources} source${sources === 1 ? "" : "s"}` : null,
    articles && articles > 0 ? `${articles} article${articles === 1 ? "" : "s"}` : null,
    mentions && mentions > 0 ? `${mentions} mention${mentions === 1 ? "" : "s"}` : null,
  ].filter((value): value is string => Boolean(value));
  const summary = [
    `GDELT machine-coded signal describing ${article} ${action} involving ${subject} near ${location}.`,
    coverage.length ? `The source record reports ${coverage.join(", ")}.` : null,
    "This is a structured coverage signal; linked publisher reporting or physical observations are required before treating the underlying claim as confirmed.",
  ].filter(Boolean).join(" ");
  return { title, summary, action, actors, location };
}

export function buildEventUnderstanding(event: Record<string, unknown>, evidence: Array<Record<string, unknown>>) {
  const rawLocation = boundedText(event.location_name);
  const specificRawLocation = rawLocation && !GENERIC_LOCATIONS.has(rawLocation.toLowerCase())
    ? rawLocation
    : null;
  const coordinate = eventCoordinate(event);
  const location = specificRawLocation
    ? specificRawLocation
    : countryName(event.primary_country_iso2)
      || (coordinate ? "Mapped event location" : null)
      || "Location not yet resolved";
  const domainCount = Math.max(0, count(event.domain_count) ?? 0);
  const evidenceCount = Math.max(0, count(event.evidence_count) ?? evidence.length);
  const newsCount = evidence.filter((item) => (
    item.domain === "news" && item.source_record_type === "item"
  )).length;
  const physicalCount = evidence.filter((item) => (
    item.domain === "earth_observation"
    && item.relationship === "observed"
    && item.source_record_type === "earth_observation"
  )).length;
  const relevance = Math.round(Math.max(0, Math.min(1, Number(event.relevance_score) || 0)) * 100);
  const severity = boundedText(event.severity, 20) || "unrated";
  const interestParts = [
    `${severity[0].toUpperCase()}${severity.slice(1)}-severity signal with ${relevance}/100 relevance`,
    `${domainCount} linked domain${domainCount === 1 ? "" : "s"} and ${evidenceCount} evidence record${evidenceCount === 1 ? "" : "s"}`,
    newsCount ? `${newsCount} linked news record${newsCount === 1 ? "" : "s"}` : "no linked publisher story yet",
    physicalCount ? `${physicalCount} processed physical observation${physicalCount === 1 ? "" : "s"}` : "no processed physical observation yet",
  ];
  return {
    what_happened: boundedText(event.summary, 1_800) || boundedText(event.title, 300) || "Event details are still emerging.",
    where: location,
    location_basis: coordinate?.basis ?? (location === "Location not yet resolved" ? "unresolved" : "named_location"),
    coordinates: coordinate,
    why_interesting: `${interestParts.join("; ")}. Correlation supplies context and does not establish causation.`,
    linked_news_count: newsCount,
    physical_observation_count: physicalCount,
  };
}

export function buildLinkedNewsPresentation(row: Record<string, unknown>) {
  return {
    id: row.id,
    evidence_type: row.evidence_type,
    relationship: row.relationship,
    title: row.source_title,
    summary: row.source_summary,
    url: row.source_url,
    publisher: row.attribution ?? row.source_name,
    // Publication and evidence receipt are intentionally separate. The latter
    // can lag well behind the article and must not be presented as news time.
    published_at: row.published_at ?? null,
    observed_at: row.observed_at,
    confidence: row.confidence,
  };
}
