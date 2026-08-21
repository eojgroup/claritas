import { query, withTransaction } from "../db";
import worldCountries from "world-countries";
import { hasEarthquakeHeadlineSignal } from "../earthquake-language";
import { buildEventDedupeKey, computeSignalPriority, evaluateMarketMove } from "./correlation";
import { resolveLocationFromText, resolveNearestLocation } from "./location-resolver";
import {
  attachIntelligenceSignalToExistingEvent,
  attachIntelligenceSignalToMajorEventContext,
  correlateAndUpsertIntelligenceSignal,
  upsertStandaloneContextSourceSignal,
  type TargetedEarthquakeContextAudit,
} from "./service";
import {
  attachWeatherSnapshotToMajorEventContext,
  refreshMajorEarthquakeContext,
  refreshRecentMajorEarthquakeTransportContext,
} from "./major-event-context";
import { calculateRollingBaseline, detectTransportAnomaly } from "./transport-anomaly";
import { trustedGdeltActionCoordinate, trustedGdeltLocations } from "./gdelt-geography";
import { buildGdeltEventPresentation } from "./event-presentation";
import { earthquakeContextEligibility } from "./contextual-linkage";
import type { DomainEventEnvelope, IntelligenceSeverity } from "./types";

const sourceReliability: Record<string, number> = {
  "usgs-earthquakes": 0.98,
  "nasa-firms": 0.95,
  nws: 0.95,
  gdelt: 0.72,
  aisstream: 0.72,
  digitraffic: 0.9,
  barentswatch: 0.92,
  kystverket: 0.92,
  mpa_oceans_x: 0.9,
  "adsb-lol": 0.72,
};

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const sixHourKey = (date: Date) => `${date.toISOString().slice(0, 10)}T${String(Math.floor(date.getUTCHours() / 6) * 6).padStart(2, "0")}`;

function collectEntityKeys(...values: unknown[]) {
  const collected: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized.length >= 2 && normalized.length <= 180) collected.push(normalized);
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 50).forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      visit(record.name ?? record.canonical_name ?? record.label ?? record.id);
    }
  };
  values.forEach(visit);
  return [...new Set(collected)].slice(0, 40);
}

function stringList(value: unknown, maximum = 40) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 180)))
    .slice(0, maximum);
}

function countryList(value: unknown) {
  return stringList(value, 8)
    .map((item) => item.toUpperCase())
    .filter((item) => /^[A-Z]{2}$/.test(item));
}

function podcastSignalRecordId(episodeId: number, signalType: string, canonicalKey: string) {
  return `podcast:${episodeId}:${signalType}:${canonicalKey}`;
}

/**
 * Podcast extraction is interpretive context, not an event detector. Only a
 * transcript-supported, sufficiently confident finding with a concrete entity
 * anchor is allowed to attempt the existing anchored-correlation policy.
 */
export function podcastSignalQualifiesForEventContext(input: {
  signalType: string;
  confidence: unknown;
  evidenceCount: unknown;
  entities: unknown;
}) {
  const confidence = Number(input.confidence);
  const evidenceCount = Number(input.evidenceCount);
  return ["event", "risk", "claim"].includes(input.signalType)
    && Number.isFinite(confidence) && confidence >= 0.55
    && Number.isFinite(evidenceCount) && evidenceCount > 0
    && stringList(input.entities).length > 0;
}

export function isAcceptedNewsQuality(payload: unknown, sourceName: unknown) {
  // GDELT records are discovery candidates until the connector has verified
  // a publisher date. Older GDELT rows predate that marker, so treating a
  // missing status as accepted would let the exact stale rediscoveries this
  // policy fixes keep generating investigation events.
  const requiresVerifiedQuality = String(sourceName ?? "").toLowerCase() === "gdelt";
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return !requiresVerifiedQuality;
  const status = (payload as Record<string, unknown>).quality_status;
  return status === "accepted" || (status == null && !requiresVerifiedQuality);
}

export function classifyEventType(text: string) {
  const normalized = text.toLowerCase();
  // News classification receives headline + summary. Keep the detector's
  // bounded-input guarantee without letting a long summary hide a clear
  // earthquake headline at the start of the record.
  if (hasEarthquakeHeadlineSignal(text.slice(0, 1_000))) return "earthquake";
  const mappings: Array<[RegExp, string]> = [
    [/wildfire|forest fire|bushfire|active fire/, "wildfire"],
    [/flood|inundation|flash flood/, "flood"],
    [/hurricane|typhoon|cyclone|storm/, "severe_storm"],
    [/port|shipping|vessel|tanker|canal|strait/, "transport_disruption"],
    [/airport|aviation|flight|airspace/, "aviation_disruption"],
    [/drought|crop|harvest/, "agricultural_stress"],
    [/attack|explosion|strike|conflict/, "security_incident"],
  ];
  return mappings.find(([pattern]) => pattern.test(normalized))?.[1] ?? "reported_development";
}

type WorldCountry = { cca2?: string; name?: { common?: string; official?: string } };

export function earthquakeCountryFromPlace(place: unknown) {
  if (typeof place !== "string" || !place.trim()) return null;
  const normalized = place.trim().toLocaleLowerCase();
  const matches = (worldCountries as WorldCountry[]).filter((country) => {
    const names = [country.name?.common, country.name?.official]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLocaleLowerCase());
    return names.some((name) => normalized === name
      || normalized.endsWith(`, ${name}`)
      || normalized.endsWith(` ${name}`));
  });
  return matches.length === 1 ? matches[0].cca2 ?? null : null;
}

export function earthquakePlaceEntityKeys(place: unknown, eventId: unknown) {
  const values = collectEntityKeys(place, eventId);
  if (typeof place !== "string") return values;
  const trimmed = place.trim();
  const localPlace = trimmed.match(/\b(?:of|near)\s+([^,]+)/i)?.[1]?.trim();
  const commaParts = trimmed.split(",").map((value) => value.trim()).filter(Boolean);
  return collectEntityKeys(values, localPlace, commaParts.at(-1));
}

type TargetedEarthquakeDiscoveryDecision = {
  present: boolean;
  linkEligible: boolean;
  rejectionReason: string | null;
  audit: TargetedEarthquakeContextAudit | null;
  observedAt: Date | null;
};

const TARGETED_DISCOVERY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedContractString(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return normalized.length >= minimum && normalized.length <= maximum ? normalized : null;
}

/**
 * Treats the presence of `targeted_discovery` as a routing decision even when
 * the payload is malformed. Review-only or invalid candidates must never fall
 * through to broad country/time context attachment.
 */
export function targetedEarthquakeDiscoveryDecision(payload: unknown): TargetedEarthquakeDiscoveryDecision {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || !Object.prototype.hasOwnProperty.call(payload, "targeted_discovery")) {
    return { present: false, linkEligible: false, rejectionReason: null, audit: null, observedAt: null };
  }
  const raw = (payload as Record<string, unknown>).targeted_discovery;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { present: true, linkEligible: false, rejectionReason: "invalid_targeted_discovery", audit: null, observedAt: null };
  }
  const discovery = raw as Record<string, unknown>;
  const match = discovery.match;
  if (!match || typeof match !== "object" || Array.isArray(match)
      || (match as Record<string, unknown>).link_eligible !== true) {
    return { present: true, linkEligible: false, rejectionReason: "targeted_match_not_link_eligible", audit: null, observedAt: null };
  }
  const matchRecord = match as Record<string, unknown>;
  const earthquakeObservationId = boundedContractString(discovery.earthquake_observation_id, 36, 36);
  const usgsEventId = boundedContractString(discovery.usgs_event_id, 3, 100);
  const place = boundedContractString(discovery.place, 2, 300);
  const methodology = discovery.method === "deterministic_gdelt_doc_event_query_v1"
    ? discovery.method : null;
  const eventType = discovery.event_type === "earthquake" ? "earthquake" : null;
  const scope = matchRecord.scope === "local_place" || matchRecord.scope === "event_signature"
    ? matchRecord.scope : null;
  const confidence = Number(matchRecord.confidence);
  const rationale = boundedContractString(matchRecord.rationale, 10, 1_000);
  const assessmentBoundary = boundedContractString(matchRecord.assessment_boundary, 10, 1_000);
  const factors = Array.isArray(matchRecord.factors)
    ? matchRecord.factors
      .map((factor) => boundedContractString(factor, 2, 240))
      .filter((factor): factor is string => Boolean(factor))
      .slice(0, 12)
    : [];
  const observedAtValue = boundedContractString(discovery.observed_at, 10, 80);
  const observedAt = observedAtValue ? new Date(observedAtValue) : null;
  if (!earthquakeObservationId || !TARGETED_DISCOVERY_UUID.test(earthquakeObservationId)
      || !usgsEventId || !/^[a-z0-9._-]+$/i.test(usgsEventId)
      || !place || !methodology || !eventType || !scope
      || !Number.isFinite(confidence) || confidence < 0.75 || confidence > 1
      || !rationale || !assessmentBoundary || factors.length === 0
      || !observedAt || Number.isNaN(observedAt.getTime())) {
    return { present: true, linkEligible: false, rejectionReason: "invalid_link_eligible_target_contract", audit: null, observedAt: null };
  }
  return {
    present: true,
    linkEligible: true,
    rejectionReason: null,
    observedAt,
    audit: {
      earthquakeObservationId,
      usgsEventId,
      place,
      confidence,
      scope,
      factors,
      rationale,
      assessmentBoundary,
      methodology,
    },
  };
}

function normalizedTargetPlace(value: unknown) {
  return typeof value === "string"
    ? value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim()
    : "";
}

export function targetedEarthquakeIdentityMatches(
  decision: TargetedEarthquakeDiscoveryDecision,
  observation: {
    id: unknown;
    usgsEventId: unknown;
    place: unknown;
    observedAt: Date;
  },
) {
  return Boolean(decision.linkEligible && decision.audit && decision.observedAt
    && observation.id === decision.audit.earthquakeObservationId
    && observation.usgsEventId === decision.audit.usgsEventId
    && normalizedTargetPlace(observation.place) === normalizedTargetPlace(decision.audit.place)
    && !Number.isNaN(observation.observedAt.getTime())
    && Math.abs(observation.observedAt.getTime() - decision.observedAt.getTime()) <= 5 * 60_000);
}

export function targetedEarthquakeEntityKeys(
  decision: TargetedEarthquakeDiscoveryDecision,
) {
  return decision.linkEligible && decision.audit
    ? collectEntityKeys(
        earthquakePlaceEntityKeys(decision.audit.place, decision.audit.usgsEventId),
        decision.audit.earthquakeObservationId,
      )
    : [];
}

export function newsEventTypeForTargetedDiscovery(
  text: string,
  decision: Pick<TargetedEarthquakeDiscoveryDecision, "linkEligible">,
) {
  return decision.linkEligible ? "earthquake" : classifyEventType(text);
}

async function resolveTargetedEarthquakeEvent(
  decision: TargetedEarthquakeDiscoveryDecision,
) {
  if (!decision.linkEligible || !decision.audit || !decision.observedAt) return null;
  const { rows } = await query<{
    event_id: string;
    observation_id: string;
    usgs_event_id: string;
    place: string;
    observed_at: string | Date;
  }>(
    `SELECT linked_event.id AS event_id,observation.id::text AS observation_id,
            observation.usgs_event_id,observation.place,observation.observed_at
     FROM earthquake_observation observation
     JOIN intelligence_event_evidence evidence
       ON evidence.source_record_type='earthquake_observation'
      AND evidence.source_record_id=observation.id::text
      AND evidence.domain='disaster'
      AND evidence.evidence_type='seismic_observation'
     JOIN intelligence_event linked_event ON linked_event.id=evidence.event_id
     WHERE observation.id=$1::uuid
       AND linked_event.event_type='earthquake'
     ORDER BY CASE WHEN evidence.relationship='observed' THEN 0 ELSE 1 END,
              linked_event.start_time DESC,linked_event.id
     LIMIT 1`,
    [decision.audit.earthquakeObservationId],
  );
  const target = rows[0];
  if (!target || !targetedEarthquakeIdentityMatches(decision, {
    id: target.observation_id,
    usgsEventId: target.usgs_event_id,
    place: target.place,
    observedAt: new Date(target.observed_at),
  })) {
    return null;
  }
  return target.event_id;
}

function weatherSeverity(value: string | null): IntelligenceSeverity {
  const normalized = value?.toLowerCase();
  if (normalized === "extreme") return "critical";
  if (normalized === "severe") return "high";
  if (normalized === "moderate") return "medium";
  return "low";
}

async function countryLocation(countryIso2: string | null | undefined) {
  if (!countryIso2) return null;
  const { rows } = await query<any>(
    `SELECT id,slug,canonical_name,country_iso2,latitude,longitude,importance_score,monitoring_tier
     FROM intelligence_location WHERE slug=$1 AND active`,
    [`country-${countryIso2.toLowerCase()}`],
  );
  return rows[0] ?? null;
}

async function handleNewsStory(event: DomainEventEnvelope) {
  const itemId = Number(event.payload.item_id ?? event.aggregate_id);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) return;
  const { rows } = await query<any>(
    `SELECT item.*,source.name AS source_name,source.metadata AS source_metadata
     FROM item JOIN source ON source.id=item.source_id
     WHERE item.id=$1 AND item.kind='news_article'`,
    [itemId],
  );
  const story = rows[0];
  if (!story || !isAcceptedNewsQuality(story.payload, story.source_name)) return;
  const targetedDiscovery = targetedEarthquakeDiscoveryDecision(story.payload);
  const occurred = new Date(story.event_time ?? story.created_at);
  const text = `${story.title ?? ""} ${story.summary ?? ""}`;
  const gkgCoordinate = trustedGdeltLocations(story.payload)[0] ?? null;
  const location = (gkgCoordinate
    ? await resolveNearestLocation(gkgCoordinate.latitude, gkgCoordinate.longitude, 150)
    : null)
    ?? await resolveLocationFromText(text, story.country_iso2)
    ?? await countryLocation(story.country_iso2);
  // Precisely located offshore/local reporting remains usable even when the
  // provider omitted a country and no catalogue location is nearby. A valid
  // targeted contract may also continue without article coordinates because
  // its event identity is verified separately and never reused as article
  // geography.
  if (!location && !story.country_iso2 && !gkgCoordinate && !targetedDiscovery.linkEligible) return;
  // A fully validated targeted contract already carries an exact
  // observation-backed earthquake identity. It may therefore supply the
  // family for a local-language title; malformed and review-only contracts
  // remain on the fail-closed targeted routing path below.
  const eventType = newsEventTypeForTargetedDiscovery(text, targetedDiscovery);
  const targetedEventId = targetedDiscovery.linkEligible
    ? await resolveTargetedEarthquakeEvent(targetedDiscovery)
    : null;
  // Contract identity is retained even when the news outbox wins the race
  // against canonical USGS event creation. The standalone source can then be
  // recovered by `attachExistingNews` during the earthquake context refresh.
  const targetedEntityKeys = targetedEarthquakeEntityKeys(targetedDiscovery);
  const reliability = sourceReliability[story.source_name] ?? 0.68;
  const priority = computeSignalPriority({
    sourceReliability: reliability,
    sourceDiversity: 1,
    freshnessHours: Math.max(0, (Date.now() - occurred.getTime()) / 3_600_000),
    severity: eventType === "security_incident" ? "high" : "medium",
    locationImportance: Number(location?.importance_score ?? 0.45),
    domainCount: 1,
  });
  const newsAnchor = gkgCoordinate
    ? `${Math.round(gkgCoordinate.latitude * 10) / 10},${Math.round(gkgCoordinate.longitude * 10) / 10}`
    : location?.id ?? story.country_iso2;
  const signalInput = {
    dedupeKey: targetedDiscovery.present
      ? buildEventDedupeKey(["targeted-news-source", itemId])
      : buildEventDedupeKey([eventType, newsAnchor, dayKey(occurred)]),
    eventType,
    title: String(story.title ?? "Reported development"),
    summary: String(story.summary ?? "A publisher reported a development. Independent corroboration may still be limited.").slice(0, 1_800),
    status: "emerging",
    severity: eventType === "security_incident" ? "high" : "medium",
    confidence: Math.min(0.85, reliability),
    startTime: occurred,
    lastActivityTime: occurred,
    primaryLocationId: location?.id ?? null,
    primaryCountryIso2: location?.country_iso2 ?? story.country_iso2,
    latitude: gkgCoordinate?.latitude ?? location?.latitude ?? null,
    longitude: gkgCoordinate?.longitude ?? location?.longitude ?? null,
    coordinatesAreExact: Boolean(gkgCoordinate),
    relevanceScore: priority.score,
    urgencyScore: eventType === "security_incident" ? 0.72 : 0.45,
    materialityScore: Number(location?.importance_score ?? 0.45),
    scoreComponents: priority.components,
    metadata: {
      extraction: "deterministic-keyword-v2",
      source_title_preserved: true,
      coordinate_source: gkgCoordinate ? "gdelt_gkg_location" : location?.match_basis ?? null,
      targeted_discovery_present: targetedDiscovery.present,
      targeted_discovery_link_eligible: targetedDiscovery.linkEligible,
      targeted_discovery_target_resolved: Boolean(targetedEventId),
      targeted_discovery_rejection: targetedDiscovery.present && !targetedEventId
        ? targetedDiscovery.rejectionReason ?? "target_identity_not_resolved" : null,
      targeted_event_coordinates_used_as_article_geography: false,
    },
    entityKeys: targetedEntityKeys.length
      ? targetedEntityKeys
      : collectEntityKeys(
          gkgCoordinate?.name,
          story.payload?.gkg?.persons,
          story.payload?.gkg?.organizations,
          story.payload?.gkg?.locations,
        ),
    evidence: {
      domain: "news",
      evidenceType: "reported_event",
      sourceRecordType: "item",
      sourceRecordId: String(itemId),
      sourceId: story.source_id,
      observedAt: occurred,
      publishedAt: occurred,
      locationId: location?.id ?? null,
      confidence: reliability,
      relationship: "reported",
      provenance: { provider: story.source_name, publisher: story.payload?.source ?? story.payload?.domain ?? story.source_name, url: story.url },
      license: story.source_metadata?.license ?? null,
      attribution: story.payload?.source ?? story.source_name,
      metadata: {
        original_title: story.title,
        original_summary: story.summary,
        language_code: story.language_code,
        extracted_coordinate: gkgCoordinate,
        targeted_discovery_present: targetedDiscovery.present,
        targeted_discovery_link_eligible: targetedDiscovery.linkEligible,
        targeted_discovery_target_resolved: Boolean(targetedEventId),
        targeted_event_coordinates_used_as_article_geography: false,
        ...(targetedDiscovery.audit ? {
          targeted_discovery_routing: {
            methodology: targetedDiscovery.audit.methodology,
            earthquake_observation_id: targetedDiscovery.audit.earthquakeObservationId,
            usgs_event_id: targetedDiscovery.audit.usgsEventId,
            place: targetedDiscovery.audit.place,
            match_scope: targetedDiscovery.audit.scope,
            match_confidence: targetedDiscovery.audit.confidence,
            match_factors: targetedDiscovery.audit.factors,
            match_rationale: targetedDiscovery.audit.rationale,
            assessment_boundary: targetedDiscovery.audit.assessmentBoundary,
          },
        } : {}),
      },
    },
  } satisfies Parameters<typeof correlateAndUpsertIntelligenceSignal>[0];
  if (targetedDiscovery.present) {
    if (targetedEventId && targetedDiscovery.audit) {
      await attachIntelligenceSignalToMajorEventContext(signalInput, {
        onlyEventId: targetedEventId,
        targetedDiscovery: targetedDiscovery.audit,
      });
    } else if (targetedDiscovery.linkEligible && targetedDiscovery.audit) {
      // Preserve a validated but not-yet-resolvable source for the USGS/news
      // outbox ordering race. Review-only or malformed targeted results stay
      // in the news stream and do not become investigation events.
      await upsertStandaloneContextSourceSignal(signalInput);
    }
    // The targeted contract is a fail-closed routing boundary. Review-only,
    // malformed, or unresolved candidates never enter generic country/time
    // contextual fallback and an eligible match can reach only its exact
    // observation-backed canonical event.
    return;
  }
  const selected = await correlateAndUpsertIntelligenceSignal(signalInput);
  await attachIntelligenceSignalToMajorEventContext(signalInput, { excludeEventId: selected.id });
}

async function handlePodcastSignal(event: DomainEventEnvelope) {
  const episodeId = Number(event.payload.episode_id);
  const signalType = typeof event.payload.signal_type === "string"
    ? event.payload.signal_type.trim().toLowerCase()
    : "";
  const canonicalKey = typeof event.payload.canonical_key === "string"
    ? event.payload.canonical_key.trim()
    : "";
  if (!Number.isSafeInteger(episodeId) || episodeId <= 0 || !signalType || !canonicalKey) return;

  const { rows } = await query<any>(
    `SELECT signal.id, signal.episode_id, signal.signal_type, signal.title, signal.summary,
            signal.canonical_key, signal.entities,
            COALESCE(signal.metadata->'countries', '[]'::jsonb) AS countries,
            signal.risk_level, signal.confidence, signal.extraction_method,
            (SELECT count(*)::int FROM intelligence_signal_evidence evidence
             WHERE evidence.signal_id=signal.id) AS evidence_count,
            episode.item_id, item.source_id, item.event_time, item.url AS episode_url,
            feed.title AS feed_title
     FROM intelligence_signal signal
     JOIN podcast_episode episode ON episode.id=signal.episode_id
     JOIN item ON item.id=episode.item_id
     JOIN podcast_feed feed ON feed.id=episode.feed_id
     WHERE signal.episode_id=$1 AND signal.signal_type=$2 AND signal.canonical_key=$3
     LIMIT 1`,
    [episodeId, signalType, canonicalKey],
  );
  const signal = rows[0];
  if (!signal || !podcastSignalQualifiesForEventContext({
    signalType: signal.signal_type,
    confidence: signal.confidence,
    evidenceCount: signal.evidence_count,
    entities: signal.entities,
  })) return;

  const entities = stringList(signal.entities);
  const countries = countryList(signal.countries);
  // Country match is intentionally not used as a correlation anchor. It only
  // supplies navigational context once the entity/location policy accepts a
  // link, and ambiguous country extraction is not promoted at all.
  const country = countries.length === 1 ? countries[0] : null;
  const location = country ? await countryLocation(country) : null;
  const sourceTime = new Date(signal.event_time ?? event.occurred_at);
  const occurred = Number.isNaN(sourceTime.getTime()) ? new Date(event.occurred_at) : sourceTime;
  if (Number.isNaN(occurred.getTime())) return;
  const confidence = Math.min(0.75, Math.max(0.55, Number(signal.confidence)));
  const text = `${signal.title ?? ""} ${signal.summary ?? ""}`;
  const eventType = classifyEventType(text);
  const recordId = podcastSignalRecordId(episodeId, signal.signal_type, signal.canonical_key);
  const priority = computeSignalPriority({
    sourceReliability: confidence,
    sourceDiversity: 1,
    freshnessHours: Math.max(0, (Date.now() - occurred.getTime()) / 3_600_000),
    // A podcast signal never escalates an event by itself. Its role is limited
    // to contextual evidence after a governed attach decision.
    severity: "low",
    locationImportance: Number(location?.importance_score ?? 0.35),
    domainCount: 1,
  });
  const contextInput = {
    dedupeKey: buildEventDedupeKey(["podcast-context", recordId]),
    eventType,
    title: `Podcast context: ${signal.title}`.slice(0, 300),
    summary: String(signal.summary || signal.title || "Podcast transcript context.").slice(0, 1_800),
    status: "monitoring",
    severity: "low",
    confidence,
    startTime: occurred,
    lastActivityTime: occurred,
    primaryLocationId: location?.id ?? null,
    primaryCountryIso2: country,
    relevanceScore: Math.min(0.55, priority.score),
    urgencyScore: 0.2,
    materialityScore: 0.2,
    scoreComponents: { ...priority.components, contextual_only: true },
    metadata: {
      source_kind: "podcast_transcript",
      podcast_context_only: true,
    },
    entityKeys: collectEntityKeys(entities),
    evidence: {
      domain: "podcast",
      evidenceType: `podcast_${signal.signal_type}`,
      sourceRecordType: "intelligence_signal",
      sourceRecordId: recordId,
      sourceId: Number.isSafeInteger(Number(signal.source_id)) ? Number(signal.source_id) : null,
      observedAt: occurred,
      publishedAt: occurred,
      locationId: location?.id ?? null,
      confidence,
      relationship: "context",
      provenance: {
        provider: "podcastindex",
        publisher: signal.feed_title,
        episode_url: signal.episode_url,
        source_url: signal.episode_url,
        episode_id: episodeId,
        signal_type: signal.signal_type,
        canonical_key: signal.canonical_key,
        extraction_method: signal.extraction_method,
      },
      attribution: signal.feed_title || "Podcast publisher",
      metadata: {
        title: signal.title,
        summary: signal.summary,
        countries,
        transcript_evidence_count: Number(signal.evidence_count),
        podcast_signal_type: signal.signal_type,
        assessment_boundary: "Podcast transcript extraction is contextual and does not independently confirm the event or establish causation.",
      },
    },
  } satisfies Parameters<typeof attachIntelligenceSignalToExistingEvent>[0];
  const selected = await attachIntelligenceSignalToExistingEvent(contextInput);
  await attachIntelligenceSignalToMajorEventContext(contextInput, {
    excludeEventId: selected?.id ?? null,
  });
}

async function handleGdeltEvent(event: DomainEventEnvelope) {
  const id = Number(event.payload.global_event_id ?? event.aggregate_id);
  const { rows } = await query<any>(
    `SELECT global_event.*,source.name AS source_name,source.metadata AS source_metadata
     FROM global_event JOIN source ON source.id=global_event.source_id WHERE global_event.id=$1`,
    [id],
  );
  const record = rows[0];
  if (!record) return;
  const observed = new Date(record.event_time);
  const actionCoordinate = trustedGdeltActionCoordinate(record);
  const location = actionCoordinate
    ? await resolveNearestLocation(actionCoordinate.latitude, actionCoordinate.longitude, 150)
    : await resolveLocationFromText(record.action_geo_name ?? "", record.action_country_iso2)
      ?? await countryLocation(record.action_country_iso2);
  const presentation = buildGdeltEventPresentation({
    eventCode: record.event_code,
    eventRootCode: record.event_root_code,
    actor1: record.actor1_name,
    actor2: record.actor2_name,
    location: record.action_geo_name ?? location?.canonical_name,
    countryIso2: record.action_country_iso2,
    mentionCount: record.mention_count,
    sourceCount: record.source_count,
    articleCount: record.article_count,
  });
  const priority = computeSignalPriority({
    sourceReliability: 0.72, sourceDiversity: Number(record.source_count ?? 1),
    freshnessHours: Math.max(0, (Date.now() - observed.getTime()) / 3_600_000), severity: "medium",
    locationImportance: Number(location?.importance_score ?? 0.4), domainCount: 1,
  });
  const signalInput = {
    dedupeKey: buildEventDedupeKey(["gdelt_event", record.external_id]),
    eventType: "reported_development", title: presentation.title, summary: presentation.summary,
    severity: "medium", confidence: 0.68, startTime: observed, lastActivityTime: observed,
    primaryLocationId: location?.id ?? null, primaryCountryIso2: location?.country_iso2 ?? record.action_country_iso2,
    latitude: actionCoordinate?.latitude ?? location?.latitude, longitude: actionCoordinate?.longitude ?? location?.longitude,
    coordinatesAreExact: Boolean(actionCoordinate),
    relevanceScore: priority.score, urgencyScore: 0.4,
    materialityScore: Math.min(1, Math.abs(Number(record.goldstein_scale ?? 0)) / 10), scoreComponents: priority.components,
    metadata: {
      gdelt_event_code: record.event_code,
      gdelt_event_root_code: record.event_root_code,
      gdelt_action: presentation.action,
      quad_class: record.quad_class,
      presentation_version: "gdelt-event-v2",
    },
    entityKeys: collectEntityKeys(record.actor1_name, record.actor2_name),
    evidence: {
      domain: "news", evidenceType: "structured_event", sourceRecordType: "global_event", sourceRecordId: String(id),
      sourceId: record.source_id, observedAt: observed, publishedAt: observed, locationId: location?.id ?? null,
      confidence: 0.72, relationship: "reported",
      provenance: { provider: "gdelt", url: record.url, mention_count: record.mention_count, source_count: record.source_count },
      license: record.source_metadata?.license ?? "GDELT reuse terms; original publisher terms remain applicable", attribution: "GDELT / original publishers",
    },
  } satisfies Parameters<typeof correlateAndUpsertIntelligenceSignal>[0];
  const selected = await correlateAndUpsertIntelligenceSignal(signalInput);
  await attachIntelligenceSignalToMajorEventContext(signalInput, { excludeEventId: selected.id });
}

async function handleWeatherAlert(event: DomainEventEnvelope) {
  const id = Number(event.payload.weather_alert_id ?? event.aggregate_id);
  const { rows } = await query<any>(
    `SELECT alert.*,source.name AS source_name,source.metadata AS source_metadata
     FROM weather_alert alert JOIN source ON source.id=alert.source_id WHERE alert.id=$1`,
    [id],
  );
  const alert = rows[0];
  if (!alert) return;
  const location = await resolveLocationFromText(`${alert.area ?? ""} ${alert.headline ?? ""}`, alert.country_iso2)
    ?? await countryLocation(alert.country_iso2);
  const severity = weatherSeverity(alert.severity);
  const start = new Date(alert.starts_at);
  const priority = computeSignalPriority({
    sourceReliability: sourceReliability[alert.source_name] ?? 0.85, sourceDiversity: 1,
    freshnessHours: Math.max(0, (Date.now() - start.getTime()) / 3_600_000), severity,
    locationImportance: Number(location?.importance_score ?? 0.5), domainCount: 1,
  });
  const signalInput = {
    dedupeKey: buildEventDedupeKey(["weather", alert.external_id, alert.country_iso2]),
    eventType: classifyEventType(alert.event), title: alert.headline ?? alert.event,
    summary: String(alert.description ?? `${alert.event} affecting ${alert.area ?? alert.country_iso2}.`).slice(0, 1_800),
    severity, confidence: alert.certainty?.toLowerCase() === "observed" ? 0.95 : 0.82,
    startTime: start, lastActivityTime: new Date(alert.updated_at),
    primaryLocationId: location?.id ?? null, primaryCountryIso2: alert.country_iso2,
    latitude: location?.latitude ?? null, longitude: location?.longitude ?? null,
    coordinatesAreExact: false,
    relevanceScore: priority.score, urgencyScore: ["immediate", "expected"].includes(String(alert.urgency).toLowerCase()) ? 0.9 : 0.55,
    materialityScore: severity === "critical" ? 1 : severity === "high" ? 0.8 : 0.5, scoreComponents: priority.components,
    metadata: { ends_at: alert.ends_at, instruction: alert.instruction },
    evidence: {
      domain: "weather", evidenceType: "official_alert", sourceRecordType: "weather_alert", sourceRecordId: String(id),
      sourceId: alert.source_id, observedAt: start, publishedAt: new Date(alert.created_at), locationId: location?.id ?? null,
      confidence: alert.certainty?.toLowerCase() === "observed" ? 0.95 : 0.82, relationship: "observed",
      provenance: { provider: alert.source_name, sender_name: alert.sender_name, external_id: alert.external_id },
      license: alert.source_metadata?.license ?? null, attribution: alert.sender_name,
      metadata: { severity: alert.severity, urgency: alert.urgency, certainty: alert.certainty, area: alert.area },
    },
  } satisfies Parameters<typeof correlateAndUpsertIntelligenceSignal>[0];
  const selected = await correlateAndUpsertIntelligenceSignal(signalInput);
  await attachIntelligenceSignalToMajorEventContext(signalInput, { excludeEventId: selected.id });
}

async function handleWeatherSnapshot(event: DomainEventEnvelope) {
  const id = Number(event.payload.weather_snapshot_id ?? event.aggregate_id);
  await attachWeatherSnapshotToMajorEventContext(id);
}

async function handleEarthquake(event: DomainEventEnvelope) {
  const id = String(event.payload.earthquake_observation_id ?? event.aggregate_id);
  const { rows } = await query<any>(`SELECT * FROM earthquake_observation WHERE id=$1::uuid`, [id]);
  const quake = rows[0];
  if (!quake) return;
  const magnitude = Number(quake.magnitude ?? 0);
  const severity: IntelligenceSeverity = magnitude >= 8 || quake.alert_level === "red" ? "critical"
    : magnitude >= 7 || quake.alert_level === "orange" ? "high"
      : magnitude >= 5.5 ? "medium" : "low";
  const contextEligibility = earthquakeContextEligibility({
    magnitude: quake.magnitude,
    significance: quake.significance,
    tsunami: quake.tsunami,
    alertLevel: quake.alert_level,
    felt: quake.felt,
    severity,
  });
  const radius = magnitude >= 7 ? 300 : magnitude >= 6 ? 180 : 100;
  const location = await resolveNearestLocation(quake.latitude, quake.longitude, radius,
    ["port", "airport", "city", "refinery", "lng_terminal", "power_station", "mine", "industrial_facility", "country"]);
  const primaryCountryIso2 = location?.country_iso2 ?? earthquakeCountryFromPlace(quake.place);
  const observed = new Date(quake.observed_at);
  const priority = computeSignalPriority({
    sourceReliability: 0.98, sourceDiversity: 1,
    freshnessHours: Math.max(0, (Date.now() - observed.getTime()) / 3_600_000), severity,
    locationImportance: Number(location?.importance_score ?? 0.65), domainCount: 1,
  });
  const intelligenceEvent = await correlateAndUpsertIntelligenceSignal({
    dedupeKey: buildEventDedupeKey(["usgs", quake.usgs_event_id]), eventType: "earthquake",
    title: `${quake.magnitude == null ? "Earthquake" : `M${Number(quake.magnitude).toFixed(1)} earthquake`} — ${quake.place}`,
    summary: `USGS observed an earthquake at ${quake.place}${quake.depth_km == null ? "" : `, depth ${Number(quake.depth_km).toFixed(1)} km`}.${quake.tsunami ? " The source tsunami flag is set." : ""}`,
    severity, confidence: 0.98, startTime: observed, lastActivityTime: new Date(quake.updated_at_source),
    primaryLocationId: location?.id ?? null, primaryCountryIso2,
    latitude: quake.latitude, longitude: quake.longitude,
    coordinatesAreExact: true,
    relevanceScore: Math.max(priority.score, Math.min(1, magnitude / 9)), urgencyScore: Math.min(1, magnitude / 8),
    materialityScore: Math.min(1, (Number(quake.significance ?? 0) / 1_000) + (location?.importance_score ?? 0) * 0.25),
    scoreComponents: {
      ...priority.components,
      magnitude,
      significance: quake.significance,
      proximity_radius_km: radius,
      context_eligibility: contextEligibility,
    },
    metadata: {
      magnitude: quake.magnitude,
      significance: quake.significance,
      tsunami: quake.tsunami,
      depth_km: quake.depth_km,
      alert_level: quake.alert_level,
      felt: quake.felt,
      context_eligibility: contextEligibility,
    },
    entityKeys: earthquakePlaceEntityKeys(quake.place, quake.usgs_event_id),
    evidence: {
      domain: "disaster", evidenceType: "seismic_observation", sourceRecordType: "earthquake_observation", sourceRecordId: id,
      sourceId: Number(event.payload.source_id) || null, observedAt: observed, publishedAt: new Date(quake.updated_at_source), locationId: location?.id ?? null,
      confidence: 0.98, relationship: "observed", provenance: { provider: "usgs-earthquakes", event_id: quake.usgs_event_id, url: quake.source_url },
      license: "U.S. government public domain", attribution: "U.S. Geological Survey",
      metadata: { magnitude: quake.magnitude, magnitude_type: quake.magnitude_type, depth_km: quake.depth_km, tsunami: quake.tsunami },
    },
  });
  if (contextEligibility.eligible) {
    await refreshMajorEarthquakeContext(intelligenceEvent.id);
  }
}

async function handleEarthquakeContextRecheck(event: DomainEventEnvelope) {
  const id = String(event.payload.earthquake_observation_id ?? event.aggregate_id);
  const { rows } = await query<{ id: string }>(
    `SELECT linked_event.id
     FROM intelligence_event_evidence evidence
     JOIN intelligence_event linked_event ON linked_event.id=evidence.event_id
     WHERE evidence.source_record_type='earthquake_observation'
       AND evidence.source_record_id=$1
       AND linked_event.event_type='earthquake'
       AND linked_event.severity IN ('medium','high','critical')
     ORDER BY CASE WHEN evidence.relationship='observed' THEN 0 ELSE 1 END,
              linked_event.start_time DESC,linked_event.id
     LIMIT 1`,
    [id],
  );
  // A context replay is intentionally attach-only. The original observation
  // outbox remains responsible for creating a missing canonical event; this
  // path must not revisit alert-recipient or EO-discovery side effects.
  if (rows[0]) await refreshMajorEarthquakeContext(rows[0].id);
}

async function handleFire(event: DomainEventEnvelope) {
  const id = String(event.payload.fire_detection_id ?? event.aggregate_id);
  const { rows } = await query<any>(`SELECT * FROM earth_fire_detection WHERE id=$1::uuid`, [id]);
  const fire = rows[0];
  if (!fire) return;
  const location = await resolveNearestLocation(fire.latitude, fire.longitude, 75,
    ["refinery", "lng_terminal", "power_station", "port", "airport", "agricultural_region", "industrial_facility", "city"]);
  const observed = new Date(fire.acquisition_time);
  const highConfidence = ["h", "high"].includes(String(fire.confidence).toLowerCase());
  const frp = Number(fire.fire_radiative_power ?? 0);
  const severity: IntelligenceSeverity = frp >= 100 && location ? "high" : frp >= 25 || location ? "medium" : "low";
  const priority = computeSignalPriority({
    sourceReliability: 0.95, sourceDiversity: 1,
    freshnessHours: Math.max(0, (Date.now() - observed.getTime()) / 3_600_000), severity,
    locationImportance: Number(location?.importance_score ?? 0.4), domainCount: 1,
    physicalObservationAvailable: true, anomalyMagnitude: Math.min(1, frp / 200),
  });
  const spatialCell = `${Math.round(Number(fire.latitude) * 5) / 5},${Math.round(Number(fire.longitude) * 5) / 5}`;
  const intelligenceEvent = await correlateAndUpsertIntelligenceSignal({
    dedupeKey: buildEventDedupeKey(["firms-fire-cluster", spatialCell, sixHourKey(observed)]), eventType: "wildfire",
    title: `Active fire detections${location ? ` near ${location.canonical_name}` : ""}`,
    summary: `NASA FIRMS VIIRS observed an active-fire signal${frp ? ` with fire radiative power ${frp.toFixed(1)} MW` : ""}. A hotspot is an observed thermal anomaly, not by itself proof of cause or impact.`,
    severity, confidence: highConfidence ? 0.94 : 0.82, startTime: observed, lastActivityTime: observed,
    primaryLocationId: location?.id ?? null, primaryCountryIso2: location?.country_iso2 ?? null,
    latitude: fire.latitude, longitude: fire.longitude,
    coordinatesAreExact: true,
    relevanceScore: priority.score, urgencyScore: highConfidence ? 0.75 : 0.55,
    materialityScore: Math.min(1, frp / 200 + Number(location?.importance_score ?? 0) * 0.35),
    scoreComponents: priority.components,
    metadata: { cluster_method: "0.2-degree/6-hour deterministic cell", satellite: fire.satellite, instrument: fire.instrument },
    evidence: {
      domain: "earth_observation", evidenceType: "active_fire_hotspot", sourceRecordType: "earth_fire_detection", sourceRecordId: id,
      sourceId: Number(event.payload.source_id) || null, observedAt: observed, locationId: location?.id ?? null,
      confidence: highConfidence ? 0.94 : 0.82, relationship: "observed",
      provenance: { provider: "nasa-firms", satellite: fire.satellite, instrument: fire.instrument, source_version: fire.source_version },
      license: "NASA Earth Science open data policy; cite the underlying FIRMS product", attribution: "NASA FIRMS",
      metadata: { confidence: fire.confidence, fire_radiative_power: fire.fire_radiative_power, day_night: fire.day_night },
    },
  });
  await query(
    `INSERT INTO event_outbox (event_type,aggregate_type,aggregate_id,dedupe_key,payload,occurred_at)
     VALUES ('earth.fire.cluster.updated','intelligence_event',$1,$2,$3::jsonb,$4)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [intelligenceEvent.id, `fire-cluster:${intelligenceEvent.id}:${id}`,
     JSON.stringify({ event_id: intelligenceEvent.id, fire_detection_id: id, location_id: location?.id ?? null }), observed],
  );
}

async function handleTransportMovement(event: DomainEventEnvelope) {
  const id = Number(event.payload.movement_event_id ?? event.aggregate_id);
  const { rows } = await query<any>(`SELECT * FROM transport_movement_event WHERE id=$1`, [id]);
  const movement = rows[0];
  if (!movement) return;
  const observed = new Date(movement.observed_at);
  const refreshEarthquakeContext = () => refreshRecentMajorEarthquakeTransportContext(
    movement.country_iso2, observed,
  );
  const { rows: hours } = await query<{ bucket: string | Date; total: number }>(
    `SELECT date_trunc('day',bucket) AS bucket,
            sum(departures+arrivals)::int AS total
     FROM transport_movement_hour
     WHERE country_iso2=$1 AND location_name=$2 AND bucket>=now()-interval '29 days'
     GROUP BY date_trunc('day',bucket) ORDER BY bucket`,
    [movement.country_iso2, movement.location_name],
  );
  const values = hours.map((row) => Number(row.total));
  if (values.length < 7) {
    await refreshEarthquakeContext();
    return;
  }
  const current = values.at(-1) ?? 0;
  const previous = values.at(-2) ?? 0;
  const anomaly = detectTransportAnomaly({
    current, previousEquivalent: previous,
    sevenDayMedian: calculateRollingBaseline(values.slice(-8, -1), 7),
    twentyEightDayMedian: calculateRollingBaseline(values.slice(0, -1), 28),
    sampleHours: Math.min(28, values.length - 1) * 24,
  });
  if (!anomaly.anomalous) {
    await refreshEarthquakeContext();
    return;
  }
  const location = await resolveLocationFromText(movement.location_name, movement.country_iso2)
    ?? await countryLocation(movement.country_iso2);
  const severity: IntelligenceSeverity = anomaly.magnitude >= 0.75 ? "high" : "medium";
  const priority = computeSignalPriority({
    sourceReliability: 0.72, sourceDiversity: 1,
    freshnessHours: Math.max(0, (Date.now() - observed.getTime()) / 3_600_000), severity,
    locationImportance: Number(location?.importance_score ?? 0.5), domainCount: 1,
    anomalyMagnitude: anomaly.magnitude,
  });
  const change = anomaly.percentChange == null ? "a new baseline" : `${Math.abs(anomaly.percentChange * 100).toFixed(0)}% ${anomaly.direction}`;
  const signalInput = {
    dedupeKey: buildEventDedupeKey(["transport-anomaly", movement.location_name, dayKey(observed)]),
    eventType: "transport_disruption", title: `${movement.location_name} movement anomaly`,
    summary: `Observed arrivals and departures are ${change} the robust rolling baseline. Coverage reflects Claritas telemetry sources, not total port-authority traffic.`,
    severity, confidence: anomaly.confidence, startTime: observed, lastActivityTime: observed,
    primaryLocationId: location?.id ?? null, primaryCountryIso2: movement.country_iso2,
    latitude: location?.latitude ?? null, longitude: location?.longitude ?? null,
    coordinatesAreExact: false,
    relevanceScore: priority.score, urgencyScore: anomaly.magnitude, materialityScore: anomaly.magnitude,
    scoreComponents: { ...priority.components, anomaly }, metadata: { methodology: anomaly.methodology, coverage_qualified: true },
    evidence: {
      domain: "transport", evidenceType: "rolling_baseline_anomaly", sourceRecordType: "transport_movement_event", sourceRecordId: String(id),
      observedAt: observed, locationId: location?.id ?? null, confidence: anomaly.confidence, relationship: "derived",
      provenance: { provider: movement.source_name, methodology: anomaly.methodology }, attribution: movement.source_name,
      metadata: { current, baseline: anomaly.baseline, percent_change: anomaly.percentChange, event_type: movement.event_type, vehicle_category: movement.vehicle_category },
    },
  } satisfies Parameters<typeof correlateAndUpsertIntelligenceSignal>[0];
  const selected = await correlateAndUpsertIntelligenceSignal(signalInput);
  await attachIntelligenceSignalToMajorEventContext(signalInput, { excludeEventId: selected.id });
  await refreshEarthquakeContext();
}

async function handleMarketIndicator(event: DomainEventEnvelope) {
  const id = Number(event.payload.market_indicator_id ?? event.aggregate_id);
  const { rows } = await query<any>(
    `SELECT indicator.*,instrument.canonical_symbol,instrument.name AS instrument_name,
            instrument.instrument_type,instrument.frequency,source.name AS source_name,source.metadata AS source_metadata
     FROM market_indicator indicator
     LEFT JOIN market_instrument instrument ON instrument.id=indicator.instrument_id
     JOIN source ON source.id=indicator.source_id WHERE indicator.id=$1`,
    [id],
  );
  const current = rows[0];
  if (!current) return;
  const { rows: history } = await query<{ value: number; observed_at: string | Date }>(
    `SELECT value,observed_at FROM market_indicator
     WHERE source_id=$1 AND series_key=$2 AND id<>$3 AND period_end<$4
     ORDER BY period_end DESC LIMIT 28`,
    [current.source_id, current.series_key, id, current.period_end],
  );
  if (!history.length) return;
  const previous = Number(history[0].value);
  const threshold = Number(process.env.MARKET_EVENT_PERCENT_THRESHOLD ?? 0.05);
  const movement = evaluateMarketMove(Number(current.value), previous, threshold);
  if (!movement) return;
  const { change, magnitude, severity } = movement;
  const { rows: exposures } = current.instrument_id ? await query<any>(
    `SELECT location.* FROM market_location_exposure exposure
     JOIN intelligence_location location ON location.id=exposure.location_id
     WHERE exposure.instrument_id=$1 ORDER BY exposure.confidence DESC,location.importance_score DESC LIMIT 1`,
    [current.instrument_id],
  ) : { rows: [] as any[] };
  const location = exposures[0] ?? await countryLocation(current.country_iso2);
  const observed = new Date(current.observed_at);
  const priority = computeSignalPriority({
    sourceReliability: 0.9, sourceDiversity: 1,
    freshnessHours: Math.max(0, (Date.now() - observed.getTime()) / 3_600_000), severity,
    locationImportance: Number(location?.importance_score ?? 0.4), domainCount: 1, anomalyMagnitude: magnitude,
  });
  const symbol = current.canonical_symbol ?? current.symbol ?? current.series_key;
  await correlateAndUpsertIntelligenceSignal({
    dedupeKey: buildEventDedupeKey(["market-move", current.instrument_id ?? current.series_key, dayKey(observed)]),
    eventType: "market_move", title: `${symbol} moved ${(change * 100).toFixed(1)}%`,
    summary: `${current.instrument_name ?? current.name} changed ${(change * 100).toFixed(1)}% from the preceding ${current.frequency ?? "reported"} observation. Physical context is shown only where a sourced exposure exists.`,
    severity, confidence: 0.9, startTime: observed, lastActivityTime: observed,
    primaryLocationId: location?.id ?? null, primaryCountryIso2: location?.country_iso2 ?? current.country_iso2,
    latitude: location?.latitude ?? null, longitude: location?.longitude ?? null,
    coordinatesAreExact: false,
    relevanceScore: priority.score, urgencyScore: Math.min(1, Math.abs(change) * 5), materialityScore: magnitude,
    scoreComponents: { ...priority.components, percent_change: change, threshold },
    metadata: { symbol, previous_value: previous, current_value: current.value, frequency: current.frequency },
    entityKeys: collectEntityKeys(symbol, current.instrument_name),
    evidence: {
      domain: "market", evidenceType: "threshold_move", sourceRecordType: "market_indicator", sourceRecordId: String(id),
      sourceId: current.source_id, observedAt: observed, locationId: location?.id ?? null,
      confidence: 0.9, relationship: "derived",
      provenance: { provider: current.source_name, series_key: current.series_key, instrument_id: current.instrument_id },
      license: current.source_metadata?.license ?? null, attribution: current.source_name,
      metadata: { value: current.value, previous_value: previous, percent_change: change, unit: current.unit, frequency: current.frequency },
    },
  });
}

export async function processDomainEvent(event: DomainEventEnvelope) {
  if (!process.env.EVENT_CORRELATION_ENABLED || ["1", "true", "yes", "on"].includes(process.env.EVENT_CORRELATION_ENABLED.toLowerCase())) {
    switch (event.type) {
      case "news.story.ingested":
      case "news.story.updated": return handleNewsStory(event);
      case "news.event.observed": return handleGdeltEvent(event);
      case "weather.alert.created":
      case "weather.alert.updated": return handleWeatherAlert(event);
      case "weather.snapshot.updated": return handleWeatherSnapshot(event);
      case "disaster.earthquake.observed": return handleEarthquake(event);
      case "disaster.earthquake.context.recheck": return handleEarthquakeContextRecheck(event);
      case "earth.fire.detected": return handleFire(event);
      case "transport.movement.recorded": return handleTransportMovement(event);
      case "market.instrument.observed": return handleMarketIndicator(event);
      case "podcast.signal.extracted": return handlePodcastSignal(event);
      default: return;
    }
  }
}

export async function consumeDomainEvent(event: DomainEventEnvelope, consumerName = "correlation-v1") {
  const claimed = await withTransaction(async (client) => {
    const { rows } = await client.query<{ event_id: string }>(
      `INSERT INTO consumed_domain_event (consumer_name,event_id,event_type,status,lease_until)
       VALUES ($1,$2,$3,'processing',now()+interval '5 minutes')
       ON CONFLICT (consumer_name,event_id) DO UPDATE SET
         status='processing',attempts=consumed_domain_event.attempts+1,
         lease_until=now()+interval '5 minutes',last_error=NULL,updated_at=now()
       WHERE consumed_domain_event.status='failed'
          OR (consumed_domain_event.status='processing' AND consumed_domain_event.lease_until<now())
       RETURNING event_id`,
      [consumerName, event.id, event.type],
    );
    return rows.length > 0;
  });
  if (!claimed) return { duplicate: true };
  try {
    await processDomainEvent(event);
    await query(
      `UPDATE consumed_domain_event SET status='processed',processed_at=now(),lease_until=NULL,updated_at=now()
       WHERE consumer_name=$1 AND event_id=$2`,
      [consumerName, event.id],
    );
    await query(
      `UPDATE provider_runtime_state SET enabled=true,last_attempt_at=now(),last_success_at=now(),
              last_event_at=now(),consecutive_failures=0,last_error=NULL,updated_at=now()
       WHERE provider='event_correlation'`,
    );
    return { duplicate: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query(
      `UPDATE consumed_domain_event SET status='failed',last_error=$3,lease_until=NULL,updated_at=now()
       WHERE consumer_name=$1 AND event_id=$2`,
      [consumerName, event.id, message.slice(0, 2_000)],
    );
    await query(
      `UPDATE provider_runtime_state SET last_attempt_at=now(),consecutive_failures=consecutive_failures+1,
              last_error=$1,updated_at=now() WHERE provider='event_correlation'`,
      [message.slice(0, 1_000)],
    ).catch(() => undefined);
    throw error;
  }
}
