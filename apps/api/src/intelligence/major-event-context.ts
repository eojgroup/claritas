import { query } from "../db";
import { assessTransportActivityComparison, contextualLinkagePolicy } from "./contextual-linkage";
import { attachIntelligenceSignalToMajorEventContext } from "./service";
import type { IntelligenceDomain, IntelligenceSignalInput } from "./types";

type MajorEarthquakeRow = {
  id: string;
  start_time: string | Date;
  latitude: number;
  longitude: number;
  country_iso2: string | null;
};

const boundedNumberEnv = (name: string, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(process.env[name] ?? "");
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
};

async function loadMajorEarthquake(eventId: string) {
  const { rows } = await query<MajorEarthquakeRow>(
    `SELECT event.id,event.start_time,event.primary_country_iso2 AS country_iso2,
            ST_Y(ST_PointOnSurface(event.geography))::double precision AS latitude,
            ST_X(ST_PointOnSurface(event.geography))::double precision AS longitude
     FROM intelligence_event event
     WHERE event.id=$1::uuid AND event.event_type='earthquake'
       AND event.severity IN ('high','critical')
       AND event.geography IS NOT NULL
       AND event.metadata @> '{"exact_geography":true}'::jsonb`,
    [eventId],
  );
  return rows[0] ?? null;
}

async function attachExistingNews(anchor: MajorEarthquakeRow) {
  const policy = contextualLinkagePolicy("earthquake", "news");
  if (!policy) return 0;
  const { rows } = await query<any>(
    `SELECT evidence.*,source.name AS source_name,source.metadata AS source_metadata,
            source_event.id AS source_event_id,source_event.event_type,
            source_event.title AS event_title,source_event.summary AS event_summary,
            source_event.severity,source_event.confidence AS event_confidence,
            source_event.start_time,source_event.last_activity_time,
            source_event.primary_location_id,source_event.primary_country_iso2,
            source_event.relevance_score,source_event.urgency_score,
            source_event.materiality_score,source_event.score_components,source_event.metadata AS event_metadata,
            location.location_type,
            COALESCE(
              CASE WHEN source_event.geography IS NULL THEN NULL ELSE ST_Y(ST_PointOnSurface(source_event.geography)) END,
              CASE WHEN location.location_type <> 'country' THEN location.latitude END
            )::double precision AS latitude,
            COALESCE(
              CASE WHEN source_event.geography IS NULL THEN NULL ELSE ST_X(ST_PointOnSurface(source_event.geography)) END,
              CASE WHEN location.location_type <> 'country' THEN location.longitude END
            )::double precision AS longitude,
            COALESCE((SELECT array_agg(DISTINCT entity.entity_key ORDER BY entity.entity_key)
              FROM intelligence_event_entity entity WHERE entity.event_id=source_event.id),ARRAY[]::text[]) AS entity_keys,
            COALESCE(source_item.title,source_event.title) AS source_title,
            COALESCE(source_item.summary,source_event.summary) AS source_summary,
            COALESCE(source_item.url,evidence.provenance->>'url') AS source_url
     FROM intelligence_event_evidence evidence
     JOIN intelligence_event source_event ON source_event.id=evidence.event_id
     LEFT JOIN source ON source.id=evidence.source_id
     LEFT JOIN intelligence_location location ON location.id=source_event.primary_location_id
     LEFT JOIN item source_item ON source_item.id=CASE
       WHEN evidence.source_record_type='item' AND evidence.source_record_id ~ '^[0-9]+$'
         THEN evidence.source_record_id::bigint END
     WHERE evidence.domain='news' AND evidence.event_id<>$1::uuid
       AND evidence.observed_at BETWEEN
         $2::timestamptz-make_interval(secs=>$3::int)
         AND $2::timestamptz+make_interval(secs=>$4::int)
       AND (evidence.source_record_type<>'item' OR
         CASE WHEN lower(COALESCE(source.name,''))='gdelt'
           THEN source_item.payload->>'quality_status'='accepted'
           ELSE COALESCE(source_item.payload->>'quality_status','accepted')='accepted' END)
       AND (
         (source_event.geography IS NOT NULL AND ST_DWithin(
           source_event.geography::geography,
           ST_SetSRID(ST_MakePoint($6,$5),4326)::geography,$7::double precision*1000))
         OR ($8::text IS NOT NULL AND source_event.primary_country_iso2=$8)
       )
     ORDER BY evidence.observed_at DESC,evidence.confidence DESC
     LIMIT 100`,
    [anchor.id, anchor.start_time, Math.round(policy.beforeHours * 3_600),
     Math.round(policy.afterHours * 3_600), anchor.latitude, anchor.longitude,
     policy.maxDistanceKm, anchor.country_iso2],
  );
  let attached = 0;
  for (const row of rows) {
    const input: IntelligenceSignalInput = {
      dedupeKey: String(row.source_event_id),
      eventType: row.event_type,
      title: row.source_title ?? row.event_title,
      summary: row.source_summary ?? row.event_summary,
      severity: row.severity,
      confidence: Number(row.event_confidence),
      startTime: new Date(row.start_time),
      lastActivityTime: new Date(row.last_activity_time),
      primaryLocationId: row.primary_location_id,
      primaryCountryIso2: row.primary_country_iso2,
      latitude: row.latitude == null ? null : Number(row.latitude),
      longitude: row.longitude == null ? null : Number(row.longitude),
      coordinatesAreExact: row.event_metadata?.exact_geography === true,
      relevanceScore: Number(row.relevance_score),
      urgencyScore: Number(row.urgency_score),
      materialityScore: Number(row.materiality_score),
      scoreComponents: row.score_components ?? {},
      entityKeys: row.entity_keys ?? [],
      evidence: {
        domain: "news",
        evidenceType: row.evidence_type,
        sourceRecordType: row.source_record_type,
        sourceRecordId: row.source_record_id,
        sourceId: row.source_id,
        observedAt: new Date(row.observed_at),
        publishedAt: row.published_at == null ? null : new Date(row.published_at),
        locationId: row.location_id,
        confidence: Number(row.confidence),
        relationship: row.relationship,
        provenance: { ...(row.provenance ?? {}), url: row.source_url ?? row.provenance?.url },
        license: row.license,
        attribution: row.attribution,
        metadata: row.metadata ?? {},
      },
    };
    if (await attachIntelligenceSignalToMajorEventContext(input, {
      excludeEventId: row.source_event_id,
      onlyEventId: anchor.id,
    })) attached += 1;
  }
  return attached;
}

export async function attachWeatherSnapshotToMajorEventContext(
  weatherSnapshotId: number,
  options: { onlyEventId?: string | null } = {},
) {
  if (!Number.isSafeInteger(weatherSnapshotId) || weatherSnapshotId <= 0) return null;
  const { rows } = await query<any>(
    `SELECT snapshot.*,source.name AS source_name,source.metadata AS source_metadata
     FROM weather_snapshot snapshot JOIN source ON source.id=snapshot.source_id
     WHERE snapshot.id=$1`,
    [weatherSnapshotId],
  );
  const snapshot = rows[0];
  if (!snapshot || !Number.isFinite(Number(snapshot.coord_lat)) || !Number.isFinite(Number(snapshot.coord_lon))) return null;
  const observedAt = new Date(snapshot.observed_at);
  if (Number.isNaN(observedAt.getTime())) return null;
  const conditions = [
    snapshot.temp_c == null ? null : `${Number(snapshot.temp_c).toFixed(1)}°C`,
    snapshot.weather_desc ?? snapshot.weather_main ?? null,
    snapshot.precipitation_mm == null ? null : `${Number(snapshot.precipitation_mm).toFixed(1)} mm precipitation`,
    snapshot.wind_speed == null ? null : `${Number(snapshot.wind_speed).toFixed(1)} m/s wind`,
  ].filter((value): value is string => Boolean(value));
  const title = `Weather model sample · ${String(snapshot.country_iso2).toUpperCase()}`;
  const summary = `${conditions.length ? conditions.join(" · ") : "Conditions were recorded"} at the provider's country sample point. This is nearby environmental context only; it does not explain or confirm earthquake impacts.`;
  return attachIntelligenceSignalToMajorEventContext({
    dedupeKey: `weather-snapshot-context:${weatherSnapshotId}`,
    eventType: "weather_conditions",
    title,
    summary,
    status: "monitoring",
    severity: "low",
    confidence: 0.72,
    startTime: observedAt,
    lastActivityTime: observedAt,
    primaryCountryIso2: snapshot.country_iso2,
    latitude: Number(snapshot.coord_lat),
    longitude: Number(snapshot.coord_lon),
    coordinatesAreExact: false,
    relevanceScore: 0.42,
    urgencyScore: 0.15,
    materialityScore: 0.2,
    scoreComponents: { contextual_weather: true, source_kind: snapshot.source_kind },
    evidence: {
      domain: "weather",
      evidenceType: "nearby_model_conditions",
      sourceRecordType: "weather_snapshot",
      sourceRecordId: String(weatherSnapshotId),
      sourceId: snapshot.source_id,
      observedAt,
      publishedAt: snapshot.updated_at == null ? null : new Date(snapshot.updated_at),
      confidence: 0.72,
      relationship: "context",
      provenance: {
        provider: snapshot.source_name,
        sample_latitude: Number(snapshot.coord_lat),
        sample_longitude: Number(snapshot.coord_lon),
        source_kind: snapshot.source_kind,
      },
      license: snapshot.source_metadata?.license ?? null,
      attribution: snapshot.source_metadata?.attribution ?? snapshot.source_name,
      metadata: {
        title,
        description: summary,
        temp_c: snapshot.temp_c,
        apparent_temp_c: snapshot.apparent_temp_c,
        humidity: snapshot.humidity,
        pressure_hpa: snapshot.pressure,
        precipitation_mm: snapshot.precipitation_mm,
        weather_main: snapshot.weather_main,
        weather_description: snapshot.weather_desc,
        wind_speed: snapshot.wind_speed,
        wind_gust: snapshot.wind_gust,
        sample_scope: "provider_country_coordinate",
      },
    },
  }, { onlyEventId: options.onlyEventId ?? null });
}

async function attachWeatherCoverageAssessment(
  anchor: MajorEarthquakeRow,
  nearest: { id: number; distance_km: number } | null,
) {
  const policy = contextualLinkagePolicy("earthquake", "weather");
  if (!policy) return 0;
  const startedAt = new Date(anchor.start_time);
  const boundedAssessmentTime = Math.min(
    Date.now(),
    startedAt.getTime() + policy.afterHours * 3_600_000,
  );
  // Synthetic assessments use a stable hourly watermark so a delivery retry
  // cannot manufacture a new event-update outbox identity milliseconds later.
  const observedAt = new Date(Math.max(
    startedAt.getTime(),
    Math.floor(boundedAssessmentTime / 3_600_000) * 3_600_000,
  ));
  const nearestSentence = nearest
    ? ` The nearest in-window provider sample was approximately ${Math.round(Number(nearest.distance_km))} km away and was not treated as local.`
    : " No provider sample was available in the governed event window.";
  const title = "No local weather sample available";
  const summary = `Claritas found no weather observation or model sample within ${policy.maxDistanceKm} km of the mapped earthquake during the ${policy.beforeHours}-hour before / ${policy.afterHours}-hour after window.${nearestSentence} No local weather inference can be made.`;
  const attached = await attachIntelligenceSignalToMajorEventContext({
    dedupeKey: `earthquake-weather-coverage:${anchor.id}`,
    eventType: "weather_conditions",
    title,
    summary,
    status: "monitoring",
    severity: "low",
    confidence: 0.95,
    startTime: startedAt,
    lastActivityTime: observedAt,
    primaryCountryIso2: anchor.country_iso2,
    // These coordinates describe the scope of the coverage check, not a
    // weather measurement. The evidence metadata makes that distinction
    // explicit while allowing the assessment to remain attached to its event.
    latitude: anchor.latitude,
    longitude: anchor.longitude,
    coordinatesAreExact: false,
    relevanceScore: 0.3,
    urgencyScore: 0.05,
    materialityScore: 0.1,
    scoreComponents: { weather_coverage_assessment: true },
    evidence: {
      domain: "weather",
      evidenceType: "event_area_weather_unavailable",
      sourceRecordType: "event_weather_coverage",
      sourceRecordId: anchor.id,
      observedAt,
      confidence: 0.95,
      relationship: "assessment",
      provenance: {
        provider: "claritas_weather_coverage",
        methodology: "bounded-weather-availability-v1",
      },
      attribution: "Claritas weather coverage assessment",
      metadata: {
        title,
        description: summary,
        radius_km: policy.maxDistanceKm,
        window_before_hours: policy.beforeHours,
        window_after_hours: policy.afterHours,
        nearest_sample_id: nearest?.id ?? null,
        nearest_sample_distance_km: nearest?.distance_km ?? null,
        coverage_status: "no_local_sample",
        assessment_boundary: "This record describes data availability only; it is not a weather observation.",
      },
    },
  }, { onlyEventId: anchor.id });
  return attached ? 1 : 0;
}

async function attachNearbyWeather(anchor: MajorEarthquakeRow) {
  const policy = contextualLinkagePolicy("earthquake", "weather");
  if (!policy) return 0;
  const { rows } = await query<{ id: number; distance_km: number }>(
    `SELECT snapshot.id,
            ST_Distance(
              ST_SetSRID(ST_MakePoint(snapshot.coord_lon,snapshot.coord_lat),4326)::geography,
              ST_SetSRID(ST_MakePoint($5,$4),4326)::geography
            )/1000 AS distance_km
     FROM weather_snapshot snapshot
     WHERE snapshot.coord_lat IS NOT NULL AND snapshot.coord_lon IS NOT NULL
       AND snapshot.observed_at BETWEEN
         $1::timestamptz-make_interval(secs=>$2::int)
         AND $1::timestamptz+make_interval(secs=>$3::int)
       AND ST_DWithin(
         ST_SetSRID(ST_MakePoint(snapshot.coord_lon,snapshot.coord_lat),4326)::geography,
         ST_SetSRID(ST_MakePoint($5,$4),4326)::geography,$6::double precision*1000)
     ORDER BY ST_Distance(
       ST_SetSRID(ST_MakePoint(snapshot.coord_lon,snapshot.coord_lat),4326)::geography,
       ST_SetSRID(ST_MakePoint($5,$4),4326)::geography),
       abs(extract(epoch FROM (snapshot.observed_at-$1::timestamptz)))
     LIMIT 1`,
    [anchor.start_time, Math.round(policy.beforeHours * 3_600), Math.round(policy.afterHours * 3_600),
     anchor.latitude, anchor.longitude, policy.maxDistanceKm],
  );
  if (!rows[0]) {
    const nearest = await query<{ id: number; distance_km: number }>(
      `SELECT snapshot.id,
              ST_Distance(
                ST_SetSRID(ST_MakePoint(snapshot.coord_lon,snapshot.coord_lat),4326)::geography,
                ST_SetSRID(ST_MakePoint($5,$4),4326)::geography
              )/1000 AS distance_km
       FROM weather_snapshot snapshot
       WHERE snapshot.coord_lat IS NOT NULL AND snapshot.coord_lon IS NOT NULL
         AND snapshot.observed_at BETWEEN
           $1::timestamptz-make_interval(secs=>$2::int)
           AND $1::timestamptz+make_interval(secs=>$3::int)
       ORDER BY distance_km LIMIT 1`,
      [anchor.start_time, Math.round(policy.beforeHours * 3_600), Math.round(policy.afterHours * 3_600),
       anchor.latitude, anchor.longitude],
    );
    return attachWeatherCoverageAssessment(anchor, nearest.rows[0] ?? null);
  }
  return await attachWeatherSnapshotToMajorEventContext(rows[0].id, { onlyEventId: anchor.id }) ? 1 : 0;
}

async function attachTransportComparison(anchor: MajorEarthquakeRow) {
  const policy = contextualLinkagePolicy("earthquake", "transport");
  if (!policy) return 0;
  const startedAt = new Date(anchor.start_time);
  const elapsedHours = (Date.now() - startedAt.getTime()) / 3_600_000;
  const configuredWindow = boundedNumberEnv("EVENT_TRANSPORT_CONTEXT_WINDOW_HOURS", 24, 2, 48);
  // Compare only completed whole-hour windows. Besides making the before and
  // after populations genuinely symmetric, this gives redeliveries the same
  // evidence/outbox timestamp within an hour.
  const windowHours = Math.floor(Math.min(
    configuredWindow,
    policy.beforeHours,
    policy.afterHours,
    Math.max(0, elapsedHours),
  ));
  if (windowHours < 1) return 0;
  const { rows } = await query<any>(
    `SELECT
       count(*) FILTER (WHERE point.observed_at<$1::timestamptz)::int AS before_samples,
       count(*) FILTER (WHERE point.observed_at>=$1::timestamptz)::int AS after_samples,
       count(DISTINCT point.mode || ':' || point.entity_id)
         FILTER (WHERE point.observed_at<$1::timestamptz)::int AS before_entities,
       count(DISTINCT point.mode || ':' || point.entity_id)
         FILTER (WHERE point.observed_at>=$1::timestamptz)::int AS after_entities,
       COALESCE(array_agg(DISTINCT point.source_name)
         FILTER (WHERE point.source_name IS NOT NULL),ARRAY[]::text[]) AS providers
     FROM transport_track_point point
     WHERE point.observed_at BETWEEN
       $1::timestamptz-make_interval(secs=>$2::int)
       AND $1::timestamptz+make_interval(secs=>$2::int)
       AND ST_DWithin(
         ST_SetSRID(ST_MakePoint(point.longitude,point.latitude),4326)::geography,
         ST_SetSRID(ST_MakePoint($4,$3),4326)::geography,$5::double precision*1000)`,
    [startedAt, Math.round(windowHours * 3_600), anchor.latitude, anchor.longitude, policy.maxDistanceKm],
  );
  const row = rows[0] ?? {};
  const assessment = assessTransportActivityComparison({
    beforeEntities: Number(row.before_entities ?? 0),
    afterEntities: Number(row.after_entities ?? 0),
    beforeSamples: Number(row.before_samples ?? 0),
    afterSamples: Number(row.after_samples ?? 0),
    windowHours,
  });
  const title = assessment.classification === "lower_activity_observed"
    ? "Lower nearby transport activity after the earthquake"
    : assessment.classification === "higher_activity_observed"
      ? "Higher nearby transport activity after the earthquake"
      : assessment.classification === "no_material_change_detected"
        ? "No material nearby transport change detected"
        : "Nearby transport coverage assessment";
  const observedAt = new Date(startedAt.getTime() + windowHours * 3_600_000);
  const attached = await attachIntelligenceSignalToMajorEventContext({
    dedupeKey: `earthquake-transport-context:${anchor.id}`,
    eventType: "transport_activity_change",
    title,
    summary: assessment.summary,
    status: "monitoring",
    severity: "low",
    confidence: assessment.confidence,
    startTime: startedAt,
    lastActivityTime: observedAt,
    primaryCountryIso2: anchor.country_iso2,
    latitude: anchor.latitude,
    longitude: anchor.longitude,
    coordinatesAreExact: false,
    relevanceScore: assessment.classification === "lower_activity_observed" ? 0.58 : 0.42,
    urgencyScore: assessment.classification === "lower_activity_observed" ? 0.45 : 0.15,
    materialityScore: assessment.classification === "lower_activity_observed" ? 0.5 : 0.2,
    scoreComponents: { contextual_transport: true, ...assessment },
    evidence: {
      domain: "transport",
      evidenceType: "event_area_activity_comparison",
      sourceRecordType: "event_transport_window",
      sourceRecordId: anchor.id,
      observedAt,
      confidence: assessment.confidence,
      relationship: "derived",
      provenance: {
        provider: "claritas_transport_comparison",
        underlying_providers: row.providers ?? [],
        methodology: assessment.methodology,
      },
      attribution: "Claritas comparison of governed transport telemetry",
      metadata: {
        title,
        description: assessment.summary,
        ...assessment,
        radius_km: policy.maxDistanceKm,
        comparison_boundary: "Tracked-entity counts reflect Claritas source coverage, not total port, maritime, or aviation activity.",
      },
    },
  }, { onlyEventId: anchor.id });
  return attached ? 1 : 0;
}

export async function refreshMajorEarthquakeContext(
  eventId: string,
  domains: IntelligenceDomain[] = ["news", "weather", "transport"],
) {
  const anchor = await loadMajorEarthquake(eventId);
  if (!anchor) return { eligible: false, news: 0, weather: 0, transport: 0 };
  const selected = new Set(domains);
  const [news, weather, transport] = await Promise.all([
    selected.has("news") ? attachExistingNews(anchor) : 0,
    selected.has("weather") ? attachNearbyWeather(anchor) : 0,
    selected.has("transport") ? attachTransportComparison(anchor) : 0,
  ]);
  return { eligible: true, news, weather, transport };
}

export async function refreshRecentMajorEarthquakeTransportContext(
  countryIso2: string | null | undefined,
  observedAt: Date,
) {
  const country = countryIso2?.trim().toUpperCase();
  if (!country || Number.isNaN(observedAt.getTime())) return 0;
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM intelligence_event
     WHERE event_type='earthquake' AND severity IN ('high','critical')
       AND status IN ('emerging','active','monitoring')
       AND primary_country_iso2=$1
       AND start_time BETWEEN $2::timestamptz-interval '72 hours' AND $2::timestamptz+interval '24 hours'
     ORDER BY start_time DESC LIMIT 5`,
    [country, observedAt],
  );
  for (const row of rows) await refreshMajorEarthquakeContext(row.id, ["transport"]);
  return rows.length;
}
