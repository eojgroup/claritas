export type IntelligenceEventFreshnessState = "active" | "expiring" | "expired";

const DEFAULT_EVENT_VISIBILITY_HOURS = 48;

/**
 * Reader-facing visibility windows. These are deliberately separate from the
 * correlation windows: correlation controls whether evidence belongs to an
 * event, while this policy controls whether the event remains in current views.
 */
export function intelligenceEventVisibilityHours(eventType: string): number {
  const normalized = eventType.trim().toLowerCase();
  if (/(agricultur|crop|drought)/.test(normalized)) return 168;
  if (/(flood|storm|cyclone|hurricane|typhoon)/.test(normalized)) return 72;
  if (/(market|reported_development|news)/.test(normalized)) return 24;
  if (/(earthquake|seismic)/.test(normalized)) return 36;
  if (/(wildfire|fire|transport|aviation|security)/.test(normalized)) return 48;
  return DEFAULT_EVENT_VISIBILITY_HOURS;
}

/** SQL equivalent of intelligenceEventVisibilityHours, applied to last activity. */
export function intelligenceEventExpiresAtSql(alias = "event") {
  const activityExpiry = `(${alias}.last_activity_time + CASE
    WHEN lower(${alias}.event_type) ~ '(agricultur|crop|drought)' THEN interval '168 hours'
    WHEN lower(${alias}.event_type) ~ '(flood|storm|cyclone|hurricane|typhoon)' THEN interval '72 hours'
    WHEN lower(${alias}.event_type) ~ '(market|reported_development|news)' THEN interval '24 hours'
    WHEN lower(${alias}.event_type) ~ '(earthquake|seismic)' THEN interval '36 hours'
    WHEN lower(${alias}.event_type) ~ '(wildfire|fire|transport|aviation|security)' THEN interval '48 hours'
    ELSE interval '${DEFAULT_EVENT_VISIBILITY_HOURS} hours'
  END)`;
  return `LEAST(${activityExpiry}, COALESCE(${alias}.end_time, ${activityExpiry}))`;
}

export function intelligenceEventFreshness(input: {
  expiresAt: string | Date;
  status?: string | null;
  now?: Date;
}): IntelligenceEventFreshnessState {
  if (input.status === "resolved" || input.status === "dismissed") return "expired";
  const expiresAt = input.expiresAt instanceof Date ? input.expiresAt : new Date(input.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) return "expired";
  const remainingMs = expiresAt.getTime() - (input.now ?? new Date()).getTime();
  if (remainingMs <= 0) return "expired";
  return remainingMs <= 6 * 60 * 60 * 1_000 ? "expiring" : "active";
}
