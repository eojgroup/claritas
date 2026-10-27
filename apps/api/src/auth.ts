import crypto from "node:crypto";
import express from "express";
import cookie from "cookie";
import { Issuer, generators, type Client } from "openid-client";
import type { Request } from "express";
import { isDatabaseUnavailableError, query, withTransaction } from "./db";
import { resolveBillingAccessState, type BillingAccessState } from "./billing";
import {
  buildNativeHandoffRedirect,
  deriveS256CodeChallenge,
  isValidNativeCodeChallenge,
  isValidNativeCodeVerifier,
  isValidNativeHandoffCode,
  resolveAllowedAuthRedirect,
} from "./auth-security";

type ProviderName = "google" | "microsoft" | "apple";

type AuthStateRow = {
  provider: ProviderName;
  state: string;
  nonce: string;
  code_verifier: string;
  redirect_url: string | null;
  native_code_challenge: string | null;
  expires_at: string;
};

type AuthContext = {
  user: {
    id: number;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    roles: string[];
    billing: BillingAccessState;
  };
  sessionId: number;
};

type DailyBriefingScheduleRow = {
  user_id: number;
  enabled: boolean;
  email_enabled: boolean;
  email_theme: "light" | "dark";
  scheduled_time: string;
  schedule_timezone: string;
  industries: string[];
  company_symbols: string[];
  country_iso2s: string[];
  regions: string[];
  max_items: number;
  last_scheduled_for: string | Date | null;
  last_triggered_at: string | Date | null;
  last_job_id: string | null;
  last_personal_job_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

const authRouter = express.Router();

const issuerCache = new Map<string, Promise<Issuer>>();
const clientCache = new Map<string, Promise<Client>>();
let ensureAuthStateTablePromise: Promise<void> | null = null;

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value ? value : undefined;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function parseDatabaseId(value: number | string, field: string): number {
  const id = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid database identifier for ${field}.`);
  }
  return id;
}

function getEnabledProviders(): ProviderName[] {
  // Keep an unconfigured deployment honest: Keycloak can be reachable before
  // every broker has credentials, so the login screen must not advertise a
  // provider merely because its route exists. Production opts into additional
  // brokers explicitly through AUTH_PROVIDERS after their credentials land.
  const configured = (optionalEnv("AUTH_PROVIDERS") || "google")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  const out: ProviderName[] = [];
  for (const p of configured) {
    if (p === "google" || p === "microsoft" || p === "apple") out.push(p);
  }
  return out;
}

function isKeycloakConfigured(): boolean {
  return !!(optionalEnv("AUTH_ISSUER_URL") && optionalEnv("AUTH_KEYCLOAK_CLIENT_ID"));
}

function getKeycloakScope(): string {
  return optionalEnv("AUTH_KEYCLOAK_SCOPE") || "openid profile email";
}

function getKeycloakIdpHint(provider: ProviderName): string {
  const envKey = `AUTH_KEYCLOAK_IDP_HINT_${provider.toUpperCase()}`;
  return optionalEnv(envKey) || provider;
}

function parseHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (!value) return undefined;
  if (Array.isArray(value)) return value[0];
  return value.split(",")[0]?.trim();
}

function getAuthBaseUrl(req: Request): string {
  const configured = optionalEnv("AUTH_BASE_URL");
  if (configured) return configured.replace(/\/+$/, "");

  const proto = parseHeader(req, "x-forwarded-proto") || req.protocol;
  const host = parseHeader(req, "x-forwarded-host") || req.get("host");
  if (!host) throw new Error("Missing host for redirect URL");
  return `${proto}://${host}`;
}

function getRedirectUri(req: Request, provider: ProviderName): string {
  return `${getAuthBaseUrl(req)}/api/auth/${provider}/callback`;
}

function getAllowedRedirects(): string[] {
  return (optionalEnv("AUTH_ALLOWED_REDIRECTS") || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function getCookieName(): string {
  return optionalEnv("AUTH_COOKIE_NAME") || "claritas_session";
}

function getSessionTtlMs(): number {
  const days = parseInt(optionalEnv("AUTH_SESSION_TTL_DAYS") || "30", 10);
  return Math.max(days, 1) * 24 * 60 * 60 * 1000;
}

function getStateTtlMs(): number {
  const minutes = parseInt(optionalEnv("AUTH_STATE_TTL_MINUTES") || "10", 10);
  return Math.max(minutes, 1) * 60 * 1000;
}

function getNativeHandoffTtlMs(): number {
  const seconds = parseInt(optionalEnv("AUTH_NATIVE_HANDOFF_TTL_SECONDS") || "60", 10);
  return Math.min(Math.max(seconds || 60, 30), 300) * 1000;
}

function getTokenEndpointAuthMethod(): "none" | "client_secret_post" {
  return optionalEnv("AUTH_KEYCLOAK_CLIENT_SECRET") ? "client_secret_post" : "none";
}

async function getIssuer(): Promise<Issuer> {
  const issuerUrl = requiredEnv("AUTH_ISSUER_URL");
  if (!issuerCache.has(issuerUrl)) {
    issuerCache.set(issuerUrl, Issuer.discover(issuerUrl));
  }
  return issuerCache.get(issuerUrl)!;
}

async function getClient(redirectUri: string): Promise<Client> {
  const cacheKey = `${requiredEnv("AUTH_ISSUER_URL")}:${requiredEnv("AUTH_KEYCLOAK_CLIENT_ID")}:${redirectUri}`;
  if (!clientCache.has(cacheKey)) {
    const issuer = await getIssuer();
    const client = new issuer.Client({
      client_id: requiredEnv("AUTH_KEYCLOAK_CLIENT_ID"),
      client_secret: optionalEnv("AUTH_KEYCLOAK_CLIENT_SECRET"),
      redirect_uris: [redirectUri],
      response_types: ["code"],
      token_endpoint_auth_method: getTokenEndpointAuthMethod(),
    });
    clientCache.set(cacheKey, Promise.resolve(client));
  }
  return clientCache.get(cacheKey)!;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function insertAuthState(
  provider: ProviderName,
  state: string,
  nonce: string,
  codeVerifier: string,
  redirectUrl: string | undefined,
  browserBindingHash: string,
  nativeCodeChallenge: string | undefined
): Promise<string> {
  await ensureAuthStateTable();
  const expiresAt = new Date(Date.now() + getStateTtlMs()).toISOString();
  await query(
    `INSERT INTO auth_state (
       provider, state, nonce, code_verifier, redirect_url,
       browser_binding_hash, native_code_challenge, expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      provider,
      state,
      nonce,
      codeVerifier,
      redirectUrl || null,
      browserBindingHash,
      nativeCodeChallenge || null,
      expiresAt,
    ]
  );
  return expiresAt;
}

async function consumeAuthState(
  provider: ProviderName,
  state: string,
  browserBindingHash: string
): Promise<AuthStateRow | null> {
  await ensureAuthStateTable();
  return withTransaction(async (client) => {
    await client.query(`DELETE FROM auth_state WHERE expires_at < now()`);
    const { rows } = await client.query<AuthStateRow>(
      `DELETE FROM auth_state
       WHERE provider = $1
         AND state = $2
         AND browser_binding_hash = $3
         AND expires_at >= now()
       RETURNING provider, state, nonce, code_verifier, redirect_url,
                 native_code_challenge, expires_at`,
      [provider, state, browserBindingHash]
    );
    return rows[0] || null;
  });
}

async function createNativeHandoff(userId: number, codeChallenge: string): Promise<{ code: string; expiresAt: string }> {
  await ensureAuthStateTable();
  const code = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + getNativeHandoffTtlMs()).toISOString();
  await query(
    `INSERT INTO auth_native_handoff (code_hash, user_id, code_challenge, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hashToken(code), userId, codeChallenge, expiresAt]
  );
  return { code, expiresAt };
}

async function consumeNativeHandoff(code: string, codeVerifier: string): Promise<number | null> {
  await ensureAuthStateTable();
  const codeHash = hashToken(code);
  const codeChallenge = deriveS256CodeChallenge(codeVerifier);
  return withTransaction(async (client) => {
    await client.query(`DELETE FROM auth_native_handoff WHERE expires_at < now()`);
    const { rows } = await client.query<{ user_id: number | string }>(
      `DELETE FROM auth_native_handoff
       WHERE code_hash = $1
         AND code_challenge = $2
         AND expires_at >= now()
       RETURNING user_id`,
      [codeHash, codeChallenge]
    );
    return rows[0] ? parseDatabaseId(rows[0].user_id, "auth_native_handoff.user_id") : null;
  });
}

async function ensureAuthStateTable(): Promise<void> {
  if (!ensureAuthStateTablePromise) {
    ensureAuthStateTablePromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS auth_state (
          id BIGSERIAL PRIMARY KEY,
          provider TEXT NOT NULL,
          state TEXT NOT NULL UNIQUE,
          nonce TEXT NOT NULL,
          code_verifier TEXT NOT NULL,
          redirect_url TEXT,
          browser_binding_hash TEXT,
          native_code_challenge TEXT,
          created_at TIMESTAMPTZ DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL
        )
      `);
      await query(`ALTER TABLE auth_state ADD COLUMN IF NOT EXISTS browser_binding_hash TEXT`);
      await query(`ALTER TABLE auth_state ADD COLUMN IF NOT EXISTS native_code_challenge TEXT`);
      await query(`CREATE INDEX IF NOT EXISTS auth_state_expires_idx ON auth_state (expires_at)`);
      await query(`
        CREATE TABLE IF NOT EXISTS auth_native_handoff (
          id BIGSERIAL PRIMARY KEY,
          code_hash TEXT NOT NULL UNIQUE,
          user_id BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
          code_challenge TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL
        )
      `);
      await query(`CREATE INDEX IF NOT EXISTS auth_native_handoff_expires_idx ON auth_native_handoff (expires_at)`);
    })().catch((err) => {
      ensureAuthStateTablePromise = null;
      throw err;
    });
  }
  await ensureAuthStateTablePromise;
}

async function ensureUserFromClaims(provider: ProviderName, claims: Record<string, any>): Promise<{ userId: number }> {
  const providerSubject = typeof claims.sub === "string" ? claims.sub : "";
  if (!providerSubject) throw new Error("Missing subject claim from token");

  const email = (claims.email || null) as string | null;
  const emailVerified =
    claims.email_verified === true ||
    (typeof claims.email_verified === "string" && claims.email_verified.toLowerCase() === "true");
  const displayName = (claims.name || null) as string | null;
  const avatarUrl = (claims.picture || null) as string | null;
  const microsoftMultiTenant =
    provider === "microsoft" && optionalEnv("AUTH_MICROSOFT_MULTI_TENANT_ENABLED")?.toLowerCase() === "true";
  // Preserve the broker-reported email on auth_identity below, but do not put
  // a cross-tenant profile attribute into app_user's unique account-email key.
  const appUserEmail = microsoftMultiTenant ? null : email;
  const appUserEmailVerified = microsoftMultiTenant ? false : emailVerified;

  return withTransaction(async (client) => {
    const { rows: existing } = await client.query<{ id: number }>(
      `SELECT user_id AS id FROM auth_identity WHERE provider = $1 AND provider_subject = $2`,
      [provider, providerSubject]
    );

    let userId = existing[0]?.id;

    // Verified email is not a globally stable Microsoft identity key across
    // tenants. Multi-tenant mode therefore links only by the broker subject.
    if (!userId && email && emailVerified && !microsoftMultiTenant) {
      const { rows: byEmail } = await client.query<{ id: number }>(
        `SELECT id FROM app_user WHERE lower(email) = lower($1)`,
        [email]
      );
      userId = byEmail[0]?.id;
    }

    if (!userId) {
      const { rows: created } = await client.query<{ id: number }>(
        `INSERT INTO app_user (email, email_verified, display_name, avatar_url)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [appUserEmail, appUserEmailVerified, displayName, avatarUrl]
      );
      userId = created[0].id;

      const { rows: roleRows } = await client.query<{ id: number }>(`SELECT id FROM auth_role WHERE key = 'user' LIMIT 1`);
      const roleId = roleRows[0]?.id;
      if (roleId) {
        await client.query(
          `INSERT INTO auth_user_role (user_id, role_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [userId, roleId]
        );
      }
    } else if (displayName || avatarUrl || appUserEmailVerified) {
      await client.query(
        `UPDATE app_user
         SET display_name = COALESCE($2, display_name),
             avatar_url = COALESCE($3, avatar_url),
             email_verified = email_verified OR $4
         WHERE id = $1`,
        [userId, displayName, avatarUrl, appUserEmailVerified]
      );
    }

    await client.query(
      `INSERT INTO auth_identity (user_id, provider, provider_subject, email, email_verified, name, picture_url, profile)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (provider, provider_subject)
       DO UPDATE SET
         email = EXCLUDED.email,
         email_verified = EXCLUDED.email_verified,
         name = EXCLUDED.name,
         picture_url = EXCLUDED.picture_url,
         profile = EXCLUDED.profile,
         updated_at = now()`,
      [userId, provider, providerSubject, email, emailVerified, displayName, avatarUrl, JSON.stringify(claims)]
    );

    return { userId };
  });
}

async function createSession(userId: number, req: Request): Promise<{ token: string; sessionId: number; expiresAt: string }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + getSessionTtlMs()).toISOString();
  const ip = parseHeader(req, "x-forwarded-for") || req.socket.remoteAddress || null;
  const userAgent = req.get("user-agent") || null;

  const { rows } = await query<{ id: number }>(
    `INSERT INTO auth_session (user_id, session_token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, tokenHash, expiresAt, ip, userAgent]
  );

  return { token, sessionId: rows[0].id, expiresAt };
}

function getAuthToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  const cookies = cookie.parse(req.headers.cookie || "");
  return cookies[getCookieName()];
}

async function getAuthContext(req: Request): Promise<AuthContext | null> {
  const token = getAuthToken(req);
  if (!token) return null;
  const tokenHash = hashToken(token);

  const { rows } = await query<{
    session_id: number | string;
    user_id: number | string;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    roles: string[] | null;
    refresh_activity: boolean;
  }>(
    `SELECT s.id AS session_id,
            u.id AS user_id,
            u.email,
            u.display_name,
            u.avatar_url,
            (s.last_seen_at IS NULL OR s.last_seen_at <= now() - interval '1 minute') AS refresh_activity,
            ARRAY_REMOVE(ARRAY_AGG(r.key), NULL) AS roles
     FROM auth_session s
     JOIN app_user u ON u.id = s.user_id
     LEFT JOIN auth_user_role ur ON ur.user_id = u.id
     LEFT JOIN auth_role r ON r.id = ur.role_id
     WHERE s.session_token_hash = $1
       AND s.expires_at > now()
       AND s.revoked_at IS NULL
       AND u.is_active = true
     GROUP BY s.id, u.id`,
    [tokenHash]
  );

  const row = rows[0];
  if (!row) return null;
  // PostgreSQL BIGINT values are returned as strings by node-postgres by default.
  // Normalize them at the auth boundary so all protected handlers receive numeric IDs.
  const sessionId = parseDatabaseId(row.session_id, "auth_session.id");
  const userId = parseDatabaseId(row.user_id, "app_user.id");
  const roles = row.roles || [];
  const billing = await resolveBillingAccessState({
    userId,
    roles,
  });

  // A screen can make many parallel authenticated reads. Updating the same
  // session row for every read serializes them and competes with ingestion.
  // Only activity telemetry is throttled; validity, roles and paid access are
  // still checked against the database on every request. The predicate also
  // prevents concurrent refreshes / replicas from repeatedly writing the row.
  if (row.refresh_activity) {
    await query(
      `UPDATE auth_session SET last_seen_at = now()
       WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at <= now() - interval '1 minute')`,
      [sessionId],
    );
  }

  return {
    sessionId,
    user: {
      id: userId,
      email: row.email,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      roles,
      billing,
    },
  };
}

function useSecureAuthCookies(): boolean {
  if (optionalEnv("NODE_ENV") === "production") return true;
  const secureEnv = optionalEnv("AUTH_COOKIE_SECURE");
  return secureEnv?.toLowerCase() === "true";
}

function appendSetCookie(res: express.Response, value: string): void {
  res.append("Set-Cookie", value);
}

function getStateBindingCookieName(state: string): string {
  return `claritas_oauth_state_${hashToken(state).slice(0, 32)}`;
}

function getStateBindingCookie(req: Request, state: string): string | undefined {
  const cookies = cookie.parse(req.headers.cookie || "");
  return cookies[getStateBindingCookieName(state)];
}

function setStateBindingCookie(
  res: express.Response,
  provider: ProviderName,
  state: string,
  browserBinding: string,
  expiresAt: string
): void {
  appendSetCookie(res, cookie.serialize(getStateBindingCookieName(state), browserBinding, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureAuthCookies(),
    path: `/api/auth/${provider}/callback`,
    expires: new Date(expiresAt),
  }));
}

function clearStateBindingCookie(res: express.Response, provider: ProviderName, state: string): void {
  appendSetCookie(res, cookie.serialize(getStateBindingCookieName(state), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureAuthCookies(),
    path: `/api/auth/${provider}/callback`,
    expires: new Date(0),
    maxAge: 0,
  }));
}

function setSessionCookie(res: express.Response, token: string, expiresAt: string) {
  const cookieValue = cookie.serialize(getCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureAuthCookies(),
    path: "/",
    expires: new Date(expiresAt),
  });
  appendSetCookie(res, cookieValue);
}

function clearSessionCookie(res: express.Response) {
  const cookieValue = cookie.serialize(getCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureAuthCookies(),
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
  appendSetCookie(res, cookieValue);
}

function scheduleError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function asPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeScheduleTime(value: unknown): string {
  if (typeof value !== "string") throw scheduleError(400, "scheduled_time must use HH:mm.");
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) throw scheduleError(400, "scheduled_time must use HH:mm.");
  return `${match[1]}:${match[2]}`;
}

function normalizeScheduleTimezone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw scheduleError(400, "timezone is required.");
  const timezone = value.trim();
  if (timezone.length > 64) throw scheduleError(400, "timezone is too long.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw scheduleError(400, "timezone must be a valid IANA timezone.");
  }
  return timezone;
}

function normalizeScheduleSelectionList(
  value: unknown,
  fieldName: string,
  options: {
    maxItems: number;
    maxLength: number;
    uppercase?: boolean;
    pattern?: RegExp;
  }
): string[] {
  if (!Array.isArray(value)) {
    throw scheduleError(400, `${fieldName} must be an array of strings.`);
  }
  if (value.length > options.maxItems) {
    throw scheduleError(400, `${fieldName} supports at most ${options.maxItems} selections.`);
  }
  const values = value.map((entry) => {
    if (typeof entry !== "string") {
      throw scheduleError(400, `${fieldName} must contain only strings.`);
    }
    const trimmed = entry.replace(/\s+/g, " ").trim();
    if (!trimmed || trimmed.length > options.maxLength) {
      throw scheduleError(
        400,
        `${fieldName} values must be between 1 and ${options.maxLength} characters.`
      );
    }
    const normalized = options.uppercase ? trimmed.toUpperCase() : trimmed;
    if (options.pattern && !options.pattern.test(normalized)) {
      throw scheduleError(400, `${fieldName} contains an invalid value: ${trimmed}.`);
    }
    return normalized;
  });
  return Array.from(new Set(values));
}

function parseDailyBriefingSchedulePatch(raw: unknown): {
  enabled?: boolean;
  email_enabled?: boolean;
  email_theme?: "light" | "dark";
  scheduled_time?: string;
  schedule_timezone?: string;
  industries?: string[];
  company_symbols?: string[];
  country_iso2s?: string[];
  regions?: string[];
  max_items?: number;
} {
  const body = asPlainObject(raw);
  const patch: {
    enabled?: boolean;
    email_enabled?: boolean;
    email_theme?: "light" | "dark";
    scheduled_time?: string;
    schedule_timezone?: string;
    industries?: string[];
    company_symbols?: string[];
    country_iso2s?: string[];
    regions?: string[];
    max_items?: number;
  } = {};

  if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
    if (typeof body.enabled !== "boolean") throw scheduleError(400, "enabled must be a boolean.");
    patch.enabled = body.enabled;
  }

  if (Object.prototype.hasOwnProperty.call(body, "email_enabled")) {
    if (typeof body.email_enabled !== "boolean") {
      throw scheduleError(400, "email_enabled must be a boolean.");
    }
    patch.email_enabled = body.email_enabled;
  }

  if (Object.prototype.hasOwnProperty.call(body, "email_theme")) {
    if (body.email_theme !== "light" && body.email_theme !== "dark") {
      throw scheduleError(400, "email_theme must be light or dark.");
    }
    patch.email_theme = body.email_theme;
  }

  const scheduledTime = body.scheduled_time ?? body.schedule_time;
  if (typeof scheduledTime !== "undefined") {
    patch.scheduled_time = normalizeScheduleTime(scheduledTime);
  }

  const timezone = body.schedule_timezone ?? body.timezone;
  if (typeof timezone !== "undefined") {
    patch.schedule_timezone = normalizeScheduleTimezone(timezone);
  }

  if (Object.prototype.hasOwnProperty.call(body, "industries")) {
    patch.industries = normalizeScheduleSelectionList(body.industries, "industries", {
      maxItems: 20,
      maxLength: 80,
    });
  }
  if (Object.prototype.hasOwnProperty.call(body, "company_symbols")) {
    patch.company_symbols = normalizeScheduleSelectionList(
      body.company_symbols,
      "company_symbols",
      {
        maxItems: 50,
        maxLength: 16,
        uppercase: true,
        pattern: /^[A-Z0-9][A-Z0-9._-]*$/,
      }
    );
  }
  if (Object.prototype.hasOwnProperty.call(body, "country_iso2s")) {
    patch.country_iso2s = normalizeScheduleSelectionList(body.country_iso2s, "country_iso2s", {
      maxItems: 50,
      maxLength: 2,
      uppercase: true,
      pattern: /^[A-Z]{2}$/,
    });
  }
  if (Object.prototype.hasOwnProperty.call(body, "regions")) {
    patch.regions = normalizeScheduleSelectionList(body.regions, "regions", {
      maxItems: 20,
      maxLength: 80,
    });
  }
  if (Object.prototype.hasOwnProperty.call(body, "max_items")) {
    if (
      typeof body.max_items !== "number" ||
      !Number.isInteger(body.max_items) ||
      body.max_items < 3 ||
      body.max_items > 25
    ) {
      throw scheduleError(400, "max_items must be an integer between 3 and 25.");
    }
    patch.max_items = body.max_items;
  }

  return patch;
}

function timestampToApiString(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function dateToApiString(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function timeToApiString(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(11, 16);
  return value.slice(0, 5);
}

function toDailyBriefingSchedule(row: DailyBriefingScheduleRow) {
  return {
    user_id: Number(row.user_id),
    enabled: !!row.enabled,
    email_enabled: !!row.email_enabled,
    email_theme: row.email_theme === "light" ? "light" : "dark",
    scheduled_time: timeToApiString(row.scheduled_time),
    timezone: row.schedule_timezone,
    industries: Array.isArray(row.industries) ? row.industries : [],
    company_symbols: Array.isArray(row.company_symbols) ? row.company_symbols : [],
    country_iso2s: Array.isArray(row.country_iso2s) ? row.country_iso2s : [],
    regions: Array.isArray(row.regions) ? row.regions : [],
    max_items: Number(row.max_items) || 10,
    last_scheduled_for: dateToApiString(row.last_scheduled_for),
    last_triggered_at: timestampToApiString(row.last_triggered_at),
    last_job_id: row.last_job_id,
    last_personal_job_id: row.last_personal_job_id,
    created_at: timestampToApiString(row.created_at) || new Date().toISOString(),
    updated_at: timestampToApiString(row.updated_at) || new Date().toISOString(),
  };
}

async function ensureDailyBriefingSchedule(userId: number): Promise<void> {
  await query(
    `INSERT INTO user_daily_briefing_schedule (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

async function getDailyBriefingSchedule(userId: number) {
  await ensureDailyBriefingSchedule(userId);
  const { rows } = await query<DailyBriefingScheduleRow>(
    `SELECT
       user_id,
       enabled,
       email_enabled,
       email_theme,
       scheduled_time::text AS scheduled_time,
       schedule_timezone,
       industries,
       company_symbols,
       country_iso2s,
       regions,
       max_items,
       last_scheduled_for,
       last_triggered_at,
       last_job_id,
       last_personal_job_id,
       created_at,
       updated_at
     FROM user_daily_briefing_schedule
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  if (!rows[0]) throw scheduleError(500, "Failed to load daily briefing schedule.");
  return toDailyBriefingSchedule(rows[0]);
}

async function updateDailyBriefingSchedule(
  userId: number,
  patch: ReturnType<typeof parseDailyBriefingSchedulePatch>
) {
  await ensureDailyBriefingSchedule(userId);
  const { rows } = await query<DailyBriefingScheduleRow>(
    `UPDATE user_daily_briefing_schedule
     SET enabled = COALESCE($2, enabled),
         scheduled_time = COALESCE($3::time, scheduled_time),
         schedule_timezone = COALESCE($4, schedule_timezone),
         email_enabled = COALESCE($5, email_enabled),
         industries = COALESCE($6::text[], industries),
         company_symbols = COALESCE($7::text[], company_symbols),
         country_iso2s = COALESCE($8::text[], country_iso2s),
         regions = COALESCE($9::text[], regions),
         max_items = COALESCE($10::int, max_items),
         email_theme = COALESCE($11, email_theme),
         updated_at = now()
     WHERE user_id = $1
     RETURNING
       user_id,
       enabled,
       email_enabled,
       email_theme,
       scheduled_time::text AS scheduled_time,
       schedule_timezone,
       industries,
       company_symbols,
       country_iso2s,
       regions,
       max_items,
       last_scheduled_for,
       last_triggered_at,
       last_job_id,
       last_personal_job_id,
       created_at,
       updated_at`,
    [
      userId,
      typeof patch.enabled === "boolean" ? patch.enabled : null,
      patch.scheduled_time ?? null,
      patch.schedule_timezone ?? null,
      typeof patch.email_enabled === "boolean" ? patch.email_enabled : null,
      patch.industries ?? null,
      patch.company_symbols ?? null,
      patch.country_iso2s ?? null,
      patch.regions ?? null,
      patch.max_items ?? null,
      patch.email_theme ?? null,
    ]
  );
  if (!rows[0]) throw scheduleError(500, "Failed to update daily briefing schedule.");
  return toDailyBriefingSchedule(rows[0]);
}

async function handleAuthDailyBriefingScheduleError(res: express.Response, err: any) {
  if (typeof err?.status === "number") return res.status(err.status).json({ error: err.message });
  return res.status(500).json({ error: err?.message || String(err) });
}

authRouter.get("/providers", (_req, res) => {
  const enabledProviders = new Set(getEnabledProviders());
  const allProviders: ProviderName[] = ["google", "microsoft", "apple"];
  const providers: {
    id: ProviderName;
    enabled: boolean;
    display_name: string;
    icon: ProviderName;
    start_path: string;
  }[] = allProviders.map((id) => ({
    id,
    enabled: isKeycloakConfigured() && enabledProviders.has(id),
    display_name: id[0].toUpperCase() + id.slice(1),
    icon: id,
    start_path: `/api/auth/${id}/start`,
  }));
  res.json({ providers });
});

authRouter.get("/:provider/start", async (req, res) => {
  try {
    const provider = req.params.provider as ProviderName;
    if (!["google", "microsoft", "apple"].includes(provider)) {
      return res.status(404).json({ error: "unknown provider" });
    }
    if (!isKeycloakConfigured()) {
      return res.status(500).json({ error: "keycloak not configured" });
    }

    const enabled = new Set(getEnabledProviders());
    if (!enabled.has(provider)) {
      return res.status(400).json({ error: "provider disabled" });
    }

    const redirectUri = getRedirectUri(req, provider);
    const client = await getClient(redirectUri);
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    const successFallback = optionalEnv("AUTH_SUCCESS_REDIRECT_URL");
    const redirectCandidate = typeof req.query.redirect === "string" ? req.query.redirect : undefined;
    const resolvedRedirect = resolveAllowedAuthRedirect(redirectCandidate, successFallback, getAllowedRedirects());
    const nativeCodeChallenge = typeof req.query.native_code_challenge === "string"
      ? req.query.native_code_challenge
      : undefined;
    const nativeCodeChallengeMethod = typeof req.query.native_code_challenge_method === "string"
      ? req.query.native_code_challenge_method
      : undefined;

    if (resolvedRedirect?.kind === "native") {
      if (!nativeCodeChallenge || !isValidNativeCodeChallenge(nativeCodeChallenge)) {
        return res.status(400).json({ error: "native_code_challenge must be a valid S256 challenge" });
      }
      if (nativeCodeChallengeMethod !== "S256") {
        return res.status(400).json({ error: "native_code_challenge_method must be S256" });
      }
    } else if (nativeCodeChallenge || nativeCodeChallengeMethod) {
      return res.status(400).json({ error: "native PKCE parameters require an allowed custom redirect" });
    }

    const authUrl = client.authorizationUrl({
      scope: getKeycloakScope(),
      state,
      nonce,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      kc_idp_hint: getKeycloakIdpHint(provider),
      prompt: "login",
    });

    const browserBinding = crypto.randomBytes(32).toString("base64url");
    const expiresAt = await insertAuthState(
      provider,
      state,
      nonce,
      codeVerifier,
      resolvedRedirect?.url,
      hashToken(browserBinding),
      resolvedRedirect?.kind === "native" ? nativeCodeChallenge : undefined
    );
    setStateBindingCookie(res, provider, state, browserBinding, expiresAt);

    return res.redirect(authUrl);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

async function handleAuthCallback(req: express.Request, res: express.Response) {
  try {
    const provider = req.params.provider as ProviderName;
    if (!["google", "microsoft", "apple"].includes(provider)) {
      return res.status(404).json({ error: "unknown provider" });
    }

    const requestState = req.method === "POST" ? req.body?.state : req.query.state;
    const stateParam = typeof requestState === "string" ? requestState : "";
    if (!stateParam) return res.status(400).json({ error: "missing state" });

    const browserBinding = getStateBindingCookie(req, stateParam);
    if (!browserBinding) return res.status(400).json({ error: "invalid state" });

    const authState = await consumeAuthState(provider, stateParam, hashToken(browserBinding));
    clearStateBindingCookie(res, provider, stateParam);
    if (!authState) return res.status(400).json({ error: "invalid state" });

    const redirectUri = getRedirectUri(req, provider);
    const client = await getClient(redirectUri);
    const params = client.callbackParams(req);

    const tokenSet = await client.callback(redirectUri, params, {
      state: authState.state,
      nonce: authState.nonce,
      code_verifier: authState.code_verifier,
    });

    const claims = tokenSet.claims() as Record<string, any>;
    if (claims.identity_provider !== authState.provider) {
      throw new Error("Identity provider provenance did not match the initiated login.");
    }

    const { userId } = await ensureUserFromClaims(provider, claims);

    if (authState.native_code_challenge) {
      if (!authState.redirect_url) throw new Error("Native auth state omitted its callback URL.");
      const handoff = await createNativeHandoff(userId, authState.native_code_challenge);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      return res.redirect(303, buildNativeHandoffRedirect(authState.redirect_url, handoff.code));
    }

    const session = await createSession(userId, req);
    setSessionCookie(res, session.token, session.expiresAt);
    if (authState.redirect_url) return res.redirect(303, authState.redirect_url);
    return res.json({ ok: true, session: { expires_at: session.expiresAt } });
  } catch (err: any) {
    const failureRedirect = resolveAllowedAuthRedirect(
      undefined,
      optionalEnv("AUTH_FAILURE_REDIRECT_URL"),
      getAllowedRedirects()
    );
    if (failureRedirect) return res.redirect(303, failureRedirect.url);
    return res.status(500).json({ error: err.message || String(err) });
  }
}

authRouter.get("/:provider/callback", handleAuthCallback);
authRouter.post("/:provider/callback", handleAuthCallback);

authRouter.post("/handoff", async (req, res) => {
  try {
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const codeVerifier = typeof req.body?.code_verifier === "string" ? req.body.code_verifier : "";
    if (!isValidNativeHandoffCode(code) || !isValidNativeCodeVerifier(codeVerifier)) {
      return res.status(400).json({ error: "invalid handoff" });
    }

    const userId = await consumeNativeHandoff(code, codeVerifier);
    if (!userId) return res.status(400).json({ error: "invalid handoff" });

    const session = await createSession(userId, req);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    return res.json({ token: session.token, expires_at: session.expiresAt });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

authRouter.get("/me", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth) return res.status(401).json({ error: "unauthorized" });
    return res.json({ user: auth.user, billing: auth.user.billing });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

authRouter.get("/me/briefings/daily/schedule", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth) return res.status(401).json({ error: "unauthorized" });
    const schedule = await getDailyBriefingSchedule(auth.user.id);
    return res.json({ schedule });
  } catch (err: any) {
    return handleAuthDailyBriefingScheduleError(res, err);
  }
});

authRouter.put("/me/briefings/daily/schedule", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth) return res.status(401).json({ error: "unauthorized" });
    const patch = parseDailyBriefingSchedulePatch(req.body);
    const schedule = await updateDailyBriefingSchedule(auth.user.id, patch);
    return res.json({ schedule });
  } catch (err: any) {
    return handleAuthDailyBriefingScheduleError(res, err);
  }
});

authRouter.post("/logout", async (req, res) => {
  try {
    const token = getAuthToken(req);
    if (token) {
      const tokenHash = hashToken(token);
      await query(
        `UPDATE auth_session
         SET revoked_at = now()
         WHERE session_token_hash = $1
           AND revoked_at IS NULL`,
        [tokenHash]
      );
    }
    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export function requireAuth() {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const auth = await getAuthContext(req);
      if (!auth) return res.status(401).json({ error: "unauthorized" });
      res.locals.auth = auth;
      return next();
    } catch (err: any) {
      if (isDatabaseUnavailableError(err)) {
        res.setHeader("Retry-After", "5");
        return res.status(503).json({ error: "Data service is reconnecting. Retry shortly." });
      }
      return res.status(500).json({ error: err.message || String(err) });
    }
  };
}

export function requireRole(role: string) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const auth = await getAuthContext(req);
      if (!auth) return res.status(401).json({ error: "unauthorized" });
      if (!auth.user.roles.includes(role)) return res.status(403).json({ error: "forbidden" });
      res.locals.auth = auth;
      return next();
    } catch (err: any) {
      if (isDatabaseUnavailableError(err)) {
        res.setHeader("Retry-After", "5");
        return res.status(503).json({ error: "Data service is reconnecting. Retry shortly." });
      }
      return res.status(500).json({ error: err.message || String(err) });
    }
  };
}

export function requirePaidAccess() {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const auth = await getAuthContext(req);
      if (!auth) return res.status(401).json({ error: "unauthorized" });
      if (!auth.user.billing.has_access) {
        return res.status(402).json({
          error: "payment_required",
          billing: auth.user.billing,
        });
      }
      res.locals.auth = auth;
      return next();
    } catch (err: any) {
      if (isDatabaseUnavailableError(err)) {
        res.setHeader("Retry-After", "5");
        return res.status(503).json({ error: "Data service is reconnecting. Retry shortly." });
      }
      return res.status(500).json({ error: err.message || String(err) });
    }
  };
}

export default authRouter;
