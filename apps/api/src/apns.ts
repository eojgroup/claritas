import { createHash, randomUUID } from "crypto";
import * as http2 from "http2";
import type { PoolClient } from "pg";
import { query, withTransaction, withWorkerLease } from "./db";
import { getPaywallBypassRoles, isPaywallEnabled, resolveBillingAccessState } from "./billing";
import {
  APNS_ELIGIBLE_CANDIDATE_STATUSES,
  ApnsPermanentError,
  ApnsRegistrationError,
  buildApnsPayload,
  classifyApnsResult,
  deriveApnsOperationalState,
  enforceDeviceRegistrationCapacity,
  normalizeDeviceMetadata,
  normalizeDeviceToken,
  normalizeEnvironment,
  normalizeInstallationId,
  normalizePlatform,
  type ApnsEnvironment,
  type ApnsSendResult,
} from "./apns-policy";
import { createApnsProviderToken, normalizeApnsPrivateKey, selectApnsEnvironmentCredential } from "./apns-signing";
export { createApnsProviderToken } from "./apns-signing";
export { ApnsRegistrationError } from "./apns-policy";
export type { ApnsSendResult } from "./apns-policy";

type ApnsConfig = {
  enabled: boolean;
  configured: boolean;
  keyId: string | null;
  teamId: string | null;
  topic: string;
  privateKey: string | null;
  sandboxKeyId: string | null;
  sandboxPrivateKey: string | null;
  sandboxUsesProductionCredential: boolean;
  reason: string | null;
};

type ClaimedDelivery = {
  id: string;
  candidate_id: string;
  user_id: number;
  device_id: string;
  device_token: string;
  environment: ApnsEnvironment;
  app_bundle_id: string;
  apns_id: string;
  device_row_version: string;
  attempts: number;
  max_attempts: number;
  event_id: string;
  severity: string;
  title: string;
  body: string;
  event_type: string;
  primary_country_iso2: string | null;
};

let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = false;
let cachedProviderToken: {
  value: string;
  createdAt: number;
  keyId: string;
  teamId: string;
  keyFingerprint: string;
} | null = null;

const flag = (name: string, fallback = false) => {
  const value = process.env[name]?.trim().toLowerCase();
  return value ? ["1", "true", "yes", "on"].includes(value) : fallback;
};

const integerEnv = (name: string, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
};

export function getApnsConfig(): ApnsConfig {
  const enabled = flag("APNS_DELIVERY_ENABLED");
  const rawKeyId = process.env.APNS_KEY_ID?.trim() ?? "";
  const rawTeamId = process.env.APNS_TEAM_ID?.trim() ?? "";
  const keyId = /^[A-Z0-9]{10}$/.test(rawKeyId) ? rawKeyId : null;
  const teamId = /^[A-Z0-9]{10}$/.test(rawTeamId) ? rawTeamId : null;
  const privateKey = normalizeApnsPrivateKey(process.env.APNS_PRIVATE_KEY);
  const rawSandboxKeyId = process.env.APNS_SANDBOX_KEY_ID?.trim() ?? "";
  const rawSandboxPrivateKey = process.env.APNS_SANDBOX_PRIVATE_KEY?.trim() ?? "";
  const sandboxSpecified = Boolean(rawSandboxKeyId || rawSandboxPrivateKey);
  const sandboxKeyId = sandboxSpecified && /^[A-Z0-9]{10}$/.test(rawSandboxKeyId)
    ? rawSandboxKeyId
    : sandboxSpecified ? null : keyId;
  const sandboxPrivateKey = sandboxSpecified
    ? normalizeApnsPrivateKey(rawSandboxPrivateKey)
    : privateKey;
  const topic = process.env.APNS_BUNDLE_TOPIC?.trim() || "com.eojgroup.claritas";
  const validTopic = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/.test(topic);
  const missing = [!keyId && "valid APNS_KEY_ID", !teamId && "valid APNS_TEAM_ID",
    !privateKey && "valid P-256 APNS_PRIVATE_KEY",
    !sandboxKeyId && "valid APNS_SANDBOX_KEY_ID",
    !sandboxPrivateKey && "valid P-256 APNS_SANDBOX_PRIVATE_KEY",
    !validTopic && "valid APNS_BUNDLE_TOPIC"]
    .filter(Boolean) as string[];
  return {
    enabled,
    configured: missing.length === 0,
    keyId,
    teamId,
    topic,
    privateKey,
    sandboxKeyId,
    sandboxPrivateKey,
    sandboxUsesProductionCredential: !sandboxSpecified,
    reason: !enabled ? "Feature flag disabled." : missing.length ? `Missing or invalid ${missing.join(", ")}.` : null,
  };
}

function apnsCredentialFingerprint(config: ApnsConfig, environment: ApnsEnvironment): string | null {
  const credential = selectApnsEnvironmentCredential(config, environment);
  if (!config.configured || !credential.keyId || !credential.teamId || !credential.privateKey) return null;
  return createHash("sha256")
    .update(JSON.stringify({ keyId: credential.keyId, teamId: credential.teamId, topic: config.topic, environment }))
    .update("\0")
    .update(credential.privateKey)
    .digest("hex");
}

async function getUserPushAccess(userId: number): Promise<{
  allowed: boolean;
  accountActive: boolean;
  reason: string;
}> {
  const { rows } = await query<{ is_active: boolean; roles: string[] | null }>(
    `SELECT user_account.is_active,ARRAY_REMOVE(ARRAY_AGG(role.key),NULL) AS roles
     FROM app_user user_account
     LEFT JOIN auth_user_role user_role ON user_role.user_id=user_account.id
     LEFT JOIN auth_role role ON role.id=user_role.role_id
     WHERE user_account.id=$1
     GROUP BY user_account.id,user_account.is_active`,
    [userId],
  );
  const account = rows[0];
  if (!account?.is_active) {
    return { allowed: false, accountActive: false, reason: "User account is inactive." };
  }
  const billing = await resolveBillingAccessState({ userId, roles: account.roles ?? [] });
  return billing.has_access
    ? { allowed: true, accountActive: true, reason: billing.reason }
    : { allowed: false, accountActive: true, reason: `Push suppressed: ${billing.reason.replace(/_/g, " ")}.` };
}

async function suppressUserPushDeliveries(userId: number, reason: string, deactivateDevices: boolean) {
  await withTransaction(async (client) => {
    if (deactivateDevices) await deactivatePushDevicesTx(client, userId, reason);
    await client.query(
      `UPDATE apns_delivery SET status='suppressed',last_error=$2,updated_at=now()
       WHERE user_id=$1 AND status IN ('queued','failed','sending')`,
      [userId, reason],
    );
  });
}

export async function registerPushDevice(userId: number, input: {
  device_token?: unknown;
  environment?: unknown;
  platform?: unknown;
  installation_id?: unknown;
  app_bundle_id?: unknown;
  metadata?: unknown;
}) {
  const token = normalizeDeviceToken(input.device_token);
  const environment = normalizeEnvironment(input.environment);
  const platform = normalizePlatform(input.platform ?? "ios");
  const installationId = normalizeInstallationId(input.installation_id);
  const config = getApnsConfig();
  const bundleId = typeof input.app_bundle_id === "string" ? input.app_bundle_id.trim() : "";
  if (!bundleId || bundleId !== config.topic) {
    throw new Error(`app_bundle_id must match the configured APNs topic ${config.topic}.`);
  }
  const metadata = normalizeDeviceMetadata(input.metadata);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const maxActiveDevices = integerEnv("APNS_MAX_ACTIVE_DEVICES_PER_USER", 8, 1, 20);
  const maxDeviceRecords = integerEnv("APNS_MAX_DEVICE_RECORDS_PER_USER", 64, 8, 256);
  return withTransaction(async (client) => {
    // Serialize by token first, then by user. The second lock makes count-based
    // limits transactional while the first preserves cross-account ownership
    // when two accounts race to register the same previously unseen token.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `apns-token:${tokenHash}:${bundleId}:${environment}`,
    ]);
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`apns-user:${userId}`]);

    const existing = await client.query<{
      id: string;
      user_id: string;
      active: boolean;
      installation_id: string;
    }>(
      `SELECT id,user_id,active,installation_id FROM user_push_device
       WHERE token_hash=$1 AND app_bundle_id=$2 AND environment=$3
       FOR UPDATE`,
      [tokenHash, bundleId, environment],
    );
    const prior = existing.rows[0];
    if (prior && Number(prior.user_id) !== userId && prior.active) {
      throw new ApnsRegistrationError(
        "device_token is registered to another active account; unregister it before reassignment.",
        409,
      );
    }

    const installation = await client.query<{
      id: string;
      user_id: string;
      active: boolean;
      installation_id: string;
    }>(
      `SELECT id,user_id,active,installation_id FROM user_push_device
       WHERE user_id=$1 AND platform=$2 AND installation_id=$3::uuid
         AND app_bundle_id=$4 AND environment=$5
       ORDER BY active DESC,last_registered_at DESC,id
       FOR UPDATE LIMIT 1`,
      [userId, platform, installationId, bundleId, environment],
    );
    const installed = installation.rows[0];
    if (installed?.active && installed.id !== prior?.id) {
      await client.query(
        `UPDATE user_push_device SET active=false,device_token='',invalidated_at=now(),
                invalidation_reason='token_rotated',updated_at=now() WHERE id=$1`,
        [installed.id],
      );
      await client.query(
        `UPDATE apns_delivery SET status='suppressed',
                last_error='Push token rotated for this app installation.',updated_at=now()
         WHERE device_id=$1 AND status IN ('queued','failed','sending')`,
        [installed.id],
      );
    }

    const target = prior ?? installed ?? null;
    if (prior && Number(prior.user_id) !== userId) {
      await client.query(
        `UPDATE apns_delivery SET status='suppressed',
                last_error='Device token ownership changed after explicit unregister.',updated_at=now()
         WHERE device_id=$1 AND status IN ('queued','failed','sending')`,
        [prior.id],
      );
    }
    const counts = await client.query<{ active: number; total: number }>(
      `SELECT count(*) FILTER (WHERE active)::int AS active,count(*)::int AS total
       FROM user_push_device WHERE user_id=$1`,
      [userId],
    );
    const deviceCounts = counts.rows[0] ?? { active: 0, total: 0 };
    enforceDeviceRegistrationCapacity({
      activeDevices: Number(deviceCounts.active),
      totalDeviceRecords: Number(deviceCounts.total),
      activatesDevice: !(target?.active && Number(target.user_id) === userId),
      addsDeviceRecordForUser: !target || Number(target.user_id) !== userId,
      maxActiveDevices,
      maxDeviceRecords,
    });

    if (target) {
      const { rows } = await client.query<any>(
        `UPDATE user_push_device SET
           user_id=$2,platform=$3,installation_id=$4::uuid,device_token=$5,token_hash=$6,
           app_bundle_id=$7,environment=$8,active=true,last_registered_at=now(),
           invalidated_at=NULL,invalidation_reason=NULL,
           metadata=CASE WHEN user_id=$2 THEN metadata || $9::jsonb ELSE $9::jsonb END,
           updated_at=now()
         WHERE id=$1
         RETURNING id,platform,installation_id,app_bundle_id,environment,active,
                   last_registered_at,created_at,updated_at`,
        [target.id, userId, platform, installationId, token, tokenHash, bundleId, environment,
         JSON.stringify(metadata)],
      );
      return rows[0];
    }

    const { rows } = await client.query<any>(
      `INSERT INTO user_push_device (
         user_id,platform,installation_id,device_token,token_hash,app_bundle_id,environment,metadata
       ) VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8::jsonb)
       RETURNING id,platform,installation_id,app_bundle_id,environment,active,
                 last_registered_at,created_at,updated_at`,
      [userId, platform, installationId, token, tokenHash, bundleId, environment, JSON.stringify(metadata)],
    );
    return rows[0];
  });
}

async function deactivatePushDevicesTx(
  client: PoolClient,
  userId: number,
  reason: string,
  deviceId?: string,
): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `UPDATE user_push_device SET active=false,device_token='',invalidated_at=now(),
            invalidation_reason=$2,updated_at=now()
     WHERE user_id=$1 AND active ${deviceId ? "AND id=$3::uuid" : ""}
     RETURNING id`,
    deviceId ? [userId, reason, deviceId] : [userId, reason],
  );
  if (rows.length) {
    await client.query(
      `UPDATE apns_delivery SET status='suppressed',last_error=$2,updated_at=now()
       WHERE device_id=ANY($1::uuid[]) AND status IN ('queued','failed','sending')`,
      [rows.map((row) => row.id), reason],
    );
  }
  return rows.length;
}

export async function deactivateUserPushDevicesTx(client: PoolClient, userId: number, reason: string) {
  return deactivatePushDevicesTx(client, userId, reason);
}

export async function unregisterPushDevice(userId: number, deviceId: string) {
  return withTransaction(async (client) => {
    return (await deactivatePushDevicesTx(client, userId, "user_unregistered", deviceId)) > 0;
  });
}

export async function unregisterAllPushDevices(userId: number) {
  return withTransaction(async (client) => {
    return await deactivatePushDevicesTx(client, userId, "user_unregistered_all");
  });
}

function providerToken(config: ApnsConfig, environment: ApnsEnvironment): string {
  const credential = selectApnsEnvironmentCredential(config, environment);
  if (!credential.keyId || !credential.teamId || !credential.privateKey) throw new Error("APNs signing credentials are incomplete.");
  const now = Date.now();
  const keyFingerprint = createHash("sha256").update(credential.privateKey).digest("hex");
  if (cachedProviderToken
      && cachedProviderToken.keyId === credential.keyId
      && cachedProviderToken.teamId === credential.teamId
      && cachedProviderToken.keyFingerprint === keyFingerprint
      && now - cachedProviderToken.createdAt < 50 * 60 * 1_000) {
    return cachedProviderToken.value;
  }
  const value = createApnsProviderToken(credential, now);
  cachedProviderToken = { value, createdAt: now, keyId: credential.keyId, teamId: credential.teamId, keyFingerprint };
  return value;
}

export async function sendApnsNotification(
  delivery: Pick<ClaimedDelivery, "device_token" | "environment" | "app_bundle_id" | "candidate_id" | "apns_id" | "event_id" | "severity" | "title" | "body" | "event_type" | "primary_country_iso2">,
  config = getApnsConfig(),
): Promise<ApnsSendResult> {
  if (!config.enabled || !config.configured) throw new ApnsPermanentError(config.reason ?? "APNs delivery is unavailable.");
  if (delivery.app_bundle_id !== config.topic) throw new ApnsPermanentError("Device topic does not match the configured APNs topic.");
  const host = delivery.environment === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";
  const apnsId = delivery.apns_id || randomUUID();
  const payload = buildApnsPayload(delivery);
  const authorizationToken = providerToken(config, delivery.environment);
  const credentialFingerprint = apnsCredentialFingerprint(config, delivery.environment);
  const expirationSeconds = integerEnv("APNS_EXPIRATION_SECONDS", 3_600, 0, 86_400);
  const expiration = expirationSeconds === 0
    ? "0"
    : String(Math.floor(Date.now() / 1_000) + expirationSeconds);

  return await new Promise<ApnsSendResult>((resolve, reject) => {
    const client = http2.connect(host);
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.close();
      callback();
    };
    const timeout = setTimeout(() => finish(() => {
      client.destroy();
      reject(new Error("APNs request timed out."));
    }), integerEnv("APNS_REQUEST_TIMEOUT_MS", 12_000, 2_000, 30_000));
    client.once("error", (error) => finish(() => reject(error)));
    const request = client.request({
      [http2.constants.HTTP2_HEADER_METHOD]: "POST",
      [http2.constants.HTTP2_HEADER_PATH]: `/3/device/${delivery.device_token}`,
      authorization: `bearer ${authorizationToken}`,
      "apns-topic": config.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-id": apnsId,
      "apns-collapse-id": `claritas-${delivery.candidate_id}`,
      "apns-expiration": expiration,
      "content-type": "application/json",
    });
    let status = 0;
    let returnedId: string | null = apnsId;
    let retryAfterSeconds: number | null = null;
    const chunks: Buffer[] = [];
    request.on("response", (headers) => {
      status = Number(headers[http2.constants.HTTP2_HEADER_STATUS] ?? 0);
      const headerId = headers["apns-id"];
      if (typeof headerId === "string") returnedId = headerId;
      const retryAfter = headers["retry-after"];
      const parsedRetryAfter = typeof retryAfter === "string" ? Number(retryAfter) : Number.NaN;
      if (Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0) retryAfterSeconds = parsedRetryAfter;
    });
    request.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    request.once("error", (error) => finish(() => reject(error)));
    request.once("end", () => finish(() => {
      const body = Buffer.concat(chunks).toString("utf8");
      let reason: string | null = null;
      let tokenInvalidatedAt: number | null = null;
      if (body) {
        try {
          const responseBody = JSON.parse(body);
          reason = typeof responseBody?.reason === "string" ? responseBody.reason.slice(0, 300) : body.slice(0, 300);
          tokenInvalidatedAt = Number.isFinite(Number(responseBody?.timestamp)) ? Number(responseBody.timestamp) : null;
        }
        catch { reason = body.slice(0, 300); }
      }
      resolve({
        accepted: status === 200,
        status,
        apnsId: returnedId,
        reason,
        credentialFingerprint,
        retryAfterSeconds,
        tokenInvalidatedAt,
      });
    }));
    request.end(payload);
  });
}

function pushAccessCondition(accountAlias: string, paywallParameter: number, rolesParameter: number) {
  return `(NOT $${paywallParameter}::boolean
    OR EXISTS (
      SELECT 1 FROM auth_user_role access_user_role
      JOIN auth_role access_role ON access_role.id=access_user_role.role_id
      WHERE access_user_role.user_id=${accountAlias}.id
        AND lower(access_role.key)=ANY($${rolesParameter}::text[])
    )
    OR EXISTS (
      SELECT 1 FROM billing_subscription access_subscription
      WHERE access_subscription.user_id=${accountAlias}.id
        AND access_subscription.status IN ('active','trialing','grace_period')
        AND (access_subscription.current_period_end IS NULL OR access_subscription.current_period_end>now())
    ))`;
}

function eligibleCandidateCondition(candidateAlias: string) {
  const statuses = APNS_ELIGIBLE_CANDIDATE_STATUSES.map((status) => `'${status}'`).join(",");
  return `${candidateAlias}.status IN (${statuses})`;
}

async function materializeDeliveries(
  topic: string,
  maximumAgeHours: number,
  materializationBatchSize: number,
  paywallEnabled: boolean,
  bypassRoles: string[],
) {
  await query(
    `UPDATE apns_delivery SET status='dead_letter',
            last_error=COALESCE(last_error,'Maximum APNs delivery attempts reached.'),updated_at=now()
     WHERE (status IN ('queued','failed') AND attempts>=max_attempts)
        OR (status='sending' AND attempts>=max_attempts AND updated_at<now()-interval '5 minutes')`,
  );
  await query(
    `UPDATE apns_delivery delivery SET status='suppressed',
            last_error=CASE
              WHEN NOT account.is_active THEN 'Recipient account is inactive.'
              WHEN NOT ${pushAccessCondition("account", 3, 4)} THEN 'Recipient no longer has paid access.'
              WHEN NOT ${eligibleCandidateCondition("candidate")} THEN 'Alert candidate is no longer deliverable.'
              WHEN NOT device.active THEN 'Push device is inactive.'
              WHEN device.user_id<>delivery.user_id THEN 'Push device ownership no longer matches recipient.'
              WHEN device.app_bundle_id<>$1 THEN 'Push device topic no longer matches configured topic.'
              WHEN candidate.created_at < now()-make_interval(hours=>$2) THEN 'Alert is too old for push delivery.'
              ELSE 'Alert is no longer eligible or was acknowledged.' END,
            updated_at=now()
     FROM user_push_device device,alert_candidate candidate,app_user account
     WHERE delivery.device_id=device.id AND delivery.candidate_id=candidate.id
       AND account.id=delivery.user_id
       AND delivery.status IN ('queued','failed','sending')
       AND (
         NOT account.is_active OR NOT ${pushAccessCondition("account", 3, 4)}
         OR NOT ${eligibleCandidateCondition("candidate")}
         OR NOT device.active OR device.user_id<>delivery.user_id OR device.app_bundle_id<>$1
         OR candidate.created_at < now()-make_interval(hours=>$2)
         OR NOT EXISTS (
           SELECT 1 FROM alert_candidate_recipient recipient
           WHERE recipient.candidate_id=delivery.candidate_id
             AND recipient.user_id=delivery.user_id AND recipient.channel='in_app'
             AND recipient.eligibility_status IN ('eligible','delivered')
             AND recipient.acknowledged_at IS NULL
         )
       )`,
    [topic, maximumAgeHours, paywallEnabled, bypassRoles],
  );
  await query(
    `INSERT INTO apns_delivery (candidate_id,user_id,device_id)
     SELECT bounded.candidate_id,bounded.user_id,bounded.device_id
     FROM (
       SELECT recipient.candidate_id,recipient.user_id,device.id AS device_id
       FROM alert_candidate_recipient recipient
       JOIN alert_candidate candidate ON candidate.id=recipient.candidate_id
       JOIN app_user account ON account.id=recipient.user_id AND account.is_active
       JOIN user_push_device device ON device.user_id=recipient.user_id AND device.active
         AND device.app_bundle_id=$1
       WHERE recipient.channel='in_app'
         AND recipient.eligibility_status IN ('eligible','delivered')
         AND recipient.acknowledged_at IS NULL
         AND ${eligibleCandidateCondition("candidate")}
         AND candidate.created_at >= now()-make_interval(hours=>$2)
         AND ${pushAccessCondition("account", 4, 5)}
         AND NOT EXISTS (
           SELECT 1 FROM apns_delivery existing
           WHERE existing.candidate_id=recipient.candidate_id AND existing.device_id=device.id
         )
       ORDER BY candidate.created_at,recipient.user_id,device.id
       LIMIT $3
     ) bounded
     ON CONFLICT (candidate_id,device_id) DO NOTHING`,
    [topic, maximumAgeHours, materializationBatchSize, paywallEnabled, bypassRoles],
  );
}

async function claimDelivery(
  topic: string,
  maximumAgeHours: number,
  paywallEnabled: boolean,
  bypassRoles: string[],
): Promise<ClaimedDelivery | null> {
  return await withTransaction(async (client) => {
    const { rows } = await client.query<ClaimedDelivery>(
      `WITH candidate_delivery AS (
         SELECT delivery.id FROM apns_delivery delivery
         JOIN user_push_device device ON device.id=delivery.device_id
         JOIN app_user account ON account.id=delivery.user_id AND account.is_active
         JOIN alert_candidate alert ON alert.id=delivery.candidate_id
         JOIN alert_candidate_recipient recipient
           ON recipient.candidate_id=delivery.candidate_id
          AND recipient.user_id=delivery.user_id AND recipient.channel='in_app'
         WHERE device.active AND device.user_id=delivery.user_id AND device.app_bundle_id=$1
           AND ${pushAccessCondition("account", 3, 4)}
           AND ${eligibleCandidateCondition("alert")}
           AND recipient.eligibility_status IN ('eligible','delivered')
           AND recipient.acknowledged_at IS NULL
           AND alert.created_at >= now()-make_interval(hours=>$2)
           AND delivery.attempts < delivery.max_attempts
           AND delivery.available_at <= now()
           AND (delivery.status IN ('queued','failed')
             OR (delivery.status='sending' AND delivery.updated_at < now()-interval '5 minutes'))
         ORDER BY delivery.available_at,delivery.created_at
         FOR UPDATE OF delivery,device SKIP LOCKED LIMIT 1
       )
       UPDATE apns_delivery delivery SET status='sending',attempts=attempts+1,
              apns_id=COALESCE(apns_id,gen_random_uuid()::text),updated_at=now()
       FROM candidate_delivery,
            alert_candidate alert,
            intelligence_event event,
            user_push_device device
       WHERE delivery.id=candidate_delivery.id
         AND alert.id=delivery.candidate_id
         AND event.id=alert.event_id
         AND device.id=delivery.device_id
       RETURNING delivery.*,device.device_token,device.environment,device.app_bundle_id,
                 device.xmin::text AS device_row_version,
                 alert.event_id,alert.severity,alert.title,alert.body,
                 event.event_type,event.primary_country_iso2`,
      [topic, maximumAgeHours, paywallEnabled, bypassRoles],
    );
    return rows[0] ?? null;
  });
}

async function refreshClaimedDevice(
  delivery: ClaimedDelivery,
  topic: string,
  maximumAgeHours: number,
  paywallEnabled: boolean,
  bypassRoles: string[],
) {
  const { rows } = await query<{
    device_token: string;
    environment: ApnsEnvironment;
    app_bundle_id: string;
    device_row_version: string;
  }>(
    `SELECT device.device_token,device.environment,device.app_bundle_id,
            device.xmin::text AS device_row_version
     FROM user_push_device device
     JOIN app_user account ON account.id=device.user_id AND account.is_active
     WHERE device.id=$1::uuid AND device.user_id=$2 AND device.active AND device.app_bundle_id=$3
       AND ${pushAccessCondition("account", 6, 7)}
       AND EXISTS (
         SELECT 1 FROM alert_candidate candidate
         JOIN alert_candidate_recipient recipient
           ON recipient.candidate_id=candidate.id AND recipient.user_id=$2 AND recipient.channel='in_app'
         WHERE candidate.id=$4 AND ${eligibleCandidateCondition("candidate")}
           AND candidate.created_at>=now()-make_interval(hours=>$5)
           AND recipient.eligibility_status IN ('eligible','delivered')
           AND recipient.acknowledged_at IS NULL
       )`,
    [delivery.device_id, delivery.user_id, topic, delivery.candidate_id, maximumAgeHours,
     paywallEnabled, bypassRoles],
  );
  const current = rows[0];
  if (!current) return false;
  delivery.device_token = current.device_token;
  delivery.environment = current.environment;
  delivery.app_bundle_id = current.app_bundle_id;
  delivery.device_row_version = current.device_row_version;
  return true;
}

async function recordDeliveryResult(delivery: ClaimedDelivery, result: ApnsSendResult) {
  const disposition = classifyApnsResult(result, delivery.attempts, delivery.max_attempts);
  if (disposition.refreshProviderToken) cachedProviderToken = null;
  if (disposition.kind === "accepted") {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE apns_delivery SET status='accepted',apns_id=$2,apns_status=$3,
                apns_reason=$4,credential_fingerprint=$5,accepted_at=now(),
                last_error=NULL,updated_at=now() WHERE id=$1`,
        [delivery.id, result.apnsId, result.status, result.reason, result.credentialFingerprint ?? null],
      );
      await client.query(
        `INSERT INTO alert_candidate_recipient (
           candidate_id,user_id,channel,eligibility_status,delivered_at,metadata
         ) VALUES ($1,$2,'push','delivered',now(),$3::jsonb)
         ON CONFLICT (candidate_id,user_id,channel) DO UPDATE SET
           eligibility_status='delivered',delivered_at=now(),last_error=NULL,
           metadata=alert_candidate_recipient.metadata || EXCLUDED.metadata,updated_at=now()`,
        [delivery.candidate_id, delivery.user_id,
         JSON.stringify({ apns_id: result.apnsId, accepted_not_seen: true })],
      );
    });
    return;
  }
  if (disposition.kind === "token_invalid") {
    const rawInvalidatedAt = Number(result.tokenInvalidatedAt);
    const invalidatedAt = Number.isFinite(rawInvalidatedAt) && rawInvalidatedAt > 0
      ? new Date(rawInvalidatedAt < 1_000_000_000_000 ? rawInvalidatedAt * 1_000 : rawInvalidatedAt)
      : null;
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE apns_delivery SET status='token_invalid',apns_id=$2,apns_status=$3,
                apns_reason=$4,credential_fingerprint=$5,last_error=$4,updated_at=now() WHERE id=$1`,
        [delivery.id, result.apnsId, result.status, result.reason ?? "APNs rejected device token.",
         result.credentialFingerprint ?? null],
      );
      const invalidated = await client.query<{ id: string }>(
         `UPDATE user_push_device SET active=false,device_token='',invalidated_at=now(),
                invalidation_reason=$2,updated_at=now()
         WHERE id=$1 AND xmin::text=$3
           AND ($4::timestamptz IS NULL OR last_registered_at <= $4::timestamptz)
         RETURNING id`,
        [delivery.device_id, result.reason ?? "APNs rejected device token.", delivery.device_row_version,
         invalidatedAt && !Number.isNaN(invalidatedAt.getTime()) ? invalidatedAt : null],
      );
      if (invalidated.rows[0]) {
        await client.query(
          `UPDATE apns_delivery SET status='token_invalid',apns_reason=$2,last_error=$2,updated_at=now()
           WHERE device_id=$1 AND id<>$3 AND status IN ('queued','failed','sending')`,
          [delivery.device_id, result.reason ?? "APNs rejected device token.", delivery.id],
        );
      }
    });
    return;
  }
  await query(
    `UPDATE apns_delivery SET status=$2,apns_id=$3,apns_status=$4,apns_reason=$5,
            credential_fingerprint=$7,last_error=$5,
            available_at=now()+make_interval(secs=>$6),updated_at=now() WHERE id=$1`,
    [delivery.id, disposition.kind === "retry" ? "failed" : "dead_letter", result.apnsId, result.status,
     result.reason ?? `APNs HTTP ${result.status || "without status"}`, disposition.backoffSeconds,
     result.credentialFingerprint ?? null],
  );
}

async function failDelivery(delivery: ClaimedDelivery, error: unknown, credentialFingerprint: string | null) {
  const message = error instanceof Error ? error.message : String(error);
  const dead = error instanceof ApnsPermanentError || delivery.attempts >= delivery.max_attempts;
  const backoffSeconds = Math.min(3_600, 15 * (2 ** Math.max(0, delivery.attempts - 1)));
  await query(
    `UPDATE apns_delivery SET status=$2,last_error=$3,credential_fingerprint=$5,
            available_at=now()+make_interval(secs=>$4),updated_at=now() WHERE id=$1`,
    [delivery.id, dead ? "dead_letter" : "failed", message.slice(0, 1_000), backoffSeconds,
     credentialFingerprint],
  );
}

async function runWorkerCycle() {
  const config = getApnsConfig();
  if (!config.enabled || !config.configured) return;
  const maximumAgeHours = integerEnv("APNS_MAX_NOTIFICATION_AGE_HOURS", 24, 1, 168);
  const materializationBatchSize = integerEnv("APNS_MATERIALIZATION_BATCH_SIZE", 500, 10, 2_000);
  const paywallEnabled = isPaywallEnabled();
  const bypassRoles = getPaywallBypassRoles();
  await materializeDeliveries(
    config.topic,
    maximumAgeHours,
    materializationBatchSize,
    paywallEnabled,
    bypassRoles,
  );
  const batch = integerEnv("APNS_WORKER_BATCH_SIZE", 10, 1, 50);
  for (let index = 0; index < batch; index += 1) {
    const delivery = await claimDelivery(config.topic, maximumAgeHours, paywallEnabled, bypassRoles);
    if (!delivery) return;
    try {
      const access = await getUserPushAccess(delivery.user_id);
      if (!access.allowed) {
        await suppressUserPushDeliveries(delivery.user_id, access.reason, !access.accountActive);
        continue;
      }
      if (!await refreshClaimedDevice(
        delivery,
        config.topic,
        maximumAgeHours,
        paywallEnabled,
        bypassRoles,
      )) {
        await query(
          `UPDATE apns_delivery SET status='suppressed',last_error='Push device changed before delivery.',updated_at=now()
           WHERE id=$1 AND status='sending'`,
          [delivery.id],
        );
        continue;
      }
      await recordDeliveryResult(delivery, await sendApnsNotification(delivery, config));
    } catch (error) {
      await failDelivery(delivery, error, apnsCredentialFingerprint(config, delivery.environment));
    }
  }
}

export async function getApnsStatus() {
  const config = getApnsConfig();
  const fingerprints = (["production", "development"] as const)
    .map((environment) => apnsCredentialFingerprint(config, environment))
    .filter((value): value is string => Boolean(value));
  const [devices, deliveries, verification] = await Promise.all([
    query<{ active: number; total: number }>(
      `SELECT count(*) FILTER (WHERE active)::int AS active,count(*)::int AS total FROM user_push_device`,
    ),
    query<{ status: string; count: number }>(
      `SELECT status,count(*)::int AS count FROM apns_delivery GROUP BY status ORDER BY status`,
    ),
    query<{
      last_verified_at: string | Date | null;
      last_provider_failure_at: string | Date | null;
      last_provider_error: string | null;
    }>(
      `SELECT
         max(accepted_at) FILTER (
           WHERE status='accepted' AND credential_fingerprint=ANY($1::text[])
         ) AS last_verified_at,
         max(updated_at) FILTER (
           WHERE credential_fingerprint=ANY($1::text[])
             AND (apns_status IN (403,429) OR apns_status BETWEEN 500 AND 599)
         ) AS last_provider_failure_at,
         (array_agg(COALESCE(apns_reason,last_error) ORDER BY updated_at DESC) FILTER (
           WHERE credential_fingerprint=ANY($1::text[])
             AND (apns_status IN (403,429) OR apns_status BETWEEN 500 AND 599)
         ))[1] AS last_provider_error
       FROM apns_delivery`,
      [fingerprints],
    ),
  ]);
  const providerVerification = verification.rows[0] ?? {
    last_verified_at: null,
    last_provider_failure_at: null,
    last_provider_error: null,
  };
  const state = deriveApnsOperationalState({
    enabled: config.enabled,
    configured: config.configured,
    lastVerifiedAt: providerVerification.last_verified_at,
    lastProviderFailureAt: providerVerification.last_provider_failure_at,
  });
  const reason = config.reason
    ?? (state === "configured_unverified"
      ? "Credentials are locally valid, but the current key/topic has not yet received an APNs acceptance."
      : state === "degraded"
        ? providerVerification.last_provider_error ?? "The latest APNs provider outcome failed after the last verified acceptance."
        : null);
  return {
    enabled: config.enabled,
    configured: config.configured,
    state,
    reason,
    topic: config.topic,
    environments: {
      production: { configured: Boolean(config.keyId && config.teamId && config.privateKey) },
      development: {
        configured: Boolean(config.sandboxKeyId && config.teamId && config.sandboxPrivateKey),
        credential_source: config.sandboxUsesProductionCredential ? "production_compatible_key" : "sandbox_key",
      },
    },
    devices: devices.rows[0] ?? { active: 0, total: 0 },
    deliveries: deliveries.rows,
    verification: providerVerification,
    limits: {
      max_active_devices_per_user: integerEnv("APNS_MAX_ACTIVE_DEVICES_PER_USER", 8, 1, 20),
      max_device_records_per_user: integerEnv("APNS_MAX_DEVICE_RECORDS_PER_USER", 64, 8, 256),
      materialization_batch_size: integerEnv("APNS_MATERIALIZATION_BATCH_SIZE", 500, 10, 2_000),
    },
    semantics: "accepted means APNs accepted the request; it does not mean the user saw it.",
  };
}

export function startApnsDeliveryWorker() {
  if (workerTimer || !flag("APNS_DELIVERY_ENABLED")) return;
  const tick = () => {
    if (workerRunning) return;
    workerRunning = true;
    void withWorkerLease("apns-delivery", 120, runWorkerCycle)
      .catch((error) => console.error(JSON.stringify({
        event: "apns_delivery_worker_failed",
        message: error instanceof Error ? error.message : String(error),
      })))
      .finally(() => { workerRunning = false; });
  };
  tick();
  workerTimer = setInterval(tick, integerEnv("APNS_WORKER_POLL_SECONDS", 15, 5, 300) * 1_000);
  workerTimer.unref();
}
