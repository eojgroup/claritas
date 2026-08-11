export type ApnsEnvironment = "development" | "production";
export type PushPlatform = "ios" | "watchos";
export const APNS_ELIGIBLE_CANDIDATE_STATUSES = ["candidate", "eligible", "delivered"] as const;

export type ApnsSendResult = {
  accepted: boolean;
  status: number;
  apnsId: string | null;
  reason: string | null;
  credentialFingerprint?: string | null;
  retryAfterSeconds?: number | null;
  tokenInvalidatedAt?: number | null;
};

export type ApnsOperationalState =
  | "disabled"
  | "not_configured"
  | "configured_unverified"
  | "ready"
  | "degraded";

export class ApnsPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApnsPermanentError";
  }
}

export class ApnsRegistrationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 429,
  ) {
    super(message);
    this.name = "ApnsRegistrationError";
  }
}

export function normalizeDeviceToken(value: unknown): string {
  const token = typeof value === "string" ? value.replace(/[\s<>]/g, "").toLowerCase() : "";
  // Apple explicitly warns clients not to assume a permanently fixed token
  // length. Bound the opaque binary token without locking it to today's size.
  if (!/^[a-f0-9]{32,256}$/.test(token) || token.length % 2 !== 0) {
    throw new Error("device_token must be an APNs hexadecimal token.");
  }
  return token;
}

export function normalizeEnvironment(value: unknown): ApnsEnvironment {
  if (value === "development" || value === "production") return value;
  throw new Error("environment must be development or production.");
}

export function normalizePlatform(value: unknown): PushPlatform {
  if (value === "ios" || value === "watchos") return value;
  throw new Error("platform must be ios or watchos.");
}

export function normalizeInstallationId(value: unknown): string {
  const installationId = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(installationId)) {
    throw new ApnsRegistrationError("installation_id must be a UUID generated and retained by this app installation.", 400);
  }
  return installationId;
}

export function normalizeDeviceMetadata(value: unknown): Record<string, unknown> {
  const metadata = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (Buffer.byteLength(JSON.stringify(metadata)) > 8_192) {
    throw new Error("device_token registration metadata must not exceed 8192 bytes.");
  }
  return metadata;
}

export function enforceDeviceRegistrationCapacity(input: {
  activeDevices: number;
  totalDeviceRecords: number;
  activatesDevice: boolean;
  addsDeviceRecordForUser: boolean;
  maxActiveDevices: number;
  maxDeviceRecords: number;
}): void {
  if (input.activatesDevice && input.activeDevices >= input.maxActiveDevices) {
    throw new ApnsRegistrationError(
      `Active push-device limit reached (${input.maxActiveDevices}). Unregister an installation before adding another.`,
      429,
    );
  }
  if (input.addsDeviceRecordForUser && input.totalDeviceRecords >= input.maxDeviceRecords) {
    throw new ApnsRegistrationError(
      `Push-device registration history limit reached (${input.maxDeviceRecords}). Contact support to remove retired registrations.`,
      429,
    );
  }
}

export function deriveApnsOperationalState(input: {
  enabled: boolean;
  configured: boolean;
  lastVerifiedAt?: string | Date | null;
  lastProviderFailureAt?: string | Date | null;
}): ApnsOperationalState {
  if (!input.enabled) return "disabled";
  if (!input.configured) return "not_configured";
  const verifiedAt = input.lastVerifiedAt ? new Date(input.lastVerifiedAt).getTime() : Number.NaN;
  const failureAt = input.lastProviderFailureAt ? new Date(input.lastProviderFailureAt).getTime() : Number.NaN;
  if (Number.isFinite(failureAt) && (!Number.isFinite(verifiedAt) || failureAt >= verifiedAt)) return "degraded";
  return Number.isFinite(verifiedAt) ? "ready" : "configured_unverified";
}

export function isApnsCandidateStatusEligible(value: string): boolean {
  return (APNS_ELIGIBLE_CANDIDATE_STATUSES as readonly string[]).includes(value);
}

function safeNotificationText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}

export function buildApnsPayload(delivery: {
  event_id: string;
  severity: string;
  title: string;
  body: string;
  event_type: string;
  primary_country_iso2: string | null;
}): string {
  const payload = JSON.stringify({
    aps: {
      alert: {
        title: safeNotificationText(delivery.title, 120),
        body: safeNotificationText(delivery.body, 600),
      },
      sound: "default",
      "thread-id": `claritas-${delivery.event_id}`,
      category: "CLARITAS_EVENT",
    },
    event_id: delivery.event_id,
    event_type: delivery.event_type,
    severity: delivery.severity,
    country_iso2: delivery.primary_country_iso2,
    destination: "intelligence",
  });
  if (Buffer.byteLength(payload) > 4_096) throw new ApnsPermanentError("APNs payload exceeds 4096 bytes.");
  return payload;
}

export type ApnsDisposition = {
  kind: "accepted" | "token_invalid" | "retry" | "dead_letter";
  backoffSeconds: number;
  refreshProviderToken: boolean;
};

export function classifyApnsResult(
  result: ApnsSendResult,
  attempts: number,
  maxAttempts: number,
): ApnsDisposition {
  if (result.accepted && result.status === 200) {
    return { kind: "accepted", backoffSeconds: 0, refreshProviderToken: false };
  }
  const tokenInvalid = (result.status === 400
      && ["BadDeviceToken", "DeviceTokenNotForTopic"].includes(result.reason ?? ""))
    || (result.status === 410 && result.reason === "Unregistered");
  if (tokenInvalid) {
    return { kind: "token_invalid", backoffSeconds: 0, refreshProviderToken: false };
  }
  const providerTokenFailure = result.status === 403
    && ["ExpiredProviderToken", "InvalidProviderToken"].includes(result.reason ?? "");
  const retryable = result.status === 0 || result.status === 429 || result.status >= 500 || providerTokenFailure;
  if (!retryable || attempts >= maxAttempts) {
    return { kind: "dead_letter", backoffSeconds: 0, refreshProviderToken: providerTokenFailure };
  }
  const exponential = Math.min(3_600, 15 * (2 ** Math.max(0, attempts - 1)));
  const retryAfter = Number(result.retryAfterSeconds);
  const backoffSeconds = Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(3_600, Math.max(exponential, Math.ceil(retryAfter)))
    : exponential;
  return { kind: "retry", backoffSeconds, refreshProviderToken: providerTokenFailure };
}
