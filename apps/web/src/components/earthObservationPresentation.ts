import type { EarthObservation } from "../lib/api";

const PRODUCT_RANK: Record<string, number> = {
  true_color: 0,
  false_color: 1,
  sar: 2,
  ndvi: 3,
  ndwi: 4,
  burn_index: 5,
  gibs_layer: 6,
};

const PRODUCT_LABELS: Record<string, string> = {
  true_color: "Natural color",
  false_color: "False-color composite",
  sar: "Radar observation",
  ndvi: "Vegetation index",
  ndwi: "Water index",
  burn_index: "Burn-sensitive index",
  gibs_layer: "Browse context",
};

export function earthObservationProductLabel(product: string) {
  return PRODUCT_LABELS[product] ?? product.replace(/_/g, " ");
}

export function isAnalyticalEarthProduct(product: string) {
  return ["false_color", "sar", "ndvi", "ndwi", "burn_index"].includes(product);
}

export function sortEarthObservationsForDisplay(observations: EarthObservation[]) {
  return [...observations].sort((left, right) => {
    const productDifference = (PRODUCT_RANK[left.product_type] ?? 99)
      - (PRODUCT_RANK[right.product_type] ?? 99);
    if (productDifference !== 0) return productDifference;
    return Date.parse(right.capture_start) - Date.parse(left.capture_start);
  });
}

export function selectOverviewObservation(
  observations: EarthObservation[],
  hasTrueColorBrowseContext: boolean,
) {
  const ready = sortEarthObservationsForDisplay(observations)
    .filter((observation) => observation.assets.length > 0);
  const naturalColor = ready.find((observation) => observation.product_type === "true_color");
  if (naturalColor) return naturalColor;
  if (hasTrueColorBrowseContext) return null;
  return ready.find((observation) => ["false_color", "sar"].includes(observation.product_type)) ?? null;
}
