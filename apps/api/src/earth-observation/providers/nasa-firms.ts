import { createHash } from "crypto";
import { parseCsv } from "../../connectors/csv";
import { EarthProviderError } from "../provider";
import type { BoundingBox, EarthProviderStatus } from "../types";
import { validateBoundingBox } from "../types";

export type FirmsDetection = {
  externalId: string;
  latitude: number;
  longitude: number;
  acquisitionTime: Date;
  satellite: string;
  instrument: string;
  confidence: string;
  fireRadiativePower: number | null;
  dayNight: string | null;
  sourceVersion: string | null;
  payload: Record<string, string>;
};

export function parseFirmsCsv(text: string): FirmsDetection[] {
  return parseCsv(text).flatMap((row): FirmsDetection[] => {
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    const date = row.acq_date;
    const time = row.acq_time?.padStart(4, "0");
    const acquisitionTime = new Date(`${date}T${time?.slice(0, 2)}:${time?.slice(2)}:00Z`);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
        || Number.isNaN(acquisitionTime.getTime())) return [];
    const signature = [latitude.toFixed(5), longitude.toFixed(5), acquisitionTime.toISOString(), row.satellite, row.instrument].join("|");
    return [{
      externalId: createHash("sha256").update(signature).digest("hex"),
      latitude,
      longitude,
      acquisitionTime,
      satellite: row.satellite || "unknown",
      instrument: row.instrument || "VIIRS",
      confidence: row.confidence || "unknown",
      fireRadiativePower: Number.isFinite(Number(row.frp)) ? Number(row.frp) : null,
      dayNight: row.daynight || null,
      sourceVersion: row.version || null,
      payload: row,
    }];
  });
}
export class NasaFirmsProvider {
  readonly id = "nasa_firms";
  constructor(
    private readonly mapKey = process.env.NASA_FIRMS_MAP_KEY?.trim() ?? "",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  status(): EarthProviderStatus {
    const enabled = process.env.NASA_FIRMS_ENABLED?.toLowerCase() === "true";
    const configured = Boolean(this.mapKey);
    return {
      provider: this.id,
      enabled,
      configured,
      state: !enabled ? "disabled" : !configured ? "not_configured" : "ready",
      reason: !enabled ? "Feature flag disabled." : !configured ? "NASA FIRMS MAP_KEY is not configured." : undefined,
      attribution: "NASA FIRMS / VIIRS near-real-time active fire detections.",
    };
  }

  async fetchArea(bbox: BoundingBox, days = 1, source = "VIIRS_NOAA20_NRT") {
    const safeBbox = validateBoundingBox(bbox);
    if (!this.mapKey) throw new EarthProviderError(this.id, "NASA FIRMS MAP_KEY is not configured.", 503, false);
    if (!["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT"].includes(source)) {
      throw new EarthProviderError(this.id, "Unsupported FIRMS source.", 400, false);
    }
    const area = safeBbox.join(",");
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(this.mapKey)}/${source}/${area}/${Math.min(5, Math.max(1, Math.trunc(days)))}`;
    const response = await this.fetchImpl(url, {
      headers: { accept: "text/csv", "user-agent": process.env.NASA_USER_AGENT?.trim() || "Claritas/1.0 engineering@claritas.info" },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new EarthProviderError(this.id, `NASA FIRMS returned HTTP ${response.status}.`, response.status, response.status >= 500 || response.status === 429);
    return parseFirmsCsv(await response.text());
  }
}
