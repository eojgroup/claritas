import type { EarthScene, SceneRank } from "./types";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function rankScene(
  scene: EarthScene,
  options: {
    now?: Date;
    eventTime?: Date | null;
    maxCloudCover?: number;
    coverageRatio?: number;
    preferredCollections?: string[];
  } = {},
): SceneRank {
  const now = options.now ?? new Date();
  const ageDays = Math.max(0, (now.getTime() - scene.captureStart.getTime()) / 86_400_000);
  const recency = clamp(1 - ageDays / 45);
  const maxCloud = Math.max(1, options.maxCloudCover ?? 35);
  const cloudCover = scene.cloudCover;
  const cloud = cloudCover == null ? 0.55 : clamp(1 - cloudCover / maxCloud);
  const eventDeltaDays = options.eventTime
    ? Math.abs(scene.captureStart.getTime() - options.eventTime.getTime()) / 86_400_000
    : ageDays;
  const eventTiming = clamp(1 - eventDeltaDays / 21);
  const coverage = clamp(options.coverageRatio ?? 1);
  const preferred = options.preferredCollections ?? ["sentinel-2-l2a", "sentinel-1-grd"];
  const sensor = preferred.includes(scene.collection)
    ? clamp(1 - preferred.indexOf(scene.collection) * 0.15)
    : 0.45;
  const quality = scene.quality.valid_pixel_coverage == null
    ? 0.7
    : clamp(Number(scene.quality.valid_pixel_coverage));
  const rejectedReason = cloudCover != null && cloudCover > maxCloud
    && scene.collection !== "sentinel-1-grd"
    ? `cloud_cover_above_${maxCloud}`
    : coverage < 0.15 ? "insufficient_aoi_coverage" : undefined;
  const score = recency * 0.2 + cloud * 0.2 + eventTiming * 0.24
    + coverage * 0.18 + sensor * 0.1 + quality * 0.08;
  return {
    scene,
    score: Number((rejectedReason ? score * 0.25 : score).toFixed(4)),
    components: { recency, cloud, event_timing: eventTiming, coverage, sensor, quality },
    rejectedReason,
  };
}
export function rankScenes(scenes: EarthScene[], options: Parameters<typeof rankScene>[1] = {}) {
  return scenes.map((scene) => rankScene(scene, options)).sort((a, b) => b.score - a.score);
}

export function selectBeforeAfterPair(
  scenes: EarthScene[],
  eventTime: Date,
  options: { maxCloudCover?: number; maxBeforeDays?: number; maxAfterDays?: number } = {},
) {
  const maxBefore = (options.maxBeforeDays ?? 180) * 86_400_000;
  const maxAfter = (options.maxAfterDays ?? 60) * 86_400_000;
  const acceptable = scenes.filter((scene) => scene.collection === "sentinel-1-grd"
    || scene.cloudCover == null || scene.cloudCover <= (options.maxCloudCover ?? 35));
  const before = acceptable
    .filter((scene) => scene.captureStart < eventTime && eventTime.getTime() - scene.captureStart.getTime() <= maxBefore)
    .sort((a, b) => b.captureStart.getTime() - a.captureStart.getTime());
  const after = acceptable
    .filter((scene) => scene.captureStart >= eventTime && scene.captureStart.getTime() - eventTime.getTime() <= maxAfter)
    .sort((a, b) => a.captureStart.getTime() - b.captureStart.getTime());
  let best: { before: EarthScene; after: EarthScene; comparability: number; warnings: string[] } | null = null;
  for (const pre of before.slice(0, 10)) {
    for (const post of after.slice(0, 10)) {
      const sameCollection = pre.collection === post.collection;
      const sameOrbit = !pre.orbitDirection || !post.orbitDirection || pre.orbitDirection === post.orbitDirection;
      const cloudDelta = Math.abs((pre.cloudCover ?? 20) - (post.cloudCover ?? 20));
      const comparability = clamp((sameCollection ? 0.55 : 0.15) + (sameOrbit ? 0.25 : 0.05) + clamp(1 - cloudDelta / 50) * 0.2);
      const warnings = [
        ...(!sameCollection ? ["Different sensor collections reduce visual comparability."] : []),
        ...(!sameOrbit ? ["Different orbit direction may change SAR appearance."] : []),
        ...(cloudDelta > 25 ? ["Cloud conditions differ materially between observations."] : []),
      ];
      if (!best || comparability > best.comparability) best = { before: pre, after: post, comparability, warnings };
    }
  }
  return best;
}
