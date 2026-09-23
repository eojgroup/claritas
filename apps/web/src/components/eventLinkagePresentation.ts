type CorrelationFactors = Record<string, unknown> | null | undefined;

export type EventLinkagePresentation = {
  label: "Starting signal" | "Likely linked";
  shortReason: string;
  explanation: string;
};

function factorNumber(factors: CorrelationFactors, key: string) {
  const value = factors?.[key];
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function factorString(factors: CorrelationFactors, key: string) {
  const value = factors?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Turns governed correlation components into reader-facing language. The
 * Country alone is never sufficient. The sole exception surfaced here is the
 * governed news fallback where the backend proves there is exactly one major
 * same-family event in that country and time window.
 */
export function presentEventLinkage(
  correlationScore?: number | null,
  factors?: CorrelationFactors,
): EventLinkagePresentation {
  const decision = factorString(factors, "decision");
  const location = factorNumber(factors, "location");
  const spatial = factorNumber(factors, "spatial");
  const entity = factorNumber(factors, "entity");
  const temporal = factorNumber(factors, "temporal");
  const eventType = factorNumber(factors, "event_type");
  const country = factorNumber(factors, "country");
  const governedRationale = factorString(factors, "rationale");
  const matchedEntities = Array.isArray(factors?.matched_entities)
    ? factors.matched_entities.filter((value): value is string => typeof value === "string").slice(0, 3) : [];
  const uniqueCountryCandidate = factors?.unique_country_candidate === true;
  const anchorReasons: string[] = [];
  const supportingReasons: string[] = [];

  if (factorNumber(factors, "instrument") === 1) anchorReasons.push(`the same financial instrument${matchedEntities.some((value) => value.startsWith("instrument:")) ? ` (${matchedEntities.filter((value) => value.startsWith("instrument:")).map((value) => value.slice(11).toUpperCase()).join(", ")})` : ""}`);
  if (location >= 0.99) anchorReasons.push("the same named location");
  else if (spatial >= 0.45) anchorReasons.push("nearby mapped geography");
  else if (spatial >= 0.25) anchorReasons.push("overlapping mapped geography");

  if (entity >= 0.5) anchorReasons.push("shared named entities");
  else if (entity >= 0.25) anchorReasons.push("partly shared named entities");
  if (uniqueCountryCandidate && country >= 0.99 && eventType >= 0.99) {
    anchorReasons.push("the only major same-family event in the country and time window");
  }
  if (temporal >= 0.5) supportingReasons.push("closely aligned timing");
  if (eventType >= 0.99) supportingReasons.push("a matching event family");

  const hasAnchor = anchorReasons.length > 0;
  if (country >= 0.99) supportingReasons.push("the same country as supporting context");
  const reasons = hasAnchor ? [...anchorReasons, ...supportingReasons] : [];

  if (decision === "created") {
    const screeningReasons = [...anchorReasons, ...supportingReasons];
    const detail = screeningReasons.length
      ? ` Screening considered ${joinReasons(screeningReasons)}.`
      : " It is shown as the source that opened the investigation.";
    return {
      label: "Starting signal",
      shortReason: screeningReasons[0] ? `Started from ${screeningReasons[0]}` : "Started this investigation",
      explanation: `This source started the current investigation.${detail} It does not establish cause or impact on its own.`,
    };
  }

  if (reasons.length > 0) {
    return {
      label: "Likely linked",
      shortReason: joinReasons(reasons),
      explanation: governedRationale
        ?? `Shown as a likely connection because of ${joinReasons(reasons)}. This is an evidence-graph association, not a claim of causation.`,
    };
  }

  const score = typeof correlationScore === "number" && Number.isFinite(correlationScore)
    ? `${Math.round(correlationScore * 100)}% correlation score`
    : null;
  return {
    label: "Likely linked",
    shortReason: score ?? "Evidence-graph association",
    explanation: governedRationale ?? (score
      ? `Shown because it passed the evidence-graph connection assessment (${score}); individual matching factors are unavailable. This is not a claim of causation.`
      : "Included in this event’s evidence graph. A more specific matching rationale is unavailable, and no causal relationship is implied."),
  };
}

export function signalDomainLabel(domain: string | null | undefined, sourceRecordType?: string | null) {
  const value = `${domain ?? ""} ${sourceRecordType ?? ""}`
    .toLocaleLowerCase()
    .replace(/[_-]+/g, " ");
  if (/\b(weather|meteorolog|forecast|openweather|nws)\b/.test(value)) return "Weather signal";
  if (/\b(transport|aviation|maritime|vessel|flight|ais|adsb)\b/.test(value)) return "Transport signal";
  if (/\b(podcasts?|episode)\b/.test(value)) return "Podcast episode";
  if (/\b(news|article|publisher)\b/.test(value)) return "News report";
  if (/\b(earth|satellite|firms|observation)\b/.test(value)) return "Earth observation";
  if (/\b(market|economic|finance)\b/.test(value)) return "Market signal";
  if (/\b(official|government)\b/.test(value)) return "Official signal";
  return (domain || sourceRecordType || "Source signal").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function joinReasons(reasons: string[]) {
  if (reasons.length <= 1) return reasons[0] ?? "available evidence";
  if (reasons.length === 2) return `${reasons[0]} and ${reasons[1]}`;
  return `${reasons.slice(0, -1).join(", ")}, and ${reasons[reasons.length - 1]}`;
}

/** Show only dimensions that actually contributed to the stored connection. */
export function connectionDimensions(factors: CorrelationFactors): string[] {
  return [
    factorNumber(factors, "location") >= 0.99 ? "Named place" : null,
    factorNumber(factors, "spatial") >= 0.25 ? "Nearby area" : null,
    factorNumber(factors, "instrument") === 1 ? "Same stock / instrument" : null,
    factorNumber(factors, "entity") >= 0.25 ? "Shared entity" : null,
    factorNumber(factors, "event_type") >= 0.99 ? "Same event topic" : null,
    factorNumber(factors, "temporal") > 0 ? "Nearby timing" : null,
  ].filter((value): value is string => value !== null);
}
