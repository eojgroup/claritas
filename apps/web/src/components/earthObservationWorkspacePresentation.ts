import type { EarthObservation } from "../lib/api";

export function earthObservationTimestamp(
  value: string | null | undefined,
  locale?: string,
  timeZone?: string,
) {
  if (!value) return "Time not reported";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function earthObservationEvidenceLabel(observation: EarthObservation) {
  if (observation.model_interpretation) return "Sensor image + model interpretation";
  if (observation.imagery?.evidence_role === "sensor_derived_signal") {
    return "Sensor-derived analytical signal";
  }
  if (observation.imagery?.evidence_role === "regional_browse_context") {
    return "Regional browse context · not confirmation";
  }
  return "Visual context · not proof of cause";
}

export function earthObservationQualityLabel(observation: EarthObservation) {
  const tier = observation.imagery?.quality_tier;
  const resolution = observation.imagery?.effective_pixel_size_m
    ?? observation.imagery?.native_resolution_m
    ?? observation.resolution_m;
  const quality = tier === "high_resolution_processed"
    ? "High-resolution processed"
    : tier === "regional_browse_context"
      ? "Regional browse context"
      : tier === "standard_processed"
        ? "Standard processed"
        : "Quality not classified";
  return resolution == null ? quality : `${quality} · ${resolution.toLocaleString()} m effective pixels`;
}

export function summarizeEarthObservationScope(observations: EarthObservation[]) {
  const readable = observations.filter((item) => (
    Boolean(item.imagery?.preferred_asset)
    || item.assets.some((asset) => asset.asset_type === "preview")
    || item.assets.length > 0
  ));
  const natural = readable.filter((item) => item.imagery?.natural_color).length;
  const analytical = readable.filter((item) => item.imagery?.visual_class === "analytical").length;
  const cloudValues = readable
    .map((item) => item.cloud_cover)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const averageCloud = cloudValues.length
    ? cloudValues.reduce((sum, value) => sum + value, 0) / cloudValues.length
    : null;
  return {
    total: observations.length,
    readable: readable.length,
    pending: observations.length - readable.length,
    natural,
    analytical,
    averageCloud,
  };
}
