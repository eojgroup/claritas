import type { BoundingBox, EarthProviderStatus } from "../types";
import { validateBoundingBox } from "../types";

export type GibsLayer = {
  id: string;
  title: string;
  category: "true_color" | "fire" | "aerosol" | "precipitation" | "snow_ice" | "temperature";
  matrixSet: string;
  format: "jpg" | "png";
  attribution: string;
  temporal: boolean;
};

export const APPROVED_GIBS_LAYERS: readonly GibsLayer[] = [
  { id: "MODIS_Terra_CorrectedReflectance_TrueColor", title: "MODIS Terra true color", category: "true_color", matrixSet: "250m", format: "jpg", attribution: "NASA EOSDIS GIBS / MODIS Terra", temporal: true },
  { id: "MODIS_Aqua_CorrectedReflectance_TrueColor", title: "MODIS Aqua true color", category: "true_color", matrixSet: "250m", format: "jpg", attribution: "NASA EOSDIS GIBS / MODIS Aqua", temporal: true },
  { id: "VIIRS_NOAA20_CorrectedReflectance_TrueColor", title: "VIIRS NOAA-20 true color", category: "true_color", matrixSet: "250m", format: "jpg", attribution: "NASA EOSDIS GIBS / VIIRS NOAA-20", temporal: true },
  { id: "MODIS_Combined_Value_Added_AOD", title: "MODIS aerosol optical depth", category: "aerosol", matrixSet: "2km", format: "png", attribution: "NASA EOSDIS GIBS / MODIS", temporal: true },
] as const;

export const GIBS_ACKNOWLEDGEMENT = "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).";

export type GibsEventLayer = {
  layer_id: string;
  title: string;
  category: GibsLayer["category"];
  date: string;
  bbox: BoundingBox;
  tile_url: string;
  preview_url: string;
  format: GibsLayer["format"];
  matrix_set: string;
  temporal: boolean;
  provenance: {
    provider: "NASA EOSDIS GIBS";
    service: "WMTS";
    layer_id: string;
    observation_date: string;
    source_url: string;
    attribution: string;
    acknowledgement: string;
    license: string;
  };
};

export function gibsStatus(): EarthProviderStatus {
  const enabled = process.env.EARTH_OBSERVATION_ENABLED?.toLowerCase() === "true"
    && process.env.NASA_GIBS_ENABLED?.toLowerCase() === "true";
  return {
    provider: "nasa_gibs",
    enabled,
    configured: true,
    state: enabled ? "ready" : "disabled",
    reason: enabled ? undefined : "Feature flag disabled.",
    attribution: "NASA EOSDIS Global Imagery Browse Services (GIBS).",
  };
}
export function buildApprovedGibsTileTemplate(layerId: string, date: string): string {
  const layer = APPROVED_GIBS_LAYERS.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error("Requested GIBS layer is not on the approved allowlist.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("GIBS date must use YYYY-MM-DD.");
  return `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${layer.id}/default/${date}/${layer.matrixSet}/{z}/{y}/{x}.${layer.format}`;
}

export function buildApprovedGibsPreviewUrl(layerId: string, date: string, bboxInput: BoundingBox): string {
  const layer = APPROVED_GIBS_LAYERS.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error("Requested GIBS layer is not on the approved allowlist.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("GIBS date must use YYYY-MM-DD.");
  const bbox = validateBoundingBox(bboxInput);
  const [west, south, east, north] = bbox;
  const aspect = Math.max(0.5, Math.min(2, (east - west) / (north - south)));
  const width = Math.round(640 * Math.sqrt(aspect));
  const height = Math.round(640 / Math.sqrt(aspect));
  const parameters = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.3.0",
    LAYERS: layer.id,
    STYLES: "",
    FORMAT: layer.format === "jpg" ? "image/jpeg" : "image/png",
    TRANSPARENT: layer.format === "png" ? "TRUE" : "FALSE",
    CRS: "EPSG:4326",
    // WMS 1.3.0 defines EPSG:4326 in latitude/longitude axis order.
    BBOX: `${south},${west},${north},${east}`,
    WIDTH: String(Math.min(768, Math.max(256, width))),
    HEIGHT: String(Math.min(768, Math.max(256, height))),
    TIME: date,
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${parameters.toString()}`;
}

/**
 * Produces a fixed, reviewed GIBS context for an intelligence event. Callers
 * cannot provide a layer id or URL; every layer comes from the governance
 * allowlist and carries the exact observation day plus reuse provenance.
 */
export function buildApprovedGibsEventLayers(input: { date: string; bbox: BoundingBox }): GibsEventLayer[] {
  const bbox = validateBoundingBox(input.bbox);
  const parsedDate = new Date(`${input.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(parsedDate.getTime())
      || parsedDate.toISOString().slice(0, 10) !== input.date) {
    throw new Error("GIBS event date must use a valid YYYY-MM-DD calendar date.");
  }
  return APPROVED_GIBS_LAYERS.map((layer) => {
    const tileUrl = buildApprovedGibsTileTemplate(layer.id, input.date);
    const previewUrl = buildApprovedGibsPreviewUrl(layer.id, input.date, bbox);
    return {
      layer_id: layer.id,
      title: layer.title,
      category: layer.category,
      date: input.date,
      bbox,
      tile_url: tileUrl,
      preview_url: previewUrl,
      format: layer.format,
      matrix_set: layer.matrixSet,
      temporal: layer.temporal,
      provenance: {
        provider: "NASA EOSDIS GIBS",
        service: "WMTS",
        layer_id: layer.id,
        observation_date: input.date,
        source_url: previewUrl,
        attribution: layer.attribution,
        acknowledgement: GIBS_ACKNOWLEDGEMENT,
        license: "NASA ESDIS open-data terms; underlying non-NASA products remain subject to their source terms.",
      },
    };
  });
}
