import type { EarthObservation } from "../lib/api";

function hasPreview(observation: EarthObservation) {
  return Boolean(observation.assets?.find((asset) => asset.asset_type === "preview") ?? observation.assets?.[0]);
}

export function findDefensibleComparisonPair(
  observations: EarthObservation[],
  eventId?: string | null,
): { before: EarthObservation; after: EarthObservation } | null {
  const candidates = observations
    .filter((item) => (
      hasPreview(item)
      && (eventId ? item.event_id === eventId : Boolean(item.location_id))
    ))
    .sort((left, right) => Date.parse(right.capture_start) - Date.parse(left.capture_start));

  for (const after of candidates) {
    if (eventId && after.event_id !== eventId) continue;
    const before = candidates.find((candidate) => {
      if (candidate.id === after.id || candidate.location_id !== after.location_id) return false;
      if (candidate.product_type !== after.product_type || candidate.provider !== after.provider) return false;
      if (eventId) {
        if (candidate.event_id !== eventId) return false;
      } else if ((candidate.event_id || after.event_id) && candidate.event_id !== after.event_id) {
        return false;
      }
      return Date.parse(candidate.capture_start) < Date.parse(after.capture_start);
    });
    if (before) return { before, after };
  }
  return null;
}
