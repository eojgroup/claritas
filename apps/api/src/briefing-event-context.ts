export type BriefingEventNewsLink = {
  title: string;
  summary: string | null;
  url: string | null;
  publisher: string;
  published_at: string | null;
  relationship: string;
};

export type BriefingEventEarthObservation = {
  observation_id: string;
  product_type: string;
  analysis_kind: string;
  status: string;
  provider: string;
  mission: string;
  captured_at: string;
  resolution_m: number | null;
  cloud_cover: number | null;
  imagery_available: boolean;
  analysis_summary: string | null;
  source_url: string | null;
  attribution: string | null;
  evidentiary_role: "sensor_observation" | "model_interpretation" | "visual_context";
  temporal_alignment?: string;
  assessment_boundary?: string;
};

export type BriefingIntelligenceEvent = {
  id: string;
  event_type: string;
  title: string;
  summary: string;
  status: string;
  severity: string;
  confidence: number;
  country_iso2: string | null;
  region: string | null;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  relevance_score: number;
  urgency_score: number;
  materiality_score: number;
  source_diversity: number;
  domain_count: number;
  start_time: string | null;
  last_activity_time: string;
  what: string;
  where: string;
  why_interesting: string[];
  source_quality: {
    publisher_report_count: number;
    cross_domain: boolean;
    machine_coded_only: boolean;
    priority_eligible: boolean;
  };
  linked_news: BriefingEventNewsLink[];
  earth_observation_state: "sensor_imagery_available" | "model_interpretation_only" | "processing" | "not_available";
  earth_observation: BriefingEventEarthObservation[];
  evidence: Array<Record<string, unknown>>;
  entities: Array<Record<string, unknown>>;
  epistemic_notice: string;
};

export type BriefingPriorityEvent<T extends BriefingIntelligenceEvent = BriefingIntelligenceEvent> =
  Omit<T, "evidence" | "entities" | "summary"> & { summary?: string };

export const BRIEFING_PRIORITY_EVENT_LIMITS = {
  events: 12,
  linked_news: 4,
  earth_observation: 2,
  why_interesting: 4,
} as const;

type EventContextRow = {
  id: string;
  event_type: string;
  title: string;
  summary: string;
  status: string;
  severity: string;
  confidence: number | string;
  primary_country_iso2: string | null;
  region: string | null;
  location_name: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  relevance_score: number | string;
  urgency_score: number | string;
  materiality_score: number | string;
  source_diversity: number | string;
  domain_count: number | string;
  start_time?: string | Date | null;
  last_activity_time: string | Date;
  evidence: unknown;
  entities: unknown;
  earth_observations: unknown;
  priority_eligible?: boolean;
};

function toIso(value: string | Date | null): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function text(value: unknown, maximum = 2_000): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum).trim()
    : "";
}

function numberOrNull(value: unknown): number | null {
  if (
    value == null
    || (typeof value === "string" && value.trim().length === 0)
  ) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : [];
}

function scorePercent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function boundedProjectionUrl(value: unknown, maximum = 800): string | null {
  const url = text(value, maximum + 1);
  if (!url || url.length > maximum) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function projectBriefingPriorityEvents<T extends BriefingIntelligenceEvent>(
  events: T[],
  maximumEvents = BRIEFING_PRIORITY_EVENT_LIMITS.events,
): Array<BriefingPriorityEvent<T>> {
  const boundedEventCount = Math.max(
    0,
    Math.min(BRIEFING_PRIORITY_EVENT_LIMITS.events, Math.trunc(maximumEvents)),
  );
  return events.slice(0, boundedEventCount).map((event) => {
    const { evidence: _evidence, entities: _entities, summary, ...priorityEvent } = event;
    const what = text(event.what, 480) || text(summary, 480) || text(event.title, 220);
    const supplementalSummary = text(summary, 360);
    const extraReasons = record(event).reasons;
    return {
      ...priorityEvent,
      title: text(event.title, 220),
      what,
      ...(supplementalSummary && supplementalSummary !== what ? { summary: supplementalSummary } : {}),
      where: text(event.where, 240),
      location_name: text(event.location_name, 160) || null,
      region: text(event.region, 120) || null,
      event_type: text(event.event_type, 80),
      why_interesting: event.why_interesting
        .map((reason) => text(reason, 160)).filter(Boolean)
        .slice(0, BRIEFING_PRIORITY_EVENT_LIMITS.why_interesting),
      linked_news: event.linked_news.slice(0, BRIEFING_PRIORITY_EVENT_LIMITS.linked_news).map((item) => ({
        title: text(item.title, 220),
        summary: text(item.summary, 240) || null,
        url: boundedProjectionUrl(item.url),
        publisher: text(item.publisher, 120) || "Publisher unavailable",
        published_at: item.published_at,
        relationship: text(item.relationship, 40),
      })),
      earth_observation: event.earth_observation
        .slice(0, BRIEFING_PRIORITY_EVENT_LIMITS.earth_observation)
        .map((item) => ({
          ...item,
          observation_id: text(item.observation_id, 100),
          product_type: text(item.product_type, 80),
          analysis_kind: text(item.analysis_kind, 80),
          status: text(item.status, 40),
          provider: text(item.provider, 100),
          mission: text(item.mission, 100),
          analysis_summary: text(item.analysis_summary, 360) || null,
          source_url: boundedProjectionUrl(item.source_url),
          attribution: text(item.attribution, 180) || null,
        })),
      epistemic_notice: text(event.epistemic_notice, 400),
      ...(Array.isArray(extraReasons)
        ? { reasons: extraReasons.map((reason) => text(reason, 160)).filter(Boolean).slice(0, 6) }
        : {}),
    } as BriefingPriorityEvent<T>;
  });
}

export function describeEventLocation(input: {
  location_name?: string | null;
  country_iso2?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): string {
  const named = text(input.location_name, 200);
  const country = text(input.country_iso2, 2).toUpperCase();
  const coordinates = input.latitude != null && input.longitude != null
    ? `${input.latitude.toFixed(3)}, ${input.longitude.toFixed(3)}`
    : null;
  if (named && country) return `${named}, ${country}`;
  if (named) return named;
  if (country) return country;
  if (coordinates) return `Near ${coordinates}`;
  return "Location not yet resolved";
}

export function buildEventInterestReasons(input: {
  severity: string;
  relevance_score: number;
  urgency_score: number;
  materiality_score: number;
  source_diversity: number;
  domain_count: number;
  linked_news_count: number;
  physical_observation_count: number;
  model_interpretation_count: number;
}): string[] {
  const reasons: string[] = [];
  if (input.severity === "critical" || input.severity === "high") {
    reasons.push(`${input.severity[0].toUpperCase()}${input.severity.slice(1)}-severity event`);
  }
  reasons.push(
    `Relevance ${scorePercent(input.relevance_score)}/100 · urgency ${scorePercent(input.urgency_score)}/100 · materiality ${scorePercent(input.materiality_score)}/100`,
  );
  if (input.domain_count > 1 || input.source_diversity > 1) {
    reasons.push(`${input.domain_count} evidence domains across ${input.source_diversity} distinct sources`);
  }
  if (input.linked_news_count > 0) {
    reasons.push(`${input.linked_news_count} linked publisher ${input.linked_news_count === 1 ? "report" : "reports"}`);
  } else {
    reasons.push("No linked publisher reporting yet; real-world impact remains uncontextualised by news");
  }
  if (input.physical_observation_count > 0) {
    reasons.push(`${input.physical_observation_count} event-aligned Earth observation ${input.physical_observation_count === 1 ? "asset" : "assets"} available; imagery is context, not automatic impact confirmation`);
  } else if (input.model_interpretation_count > 0) {
    reasons.push("Earth-observation model interpretation is available, but no sensor image is treated as confirmation");
  }
  return reasons.slice(0, 6);
}

function describeObservationAlignment(capturedAt: string | null, eventStart: string | null): string {
  if (!capturedAt || !eventStart) return "Acquisition timing cannot yet be aligned with the event start.";
  const captured = Date.parse(capturedAt);
  const started = Date.parse(eventStart);
  if (Number.isNaN(captured) || Number.isNaN(started)) return "Acquisition timing cannot yet be aligned with the event start.";
  const minutes = Math.round(Math.abs(captured - started) / 60_000);
  const duration = minutes < 60
    ? `${minutes} minute${minutes === 1 ? "" : "s"}`
    : minutes < 2_880
      ? `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? "" : "s"}`
      : `${Math.round(minutes / 1_440)} day${Math.round(minutes / 1_440) === 1 ? "" : "s"}`;
  return captured >= started
    ? `Captured ${duration} after the recorded event start; post-start context does not establish impact or cause.`
    : `Captured ${duration} before the recorded event start; possible baseline context only.`;
}

function earthObservationBoundary(productType: string, role: BriefingEventEarthObservation["evidentiary_role"]): string {
  if (role === "model_interpretation") {
    return "Model-generated interpretation for human review; not an independent sensor observation or confirmation.";
  }
  if (["burn_index", "false_color", "ndvi", "sar", "radar"].some((token) => productType.toLowerCase().includes(token))) {
    return "Derived sensor product that may highlight conditions or change; it does not directly show flames, damage, impact, or causation.";
  }
  return "Event-aligned visual context. Surface appearance alone neither confirms nor disproves the reported event, and no impact conclusion should be inferred without interpreted change evidence.";
}

export function normalizeBriefingEventContextRow(row: EventContextRow): BriefingIntelligenceEvent {
  const eventStartTime = toIso(row.start_time ?? null);
  const evidence = records(row.evidence).map((entry) => ({
    domain: text(entry.domain, 40),
    evidence_type: text(entry.evidence_type, 100),
    relationship: text(entry.relationship, 40),
    confidence: numberOrNull(entry.confidence),
    observed_at: toIso(text(entry.observed_at, 50) || null),
    published_at: toIso(text(entry.published_at, 50) || null),
    source: text(entry.source, 160) || text(entry.source_record_type, 100),
    source_record_type: text(entry.source_record_type, 100),
    source_title: text(entry.source_title, 400) || null,
    source_summary: text(entry.source_summary, 1_200) || null,
    source_url: text(entry.source_url, 2_000) || null,
    attribution: text(entry.attribution, 500) || null,
    license: text(entry.license, 200) || null,
  }));
  const linkedNews: BriefingEventNewsLink[] = evidence
    .filter((entry) => entry.domain === "news" && entry.source_record_type === "item" && !!entry.source_title)
    .map((entry) => ({
      title: String(entry.source_title),
      summary: typeof entry.source_summary === "string" ? entry.source_summary : null,
      url: typeof entry.source_url === "string" ? entry.source_url : null,
      publisher: text(entry.source, 160) || "Publisher unavailable",
      published_at: typeof entry.published_at === "string" ? entry.published_at : null,
      relationship: text(entry.relationship, 40) || "reported",
    }))
    .filter((entry, index, all) => all.findIndex((candidate) =>
      candidate.title === entry.title && candidate.url === entry.url) === index)
    .slice(0, 10);

  const earthObservation: BriefingEventEarthObservation[] = records(row.earth_observations)
    .flatMap((entry) => {
      const analysisKind = text(entry.analysis_kind, 80) || "rendered_observation";
      const imageryAvailable = entry.imagery_available === true;
      const sensorObservation: BriefingEventEarthObservation = {
        observation_id: text(entry.observation_id, 80),
        product_type: text(entry.product_type, 80),
        analysis_kind: analysisKind,
        status: text(entry.status, 40),
        provider: text(entry.provider, 100),
        mission: text(entry.mission, 100),
        captured_at: toIso(text(entry.captured_at, 50) || null) ?? "",
        resolution_m: numberOrNull(entry.resolution_m),
        cloud_cover: numberOrNull(entry.cloud_cover),
        imagery_available: imageryAvailable,
        analysis_summary: analysisKind === "model_interpretation"
          ? text(entry.analysis_summary, 1_200) || null
          : null,
        source_url: text(entry.source_url, 2_000) || null,
        attribution: text(entry.attribution, 500) || null,
        evidentiary_role: analysisKind === "model_interpretation"
          ? "model_interpretation" as const
          : imageryAvailable
            ? "sensor_observation" as const
            : "visual_context" as const,
        temporal_alignment: describeObservationAlignment(
          toIso(text(entry.captured_at, 50) || null),
          eventStartTime,
        ),
        assessment_boundary: earthObservationBoundary(
          text(entry.product_type, 80),
          analysisKind === "model_interpretation"
            ? "model_interpretation"
            : imageryAvailable ? "sensor_observation" : "visual_context",
        ),
      };
      const details = record(entry.analysis_details);
      const methodology = record(entry.methodology);
      const model = Object.keys(record(details.model_interpretation)).length > 0
        ? record(details.model_interpretation)
        : record(methodology.vision_enrichment);
      if (analysisKind === "model_interpretation" || Object.keys(model).length === 0) {
        return [sensorObservation];
      }
      const modelInterpretation: BriefingEventEarthObservation = {
        ...sensorObservation,
        observation_id: `${sensorObservation.observation_id}:model-interpretation`,
        analysis_kind: "model_interpretation",
        provider: text(model.provider, 100) || "OpenRouter",
        imagery_available: false,
        analysis_summary: text(model.summary, 1_200) || text(entry.analysis_summary, 1_200) || null,
        source_url: null,
        attribution: "Model interpretation of the separately attributed sensor observation",
        evidentiary_role: "model_interpretation",
        assessment_boundary: earthObservationBoundary(sensorObservation.product_type, "model_interpretation"),
      };
      return [sensorObservation, modelInterpretation];
    })
    .filter((entry) => !!entry.observation_id)
    .slice(0, 8);

  const locationName = text(row.location_name, 200) || null;
  const country = text(row.primary_country_iso2, 2).toUpperCase() || null;
  const latitude = numberOrNull(row.latitude);
  const longitude = numberOrNull(row.longitude);
  const relevance = numberOrNull(row.relevance_score) ?? 0;
  const urgency = numberOrNull(row.urgency_score) ?? 0;
  const materiality = numberOrNull(row.materiality_score) ?? 0;
  const sourceDiversity = Math.max(0, Math.trunc(numberOrNull(row.source_diversity) ?? 0));
  const domainCount = Math.max(0, Math.trunc(numberOrNull(row.domain_count) ?? 0));
  const physicalCount = earthObservation.filter((item) =>
    item.evidentiary_role === "sensor_observation" && item.imagery_available).length;
  const modelCount = earthObservation.filter((item) => item.evidentiary_role === "model_interpretation").length;
  const earthObservationState: BriefingIntelligenceEvent["earth_observation_state"] = physicalCount > 0
    ? "sensor_imagery_available"
    : modelCount > 0
      ? "model_interpretation_only"
      : earthObservation.some((item) => item.status === "queued" || item.status === "processing")
        ? "processing"
        : "not_available";
  const summary = text(row.summary, 2_000);
  const machineCodedOnly = evidence.length > 0 && evidence.every((entry) =>
    entry.source_record_type === "global_event" || entry.source_record_type === "news_signal");
  const crossDomain = new Set(evidence.map((entry) => entry.domain).filter(Boolean)).size > 1;
  const priorityEligible = row.priority_eligible === true
    || !machineCodedOnly || linkedNews.length > 0 || crossDomain || relevance >= 0.85;

  return {
    id: row.id,
    event_type: text(row.event_type, 120),
    title: text(row.title, 400) || "Untitled event",
    summary,
    status: text(row.status, 40),
    severity: text(row.severity, 40),
    confidence: numberOrNull(row.confidence) ?? 0,
    country_iso2: country,
    region: text(row.region, 160) || null,
    location_name: locationName,
    latitude,
    longitude,
    relevance_score: relevance,
    urgency_score: urgency,
    materiality_score: materiality,
    source_diversity: sourceDiversity,
    domain_count: domainCount,
    start_time: eventStartTime,
    last_activity_time: toIso(row.last_activity_time) ?? new Date(0).toISOString(),
    what: summary || text(row.title, 400) || "Event details are still being assembled.",
    where: describeEventLocation({ location_name: locationName, country_iso2: country, latitude, longitude }),
    why_interesting: buildEventInterestReasons({
      severity: text(row.severity, 40),
      relevance_score: relevance,
      urgency_score: urgency,
      materiality_score: materiality,
      source_diversity: sourceDiversity,
      domain_count: domainCount,
      linked_news_count: linkedNews.length,
      physical_observation_count: physicalCount,
      model_interpretation_count: modelCount,
    }),
    source_quality: {
      publisher_report_count: linkedNews.length,
      cross_domain: crossDomain,
      machine_coded_only: machineCodedOnly,
      priority_eligible: priorityEligible,
    },
    linked_news: linkedNews,
    earth_observation_state: earthObservationState,
    earth_observation: earthObservation,
    evidence,
    entities: records(row.entities),
    epistemic_notice: "Reported, observed, derived, model-interpreted and assessed evidence remains explicitly labelled. Correlation does not establish causation, and imagery is not automatic proof of an event.",
  };
}

async function queryBriefingEvents(input: {
  start?: string;
  end?: string;
  eventId?: string;
  limit: number;
}): Promise<BriefingIntelligenceEvent[]> {
  const { query } = await import("./db");
  const params: unknown[] = [];
  const where: string[] = [
    "event.status NOT IN ('dismissed','resolved')",
    // Apply the machine-coded eligibility rule before ORDER/LIMIT. Otherwise a
    // burst of ineligible GDELT-only rows can starve publisher- or EO-backed
    // events that rank immediately below them.
    `(event.relevance_score >= 0.85
      OR NOT EXISTS (
        SELECT 1 FROM intelligence_event_evidence eligibility_evidence
        WHERE eligibility_evidence.event_id=event.id
      )
      OR EXISTS (
        SELECT 1 FROM intelligence_event_evidence eligibility_evidence
        WHERE eligibility_evidence.event_id=event.id
          AND eligibility_evidence.source_record_type NOT IN ('global_event','news_signal')
      )
      OR 1 < (
        SELECT count(DISTINCT eligibility_evidence.domain)
        FROM intelligence_event_evidence eligibility_evidence
        WHERE eligibility_evidence.event_id=event.id
      ))`,
  ];
  if (input.start) {
    params.push(input.start);
    where.push(`event.last_activity_time >= $${params.length}::timestamptz`);
  }
  if (input.end) {
    params.push(input.end);
    where.push(`event.last_activity_time < $${params.length}::timestamptz`);
  }
  if (input.eventId) {
    params.push(input.eventId);
    where.push(`event.id = $${params.length}::uuid`);
  }
  params.push(Math.min(100, Math.max(1, Math.trunc(input.limit))));
  const limitRef = `$${params.length}`;
  const { rows } = await query<EventContextRow>(
    `SELECT event.id,event.event_type,event.title,event.summary,event.status,event.severity,event.start_time,
            true AS priority_eligible,
            event.confidence,event.primary_country_iso2,country.region,
            event.relevance_score,event.urgency_score,event.materiality_score,
            event.source_diversity,event.domain_count,event.last_activity_time,
            location.canonical_name AS location_name,
            COALESCE(CASE WHEN event.geography IS NULL THEN NULL ELSE ST_Y(ST_PointOnSurface(event.geography)) END,
                     location.latitude)::double precision AS latitude,
            COALESCE(CASE WHEN event.geography IS NULL THEN NULL ELSE ST_X(ST_PointOnSurface(event.geography)) END,
                     location.longitude)::double precision AS longitude,
            COALESCE((
              SELECT jsonb_agg(evidence_row.payload ORDER BY evidence_row.observed_at DESC)
              FROM (
                SELECT evidence.observed_at,
                       jsonb_build_object(
                         'domain',evidence.domain,'evidence_type',evidence.evidence_type,
                         'relationship',evidence.relationship,'confidence',evidence.confidence,
                         'observed_at',evidence.observed_at,'published_at',evidence.published_at,
                         'source',COALESCE(NULLIF(source_item.payload->>'source',''),
                           NULLIF(source_item.payload->>'domain',''),source.name,evidence.source_record_type),
                         'source_record_type',evidence.source_record_type,
                         'source_title',COALESCE(source_item.title,
                           NULLIF(concat_ws(' / ',global_source.actor1_name,global_source.actor2_name),''),
                           global_source.action_geo_name),
                         'source_summary',COALESCE(source_item.summary,
                           CASE WHEN global_source.id IS NOT NULL THEN
                             'Structured GDELT event near ' || COALESCE(global_source.action_geo_name,'an unspecified location') END),
                         'source_url',COALESCE(source_item.url,global_source.url,evidence.provenance->>'url'),
                         'attribution',evidence.attribution,'license',evidence.license
                       ) AS payload
                FROM intelligence_event_evidence evidence
                LEFT JOIN source ON source.id=evidence.source_id
                LEFT JOIN item source_item ON source_item.id=CASE
                  WHEN evidence.source_record_type='item' AND evidence.source_record_id ~ '^[0-9]+$'
                    THEN evidence.source_record_id::bigint END
                LEFT JOIN global_event global_source ON global_source.id=CASE
                  WHEN evidence.source_record_type='global_event' AND evidence.source_record_id ~ '^[0-9]+$'
                    THEN evidence.source_record_id::bigint END
                WHERE evidence.event_id=event.id
                ORDER BY evidence.observed_at DESC LIMIT 30
              ) evidence_row
            ),'[]'::jsonb) AS evidence,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'entity_type',entity.entity_type,'entity_key',entity.entity_key,
                'display_name',entity.display_name,'relationship',entity.relationship,
                'confidence',entity.confidence
              ) ORDER BY entity.confidence DESC,entity.display_name)
              FROM intelligence_event_entity entity WHERE entity.event_id=event.id
            ),'[]'::jsonb) AS entities,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'observation_id',observation.id,'product_type',observation.product_type,
                'analysis_kind',observation.analysis_kind,'status',observation.status,
                'analysis_summary',observation.analysis_summary,'analysis_details',observation.analysis_details,
                'methodology',observation.methodology,
                'captured_at',observation.captured_at,
                'provider',scene.provider,'mission',scene.mission,'resolution_m',scene.resolution_m,
                'cloud_cover',scene.cloud_cover,'source_url',scene.source_url,
                'attribution',observation.attribution,
                'imagery_available',EXISTS (
                  SELECT 1 FROM earth_observation_asset asset
                  WHERE asset.observation_id=observation.id
                    AND (asset.expires_at IS NULL OR asset.expires_at>now())
                )
              ) ORDER BY observation.captured_at DESC)
              FROM earth_observation observation
              JOIN earth_scene scene ON scene.id=observation.scene_id
              WHERE observation.event_id=event.id
                AND observation.status IN ('available','processing','queued')
            ),'[]'::jsonb) AS earth_observations
     FROM intelligence_event event
     LEFT JOIN intelligence_location location ON location.id=event.primary_location_id
     LEFT JOIN country ON upper(country.iso2::text)=event.primary_country_iso2
     WHERE ${where.join(" AND ")}
     ORDER BY event.relevance_score DESC,event.last_activity_time DESC,event.id
     LIMIT ${limitRef}`,
    params,
  );
  return rows.map(normalizeBriefingEventContextRow).filter((event) => event.source_quality.priority_eligible);
}

export async function getBriefingIntelligenceEvents(
  sourceWindowStart: string,
  sourceWindowEnd: string,
  limit = 30,
): Promise<BriefingIntelligenceEvent[]> {
  return queryBriefingEvents({ start: sourceWindowStart, end: sourceWindowEnd, limit });
}

export async function getBriefingIntelligenceEvent(
  eventId: string,
): Promise<BriefingIntelligenceEvent | null> {
  return (await queryBriefingEvents({ eventId, limit: 1 }))[0] ?? null;
}
