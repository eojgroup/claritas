import type {
  EarthProviderStatus,
  EarthScene,
  RenderedObservation,
  RenderRequest,
  SceneDiscoveryRequest,
} from "./types";

export interface EarthObservationProvider {
  readonly id: string;
  status(): EarthProviderStatus;
  discoverScenes(request: SceneDiscoveryRequest): Promise<EarthScene[]>;
  render?(request: RenderRequest): Promise<RenderedObservation>;
}
export class EarthProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EarthProviderError";
  }
}
