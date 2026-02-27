"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireRole = requireRole;
const node_crypto_1 = __importDefault(require("node:crypto"));
const express_1 = __importDefault(require("express"));
const cookie_1 = __importDefault(require("cookie"));
const openid_client_1 = require("openid-client");
const db_1 = require("./db");
const authRouter = express_1.default.Router();
const issuerCache = new Map();
const clientCache = new Map();
let ensureAuthStateTablePromise = null;
function optionalEnv(name) {
    const value = process.env[name];
    return value ? value : undefined;
}
function requiredEnv(name) {
    const value = optionalEnv(name);
    if (!value)
        throw new Error(`Missing required env: ${name}`);
    return value;
}
function getEnabledProviders() {
    const configured = (optionalEnv("AUTH_PROVIDERS") || "google,microsoft,apple")
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean);
    const out = [];
    for (const p of configured) {
        if (p === "google" || p === "microsoft" || p === "apple")
            out.push(p);
    }
    return out;
}
function isKeycloakConfigured() {
    return !!(optionalEnv("AUTH_ISSUER_URL") && optionalEnv("AUTH_KEYCLOAK_CLIENT_ID"));
}
function getKeycloakScope() {
    return optionalEnv("AUTH_KEYCLOAK_SCOPE") || "openid profile email";
}
function getKeycloakIdpHint(provider) {
    const envKey = `AUTH_KEYCLOAK_IDP_HINT_${provider.toUpperCase()}`;
    return optionalEnv(envKey) || provider;
}
function parseHeader(req, name) {
    const value = req.headers[name];
    if (!value)
        return undefined;
    if (Array.isArray(value))
        return value[0];
    return value.split(",")[0]?.trim();
}
function getAuthBaseUrl(req) {
    const configured = optionalEnv("AUTH_BASE_URL");
    if (configured)
        return configured.replace(/\/+$/, "");
    const proto = parseHeader(req, "x-forwarded-proto") || req.protocol;
    const host = parseHeader(req, "x-forwarded-host") || req.get("host");
    if (!host)
        throw new Error("Missing host for redirect URL");
    return `${proto}://${host}`;
}
function getRedirectUri(req, provider) {
    return `${getAuthBaseUrl(req)}/api/auth/${provider}/callback`;
}
function getAllowedRedirects() {
    return (optionalEnv("AUTH_ALLOWED_REDIRECTS") || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
}
function getAllowedRedirectSchemes() {
    return (optionalEnv("AUTH_ALLOWED_REDIRECT_SCHEMES") || "claritas")
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean);
}
function resolveRedirectUrl(candidate, fallback) {
    if (!candidate)
        return fallback;
    const allowlist = getAllowedRedirects();
    const allowedSchemes = getAllowedRedirectSchemes();
    if (candidate.startsWith("/") && !candidate.startsWith("//")) {
        if (!fallback)
            return candidate;
        try {
            const base = new URL(fallback);
            return `${base.origin}${candidate}`;
        }
        catch {
            return fallback;
        }
    }
    try {
        const url = new URL(candidate);
        const scheme = url.protocol.replace(":", "").toLowerCase();
        if (allowlist.some((prefix) => candidate.startsWith(prefix)))
            return candidate;
        if (scheme && scheme !== "http" && scheme !== "https") {
            return allowedSchemes.includes(scheme) ? candidate : fallback;
        }
        if (fallback) {
            const base = new URL(fallback);
            if (url.origin === base.origin)
                return candidate;
        }
    }
    catch {
        return fallback;
    }
    return fallback;
}
function getCookieName() {
    return optionalEnv("AUTH_COOKIE_NAME") || "claritas_session";
}
function getSessionTtlMs() {
    const days = parseInt(optionalEnv("AUTH_SESSION_TTL_DAYS") || "30", 10);
    return Math.max(days, 1) * 24 * 60 * 60 * 1000;
}
function getStateTtlMs() {
    const minutes = parseInt(optionalEnv("AUTH_STATE_TTL_MINUTES") || "10", 10);
    return Math.max(minutes, 1) * 60 * 1000;
}
function getTokenEndpointAuthMethod() {
    return optionalEnv("AUTH_KEYCLOAK_CLIENT_SECRET") ? "client_secret_post" : "none";
}
async function getIssuer() {
    const issuerUrl = requiredEnv("AUTH_ISSUER_URL");
    if (!issuerCache.has(issuerUrl)) {
        issuerCache.set(issuerUrl, openid_client_1.Issuer.discover(issuerUrl));
    }
    return issuerCache.get(issuerUrl);
}
async function getClient(redirectUri) {
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
    return clientCache.get(cacheKey);
}
function hashToken(token) {
    return node_crypto_1.default.createHash("sha256").update(token).digest("hex");
}
async function insertAuthState(provider, state, nonce, codeVerifier, redirectUrl) {
    await ensureAuthStateTable();
    const expiresAt = new Date(Date.now() + getStateTtlMs()).toISOString();
    await (0, db_1.query)(`INSERT INTO auth_state (provider, state, nonce, code_verifier, redirect_url, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`, [provider, state, nonce, codeVerifier, redirectUrl || null, expiresAt]);
}
async function consumeAuthState(state) {
    await ensureAuthStateTable();
    return (0, db_1.withTransaction)(async (client) => {
        await client.query(`DELETE FROM auth_state WHERE expires_at < now()`);
        const { rows } = await client.query(`DELETE FROM auth_state
       WHERE state = $1
         AND expires_at >= now()
       RETURNING provider, state, nonce, code_verifier, redirect_url, expires_at`, [state]);
        return rows[0] || null;
    });
}
async function ensureAuthStateTable() {
    if (!ensureAuthStateTablePromise) {
        ensureAuthStateTablePromise = (async () => {
            await (0, db_1.query)(`
        CREATE TABLE IF NOT EXISTS auth_state (
          id BIGSERIAL PRIMARY KEY,
          provider TEXT NOT NULL,
          state TEXT NOT NULL UNIQUE,
          nonce TEXT NOT NULL,
          code_verifier TEXT NOT NULL,
          redirect_url TEXT,
          created_at TIMESTAMPTZ DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL
        )
      `);
            await (0, db_1.query)(`CREATE INDEX IF NOT EXISTS auth_state_expires_idx ON auth_state (expires_at)`);
        })().catch((err) => {
            ensureAuthStateTablePromise = null;
            throw err;
        });
    }
    await ensureAuthStateTablePromise;
}
async function ensureUserFromClaims(provider, claims) {
    const providerSubject = typeof claims.sub === "string" ? claims.sub : "";
    if (!providerSubject)
        throw new Error("Missing subject claim from token");
    const email = (claims.email || null);
    const emailVerified = claims.email_verified === true ||
        (typeof claims.email_verified === "string" && claims.email_verified.toLowerCase() === "true");
    const displayName = (claims.name || null);
    const avatarUrl = (claims.picture || null);
    return (0, db_1.withTransaction)(async (client) => {
        const { rows: existing } = await client.query(`SELECT user_id AS id FROM auth_identity WHERE provider = $1 AND provider_subject = $2`, [provider, providerSubject]);
        let userId = existing[0]?.id;
        if (!userId && email && emailVerified) {
            const { rows: byEmail } = await client.query(`SELECT id FROM app_user WHERE lower(email) = lower($1)`, [email]);
            userId = byEmail[0]?.id;
        }
        if (!userId) {
            const { rows: created } = await client.query(`INSERT INTO app_user (email, email_verified, display_name, avatar_url)
         VALUES ($1, $2, $3, $4)
         RETURNING id`, [email, emailVerified, displayName, avatarUrl]);
            userId = created[0].id;
            const { rows: roleRows } = await client.query(`SELECT id FROM auth_role WHERE key = 'user' LIMIT 1`);
            const roleId = roleRows[0]?.id;
            if (roleId) {
                await client.query(`INSERT INTO auth_user_role (user_id, role_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`, [userId, roleId]);
            }
        }
        else if (displayName || avatarUrl || emailVerified) {
            await client.query(`UPDATE app_user
         SET display_name = COALESCE($2, display_name),
             avatar_url = COALESCE($3, avatar_url),
             email_verified = email_verified OR $4
         WHERE id = $1`, [userId, displayName, avatarUrl, emailVerified]);
        }
        await client.query(`INSERT INTO auth_identity (user_id, provider, provider_subject, email, email_verified, name, picture_url, profile)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (provider, provider_subject)
       DO UPDATE SET
         email = EXCLUDED.email,
         email_verified = EXCLUDED.email_verified,
         name = EXCLUDED.name,
         picture_url = EXCLUDED.picture_url,
         profile = EXCLUDED.profile,
         updated_at = now()`, [userId, provider, providerSubject, email, emailVerified, displayName, avatarUrl, JSON.stringify(claims)]);
        return { userId };
    });
}
async function createSession(userId, req) {
    const token = node_crypto_1.default.randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + getSessionTtlMs()).toISOString();
    const ip = parseHeader(req, "x-forwarded-for") || req.socket.remoteAddress || null;
    const userAgent = req.get("user-agent") || null;
    const { rows } = await (0, db_1.query)(`INSERT INTO auth_session (user_id, session_token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`, [userId, tokenHash, expiresAt, ip, userAgent]);
    return { token, sessionId: rows[0].id, expiresAt };
}
function getAuthToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.slice("Bearer ".length).trim();
    }
    const cookies = cookie_1.default.parse(req.headers.cookie || "");
    return cookies[getCookieName()];
}
async function getAuthContext(req) {
    const token = getAuthToken(req);
    if (!token)
        return null;
    const tokenHash = hashToken(token);
    const { rows } = await (0, db_1.query)(`SELECT s.id AS session_id,
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
     GROUP BY s.id, u.id`, [tokenHash]);
    const row = rows[0];
    if (!row)
        return null;
    await (0, db_1.query)(`UPDATE auth_session SET last_seen_at = now() WHERE id = $1`, [row.session_id]);
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
function setSessionCookie(res, token, expiresAt) {
    const secureEnv = optionalEnv("AUTH_COOKIE_SECURE");
    const secureDefault = optionalEnv("NODE_ENV") === "production";
    const secure = secureEnv ? secureEnv.toLowerCase() === "true" : secureDefault;
    const cookieValue = cookie_1.default.serialize(getCookieName(), token, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        expires: new Date(expiresAt),
    });
    res.setHeader("Set-Cookie", cookieValue);
}
function clearSessionCookie(res) {
    const secureEnv = optionalEnv("AUTH_COOKIE_SECURE");
    const secureDefault = optionalEnv("NODE_ENV") === "production";
    const secure = secureEnv ? secureEnv.toLowerCase() === "true" : secureDefault;
    const cookieValue = cookie_1.default.serialize(getCookieName(), "", {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: 0,
    });
    res.setHeader("Set-Cookie", cookieValue);
}
authRouter.get("/providers", (_req, res) => {
    const enabledProviders = new Set(getEnabledProviders());
    const allProviders = ["google", "microsoft", "apple"];
    const providers = allProviders.map((id) => ({
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
        const provider = req.params.provider;
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
        const state = openid_client_1.generators.state();
        const nonce = openid_client_1.generators.nonce();
        const codeVerifier = openid_client_1.generators.codeVerifier();
        const codeChallenge = openid_client_1.generators.codeChallenge(codeVerifier);
        const successFallback = optionalEnv("AUTH_SUCCESS_REDIRECT_URL");
        const redirectCandidate = typeof req.query.redirect === "string" ? req.query.redirect : undefined;
        const redirectUrl = resolveRedirectUrl(redirectCandidate, successFallback);
        await insertAuthState(provider, state, nonce, codeVerifier, redirectUrl);
        const authUrl = client.authorizationUrl({
            scope: getKeycloakScope(),
            state,
            nonce,
            redirect_uri: redirectUri,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            kc_idp_hint: getKeycloakIdpHint(provider),
        });
        return res.redirect(authUrl);
    }
    catch (err) {
        return res.status(500).json({ error: err.message || String(err) });
    }
});
async function handleAuthCallback(req, res) {
    try {
        const provider = req.params.provider;
        if (!["google", "microsoft", "apple"].includes(provider)) {
            return res.status(404).json({ error: "unknown provider" });
        }
        const redirectUri = getRedirectUri(req, provider);
        const client = await getClient(redirectUri);
        const params = client.callbackParams(req);
        const stateParam = typeof params.state === "string" ? params.state : "";
        if (!stateParam)
            return res.status(400).json({ error: "missing state" });
        const authState = await consumeAuthState(stateParam);
        if (!authState)
            return res.status(400).json({ error: "invalid state" });
        if (authState.provider !== provider)
            return res.status(400).json({ error: "state/provider mismatch" });
        const tokenSet = await client.callback(redirectUri, params, {
            state: authState.state,
            nonce: authState.nonce,
            code_verifier: authState.code_verifier,
        });
        const claims = tokenSet.claims();
        const { userId } = await ensureUserFromClaims(provider, claims);
        const session = await createSession(userId, req);
        setSessionCookie(res, session.token, session.expiresAt);
        const successRedirect = authState.redirect_url || optionalEnv("AUTH_SUCCESS_REDIRECT_URL");
        if (successRedirect) {
            let redirectTarget = successRedirect;
            if (!/^https?:\/\//i.test(successRedirect)) {
                try {
                    const url = new URL(successRedirect);
                    url.searchParams.set("token", session.token);
                    url.searchParams.set("expires_at", session.expiresAt);
                    redirectTarget = url.toString();
                }
                catch {
                    redirectTarget = successRedirect;
                }
            }
            return res.redirect(303, redirectTarget);
        }
        return res.json({ ok: true, session: { expires_at: session.expiresAt } });
    }
    catch (err) {
        const failureRedirect = optionalEnv("AUTH_FAILURE_REDIRECT_URL");
        if (failureRedirect)
            return res.redirect(303, failureRedirect);
        return res.status(500).json({ error: err.message || String(err) });
    }
}
authRouter.get("/:provider/callback", handleAuthCallback);
authRouter.post("/:provider/callback", handleAuthCallback);
authRouter.get("/me", async (req, res) => {
    try {
        const auth = await getAuthContext(req);
        if (!auth)
            return res.status(401).json({ error: "unauthorized" });
        return res.json({ user: auth.user });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || String(err) });
    }
});
authRouter.post("/logout", async (req, res) => {
    try {
        const token = getAuthToken(req);
        if (token) {
            const tokenHash = hashToken(token);
            await (0, db_1.query)(`UPDATE auth_session
         SET revoked_at = now()
         WHERE session_token_hash = $1
           AND revoked_at IS NULL`, [tokenHash]);
        }
        clearSessionCookie(res);
        return res.json({ ok: true });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || String(err) });
    }
});
function requireAuth() {
    return async (req, res, next) => {
        try {
            const auth = await getAuthContext(req);
            if (!auth)
                return res.status(401).json({ error: "unauthorized" });
            res.locals.auth = auth;
            return next();
        }
        catch (err) {
            return res.status(500).json({ error: err.message || String(err) });
        }
    };
}
function requireRole(role) {
    return async (req, res, next) => {
        try {
            const auth = await getAuthContext(req);
            if (!auth)
                return res.status(401).json({ error: "unauthorized" });
            if (!auth.user.roles.includes(role))
                return res.status(403).json({ error: "forbidden" });
            res.locals.auth = auth;
            return next();
        }
        catch (err) {
            return res.status(500).json({ error: err.message || String(err) });
        }
    };
}
exports.default = authRouter;
