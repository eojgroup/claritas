import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  ApnsPermanentError,
  ApnsRegistrationError,
  buildApnsPayload,
  classifyApnsResult,
  deriveApnsOperationalState,
  enforceDeviceRegistrationCapacity,
  isApnsCandidateStatusEligible,
  normalizeDeviceMetadata,
  normalizeDeviceToken,
  normalizeInstallationId,
} from "./apns-policy";
import { createApnsProviderToken, normalizeApnsPrivateKey } from "./apns-signing";

test("APNs provider token is a compact ES256 JWT with bounded claims", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const now = Date.UTC(2026, 7, 11, 12, 0, 0);
  const token = createApnsProviderToken({
    keyId: "ABC123DEFG",
    teamId: "VTBJTFDTQY",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  }, now);
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), {
    alg: "ES256",
    kid: "ABC123DEFG",
  });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), {
    iss: "VTBJTFDTQY",
    iat: Math.floor(now / 1_000),
  });
  assert.equal(Buffer.from(signature, "base64url").length, 64);
  assert.ok(normalizeApnsPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" }).toString()));
  assert.equal(normalizeApnsPrivateKey("not a key"), null);
});

test("APNs device tokens remain opaque, normalized, and metadata-bounded", () => {
  assert.equal(normalizeDeviceToken(`<${"AB".repeat(32)}>`), "ab".repeat(32));
  assert.throws(() => normalizeDeviceToken("xyz"), /hexadecimal token/);
  assert.deepEqual(normalizeDeviceMetadata(null), {});
  assert.throws(() => normalizeDeviceMetadata({ value: "x".repeat(8_200) }), /8192 bytes/);
  assert.equal(
    normalizeInstallationId("5C2D6F9B-E28D-4E14-BD21-928A5242052F"),
    "5c2d6f9b-e28d-4e14-bd21-928a5242052f",
  );
  assert.throws(() => normalizeInstallationId("per-user-device"), ApnsRegistrationError);
});

test("APNs registration capacity bounds both active fan-out and retained device rows", () => {
  assert.doesNotThrow(() => enforceDeviceRegistrationCapacity({
    activeDevices: 7,
    totalDeviceRecords: 63,
    activatesDevice: true,
    addsDeviceRecordForUser: true,
    maxActiveDevices: 8,
    maxDeviceRecords: 64,
  }));
  assert.throws(() => enforceDeviceRegistrationCapacity({
    activeDevices: 8,
    totalDeviceRecords: 8,
    activatesDevice: true,
    addsDeviceRecordForUser: false,
    maxActiveDevices: 8,
    maxDeviceRecords: 64,
  }), (error: unknown) => error instanceof ApnsRegistrationError && error.status === 429);
  assert.throws(() => enforceDeviceRegistrationCapacity({
    activeDevices: 0,
    totalDeviceRecords: 64,
    activatesDevice: true,
    addsDeviceRecordForUser: true,
    maxActiveDevices: 8,
    maxDeviceRecords: 64,
  }), (error: unknown) => error instanceof ApnsRegistrationError && error.status === 429);
});

test("APNs readiness distinguishes local configuration from current-key verification", () => {
  assert.equal(deriveApnsOperationalState({ enabled: false, configured: true }), "disabled");
  assert.equal(deriveApnsOperationalState({ enabled: true, configured: false }), "not_configured");
  assert.equal(deriveApnsOperationalState({ enabled: true, configured: true }), "configured_unverified");
  assert.equal(deriveApnsOperationalState({
    enabled: true,
    configured: true,
    lastVerifiedAt: "2026-08-11T12:00:00Z",
  }), "ready");
  assert.equal(deriveApnsOperationalState({
    enabled: true,
    configured: true,
    lastVerifiedAt: "2026-08-11T12:00:00Z",
    lastProviderFailureAt: "2026-08-11T12:01:00Z",
  }), "degraded");
  assert.equal(deriveApnsOperationalState({
    enabled: true,
    configured: true,
    lastVerifiedAt: "2026-08-11T12:02:00Z",
    lastProviderFailureAt: "2026-08-11T12:01:00Z",
  }), "ready");
});

test("APNs sends only candidate states that remain deliverable", () => {
  for (const status of ["candidate", "eligible", "delivered"]) {
    assert.equal(isApnsCandidateStatusEligible(status), true);
  }
  for (const status of ["muted", "failed", "expired", "dismissed"]) {
    assert.equal(isApnsCandidateStatusEligible(status), false);
  }
});

test("APNs payload is bounded and contains only governed navigation context", () => {
  const payload = JSON.parse(buildApnsPayload({
    event_id: "5c2d6f9b-e28d-4e14-bd21-928a5242052f",
    event_type: "wildfire",
    severity: "high",
    title: "  Visible  smoke   signal  ",
    body: "Context from multiple sources.",
    primary_country_iso2: "GR",
  }));
  assert.equal(payload.aps.alert.title, "Visible smoke signal");
  assert.equal(payload.destination, "intelligence");
  assert.equal(payload.event_id, "5c2d6f9b-e28d-4e14-bd21-928a5242052f");
  assert.throws(() => buildApnsPayload({
    event_id: "event",
    event_type: "wildfire",
    severity: "high",
    title: "\u0000".repeat(120),
    body: "\u0000".repeat(600),
    primary_country_iso2: null,
  }), ApnsPermanentError);
});

test("APNs response policy distinguishes token invalidation, retry, and permanent failure", () => {
  assert.equal(classifyApnsResult({ accepted: true, status: 200, apnsId: "id", reason: null }, 1, 5).kind, "accepted");
  assert.equal(classifyApnsResult({ accepted: false, status: 410, apnsId: "id", reason: "Unregistered" }, 1, 5).kind, "token_invalid");
  assert.equal(classifyApnsResult({ accepted: false, status: 500, apnsId: "id", reason: "BadDeviceToken" }, 1, 5).kind, "retry");
  assert.equal(classifyApnsResult({ accepted: false, status: 400, apnsId: "id", reason: "BadPayload" }, 1, 5).kind, "dead_letter");
  const network = classifyApnsResult({ accepted: false, status: 0, apnsId: "id", reason: null }, 2, 5);
  assert.deepEqual(network, { kind: "retry", backoffSeconds: 30, refreshProviderToken: false });
  const throttled = classifyApnsResult({
    accepted: false, status: 429, apnsId: "id", reason: "TooManyRequests", retryAfterSeconds: 240,
  }, 1, 5);
  assert.equal(throttled.backoffSeconds, 240);
  const auth = classifyApnsResult({
    accepted: false, status: 403, apnsId: "id", reason: "ExpiredProviderToken",
  }, 1, 5);
  assert.equal(auth.kind, "retry");
  assert.equal(auth.refreshProviderToken, true);
  assert.equal(classifyApnsResult({ accepted: false, status: 503, apnsId: "id", reason: "Shutdown" }, 5, 5).kind, "dead_letter");
});
