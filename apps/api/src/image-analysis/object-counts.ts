export type ImageObjectCount = {
  object_type: "truck" | "vessel";
  area: "port_yard" | "harbor" | "offshore" | "image";
  status: "estimated" | "not_resolvable";
  count_min: number | null;
  count_max: number | null;
  confidence: number;
  reason: string;
  boxes: Array<[number, number, number, number]>;
};
export type ImageCountChange = {
  object_type: ImageObjectCount["object_type"]; area: ImageObjectCount["area"];
  baseline_id: string; baseline_captured_at: string;
  delta_min: number; delta_max: number; direction: "increase" | "decrease" | "overlapping_estimates";
};
export type CountImageContext = {
  source_kind: "satellite" | "news";
  product_type?: string; native_resolution_m?: number | null;
  effective_pixel_size_m?: number | null; cloud_cover?: number | null;
  width: number; height: number;
};

export function validateObjectCounts(value: unknown): ImageObjectCount[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error("Image object counts must be a bounded array.");
  const keys = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid image count.");
    const row = entry as Record<string, unknown>;
    if (!["truck", "vessel"].includes(String(row.object_type)) || !["port_yard", "harbor", "offshore", "image"].includes(String(row.area))
      || !["estimated", "not_resolvable"].includes(String(row.status)) || typeof row.confidence !== "number" || !Number.isFinite(row.confidence)
      || row.confidence < 0 || row.confidence > 1 || typeof row.reason !== "string" || !row.reason.trim()) throw new Error("Invalid image count fields.");
    const key = `${row.object_type}:${row.area}`;
    if (keys.has(key)) throw new Error("Duplicate image count scope.");
    keys.add(key);
    if (!Array.isArray(row.boxes) || row.boxes.length > 200) throw new Error("Invalid detection boxes.");
    const boxes = row.boxes.map((box) => {
      if (!Array.isArray(box) || box.length !== 4 || !box.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)
        || box[0] >= box[2] || box[1] >= box[3]) throw new Error("Detection boxes must have ordered normalized coordinates.");
      return box as [number, number, number, number];
    });
    if (row.status === "estimated" && (!Number.isInteger(row.count_min) || !Number.isInteger(row.count_max)
      || (row.count_min as number) < 0 || (row.count_max as number) < (row.count_min as number) || (row.count_max as number) > 200
      || (row.count_min as number) > boxes.length || ((row.count_max as number) > 0 && boxes.length === 0))) throw new Error("Count estimates require valid ranges and visible detections.");
    if (row.status === "not_resolvable" && (row.count_min !== null || row.count_max !== null || boxes.length !== 0)) throw new Error("Unresolvable counts must remain unknown, never zero.");
    return { object_type: row.object_type, area: row.area, status: row.status, count_min: row.count_min, count_max: row.count_max,
      confidence: row.confidence, reason: row.reason.trim().slice(0, 400), boxes } as ImageObjectCount;
  });
}

export function gateObjectCounts(counts: ImageObjectCount[], context: CountImageContext): ImageObjectCount[] {
  return counts.map((count) => {
    if (count.status !== "estimated") return count;
    let reason: string | null = null;
    if (context.source_kind === "satellite") {
      const resolutions = [context.native_resolution_m, context.effective_pixel_size_m];
      const threshold = count.object_type === "truck" ? 1.5 : 20;
      if (context.product_type !== "true_color") reason = "Object counts require natural-color imagery; this sensor product is unsuitable.";
      else if (resolutions.some((n) => typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > threshold)) reason = `Image resolution cannot support ${count.object_type} counts (requires ≤${threshold} m/pixel).`;
      else if (context.cloud_cover == null || !Number.isFinite(context.cloud_cover) || context.cloud_cover > 40) reason = "Cloud coverage is unknown or too high for comparable visible-object counts.";
    }
    if (!reason && count.boxes.some(([x1, y1, x2, y2]) => {
      const width = (x2 - x1) * context.width; const height = (y2 - y1) * context.height;
      return Math.max(width, height) < 6 || Math.min(width, height) < 2;
    })) reason = "Detected objects occupy too few delivered pixels for a defensible count.";
    return reason ? { ...count, status: "not_resolvable", count_min: null, count_max: null, confidence: 0, boxes: [], reason } : count;
  });
}

/** Only call with the same AOI, product, sensor, scale and a strictly older scene. */
export function compareObjectCounts(current: ImageObjectCount[], baseline: ImageObjectCount[], baselineId: string, capturedAt: string): ImageCountChange[] {
  return current.flatMap((count) => {
    const before = baseline.find((candidate) => candidate.object_type === count.object_type && candidate.area === count.area);
    if (!before || count.status !== "estimated" || before.status !== "estimated" || Math.min(count.confidence, before.confidence) < .65) return [];
    const deltaMin = count.count_min! - before.count_max!; const deltaMax = count.count_max! - before.count_min!;
    return [{ object_type: count.object_type, area: count.area, baseline_id: baselineId, baseline_captured_at: capturedAt,
      delta_min: deltaMin, delta_max: deltaMax, direction: deltaMin > 0 ? "increase" : deltaMax < 0 ? "decrease" : "overlapping_estimates" }];
  });
}

export function visualSignalScore(counts: ImageObjectCount[], changes: ImageCountChange[]) {
  if (!counts.some((count) => count.status === "estimated" && count.confidence >= .65 && count.count_min! > 0)) return 0;
  return changes.some((change) => change.direction !== "overlapping_estimates" && Math.min(Math.abs(change.delta_min), Math.abs(change.delta_max)) >= 5) ? .04 : .015;
}
