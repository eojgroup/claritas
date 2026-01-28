import crypto from "node:crypto";
import express from "express";
import cookie from "cookie";
import jwt from "jsonwebtoken";
import { Issuer, generators, type Client, type ClientAuthMethod } from "openid-client";
import type { Request } from "express";
import { query, withTransaction } from "./db";

type ProviderName = "google" | "microsoft" | "apple";

type ProviderConfig = {
  name: ProviderName;
  discoveryUrl: string;
  scope: string;
  clientIdEnv: string;
  clientSecretEnv?: string;
  authParams?: Record<string, string>;
  tokenEndpointAuthMethod?: ClientAuthMethod;
};

const providerConfigs: Record<ProviderName, ProviderConfig> = {
  google: {
    name: "google",
    discoveryUrl: "https://accounts.google.com/.well-known/openid-configuration",
    scope: "openid email profile",
    clientIdEnv: "AUTH_GOOGLE_CLIENT_ID",
    clientSecretEnv: "AUTH_GOOGLE_CLIENT_SECRET",
    authParams: { prompt: "select_account" },
  },
  microsoft: {
    name: "microsoft",
    discoveryUrl: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_TENANT_ID || "common"}/v2.0/.well-known/openid-configuration`,
    scope: "openid email profile",
    clientIdEnv: "AUTH_MICROSOFT_CLIENT_ID",
    clientSecretEnv: "AUTH_MICROSOFT_CLIENT_SECRET",
  },
  apple: {
    name: "apple",
    discoveryUrl: "https://appleid.apple.com/.well-known/openid-configuration",
    scope: "openid email name",
    clientIdEnv: "AUTH_APPLE_CLIENT_ID",
    authParams: { response_mode: "form_post" },
    tokenEndpointAuthMethod: "client_secret_post",
  },
};

type AuthStateRow = {
  provider: ProviderName;
  state: string;
  nonce: string;
  code_verifier: string;
  redirect_url: string | null;
  expires_at: string;
};

type AuthContext = {
  user: {
    id: number;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    roles: string[];
  };
  sessionId: number;
};

const issuerCache = new Map<ProviderName, Promise<Issuer>>();
const clientCache = new Map<string, Promise<Client>>();

const authRouter = express.Router();

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value ? value : undefined;
}

function parseHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (!value) return undefined;
  if (Array.isArray(value)) return value[0];
  return value.split(",")[0]?.trim();
}

function getAuthBaseUrl(req: Request): string {
  const base = optionalEnv("AUTH_BASE_URL");
  if (base) return base.replace(/\/+$/, "");
  const proto = parseHeader(req, "x-forwarded-proto") || req.protocol;
  const host = parseHeader(req, "x-forwarded-host") || req.get("host");
  if (!host) throw new Error("Missing host for redirect URL");
  return `${proto}://${host}`;
}

function getRedirectUri(req: Request, provider: ProviderName): string {
  const base = getAuthBaseUrl(req);
  return `${base}/api/auth/${provider}/callback`;
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

function getAllowedRedirects(): string[] {
  return (optionalEnv("AUTH_ALLOWED_REDIRECTS") || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function resolveRedirectUrl(candidate: string | undefined, fallback: string | undefined): string | undefined {
  if (!candidate) return fallback;
  const allowlist = getAllowedRedirects();
  if (candidate.startsWith("/") && !candidate.startsWith("//")) {
    if (fallback) {
      try {
        const base = new URL(fallback);
        return `${base.origin}${candidate}`;
      } catch {
        return fallback;
      }
    }
    return candidate;
  }
  try {
    const url = new URL(candidate);
    if (allowlist.some((prefix) => candidate.startsWith(prefix))) return candidate;
    if (fallback) {
      try {
        const base = new URL(fallback);
        if (url.origin === base.origin) return candidate;
      } catch {
        return fallback;
      }
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function isProviderConfigured(provider: ProviderName): boolean {
  const cfg = providerConfigs[provider];
  if (!optionalEnv(cfg.clientIdEnv)) return false;
  if (provider !== "apple" && cfg.clientSecretEnv && !optionalEnv(cfg.clientSecretEnv)) return false;
  if (provider === "apple") {
    return !!(
      optionalEnv("AUTH_APPLE_TEAM_ID") &&
      optionalEnv("AUTH_APPLE_KEY_ID") &&
      optionalEnv("AUTH_APPLE_PRIVATE_KEY")
    );
  }
  return true;
}

type AppleSecretCache = { token: string; expiresAt: number };
let appleSecretCache: AppleSecretCache | null = null;

function getAppleClientSecret(): string {
  const now = Math.floor(Date.now() / 1000);
  if (appleSecretCache && appleSecretCache.expiresAt - 120 > now) {
    return appleSecretCache.token;
  }

  const teamId = requiredEnv("AUTH_APPLE_TEAM_ID");
  const keyId = requiredEnv("AUTH_APPLE_KEY_ID");
  const clientId = requiredEnv("AUTH_APPLE_CLIENT_ID");
  const privateKey = requiredEnv("AUTH_APPLE_PRIVATE_KEY").replace(/\\n/g, "\n");

  const token = jwt.sign(
    {},
    privateKey,
    {
      algorithm: "ES256",
      keyid: keyId,
      issuer: teamId,
      audience: "https://appleid.apple.com",
      subject: clientId,
      expiresIn: 60 * 60 * 24 * 180,
    }
  );
  const decoded = jwt.decode(token, { complete: true });
  const exp = typeof decoded === "object" && decoded && typeof decoded.payload === "object"
    ? (decoded.payload as { exp?: number }).exp
    : undefined;

  appleSecretCache = {
    token,
    expiresAt: exp || now + 60 * 60 * 24 * 180,
  };
  return token;
}

async function getIssuer(provider: ProviderName): Promise<Issuer> {
  if (!issuerCache.has(provider)) {
    issuerCache.set(provider, Issuer.discover(providerConfigs[provider].discoveryUrl));
  }
  return issuerCache.get(provider)!;
}

async function getClient(provider: ProviderName, redirectUri: string): Promise<Client> {
  const cacheKey = `${provider}:${redirectUri}`;
  if (!clientCache.has(cacheKey)) {
    const cfg = providerConfigs[provider];
    const clientId = requiredEnv(cfg.clientIdEnv);
    const clientSecret = cfg.clientSecretEnv ? requiredEnv(cfg.clientSecretEnv) : undefined;
    const issuer = await getIssuer(provider);
    const client = new issuer.Client({
      client_id: clientId,
      client_secret: provider === "apple" ? getAppleClientSecret() : clientSecret,
      redirect_uris: [redirectUri],
      response_types: ["code"],
      token_endpoint_auth_method: cfg.tokenEndpointAuthMethod,
    });
    clientCache.set(cacheKey, Promise.resolve(client));
  }
  return clientCache.get(cacheKey)!;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function insertAuthState(provider: ProviderName, state: string, nonce: string, codeVerifier: string, redirectUrl: string | undefined) {
  const expiresAt = new Date(Date.now() + getStateTtlMs()).toISOString();
  await query(
    `INSERT INTO auth_state (provider, state, nonce, code_verifier, redirect_url, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [provider, state, nonce, codeVerifier, redirectUrl || null, expiresAt]
  );
}

async function consumeAuthState(state: string): Promise<AuthStateRow | null> {
  return withTransaction(async (client) => {
    await client.query(`DELETE FROM auth_state WHERE expires_at < now()`);
    const { rows } = await client.query<AuthStateRow>(
      `DELETE FROM auth_state
       WHERE state = $1
         AND expires_at >= now()
       RETURNING provider, state, nonce, code_verifier, redirect_url, expires_at`,
      [state]
    );
    return rows[0] || null;
  });
}

async function ensureUserFromClaims(provider: ProviderName, claims: Record<string, any>, profile: Record<string, any>): Promise<{ userId: number }> {
  const providerSubject = typeof claims.sub === "string" ? claims.sub : "";
  if (!providerSubject) throw new Error("Missing subject claim from provider");

  const email = (claims.email || claims.preferred_username || null) as string | null;
  const emailVerified =
    claims.email_verified === true ||
    (typeof claims.email_verified === "string" && claims.email_verified.toLowerCase() === "true");
  const displayName = (claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(" ") || null) as string | null;
  const avatarUrl = (claims.picture || null) as string | null;

  return withTransaction(async (client) => {
    const { rows: existing } = await client.query<{ id: number }>(
      `SELECT user_id AS id FROM auth_identity WHERE provider = $1 AND provider_subject = $2`,
      [provider, providerSubject]
    );
    let userId = existing[0]?.id;

    if (!userId && email && emailVerified) {
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
        [email, emailVerified, displayName, avatarUrl]
      );
      userId = created[0].id;

      const { rows: roleRows } = await client.query<{ id: number }>(
        `SELECT id FROM auth_role WHERE key = 'user' LIMIT 1`
      );
      const roleId = roleRows[0]?.id;
      if (roleId) {
        await client.query(
          `INSERT INTO auth_user_role (user_id, role_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [userId, roleId]
        );
      }
    } else if (displayName || avatarUrl || emailVerified) {
      await client.query(
        `UPDATE app_user
         SET display_name = COALESCE($2, display_name),
             avatar_url = COALESCE($3, avatar_url),
             email_verified = email_verified OR $4
         WHERE id = $1`,
        [userId, displayName, avatarUrl, emailVerified]
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
      [userId, provider, providerSubject, email, emailVerified, displayName, avatarUrl, JSON.stringify(profile)]
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

async function getAuthContext(req: Request): Promise<AuthContext | null> {
  const token = getAuthToken(req);
  if (!token) return null;
  const tokenHash = hashToken(token);

  const { rows } = await query<{
    session_id: number;
    user_id: number;
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    roles: string[] | null;
  }>(
    `SELECT s.id AS session_id,
            u.id AS user_id,
            u.email,
            u.display_name,
            u.avatar_url,
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

  await query(`UPDATE auth_session SET last_seen_at = now() WHERE id = $1`, [row.session_id]);

  return {
    sessionId: row.session_id,
    user: {
      id: row.user_id,
      email: row.email,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      roles: row.roles || [],
    },
  };
}

function getAuthToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  const cookies = cookie.parse(req.headers.cookie || "");
  return cookies[getCookieName()];
}

function setSessionCookie(res: express.Response, token: string, expiresAt: string) {
  const secureEnv = optionalEnv("AUTH_COOKIE_SECURE");
  const secureDefault = optionalEnv("NODE_ENV") === "production";
  const secure = secureEnv ? secureEnv.toLowerCase() === "true" : secureDefault;
  const cookieValue = cookie.serialize(getCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: new Date(expiresAt),
  });
  res.setHeader("Set-Cookie", cookieValue);
}

function clearSessionCookie(res: express.Response) {
  const secureEnv = optionalEnv("AUTH_COOKIE_SECURE");
  const secureDefault = optionalEnv("NODE_ENV") === "production";
  const secure = secureEnv ? secureEnv.toLowerCase() === "true" : secureDefault;
  const cookieValue = cookie.serialize(getCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  res.setHeader("Set-Cookie", cookieValue);
}

authRouter.get("/providers", (_req, res) => {
  const providers = (Object.keys(providerConfigs) as ProviderName[]).map((provider) => ({
    id: provider,
    enabled: isProviderConfigured(provider),
  }));
  res.json({ providers });
});

authRouter.get("/:provider/start", async (req, res) => {
  try {
    const provider = req.params.provider as ProviderName;
    if (!providerConfigs[provider]) return res.status(404).json({ error: "unknown provider" });
    if (!isProviderConfigured(provider)) return res.status(400).json({ error: "provider not configured" });

    const redirectUri = getRedirectUri(req, provider);
    const client = await getClient(provider, redirectUri);
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    const successFallback = optionalEnv("AUTH_SUCCESS_REDIRECT_URL");
    const redirectCandidate = typeof req.query.redirect === "string" ? req.query.redirect : undefined;
    const redirectUrl = resolveRedirectUrl(redirectCandidate, successFallback);

    await insertAuthState(provider, state, nonce, codeVerifier, redirectUrl);

    const authUrl = client.authorizationUrl({
      scope: providerConfigs[provider].scope,
      state,
      nonce,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      ...providerConfigs[provider].authParams,
    });

    res.redirect(authUrl);
  } catch (err: any) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

async function handleAuthCallback(req: express.Request, res: express.Response) {
  try {
    const provider = req.params.provider as ProviderName;
    if (!providerConfigs[provider]) return res.status(404).json({ error: "unknown provider" });
    if (!isProviderConfigured(provider)) return res.status(400).json({ error: "provider not configured" });

    const redirectUri = getRedirectUri(req, provider);
    const client = await getClient(provider, redirectUri);
    if (provider === "apple") {
      client.client_secret = getAppleClientSecret();
    }

    const params = client.callbackParams(req);
    const stateParam = typeof params.state === "string" ? params.state : "";
    if (!stateParam) return res.status(400).json({ error: "missing state" });

    const authState = await consumeAuthState(stateParam);
    if (!authState) return res.status(400).json({ error: "invalid state" });
    if (authState.provider !== provider) return res.status(400).json({ error: "state/provider mismatch" });

    const tokenSet = await client.callback(
      redirectUri,
      params,
      {
        state: authState.state,
        nonce: authState.nonce,
        code_verifier: authState.code_verifier,
      }
    );

    const claims = tokenSet.claims();
    const profile = { ...claims };

    const { userId } = await ensureUserFromClaims(provider, claims, profile);
    const session = await createSession(userId, req);
    setSessionCookie(res, session.token, session.expiresAt);

    const successRedirect = authState.redirect_url || optionalEnv("AUTH_SUCCESS_REDIRECT_URL");
    if (successRedirect) {
      let redirectTarget = successRedirect;
      // If redirecting to a custom scheme (mobile deep link), append session token details.
      if (!/^https?:\/\//i.test(successRedirect)) {
        try {
          const url = new URL(successRedirect);
          url.searchParams.set("token", session.token);
          url.searchParams.set("expires_at", session.expiresAt);
          redirectTarget = url.toString();
        } catch {
          // fall back to original redirect
          redirectTarget = successRedirect;
        }
      }
      return res.redirect(303, redirectTarget);
    }

    return res.json({ ok: true, session: { expires_at: session.expiresAt } });
  } catch (err: any) {
    const failureRedirect = optionalEnv("AUTH_FAILURE_REDIRECT_URL");
    if (failureRedirect) {
      return res.redirect(303, failureRedirect);
    }
    return res.status(500).json({ error: err.message || String(err) });
  }
}

authRouter.get("/:provider/callback", handleAuthCallback);
authRouter.post("/:provider/callback", handleAuthCallback);

authRouter.get("/me", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth) return res.status(401).json({ error: "unauthorized" });
    res.json({ user: auth.user });
  } catch (err: any) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

authRouter.post("/logout", async (req, res) => {
  try {
    const token = getAuthToken(req);
    if (token) {
      const tokenHash = hashToken(token);
      await query(`UPDATE auth_session SET revoked_at = now() WHERE session_token_hash = $1 AND revoked_at IS NULL`, [tokenHash]);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || String(err) });
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
      return res.status(500).json({ error: err.message || String(err) });
    }
  };
}

export default authRouter;
