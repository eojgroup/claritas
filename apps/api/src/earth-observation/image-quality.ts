import type { BoundingBox, EarthProductType } from "./types";

const METRES_PER_LATITUDE_DEGREE = 110_574;
const METRES_PER_LONGITUDE_DEGREE = 111_320;

export type EarthProductPresentation = {
  label: string;
  visual_class: "natural" | "enhanced" | "analytical" | "radar" | "browse";
  evidence_role: "visual_context" | "sensor_derived_signal" | "regional_browse_context";
  natural_color: boolean;
  interpretation: string;
};

const PRODUCT_PRESENTATION: Record<EarthProductType, EarthProductPresentation> = {
  true_color: {
    label: "Natural color",
    visual_class: "natural",
    evidence_role: "visual_context",
    natural_color: true,
    interpretation: "Human-readable Sentinel-2 reflectance rendered in approximately natural color.",
  },
  false_color: {
    label: "False color",
    visual_class: "enhanced",
    evidence_role: "sensor_derived_signal",
    natural_color: false,
    interpretation: "Near-infrared false-color rendering; colors are analytical and not literal scene colors.",
  },
  ndvi: {
    label: "Vegetation index",
    visual_class: "analytical",
    evidence_role: "sensor_derived_signal",
    natural_color: false,
    interpretation: "Normalized vegetation index; palette colors encode relative vegetation response.",
  },
  ndwi: {
    label: "Water index",
    visual_class: "analytical",
    evidence_role: "sensor_derived_signal",
    natural_color: false,
    interpretation: "Normalized water index; palette colors encode relative surface-water response.",
  },
  burn_index: {
    label: "Burn index",
    visual_class: "analytical",
    evidence_role: "sensor_derived_signal",
    natural_color: false,
    interpretation: "Normalized burn ratio; palette colors encode a spectral index and are not natural color.",
  },
  sar: {
    label: "Radar",
    visual_class: "radar",
    evidence_role: "sensor_derived_signal",
    natural_color: false,
    interpretation: "Sentinel-1 radar backscatter; brightness represents radar response rather than visible color.",
  },
  gibs_layer: {
    label: "NASA browse context",
    visual_class: "browse",
    evidence_role: "regional_browse_context",
    natural_color: false,
    interpretation: "Regional NASA browse imagery intended for context, not detailed event verification.",
  },
};

export function earthProductPresentation(product: EarthProductType): EarthProductPresentation {
  return PRODUCT_PRESENTATION[product];
}

/**
 * Preflight budget checks are not reservations. Persist exactly one
 * conservative usage value after a successful render so a missing/invalid
 * provider header cannot turn paid work into zero accounted units.
 */
export function accountedProcessingUnits(estimated: number, providerReported?: number | null) {
  const safeEstimate = Number.isFinite(estimated) && estimated > 0 ? estimated : 1;
  const safeReported = providerReported != null && Number.isFinite(providerReported)
    && providerReported > 0 ? providerReported : 0;
  return Math.max(safeEstimate, safeReported);
}

/**
 * Content-addressed objects let a newly rendered preview be uploaded before
 * the database pointer changes without overwriting the currently live asset.
 */
export function contentAddressedObservationObject(
  observationId: string,
  assetType: "preview" | "thumbnail",
  contentHash: string,
  extension: string,
) {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `observations/${observationId}/${assetType}-${contentHash}.${safeExtension}`;
}

export function aoiGroundDimensions(bbox: BoundingBox) {
  const [west, south, east, north] = bbox;
  const centerLatitudeRadians = ((south + north) / 2) * Math.PI / 180;
  const widthM = Math.max(1, (east - west) * METRES_PER_LONGITUDE_DEGREE
    * Math.max(0.01, Math.cos(centerLatitudeRadians)));
  const heightM = Math.max(1, (north - south) * METRES_PER_LATITUDE_DEGREE);
  return { widthM, heightM };
}

/**
 * Preserves the AOI's physical aspect ratio while remaining inside the
 * configured output ceiling. This avoids stretching a square ground footprint
 * into a landscape raster and never increases either provider dimension.
 */
export function renderDimensionsForAoi(bbox: BoundingBox, maxWidth: number, maxHeight: number) {
  const boundedWidth = Math.min(2_048, Math.max(64, Math.trunc(maxWidth)));
  const boundedHeight = Math.min(2_048, Math.max(64, Math.trunc(maxHeight)));
  const ground = aoiGroundDimensions(bbox);
  const aspect = ground.widthM / ground.heightM;
  let width = boundedWidth;
  let height = Math.round(width / aspect);
  if (height > boundedHeight) {
    height = boundedHeight;
    width = Math.round(height * aspect);
  }
  width = Math.min(boundedWidth, Math.max(64, width));
  height = Math.min(boundedHeight, Math.max(64, height));
  return {
    width,
    height,
    ground_width_m: Math.round(ground.widthM),
    ground_height_m: Math.round(ground.heightM),
    effective_pixel_size_m: Number(Math.max(ground.widthM / width, ground.heightM / height).toFixed(1)),
  };
}

/** Keeps Process API mosaicking tied to the catalogued acquisition. */
export function renderWindowForScene(captureStart: Date, captureEnd?: Date | null) {
  if (Number.isNaN(captureStart.getTime())) throw new Error("Scene capture start is invalid.");
  const paddingMs = 5 * 60_000;
  const maximumEnd = captureStart.getTime() + 3 * 60 * 60_000;
  const candidateEnd = captureEnd && !Number.isNaN(captureEnd.getTime())
    && captureEnd.getTime() >= captureStart.getTime()
    ? captureEnd.getTime() + paddingMs
    : captureStart.getTime() + 30 * 60_000;
  return {
    start: new Date(captureStart.getTime() - paddingMs),
    end: new Date(Math.min(maximumEnd, candidateEnd)),
  };
}

const iso = (value: string | Date | null | undefined) => value == null
  ? null
  : (value instanceof Date ? value : new Date(value)).toISOString();

/**
 * Makes the EO contract self-describing so consumers do not accidentally use
 * a thumbnail as a hero image or imply that browse pixels confirm a report.
 */
export function earthObservationToApi(row: any) {
  const assets = Array.isArray(row.assets) ? row.assets.map((asset: any) => ({
    ...asset,
    width: Number(asset.width),
    height: Number(asset.height),
    size_bytes: Number(asset.size_bytes),
    generated_at: iso(asset.generated_at),
    expires_at: iso(asset.expires_at),
  })) : [];
  const preferredAsset = assets.find((asset: any) => asset.asset_type === "preview")
    ?? assets.sort((left: any, right: any) => right.width * right.height - left.width * left.height)[0]
    ?? null;
  const product = earthProductPresentation(row.product_type as EarthProductType);
  const nativeResolution = row.resolution_m == null ? null : Number(row.resolution_m);
  const effectiveResolutionValue = Number(row.methodology?.render_context?.effective_pixel_size_m);
  const effectiveResolution = Number.isFinite(effectiveResolutionValue) ? effectiveResolutionValue : null;
  const highResolution = row.provider === "copernicus" && nativeResolution != null
    && nativeResolution <= 30 && preferredAsset?.width >= 768
    && (effectiveResolution == null || effectiveResolution <= 40);
  const linkedNews = Array.isArray(row.linked_news) ? row.linked_news : [];
  const rawModelInterpretation = row.analysis_details?.model_interpretation
    ?? row.methodology?.vision_enrichment;
  const hasModelInterpretation = rawModelInterpretation
    && typeof rawModelInterpretation === "object" && !Array.isArray(rawModelInterpretation);
  const modelConfidence = Number(rawModelInterpretation?.confidence);
  const observedFeatures = Array.isArray(rawModelInterpretation?.observed_features)
    ? rawModelInterpretation.observed_features.slice(0, 8) : [];
  const possibleChanges = Array.isArray(rawModelInterpretation?.possible_changes)
    ? rawModelInterpretation.possible_changes.slice(0, 8) : [];
  const modelInterpretation = hasModelInterpretation ? {
    summary: typeof rawModelInterpretation.summary === "string"
      ? rawModelInterpretation.summary
      : typeof row.analysis_summary === "string" ? row.analysis_summary : null,
    findings: Array.isArray(rawModelInterpretation.findings)
      ? rawModelInterpretation.findings.slice(0, 8) : observedFeatures,
    possible_changes: possibleChanges,
    limitations: Array.isArray(rawModelInterpretation.limitations)
      ? rawModelInterpretation.limitations.slice(0, 8) : [],
    confidence: Number.isFinite(modelConfidence) ? modelConfidence : null,
    provider: rawModelInterpretation.provider ?? null,
    model: rawModelInterpretation.actual_model ?? rawModelInterpretation.model ?? null,
    requested_model: rawModelInterpretation.requested_model ?? null,
    prompt_version: rawModelInterpretation.prompt_version ?? null,
    generated_at: iso(rawModelInterpretation.generated_at),
    epistemic_class: "model_interpretation",
    notice: "Model-generated interpretation of the displayed physical observation; it is not an independent sensor measurement.",
  } : null;
  return {
    ...row,
    confidence: row.confidence == null ? null : Number(row.confidence),
    scene_rank: row.scene_rank == null ? null : Number(row.scene_rank),
    cloud_cover: row.cloud_cover == null ? null : Number(row.cloud_cover),
    resolution_m: nativeResolution,
    captured_at: iso(row.captured_at),
    capture_start: iso(row.capture_start),
    capture_end: iso(row.capture_end),
    analysis_summary_role: modelInterpretation
      ? "model_interpretation"
      : row.analysis_summary ? row.analysis_kind ?? "derived_analysis" : null,
    model_interpretation: modelInterpretation,
    assets,
    imagery: {
      ...product,
      quality_tier: product.visual_class === "browse"
        ? "regional_browse_context"
        : highResolution ? "high_resolution_processed" : "standard_processed",
      native_resolution_m: nativeResolution,
      effective_pixel_size_m: effectiveResolution,
      preferred_asset: preferredAsset,
      display_guidance: product.visual_class === "analytical"
        ? "Show with the product legend and analytical label; do not present as a natural-color photograph."
        : "Use the preview asset for primary display and thumbnails only for compact lists.",
    },
    event_context: row.event_id ? {
      id: row.event_id,
      title: row.event_title ?? null,
      summary: row.event_summary ?? null,
      event_type: row.event_type ?? null,
      status: row.event_status ?? null,
      severity: row.event_severity ?? null,
      start_time: iso(row.event_start_time),
      last_activity_time: iso(row.event_last_activity_time),
      relevance: {
        score: row.event_relevance_score == null ? null : Number(row.event_relevance_score),
        urgency: row.event_urgency_score == null ? null : Number(row.event_urgency_score),
        materiality: row.event_materiality_score == null ? null : Number(row.event_materiality_score),
        components: row.event_score_components ?? {},
      },
      location: {
        id: row.location_id ?? null,
        name: row.location_name ?? null,
        country_iso2: row.event_country_iso2 ?? row.location_country_iso2 ?? null,
        latitude: row.event_latitude == null ? null : Number(row.event_latitude),
        longitude: row.event_longitude == null ? null : Number(row.event_longitude),
      },
      news: {
        count: Number(row.linked_news_count ?? linkedNews.length),
        items: linkedNews,
      },
      linkage: {
        relationship: "event_scoped_observation",
        scope: "The scene is linked through the canonical event and its trusted geography.",
        limitation: "Spatial and temporal alignment provides context; it does not by itself prove that reported activity caused a visible change.",
      },
    } : null,
  };
}
