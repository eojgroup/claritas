import { createHash } from "node:crypto";

export const NEWS_ASSESSMENT_METHODOLOGY = "trader-news-priority-v1";

export const NEWS_CATEGORIES = [
  "markets",
  "economy",
  "companies",
  "geopolitics",
  "policy",
  "energy",
  "technology",
  "climate_disasters",
  "health",
  "transport",
  "other",
] as const;

export type NewsCategory = (typeof NEWS_CATEGORIES)[number];
export type NewsImportanceTier = "top" | "high" | "notable" | "routine";
export type NewsAssessmentTag = {
  code: string;
  label: string;
  kind: "category" | "topic" | "event" | "evidence";
};
export type NewsAssessmentReason = { code: string; label: string };

export type NewsAssessmentLinkedEvent = {
  id?: string | null;
  event_type?: string | null;
  status?: string | null;
  severity?: string | null;
  confidence?: number | string | null;
  relevance_score?: number | string | null;
  urgency_score?: number | string | null;
  materiality_score?: number | string | null;
  correlation_score?: number | string | null;
  correlation_factors?: unknown;
  source_diversity?: number | string | null;
  domain_count?: number | string | null;
  distinct_publisher_count?: number | string | null;
};

export type NewsAssessmentInput = {
  itemId: number;
  title?: string | null;
  summary?: string | null;
  eventTime?: string | Date | null;
  createdAt?: string | Date | null;
  sourceName?: string | null;
  payload?: unknown;
  linkedEvents?: NewsAssessmentLinkedEvent[] | null;
};

export type NewsAssessment = {
  itemId: number;
  methodologyVersion: typeof NEWS_ASSESSMENT_METHODOLOGY;
  primaryCategory: NewsCategory;
  categories: NewsCategory[];
  tags: NewsAssessmentTag[];
  reasons: NewsAssessmentReason[];
  components: Record<string, unknown>;
  score: number;
  tier: NewsImportanceTier;
  confidence: number;
  assessedAt: string;
  inputsHash: string;
};

export function createNewsQueryParameterPlan(displayLanguage: string, includeMetadata: boolean) {
  const params: any[] = [displayLanguage];
  const displayLanguageIndex = 1;
  const categoryCatalogIndex = includeMetadata ? params.push([...NEWS_CATEGORIES]) : null;
  const methodologyIndex = params.push(NEWS_ASSESSMENT_METHODOLOGY);
  return { params, displayLanguageIndex, categoryCatalogIndex, methodologyIndex };
}

const CATEGORY_LABELS: Record<NewsCategory, string> = {
  markets: "Markets",
  economy: "Economy",
  companies: "Companies",
  geopolitics: "Geopolitics",
  policy: "Policy",
  energy: "Energy",
  technology: "Technology",
  climate_disasters: "Climate & disasters",
  health: "Health",
  transport: "Transport",
  other: "Other",
};

const CATEGORY_RULES: Array<{ category: Exclude<NewsCategory, "other">; pattern: RegExp }> = [
  {
    category: "markets",
    pattern: /\b(?:financial markets?|capital markets?|stock(?:s| market)?|equities|share prices?|equity shares?|bonds?|treasur(?:y|ies)|yield curves?|currenc(?:y|ies)|forex|foreign exchange|securities|stock exchange|market index|futures?|derivatives?|asset prices?)\b/i,
  },
  {
    category: "economy",
    pattern: /\b(?:econom(?:y|ic|ics)|macroeconom(?:y|ic|ics)|inflation|deflation|consumer prices?|producer prices?|\bcpi\b|\bppi\b|gross domestic product|\bgdp\b|employment|unemployment|jobs? report|labou?r market|central banks?|monetary policy|interest rates?|fiscal policy|recession|economic growth)\b/i,
  },
  {
    category: "companies",
    pattern: /\b(?:earnings|revenue|profit|losses|mergers?|acquisitions?|takeovers?|initial public offering|\bipo\b|bankrupt(?:cy)?|insolvenc(?:y|ies)|corporate|shareholders?|chief executive|quarterly results?|annual results?)\b/i,
  },
  {
    category: "geopolitics",
    pattern: /\b(?:geopolitic(?:s|al)?|armed conflict|warfare|war|military|missiles?|ceasefires?|sanctions?|diplomac(?:y|tic)|international relations?|national security|border conflict|elections?|defen[cs]e|terrorism|hostilities)\b/i,
  },
  {
    category: "policy",
    pattern: /\b(?:regulat(?:ion|ions|or|ory)|legislation|legislative|parliament|congress|government policy|public policy|tariffs?|tax policy|antitrust|competition policy|enforcement action|rulemaking|legal reform|ministerial|white paper)\b/i,
  },
  {
    category: "energy",
    pattern: /\b(?:energy|crude oil|petroleum|natural gas|liquefied natural gas|\blng\b|opec|electricity|power grid|renewables?|solar power|wind power|nuclear power|pipelines?|refiner(?:y|ies)|utilities)\b/i,
  },
  {
    category: "technology",
    pattern: /\b(?:artificial intelligence|machine learning|generative ai|semiconductors?|microchips?|chipmakers?|cybersecurity|cyber attacks?|software|cloud computing|data cent(?:er|re)s?|telecommunications?|quantum computing|technology)\b/i,
  },
  {
    category: "climate_disasters",
    pattern: /\b(?:climate|climatechange|global warming|natural disasters?|earthquakes?|wildfires?|forest fires?|floods?|droughts?|hurricanes?|typhoons?|cyclones?|severe storms?|tsunami|volcan(?:o|ic)|extreme weather)\b/i,
  },
  {
    category: "health",
    pattern: /\b(?:public health|healthcare|hospitals?|diseases?|viruses?|pandemic|epidemic|outbreak|vaccines?|pharmaceuticals?|medicines?|drug approvals?|clinical trials?|world health organization|\bwho\b)\b/i,
  },
  {
    category: "transport",
    pattern: /\b(?:transport|transportation|shipping|maritime|vessels?|tankers?|ports?|aviation|airlines?|airports?|railways?|railroads?|freight|logistics|supply chains?|canals?|straits?|trucking)\b/i,
  },
];

const EVENT_CATEGORY: Record<string, NewsCategory[]> = {
  market_move: ["markets"],
  transport_disruption: ["transport"],
  aviation_disruption: ["transport"],
  transport_activity_change: ["transport"],
  weather_conditions: ["climate_disasters"],
  earthquake: ["climate_disasters"],
  wildfire: ["climate_disasters"],
  flood: ["climate_disasters"],
  severe_storm: ["climate_disasters"],
  agricultural_stress: ["climate_disasters", "economy"],
  security_incident: ["geopolitics"],
};

const STRUCTURED_TOPIC_MATERIALITY_RULES: Array<{ code: string; score: number; pattern: RegExp }> = [
  {
    code: "macro_price_release",
    score: 0.95,
    pattern: /\b(?:inflation|consumer prices?|producer prices?|\bcpi\b|\bppi\b|monetary policy|interest rates?|\bfomc\b|federal funds|discount rate)\b/i,
  },
  {
    code: "macro_activity_release",
    score: 0.9,
    pattern: /\b(?:employment|labou?r market|job openings?|unemployment|gross domestic product|\bgdp\b|economic statistics?|financial stability)\b/i,
  },
  {
    code: "market_structure_action",
    score: 0.78,
    pattern: /\b(?:market structure|securities regulation|enforcement|antitrust|competition policy|banking supervision|fraud charges?|charged with fraud)\b/i,
  },
  {
    code: "company_corporate_action",
    score: 0.88,
    pattern: /\b(?:earnings|quarterly results?|annual results?|mergers?|acquisitions?|takeovers?|initial public offering|\bipo\b|bankrupt(?:cy)?|insolvenc(?:y|ies))\b/i,
  },
  {
    code: "geopolitical_disruption",
    score: 0.9,
    pattern: /\b(?:sanctions?|armed conflict|warfare|military escalation|ceasefires?|trade embargo)\b/i,
  },
  {
    code: "energy_supply_disruption",
    score: 0.86,
    pattern: /\b(?:energy supply|crude oil|natural gas|liquefied natural gas|\blng\b|opec|pipelines?|power grid|refiner(?:y|ies))\b/i,
  },
  {
    code: "transport_supply_disruption",
    score: 0.84,
    pattern: /\b(?:supply chain|shipping disruption|port disruption|freight disruption|canal closure|airspace closure)\b/i,
  },
];

const RELEASE_SPECIFIC_INSTITUTIONAL_FEEDS = new Set([
  "bls_employment_situation",
  "bls_consumer_price_index",
  "bls_producer_price_index",
  "bls_job_openings",
  "ecb_statistical_press_releases",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizedText(value: unknown, maximum = 240): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .normalize("NFKC")
    .replace(/[_:/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function collectStrings(value: unknown, output: string[], depth = 0): void {
  if (output.length >= 120 || depth > 3 || value == null) return;
  const direct = normalizedText(value);
  if (direct) {
    output.push(direct);
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 50).forEach((entry) => collectStrings(entry, output, depth + 1));
    return;
  }
  if (typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    for (const key of ["name", "title", "label", "type", "id"]) {
      if (key in candidate) collectStrings(candidate[key], output, depth + 1);
    }
  }
}

type StructuredClassificationSignal = {
  signal: string;
  scope: "feed_topic" | "item_context";
};

function isBroadInstitutionalFeed(payload: unknown): boolean {
  const source = record(payload);
  const provider = String(source.provider ?? "").trim().toLowerCase();
  const feed = String(source.feed ?? "").trim().toLowerCase();
  return provider === "institutional_rss" && !RELEASE_SPECIFIC_INSTITUTIONAL_FEEDS.has(feed);
}

function structuredClassificationEvidence(payload: unknown): StructuredClassificationSignal[] {
  const source = record(payload);
  const gkg = record(source.gkg);
  const targeted = record(source.targeted_discovery);
  const output: StructuredClassificationSignal[] = [];
  const add = (value: unknown, scope: StructuredClassificationSignal["scope"]) => {
    const values: string[] = [];
    collectStrings(value, values);
    for (const value of values) {
      output.push({ signal: value.toLocaleLowerCase(), scope });
    }
  };
  add(source.category, "item_context");
  add(source.categories, "item_context");
  add(source.topics, isBroadInstitutionalFeed(payload) ? "feed_topic" : "item_context");
  add(source.themes, "item_context");
  add(source.document_type, "item_context");
  add(source.documentType, "item_context");
  add(source.organisations, "item_context");
  add(source.organizations, "item_context");
  add(gkg.themes, "item_context");
  add(gkg.organizations, "item_context");
  add(targeted.event_type, "item_context");
  return Array.from(new Map(
    output.map((entry) => [`${entry.scope}:${entry.signal}`, entry]),
  ).values()).sort((left, right) => (
    left.signal.localeCompare(right.signal) || left.scope.localeCompare(right.scope)
  ));
}

export function newsStructuredClassificationSignals(payload: unknown): string[] {
  return Array.from(new Set(
    structuredClassificationEvidence(payload).map((entry) => entry.signal),
  )).sort();
}

export function newsStructuredTopicMateriality(
  payload: unknown,
  title?: string | null,
  summary?: string | null,
): {
  score: number;
  codes: string[];
  signals: string[];
} {
  const source = record(payload);
  const broadInstitutionalFeed = isBroadInstitutionalFeed(payload);
  const itemText = `${normalizedText(title, 500) ?? ""} ${normalizedText(summary, 1_200) ?? ""}`;
  const matched = new Map<string, { score: number; signal: string }>();
  for (const { signal, scope } of structuredClassificationEvidence(payload)) {
    for (const rule of STRUCTURED_TOPIC_MATERIALITY_RULES) {
      // Institutional RSS topics describe the whole feed. Broad Fed/SEC/ECB/
      // Commission feeds therefore need item-specific structured or headline
      // evidence; exact BLS and ECB statistical-release feeds are safe
      // release-level context.
      if (rule.pattern.test(signal)
          && (!broadInstitutionalFeed || scope === "item_context" || rule.pattern.test(itemText))
          && (!matched.has(rule.code) || matched.get(rule.code)!.score < rule.score)) {
        matched.set(rule.code, { score: rule.score, signal });
      }
    }
  }
  const ordered = [...matched.entries()].sort((left, right) => (
    right[1].score - left[1].score || left[0].localeCompare(right[0])
  ));
  return {
    score: ordered[0]?.[1].score ?? 0,
    codes: ordered.map(([code]) => code),
    signals: ordered.map(([, value]) => value.signal).slice(0, 8),
  };
}

function finiteUnit(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

function finiteCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function dateValue(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function severityRank(value: unknown): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[String(value ?? "").toLowerCase()] ?? 0;
}

function eventEvidenceFactor(event: NewsAssessmentLinkedEvent): number {
  const correlation = finiteUnit(event.correlation_score, 1);
  const decision = String(record(event.correlation_factors).decision ?? "").toLowerCase();
  const hasIndependentContext = finiteCount(event.domain_count) > 1
    || finiteCount(event.source_diversity) > 1
    || finiteCount(event.distinct_publisher_count) > 1;
  // A story normally creates its own event record. That self-derived aggregate
  // is useful for taxonomy but is not new evidence of importance. It receives
  // only a bounded context factor until another source or domain is attached.
  if (!hasIndependentContext && decision === "created") return correlation * 0.25;
  if (!hasIndependentContext && decision !== "attached") return correlation * 0.5;
  return correlation;
}

function eventStrength(event: NewsAssessmentLinkedEvent): number {
  const evidenceFactor = eventEvidenceFactor(event);
  return finiteUnit(event.relevance_score) * evidenceFactor * 0.45
    + finiteUnit(event.materiality_score) * evidenceFactor * 0.2
    + finiteUnit(event.urgency_score) * evidenceFactor * 0.15
    + finiteUnit(event.confidence) * evidenceFactor * 0.1
    + severityRank(event.severity) / 4 * 0.1;
}

export function strongestNewsLinkedEvent(
  events: NewsAssessmentLinkedEvent[] | null | undefined,
): NewsAssessmentLinkedEvent | null {
  return [...(events ?? [])]
    .filter((event) => String(event.status ?? "").toLowerCase() !== "dismissed")
    .sort((left, right) => (
      eventStrength(right) - eventStrength(left)
      || String(left.id ?? "").localeCompare(String(right.id ?? ""))
    ))[0] ?? null;
}

type Classification = {
  primaryCategory: NewsCategory;
  categories: NewsCategory[];
  confidence: number;
  evidence: Array<{ category: NewsCategory; basis: "event" | "structured" | "lexical"; signal: string }>;
};

export function classifyNewsItem(input: NewsAssessmentInput): Classification {
  const event = strongestNewsLinkedEvent(input.linkedEvents);
  const points = new Map<NewsCategory, number>();
  const evidence: Classification["evidence"] = [];
  const add = (category: NewsCategory, score: number, basis: Classification["evidence"][number]["basis"], signal: string) => {
    points.set(category, (points.get(category) ?? 0) + score);
    evidence.push({ category, basis, signal: signal.slice(0, 120) });
  };

  const eventType = normalizedText(event?.event_type)?.toLocaleLowerCase().replace(/\s+/g, "_") ?? "";
  for (const category of EVENT_CATEGORY[eventType] ?? []) add(category, 4, "event", eventType);

  const itemText = `${normalizedText(input.title, 500) ?? ""} ${normalizedText(input.summary, 1_200) ?? ""}`;
  const structuredSignals = structuredClassificationEvidence(input.payload);
  for (const { signal, scope } of structuredSignals) {
    for (const rule of CATEGORY_RULES) {
      // Topics on broad institutional feeds describe the publisher's entire
      // feed, not necessarily this item. They can classify an item only when
      // its own headline/summary confirms the same category. Other provider
      // fields (document type, GDELT themes, targeted event context) remain
      // item-scoped structured evidence.
      if (scope === "feed_topic" && !rule.pattern.test(itemText)) continue;
      if (rule.pattern.test(signal)) add(rule.category, 2, "structured", signal);
    }
  }

  // Publisher text is untrusted and source-specific. Lexical classification is
  // deliberately a fallback only when no governed event or provider metadata
  // supplied a category.
  if (points.size === 0) {
    for (const rule of CATEGORY_RULES) {
      if (rule.pattern.test(itemText)) add(rule.category, 1, "lexical", rule.category);
    }
  }

  if (points.size === 0) {
    return {
      primaryCategory: "other",
      categories: ["other"],
      confidence: 0.2,
      evidence: [{ category: "other", basis: "lexical", signal: "no_supported_category" }],
    };
  }

  const ordered = [...points.entries()].sort((left, right) => (
    right[1] - left[1]
    || NEWS_CATEGORIES.indexOf(left[0]) - NEWS_CATEGORIES.indexOf(right[0])
  ));
  const categories = ordered.slice(0, 4).map(([category]) => category);
  const primaryEvidence = evidence.filter((entry) => entry.category === categories[0]);
  const basisConfidence = primaryEvidence.some((entry) => entry.basis === "event")
    ? 0.92
    : primaryEvidence.some((entry) => entry.basis === "structured")
      ? Math.min(0.9, 0.72 + primaryEvidence.length * 0.06)
      : 0.55;
  return {
    primaryCategory: categories[0],
    categories,
    confidence: Number(basisConfidence.toFixed(3)),
    evidence: evidence.slice(0, 20),
  };
}

function publicationFreshness(input: NewsAssessmentInput, assessedAt: Date) {
  // Ingestion time is operational provenance, never evidence that a publisher
  // released the story recently. Missing publisher time therefore fails closed.
  const publishedAt = dateValue(input.eventTime);
  if (!publishedAt || publishedAt.getTime() > assessedAt.getTime() + 5 * 60_000) {
    return { score: 0, ageHours: null, valid: false };
  }
  const ageHours = Math.max(0, (assessedAt.getTime() - publishedAt.getTime()) / 3_600_000);
  const score = ageHours <= 1 ? 1
    : ageHours <= 6 ? 0.9
      : ageHours <= 24 ? 0.75
        : ageHours <= 72 ? 0.45
          : ageHours <= 168 ? 0.2
            : 0;
  return { score, ageHours: Number(ageHours.toFixed(3)), valid: true };
}

function sourceEvidenceQuality(input: NewsAssessmentInput, publicationValid: boolean): number {
  const payload = record(input.payload);
  if (String(payload.quality_status ?? "").toLowerCase() === "rejected") return 0;
  const timeBasis = String(payload.time_basis ?? "").toLowerCase();
  if (publicationValid && (timeBasis.includes("publisher_published") || timeBasis.includes("verified"))) return 1;
  if (publicationValid && String(payload.quality_status ?? "").toLowerCase() === "accepted") return 0.95;
  if (publicationValid) return 0.75;
  return 0.25;
}

function publisherDiversityScore(count: number): number {
  if (count < 2) return 0;
  if (count === 2) return 0.4;
  if (count === 3) return 0.7;
  return 1;
}

function importanceTier(score: number): NewsImportanceTier {
  if (score >= 80) return "top";
  if (score >= 60) return "high";
  if (score >= 35) return "notable";
  return "routine";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableValue(entry)]));
}

function assessmentHour(date: Date): string {
  return date.toISOString().slice(0, 13) + ":00:00.000Z";
}

export function assessNewsItem(input: NewsAssessmentInput, now = new Date()): NewsAssessment {
  if (!Number.isSafeInteger(input.itemId) || input.itemId <= 0) {
    throw new Error("News assessment itemId must be a positive safe integer.");
  }
  if (Number.isNaN(now.getTime())) throw new Error("News assessment time must be valid.");
  const assessedAt = new Date(now.getTime());
  const classification = classifyNewsItem(input);
  const event = strongestNewsLinkedEvent(input.linkedEvents);
  const freshness = publicationFreshness(input, assessedAt);
  const sourceQuality = sourceEvidenceQuality(input, freshness.valid);
  const structuredMateriality = newsStructuredTopicMateriality(input.payload, input.title, input.summary);
  const evidenceFactor = event ? eventEvidenceFactor(event) : 0;
  const eventRelevance = event ? finiteUnit(event.relevance_score) * evidenceFactor : 0;
  const materiality = event ? finiteUnit(event.materiality_score) * evidenceFactor : 0;
  const urgency = event ? finiteUnit(event.urgency_score) * evidenceFactor : 0;
  const evidenceConfidence = event ? finiteUnit(event.confidence) * evidenceFactor : 0;
  const distinctPublishers = event ? finiteCount(event.distinct_publisher_count) : 0;
  const publisherDiversity = publisherDiversityScore(distinctPublishers);
  const score = Math.round(Math.max(0, Math.min(100,
    eventRelevance * 23
    + materiality * 14
    + urgency * 12
    + structuredMateriality.score * 20
    + freshness.score * 14
    + evidenceConfidence * 8
    + publisherDiversity * 5
    + sourceQuality * 4,
  )));

  const reasons: NewsAssessmentReason[] = [];
  if (eventRelevance >= 0.7) reasons.push({ code: "high_event_relevance", label: "High-relevance linked event" });
  if (materiality >= 0.65) reasons.push({ code: "material_event_context", label: "Material linked-event context" });
  if (urgency >= 0.65) reasons.push({ code: "urgent_event_context", label: "Urgent linked-event context" });
  if (distinctPublishers >= 2) reasons.push({
    code: "independent_publishers",
    label: `${distinctPublishers} distinct original publishers linked to the event`,
  });
  if (event && finiteCount(event.domain_count) > 1) reasons.push({
    code: "cross_domain_event_context",
    label: "Linked event has cross-domain evidence",
  });
  if (structuredMateriality.score >= 0.7) reasons.push({
    code: "market_sensitive_source_topic",
    label: "Source metadata identifies a market-sensitive topic",
  });
  if (freshness.score >= 0.75) reasons.push({ code: "recent_publication", label: "Recently published" });
  if (!event) reasons.push({ code: "limited_event_evidence", label: "No qualifying linked-event evidence yet" });
  if (!freshness.valid) reasons.push({ code: "unverified_publication_time", label: "Publication time unavailable or invalid" });

  const tags: NewsAssessmentTag[] = classification.categories.slice(0, 3).map((category) => ({
    code: `category:${category}`,
    label: CATEGORY_LABELS[category],
    kind: "category",
  }));
  const eventType = normalizedText(event?.event_type)?.toLocaleLowerCase().replace(/\s+/g, "_") ?? "";
  if (eventType && eventType !== "reported_development") {
    tags.push({
      code: `event:${eventType}`,
      label: eventType.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "),
      kind: "event",
    });
  }
  if (event && ["high", "critical"].includes(String(event.severity ?? "").toLowerCase())) {
    const severity = String(event.severity).toLowerCase();
    tags.push({ code: `severity:${severity}`, label: `${severity[0].toUpperCase()}${severity.slice(1)} severity`, kind: "evidence" });
  }
  if (distinctPublishers >= 2) {
    tags.push({ code: "evidence:publishers", label: `${distinctPublishers} publishers`, kind: "evidence" });
  }
  if (structuredMateriality.codes[0]) {
    tags.push({
      code: `topic:${structuredMateriality.codes[0]}`,
      label: structuredMateriality.codes[0].split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "),
      kind: "topic",
    });
  }

  const confidence = event
    ? Math.min(1, evidenceConfidence * 0.55 + classification.confidence * 0.25 + sourceQuality * 0.2)
    : Math.min(0.7, classification.confidence * 0.55 + sourceQuality * 0.45);
  const components: Record<string, unknown> = {
    event_relevance: Number(eventRelevance.toFixed(4)),
    materiality: Number(materiality.toFixed(4)),
    urgency: Number(urgency.toFixed(4)),
    structured_topic_materiality: structuredMateriality.score,
    structured_topic_materiality_codes: structuredMateriality.codes,
    structured_topic_materiality_signals: structuredMateriality.signals,
    freshness: freshness.score,
    publication_age_hours: freshness.ageHours,
    publication_time_valid: freshness.valid,
    evidence_confidence: Number(evidenceConfidence.toFixed(4)),
    distinct_original_publishers: distinctPublishers,
    publisher_diversity: publisherDiversity,
    source_evidence_quality: sourceQuality,
    linked_event_id: event?.id ?? null,
    linked_event_type: event?.event_type ?? null,
    linked_event_assignment: record(event?.correlation_factors).decision ?? null,
    event_evidence_factor: Number(evidenceFactor.toFixed(4)),
    cross_domain_evidence: event ? finiteCount(event.domain_count) > 1 : false,
    category_evidence: classification.evidence,
    weights: {
      event_relevance: 0.23,
      materiality: 0.14,
      urgency: 0.12,
      structured_topic_materiality: 0.20,
      freshness: 0.14,
      evidence_confidence: 0.08,
      publisher_diversity: 0.05,
      source_evidence_quality: 0.04,
    },
  };
  const hashInput = stableValue({
    methodology: NEWS_ASSESSMENT_METHODOLOGY,
    assessment_hour: assessmentHour(assessedAt),
    item_id: input.itemId,
    title: input.title ?? null,
    summary: input.summary ?? null,
    event_time: dateValue(input.eventTime)?.toISOString() ?? null,
    created_at: dateValue(input.createdAt)?.toISOString() ?? null,
    source_name: input.sourceName ?? null,
    structured_signals: newsStructuredClassificationSignals(input.payload),
    quality_status: record(input.payload).quality_status ?? null,
    time_basis: record(input.payload).time_basis ?? null,
    linked_events: (input.linkedEvents ?? []).map((linked) => ({
      id: linked.id ?? null,
      event_type: linked.event_type ?? null,
      status: linked.status ?? null,
      severity: linked.severity ?? null,
      confidence: finiteUnit(linked.confidence),
      relevance_score: finiteUnit(linked.relevance_score),
      urgency_score: finiteUnit(linked.urgency_score),
      materiality_score: finiteUnit(linked.materiality_score),
      correlation_score: finiteUnit(linked.correlation_score, 1),
      correlation_factors: stableValue(record(linked.correlation_factors)),
      source_diversity: finiteCount(linked.source_diversity),
      domain_count: finiteCount(linked.domain_count),
      distinct_publisher_count: finiteCount(linked.distinct_publisher_count),
    })).sort((left, right) => String(left.id ?? "").localeCompare(String(right.id ?? ""))),
  });
  const inputsHash = createHash("sha256").update(JSON.stringify(hashInput)).digest("hex");

  return {
    itemId: input.itemId,
    methodologyVersion: NEWS_ASSESSMENT_METHODOLOGY,
    primaryCategory: classification.primaryCategory,
    categories: classification.categories,
    tags: tags.slice(0, 6),
    reasons: reasons.slice(0, 5),
    components,
    score,
    tier: importanceTier(score),
    confidence: Number(confidence.toFixed(4)),
    assessedAt: assessedAt.toISOString(),
    inputsHash,
  };
}
