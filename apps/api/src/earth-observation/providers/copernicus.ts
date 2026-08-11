import { EarthProviderError, type EarthObservationProvider } from "../provider";
import type {
  EarthProviderStatus,
  EarthProductType,
  EarthScene,
  RenderedObservation,
  RenderRequest,
  SceneDiscoveryRequest,
} from "../types";
import { validateBoundingBox } from "../types";

const TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const CATALOG_URL = "https://sh.dataspace.copernicus.eu/catalog/v1/search";
const PROCESS_URL = "https://sh.dataspace.copernicus.eu/process/v1";

type FetchLike = typeof fetch;
type TokenPayload = { access_token?: string; expires_in?: number };

const EVALSCRIPTS: Record<Exclude<EarthProductType, "gibs_layer">, string> = {
  true_color: `//VERSION=3
function setup(){return {input:["B02","B03","B04","dataMask"],output:{bands:4,sampleType:"AUTO"}}}
function stretch(v){return Math.min(1,Math.max(0,Math.pow(2.5*v,0.85)))}
function evaluatePixel(s){return [stretch(s.B04),stretch(s.B03),stretch(s.B02),s.dataMask]}`,
  false_color: `//VERSION=3
function setup(){return {input:["B03","B04","B08","dataMask"],output:{bands:4,sampleType:"AUTO"}}}
function stretch(v){return Math.min(1,Math.max(0,Math.pow(2.5*v,0.85)))}
function evaluatePixel(s){return [stretch(s.B08),stretch(s.B04),stretch(s.B03),s.dataMask]}`,
  ndvi: `//VERSION=3
function setup(){return {input:["B04","B08","dataMask"],output:{bands:4,sampleType:"AUTO"}}}
function evaluatePixel(s){if(!s.dataMask)return [0,0,0,0];let v=index(s.B08,s.B04);if(v<0)return [0.45,0.28,0.16,1];if(v<0.2)return [0.88,0.78,0.48,1];if(v<0.4)return [0.62,0.72,0.28,1];if(v<0.6)return [0.24,0.55,0.2,1];return [0.04,0.3,0.13,1]}`,
  ndwi: `//VERSION=3
function setup(){return {input:["B03","B08","dataMask"],output:{bands:4,sampleType:"AUTO"}}}
function evaluatePixel(s){if(!s.dataMask)return [0,0,0,0];let v=index(s.B03,s.B08);if(v<-0.2)return [0.42,0.34,0.2,1];if(v<0)return [0.76,0.7,0.5,1];if(v<0.2)return [0.48,0.75,0.78,1];if(v<0.4)return [0.12,0.48,0.72,1];return [0.03,0.2,0.55,1]}`,
  burn_index: `//VERSION=3
function setup(){return {input:["B08","B12","dataMask"],output:{bands:4,sampleType:"AUTO"}}}
function evaluatePixel(s){if(!s.dataMask)return [0,0,0,0];let v=index(s.B08,s.B12);if(v<-0.2)return [0.48,0.04,0.08,1];if(v<0)return [0.78,0.16,0.08,1];if(v<0.2)return [0.95,0.48,0.12,1];if(v<0.4)return [0.72,0.68,0.2,1];return [0.12,0.46,0.2,1]}`,
  sar: `//VERSION=3
function setup(){return {input:["VV","VH","dataMask"],output:{bands:4,sampleType:"AUTO"}}}
function evaluatePixel(s){let vv=Math.min(1,Math.sqrt(Math.max(0,s.VV))*2);let vh=Math.min(1,Math.sqrt(Math.max(0,s.VH))*4);return [vv,vh,(vv+vh)/2,s.dataMask]}`,
};

function timeoutSignal(milliseconds: number) {
  return AbortSignal.timeout(Math.max(1_000, milliseconds));
}
export class CopernicusProvider implements EarthObservationProvider {
  readonly id = "copernicus";
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId = process.env.COPERNICUS_CLIENT_ID?.trim() ?? "",
    private readonly clientSecret = process.env.COPERNICUS_CLIENT_SECRET?.trim() ?? "",
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  status(): EarthProviderStatus {
    const enabled = process.env.EARTH_OBSERVATION_ENABLED?.toLowerCase() === "true"
      && process.env.COPERNICUS_ENABLED?.toLowerCase() === "true";
    const configured = Boolean(this.clientId && this.clientSecret);
    return {
      provider: this.id,
      enabled,
      configured,
      state: !enabled ? "disabled" : !configured ? "not_configured" : "ready",
      reason: !enabled ? "Feature flag disabled." : !configured ? "OAuth client credentials are not configured." : undefined,
      attribution: "Contains modified Copernicus Sentinel data processed by Sentinel Hub.",
    };
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new EarthProviderError(this.id, "Copernicus OAuth client credentials are not configured.", 503, false);
    }
    if (!forceRefresh && this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: timeoutSignal(15_000),
    });
    if (!response.ok) {
      throw new EarthProviderError(this.id, `Copernicus token endpoint returned HTTP ${response.status}.`, response.status, response.status >= 500 || response.status === 429);
    }
    const payload = await response.json() as TokenPayload;
    if (!payload.access_token) throw new EarthProviderError(this.id, "Copernicus token response omitted access_token.", 502, true);
    this.token = { value: payload.access_token, expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 600) * 1_000 };
    return this.token.value;
  }

  private async authorizedFetch(url: string, init: RequestInit, retryAuth = true) {
    const token = await this.getAccessToken();
    const response = await this.fetchImpl(url, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    });
    if (response.status === 401 && retryAuth) {
      this.token = null;
      const freshToken = await this.getAccessToken(true);
      return this.fetchImpl(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${freshToken}` } });
    }
    return response;
  }

  async discoverScenes(request: SceneDiscoveryRequest): Promise<EarthScene[]> {
    const bbox = validateBoundingBox(request.bbox);
    const collections = request.collections.filter((value) => ["sentinel-2-l2a", "sentinel-1-grd"].includes(value));
    if (!collections.length) throw new EarthProviderError(this.id, "No supported Copernicus collection was requested.", 400, false);
    const features: Array<{
      id?: string;
      collection?: string;
      bbox?: number[];
      geometry?: Record<string, unknown>;
      properties?: Record<string, unknown>;
      links?: Array<{ rel?: string; href?: string }>;
    }> = [];

    // CDSE's current Catalog contract accepts exactly one collection per
    // search. Keep the two governed Sentinel searches explicit and bounded,
    // then rank their combined results locally.
    for (const collection of collections) {
      const response = await this.authorizedFetch(CATALOG_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/geo+json" },
        body: JSON.stringify({
          bbox,
          datetime: `${request.start.toISOString()}/${request.end.toISOString()}`,
          collections: [collection],
          limit: Math.min(100, Math.max(1, request.limit)),
          fields: { include: ["id", "type", "bbox", "geometry", "properties.datetime", "properties.created", "properties.eo:cloud_cover", "properties.sat:orbit_state", "collection", "links"] },
        }),
        signal: timeoutSignal(20_000),
      });
      if (!response.ok) {
        throw new EarthProviderError(this.id, `Copernicus Catalog API returned HTTP ${response.status} for ${collection}: ${(await response.text()).slice(0, 240)}`, response.status, response.status >= 500 || response.status === 429);
      }
      const payload = await response.json() as { features?: typeof features };
      features.push(...(payload.features ?? []));
    }

    return features.flatMap((feature): EarthScene[] => {
      const collection = feature.collection ?? "";
      const captured = String(feature.properties?.datetime ?? "");
      if (!feature.id || !collections.includes(collection) || !Array.isArray(feature.bbox)
          || feature.bbox.length < 4 || Number.isNaN(Date.parse(captured))) return [];
      const mission = collection.startsWith("sentinel-1") ? "sentinel-1" : "sentinel-2";
      return [{
        provider: this.id,
        mission,
        collection,
        providerSceneId: feature.id,
        captureStart: new Date(captured),
        publishedAt: feature.properties?.created ? new Date(String(feature.properties.created)) : null,
        bbox: feature.bbox.slice(0, 4).map(Number) as [number, number, number, number],
        geometry: feature.geometry ?? null,
        cloudCover: Number.isFinite(Number(feature.properties?.["eo:cloud_cover"]))
          ? Number(feature.properties?.["eo:cloud_cover"]) : null,
        resolutionM: mission === "sentinel-2" ? 10 : 20,
        orbitDirection: typeof feature.properties?.["sat:orbit_state"] === "string"
          ? String(feature.properties?.["sat:orbit_state"]) : null,
        sourceUrl: feature.links?.find((link) => link.rel === "self")?.href ?? CATALOG_URL,
        license: "Copernicus Data Space Ecosystem terms; Sentinel data free, full and open access.",
        attribution: "Contains modified Copernicus Sentinel data processed by Sentinel Hub.",
        quality: {},
        rawMetadata: feature as unknown as Record<string, unknown>,
      }];
    })
      .sort((left, right) => right.captureStart.getTime() - left.captureStart.getTime())
      .slice(0, Math.min(100, Math.max(1, request.limit)));
  }

  async render(request: RenderRequest): Promise<RenderedObservation> {
    const bbox = validateBoundingBox(request.bbox);
    const maxWidth = Math.min(2_048, Math.max(64, Number(process.env.EO_RENDER_MAX_WIDTH ?? 1_024)));
    const maxHeight = Math.min(2_048, Math.max(64, Number(process.env.EO_RENDER_MAX_HEIGHT ?? 1_024)));
    const width = Math.min(maxWidth, Math.max(64, Math.trunc(request.width)));
    const height = Math.min(maxHeight, Math.max(64, Math.trunc(request.height)));
    if (request.product === "gibs_layer") throw new EarthProviderError(this.id, "GIBS layers are not rendered by Copernicus.", 400, false);
    if (request.product === "sar" && request.collection !== "sentinel-1-grd") {
      throw new EarthProviderError(this.id, "SAR rendering requires the sentinel-1-grd collection.", 400, false);
    }
    if (request.product !== "sar" && request.collection !== "sentinel-2-l2a") {
      throw new EarthProviderError(this.id, `${request.product} rendering requires sentinel-2-l2a.`, 400, false);
    }
    const response = await this.authorizedFetch(PROCESS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "image/png" },
      body: JSON.stringify({
        input: {
          bounds: { bbox, properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } },
          data: [{
            type: request.collection,
            dataFilter: {
              timeRange: { from: request.start.toISOString(), to: request.end.toISOString() },
              ...(request.collection === "sentinel-2-l2a" ? { maxCloudCoverage: Math.min(100, Math.max(0, request.maxCloudCoverage ?? 35)) } : {}),
              mosaickingOrder: "mostRecent",
            },
          }],
        },
        output: { width, height, responses: [{ identifier: "default", format: { type: "image/png" } }] },
        evalscript: EVALSCRIPTS[request.product],
      }),
      signal: timeoutSignal(45_000),
    });
    if (!response.ok) {
      throw new EarthProviderError(this.id, `Copernicus Process API returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`, response.status, response.status >= 500 || response.status === 429);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new EarthProviderError(this.id, "Copernicus Process API returned an empty image.", 502, true);
    return {
      bytes,
      mimeType: "image/png",
      width,
      height,
      processingUnits: Number(response.headers.get("x-processingunits-spent") ?? 0) || undefined,
    };
  }
}
