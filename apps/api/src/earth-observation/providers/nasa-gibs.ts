import type { EarthProviderStatus } from "../types";

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
