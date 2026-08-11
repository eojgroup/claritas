export type IntelligenceDomain =
  | "news"
  | "transport"
  | "market"
  | "weather"
  | "earth_observation"
  | "disaster"
  | "podcast"
  | "assessment";

export type EvidenceRelationship =
  | "reported"
  | "observed"
  | "derived"
  | "model_interpretation"
  | "assessment"
  | "corroborates"
  | "contradicts"
  | "context";

export type IntelligenceSeverity = "low" | "medium" | "high" | "critical";

export type CorrelationCandidate = {
  eventType: string;
  observedAt: Date;
  latitude?: number | null;
  longitude?: number | null;
  locationId?: string | null;
  countryIso2?: string | null;
  entityKeys?: string[];
  sourceReliability?: number;
};
export type CorrelationScore = {
  score: number;
  accepted: boolean;
  components: {
    temporal: number;
    spatial: number;
    location: number;
    country: number;
    entity: number;
    event_type: number;
    source_reliability: number;
  };
  methodology: string;
};

export type SignalEvidenceInput = {
  domain: IntelligenceDomain;
  evidenceType: string;
  sourceRecordType: string;
  sourceRecordId: string;
  sourceId?: number | null;
  observedAt: Date;
  publishedAt?: Date | null;
  locationId?: string | null;
  confidence: number;
  relationship: EvidenceRelationship;
  provenance: Record<string, unknown>;
  license?: string | null;
  attribution?: string | null;
  correlationScore?: number;
  correlationFactors?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type IntelligenceSignalInput = {
  dedupeKey: string;
  eventType: string;
  title: string;
  summary: string;
  status?: "emerging" | "active" | "monitoring" | "resolved" | "dismissed";
  severity: IntelligenceSeverity;
  confidence: number;
  startTime: Date;
  lastActivityTime: Date;
  primaryLocationId?: string | null;
  primaryCountryIso2?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /**
   * True only when latitude/longitude came from the source observation itself
   * (for example GKG, USGS, GDELT action geometry, or FIRMS), not from a
   * canonical location or country centroid used for navigation/correlation.
   */
  coordinatesAreExact?: boolean;
  relevanceScore: number;
  urgencyScore: number;
  materialityScore: number;
  scoreComponents: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /**
   * Stable, normalized entity anchors used for correlation. These are not
   * inferred causal links; they are only additional evidence that two signals
   * may describe the same real-world event.
   */
  entityKeys?: string[];
  evidence: SignalEvidenceInput;
};

export type DomainEventEnvelope = {
  id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
};
