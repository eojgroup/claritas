import { query, withTransaction } from "../db";
import { buildEventDedupeKey, computeSignalPriority, evaluateMarketMove } from "./correlation";
import { resolveLocationFromText, resolveNearestLocation } from "./location-resolver";
import { correlateAndUpsertIntelligenceSignal } from "./service";
import { calculateRollingBaseline, detectTransportAnomaly } from "./transport-anomaly";
import type { DomainEventEnvelope, IntelligenceSeverity } from "./types";

const sourceReliability: Record<string, number> = {
  "usgs-earthquakes": 0.98,
  "nasa-firms": 0.95,
  nws: 0.95,
  gdelt: 0.72,
  aisstream: 0.72,
  digitraffic: 0.9,
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

function firstGkgCoordinate(payload: any): { latitude: number; longitude: number; name: string | null } | null {
  const locations = Array.isArray(payload?.gkg?.locations) ? payload.gkg.locations : [];
  for (const candidate of locations.slice(0, 30)) {
    const latitude = Number(candidate?.latitude);
    const longitude = Number(candidate?.longitude);
    if (Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
        && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) {
      return {
        latitude,
        longitude,
        name: typeof candidate?.name === "string" && candidate.name.trim() ? candidate.name.trim() : null,
      };
    }
  }
  return null;
}

function exactObservedCoordinate(latitudeValue: unknown, longitudeValue: unknown) {
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    ? { latitude, longitude }
    : null;
}

function classifyEventType(text: string) {
  const normalized = text.toLowerCase();
  const mappings: Array<[RegExp, string]> = [
    [/earthquake|seismic|tremor/, "earthquake"],
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
  if (!story) return;
  const occurred = new Date(story.event_time ?? story.created_at);
  const text = `${story.title ?? ""} ${story.summary ?? ""}`;
  const gkgCoordinate = firstGkgCoordinate(story.payload);
  const location = (gkgCoordinate
    ? await resolveNearestLocation(gkgCoordinate.latitude, gkgCoordinate.longitude, 150)
    : null)
    ?? await resolveLocationFromText(text, story.country_iso2)
    ?? await countryLocation(story.country_iso2);
  if (!location && !story.country_iso2) return;
  const eventType = classifyEventType(text);
  const reliability = sourceReliability[story.source_name] ?? 0.68;
  const priority = computeSignalPriority({
    sourceReliability: reliability,
    sourceDiversity: 1,
    freshnessHours: Math.max(0, (Date.now() - occurred.getTime()) / 3_600_000),
    severity: eventType === "security_incident" ? "high" : "medium",
    locationImportance: Number(location?.importance_score ?? 0.45),
    domainCount: 1,
  });
  await correlateAndUpsertIntelligenceSignal({
    dedupeKey: buildEventDedupeKey([eventType, location?.id ?? story.country_iso2, dayKey(occurred)]),
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
    },
    entityKeys: collectEntityKeys(
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
      },
    },
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
  const actionCoordinate = exactObservedCoordinate(record.action_lat, record.action_lon);
  const location = actionCoordinate
    ? await resolveNearestLocation(actionCoordinate.latitude, actionCoordinate.longitude, 150)
    : await resolveLocationFromText(record.action_geo_name ?? "", record.action_country_iso2)
      ?? await countryLocation(record.action_country_iso2);
  const title = [record.actor1_name, record.actor2_name].filter(Boolean).join(" / ") || record.action_geo_name || "GDELT event signal";
  const priority = computeSignalPriority({
    sourceReliability: 0.72, sourceDiversity: Number(record.source_count ?? 1),
    freshnessHours: Math.max(0, (Date.now() - observed.getTime()) / 3_600_000), severity: "medium",
    locationImportance: Number(location?.importance_score ?? 0.4), domainCount: 1,
  });
  await correlateAndUpsertIntelligenceSignal({
    dedupeKey: buildEventDedupeKey(["gdelt_event", record.external_id]),
    eventType: "reported_development", title, summary: `GDELT recorded a structured event near ${record.action_geo_name ?? location?.canonical_name ?? "the reported location"}.`,
    severity: "medium", confidence: 0.68, startTime: observed, lastActivityTime: observed,
    primaryLocationId: location?.id ?? null, primaryCountryIso2: location?.country_iso2 ?? record.action_country_iso2,
    latitude: actionCoordinate?.latitude ?? location?.latitude, longitude: actionCoordinate?.longitude ?? location?.longitude,
    coordinatesAreExact: Boolean(actionCoordinate),
    relevanceScore: priority.score, urgencyScore: 0.4,
    materialityScore: Math.min(1, Math.abs(Number(record.goldstein_scale ?? 0)) / 10), scoreComponents: priority.components,
    metadata: { gdelt_event_code: record.event_code, quad_class: record.quad_class },
    entityKeys: collectEntityKeys(record.actor1_name, record.actor2_name),
    evidence: {
      domain: "news", evidenceType: "structured_event", sourceRecordType: "global_event", sourceRecordId: String(id),
      sourceId: record.source_id, observedAt: observed, publishedAt: observed, locationId: location?.id ?? null,
      confidence: 0.72, relationship: "reported",
      provenance: { provider: "gdelt", url: record.url, mention_count: record.mention_count, source_count: record.source_count },
      license: record.source_metadata?.license ?? "GDELT reuse terms; original publisher terms remain applicable", attribution: "GDELT / original publishers",
    },
  });
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
  await correlateAndUpsertIntelligenceSignal({
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
  });
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
  const radius = magnitude >= 7 ? 300 : magnitude >= 6 ? 180 : 100;
  const location = await resolveNearestLocation(quake.latitude, quake.longitude, radius,
    ["port", "airport", "city", "refinery", "lng_terminal", "power_station", "mine", "industrial_facility", "country"]);
  const observed = new Date(quake.observed_at);
  const priority = computeSignalPriority({
    sourceReliability: 0.98, sourceDiversity: 1,
    freshnessHours: Math.max(0, (Date.now() - observed.getTime()) / 3_600_000), severity,
    locationImportance: Number(location?.importance_score ?? 0.65), domainCount: 1,
  });
  await correlateAndUpsertIntelligenceSignal({
    dedupeKey: buildEventDedupeKey(["usgs", quake.usgs_event_id]), eventType: "earthquake",
    title: `${quake.magnitude == null ? "Earthquake" : `M${Number(quake.magnitude).toFixed(1)} earthquake`} — ${quake.place}`,
    summary: `USGS observed an earthquake at ${quake.place}${quake.depth_km == null ? "" : `, depth ${Number(quake.depth_km).toFixed(1)} km`}.${quake.tsunami ? " The source tsunami flag is set." : ""}`,
    severity, confidence: 0.98, startTime: observed, lastActivityTime: new Date(quake.updated_at_source),
    primaryLocationId: location?.id ?? null, primaryCountryIso2: location?.country_iso2 ?? null,
    latitude: quake.latitude, longitude: quake.longitude,
    coordinatesAreExact: true,
    relevanceScore: Math.max(priority.score, Math.min(1, magnitude / 9)), urgencyScore: Math.min(1, magnitude / 8),
    materialityScore: Math.min(1, (Number(quake.significance ?? 0) / 1_000) + (location?.importance_score ?? 0) * 0.25),
    scoreComponents: { ...priority.components, magnitude, significance: quake.significance, proximity_radius_km: radius },
    metadata: { tsunami: quake.tsunami, depth_km: quake.depth_km, alert_level: quake.alert_level, felt: quake.felt },
    entityKeys: collectEntityKeys(quake.place, quake.usgs_event_id),
    evidence: {
      domain: "disaster", evidenceType: "seismic_observation", sourceRecordType: "earthquake_observation", sourceRecordId: id,
      sourceId: Number(event.payload.source_id) || null, observedAt: observed, publishedAt: new Date(quake.updated_at_source), locationId: location?.id ?? null,
      confidence: 0.98, relationship: "observed", provenance: { provider: "usgs-earthquakes", event_id: quake.usgs_event_id, url: quake.source_url },
      license: "U.S. government public domain", attribution: "U.S. Geological Survey",
      metadata: { magnitude: quake.magnitude, magnitude_type: quake.magnitude_type, depth_km: quake.depth_km, tsunami: quake.tsunami },
    },
  });
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
  const { rows: hours } = await query<{ bucket: string | Date; total: number }>(
    `SELECT date_trunc('day',bucket) AS bucket,
            sum(departures+arrivals)::int AS total
     FROM transport_movement_hour
     WHERE country_iso2=$1 AND location_name=$2 AND bucket>=now()-interval '29 days'
     GROUP BY date_trunc('day',bucket) ORDER BY bucket`,
    [movement.country_iso2, movement.location_name],
  );
  const values = hours.map((row) => Number(row.total));
  if (values.length < 7) return;
  const current = values.at(-1) ?? 0;
  const previous = values.at(-2) ?? 0;
  const anomaly = detectTransportAnomaly({
    current, previousEquivalent: previous,
    sevenDayMedian: calculateRollingBaseline(values.slice(-8, -1), 7),
    twentyEightDayMedian: calculateRollingBaseline(values.slice(0, -1), 28),
    sampleHours: Math.min(28, values.length - 1) * 24,
  });
  if (!anomaly.anomalous) return;
  const location = await resolveLocationFromText(movement.location_name, movement.country_iso2)
    ?? await countryLocation(movement.country_iso2);
  const observed = new Date(movement.observed_at);
  const severity: IntelligenceSeverity = anomaly.magnitude >= 0.75 ? "high" : "medium";
  const priority = computeSignalPriority({
    sourceReliability: 0.72, sourceDiversity: 1,
    freshnessHours: Math.max(0, (Date.now() - observed.getTime()) / 3_600_000), severity,
    locationImportance: Number(location?.importance_score ?? 0.5), domainCount: 1,
    anomalyMagnitude: anomaly.magnitude,
  });
  const change = anomaly.percentChange == null ? "a new baseline" : `${Math.abs(anomaly.percentChange * 100).toFixed(0)}% ${anomaly.direction}`;
  await correlateAndUpsertIntelligenceSignal({
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
  });
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
      case "disaster.earthquake.observed": return handleEarthquake(event);
      case "earth.fire.detected": return handleFire(event);
      case "transport.movement.recorded": return handleTransportMovement(event);
      case "market.instrument.observed": return handleMarketIndicator(event);
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
