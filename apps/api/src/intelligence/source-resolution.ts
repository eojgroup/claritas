import { promoteSourceToInvestigation } from "./consumer";

export type SourceReference = { domain: string; sourceRecordType: string; sourceRecordId: string };

/** Only references to stored records are accepted; clients cannot supply a claim. */
export function parseInvestigationSource(body: unknown): SourceReference | null {
  if (!body || typeof body !== "object") return null;
  const input = body as Record<string, unknown>;
  const domain = typeof input.domain === "string" ? input.domain.trim() : "";
  const sourceRecordType = typeof input.source_record_type === "string" ? input.source_record_type.trim() : "";
  const sourceRecordId = typeof input.source_record_id === "string" || typeof input.source_record_id === "number"
    ? String(input.source_record_id).trim() : "";
  const supported: Record<string, string[]> = {
    news: ["item"], social: ["social_signal"],
    podcast: ["podcast_episode", "intelligence_signal"],
    imagery: ["earth_observation"], earth_observation: ["earth_observation"],
  };
  if (!supported[domain]?.includes(sourceRecordType) || !sourceRecordId || sourceRecordId.length > 500) return null;
  const numeric = /^\d+$/.test(sourceRecordId) && Number.isSafeInteger(Number(sourceRecordId)) && Number(sourceRecordId) > 0;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceRecordId);
  const podcastKey = sourceRecordType === "intelligence_signal" && /^podcast:\d+:(event|risk|claim):\S.{0,440}$/.test(sourceRecordId);
  if (sourceRecordType === "earth_observation" ? !uuid : !numeric && !podcastKey) return null;
  return { domain, sourceRecordType, sourceRecordId };
}

export async function resolveInvestigationSource(input: SourceReference) {
  const eventId = await promoteSourceToInvestigation(input);
  return eventId
    ? { event_id: eventId, status: "available" as const }
    : {
        event_id: null, status: "ineligible" as const,
        reason: input.domain === "podcast"
          ? "No eligible transcript-backed finding is available for this source yet."
          : "This source is unavailable or does not meet the criteria for an investigation.",
      };
}
