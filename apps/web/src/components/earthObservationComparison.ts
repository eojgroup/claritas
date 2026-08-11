import type { EarthObservation } from "../lib/api";

// Default comparison is intentionally conservative: natural colour is easiest
// to interpret, while radar remains useful when no optical pair exists. False
// colour and derived indices require specialist interpretation and must not be
// promoted into the generic before/after canvas.
const READABLE_COMPARISON_PRODUCTS = new Set(["true_color", "sar"]);
const COMPARISON_PRODUCT_RANK: Record<string, number> = { true_color: 0, sar: 1 };

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
      && READABLE_COMPARISON_PRODUCTS.has(item.product_type)
      && (eventId ? item.event_id === eventId : Boolean(item.location_id))
    ))
    .sort((left, right) => (
      (COMPARISON_PRODUCT_RANK[left.product_type] ?? 99)
      - (COMPARISON_PRODUCT_RANK[right.product_type] ?? 99)
      || Date.parse(right.capture_start) - Date.parse(left.capture_start)
    ));

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

function nestedId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() ? id : null;
}

export function reconcileValidatedComparisonPair(
  observations: EarthObservation[],
  validation: Record<string, unknown> | null,
  eventId?: string | null,
): { before: EarthObservation; after: EarthObservation } | null {
  if (!validation || !["available", "limited_comparability"].includes(String(validation.status))) {
    return null;
  }
  const beforeSceneId = nestedId(validation.before);
  const afterSceneId = nestedId(validation.after);
  if (!beforeSceneId || !afterSceneId || beforeSceneId === afterSceneId) return null;
  const before = observations.find((item) => item.scene_id === beforeSceneId && hasPreview(item));
  const after = observations.find((item) => item.scene_id === afterSceneId && hasPreview(item));
  if (!before || !after) return null;
  if (!READABLE_COMPARISON_PRODUCTS.has(before.product_type)) return null;
  if (before.provider !== after.provider || before.product_type !== after.product_type) return null;
  if (before.location_id !== after.location_id) return null;
  if (eventId && (before.event_id !== eventId || after.event_id !== eventId)) return null;
  if (!eventId && (before.event_id || after.event_id) && before.event_id !== after.event_id) return null;
  if (Date.parse(before.capture_start) >= Date.parse(after.capture_start)) return null;
  return { before, after };
}
