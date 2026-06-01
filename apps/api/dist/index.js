"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const newsapi_1 = require("./connectors/newsapi");
const thenewsapi_1 = require("./connectors/thenewsapi");
const openweather_1 = require("./connectors/openweather");
const finnhub_1 = require("./connectors/finnhub");
const db_1 = require("./db");
const auth_1 = __importStar(require("./auth"));
const ingestion_admin_1 = require("./ingestion-admin");
const ingestion_automation_1 = require("./ingestion-automation");
const billing_1 = require("./billing");
const app = (0, express_1.default)();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
app.set("trust proxy", 1);
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: false }));
app.get("/api/hello", (_req, res) => res.json({ hello: "world" }));
app.use("/api/auth", auth_1.default);
const requireAdminRole = (0, auth_1.requireRole)("admin");
const requireSession = (0, auth_1.requireAuth)();
const requireAuthenticated = (0, auth_1.requirePaidAccess)();
class AdminApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const ADMIN_USER_BASE_SELECT = `
  SELECT
    u.id,
    u.email,
    u.display_name,
    u.avatar_url,
    u.is_active,
    u.created_at,
    u.updated_at,
    COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.key), NULL), '{}') AS roles,
    COALESCE(ARRAY_REMOVE(ARRAY_AGG(DISTINCT ai.provider), NULL), '{}') AS providers,
    MAX(s.last_seen_at) AS last_seen_at,
    bs_latest.subscription_id,
    bs_latest.subscription_status,
    bs_latest.subscription_provider,
    bs_latest.subscription_started_at,
    bs_latest.subscription_current_period_end,
    bs_latest.subscription_canceled_at,
    bs_latest.subscription_plan_code,
    bs_latest.subscription_plan_name
  FROM app_user u
  LEFT JOIN auth_user_role ur ON ur.user_id = u.id
  LEFT JOIN auth_role r ON r.id = ur.role_id
  LEFT JOIN auth_identity ai ON ai.user_id = u.id
  LEFT JOIN auth_session s ON s.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT
      bs.id AS subscription_id,
      bs.status AS subscription_status,
      bs.provider AS subscription_provider,
      bs.started_at AS subscription_started_at,
      bs.current_period_end AS subscription_current_period_end,
      bs.canceled_at AS subscription_canceled_at,
      bp.code AS subscription_plan_code,
      bp.name AS subscription_plan_name
    FROM billing_subscription bs
    JOIN billing_plan bp ON bp.id = bs.plan_id
    WHERE bs.user_id = u.id
    ORDER BY
      CASE
        WHEN bs.status IN ('active', 'trialing', 'grace_period') THEN 0
        WHEN bs.status = 'past_due' THEN 1
        ELSE 2
      END,
      COALESCE(bs.current_period_end, 'infinity'::timestamptz) DESC,
      bs.started_at DESC,
      bs.id DESC
    LIMIT 1
  ) bs_latest ON true
`;
function isValidRoleKey(key) {
    return /^[a-z][a-z0-9_-]{1,31}$/.test(key);
}
function normalizeRoleKeys(raw) {
    if (!Array.isArray(raw))
        throw new AdminApiError(400, "body.roles must be an array of role keys.");
    const keys = raw
        .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
        .filter(Boolean);
    for (const key of keys) {
        if (!isValidRoleKey(key))
            throw new AdminApiError(400, `Invalid role key: ${key}`);
    }
    return Array.from(new Set(keys)).sort();
}
function toAdminUser(row) {
    const subscription = row.subscription_id == null
        ? null
        : {
            id: row.subscription_id,
            status: row.subscription_status,
            provider: row.subscription_provider,
            started_at: row.subscription_started_at,
            current_period_end: row.subscription_current_period_end,
            canceled_at: row.subscription_canceled_at,
            plan: {
                code: row.subscription_plan_code,
                name: row.subscription_plan_name,
            },
        };
    return {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        is_active: row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
        roles: row.roles || [],
        providers: row.providers || [],
        last_seen_at: row.last_seen_at,
        subscription,
    };
}
async function getAdminUserById(userId) {
    const { rows } = await (0, db_1.query)(`${ADMIN_USER_BASE_SELECT}
     WHERE u.id = $1
     GROUP BY
       u.id,
       bs_latest.subscription_id,
       bs_latest.subscription_status,
       bs_latest.subscription_provider,
       bs_latest.subscription_started_at,
       bs_latest.subscription_current_period_end,
       bs_latest.subscription_canceled_at,
       bs_latest.subscription_plan_code,
       bs_latest.subscription_plan_name
     LIMIT 1`, [userId]);
    return rows[0] ? toAdminUser(rows[0]) : null;
}
async function getActiveAdminCountTx(client) {
    const { rows } = await client.query(`SELECT COUNT(DISTINCT ur.user_id)::int AS count
     FROM auth_user_role ur
     JOIN auth_role r ON r.id = ur.role_id
     JOIN app_user u ON u.id = ur.user_id
     WHERE r.key = 'admin'
       AND u.is_active = true`);
    return Number(rows[0]?.count || 0);
}
function parsePipeline(value) {
    if (value === "news" || value === "weather" || value === "market")
        return value;
    return undefined;
}
function timestampToApiString(value) {
    if (value == null)
        return null;
    if (value instanceof Date) {
        const ts = value.getTime();
        return Number.isNaN(ts) ? null : value.toISOString();
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed))
        return new Date(parsed).toISOString();
    return value;
}
function dateToApiString(value) {
    if (value instanceof Date)
        return value.toISOString().slice(0, 10);
    return value.slice(0, 10);
}
function parseBriefingDate(value) {
    if (typeof value !== "string" || !value.trim()) {
        throw new AdminApiError(400, "briefing_date is required.");
    }
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        throw new AdminApiError(400, "briefing_date must use YYYY-MM-DD.");
    }
    const parsed = Date.parse(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== trimmed) {
        throw new AdminApiError(400, "briefing_date must be a valid date.");
    }
    return trimmed;
}
function parseBriefingStatus(value) {
    if (value == null || value === "")
        return "draft";
    if (typeof value !== "string")
        throw new AdminApiError(400, "status must be draft, published, or archived.");
    const normalized = value.trim().toLowerCase();
    if (normalized === "draft" || normalized === "published" || normalized === "archived")
        return normalized;
    throw new AdminApiError(400, "status must be draft, published, or archived.");
}
function sanitizeBriefingPayload(raw) {
    const body = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw
        : {};
    const titleRaw = typeof body.title === "string" ? body.title.trim() : "";
    const updateRaw = typeof body.update_text === "string"
        ? body.update_text.trim()
        : typeof body.update === "string"
            ? body.update.trim()
            : "";
    const rawTakeaways = Array.isArray(body.key_takeaways)
        ? body.key_takeaways
        : Array.isArray(body.takeaways)
            ? body.takeaways
            : [];
    const keyTakeaways = rawTakeaways
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
        .slice(0, 12);
    const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {};
    return {
        title: titleRaw || "Daily signal brief",
        update_text: updateRaw,
        key_takeaways: keyTakeaways,
        status: parseBriefingStatus(body.status),
        source_window_start: parseOptionalIsoDateTime(body.source_window_start, "source_window_start") ?? null,
        source_window_end: parseOptionalIsoDateTime(body.source_window_end, "source_window_end") ?? null,
        generated_by: typeof body.generated_by === "string" && body.generated_by.trim() ? body.generated_by.trim() : null,
        metadata,
        published_at: parseOptionalIsoDateTime(body.published_at, "published_at") ?? null,
    };
}
function toDailySignalBriefing(row) {
    return {
        id: Number(row.id),
        briefing_date: dateToApiString(row.briefing_date),
        title: row.title,
        update_text: row.update_text,
        key_takeaways: Array.isArray(row.key_takeaways) ? row.key_takeaways : [],
        status: row.status,
        source_window_start: timestampToApiString(row.source_window_start),
        source_window_end: timestampToApiString(row.source_window_end),
        generated_by: row.generated_by,
        metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
        published_at: timestampToApiString(row.published_at),
        created_at: timestampToApiString(row.created_at) || new Date().toISOString(),
        updated_at: timestampToApiString(row.updated_at) || new Date().toISOString(),
    };
}
async function upsertDailySignalBriefing(briefingDate, payload) {
    const { rows } = await (0, db_1.query)(`INSERT INTO daily_signal_briefing (
       briefing_date,
       title,
       update_text,
       key_takeaways,
       status,
       source_window_start,
       source_window_end,
       generated_by,
       metadata,
       published_at
     )
     VALUES (
       $1::date,
       $2,
       $3,
       $4::jsonb,
       $5,
       $6,
       $7,
       $8,
       $9::jsonb,
       CASE WHEN $5 = 'published' THEN COALESCE($10::timestamptz, now()) ELSE $10::timestamptz END
     )
     ON CONFLICT (briefing_date)
     DO UPDATE SET
       title = EXCLUDED.title,
       update_text = EXCLUDED.update_text,
       key_takeaways = EXCLUDED.key_takeaways,
       status = EXCLUDED.status,
       source_window_start = EXCLUDED.source_window_start,
       source_window_end = EXCLUDED.source_window_end,
       generated_by = EXCLUDED.generated_by,
       metadata = EXCLUDED.metadata,
       published_at = CASE
         WHEN EXCLUDED.status = 'published'
           THEN COALESCE(EXCLUDED.published_at, daily_signal_briefing.published_at, now())
         ELSE EXCLUDED.published_at
       END,
       updated_at = now()
     RETURNING
       id,
       briefing_date,
       title,
       update_text,
       key_takeaways,
       status,
       source_window_start,
       source_window_end,
       generated_by,
       metadata,
       published_at,
       created_at,
       updated_at`, [
        briefingDate,
        payload.title,
        payload.update_text,
        JSON.stringify(payload.key_takeaways),
        payload.status,
        payload.source_window_start,
        payload.source_window_end,
        payload.generated_by,
        JSON.stringify(payload.metadata),
        payload.published_at,
    ]);
    if (!rows[0])
        throw new AdminApiError(500, "Failed to upsert daily briefing.");
    return toDailySignalBriefing(rows[0]);
}
function parseBillingStatus(value) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === "trialing" ||
        normalized === "active" ||
        normalized === "past_due" ||
        normalized === "grace_period" ||
        normalized === "canceled" ||
        normalized === "unpaid" ||
        normalized === "incomplete") {
        return normalized;
    }
    return undefined;
}
function parseOptionalIsoDateTime(value, fieldName) {
    if (typeof value === "undefined")
        return undefined;
    if (value === null || value === "")
        return null;
    if (typeof value !== "string") {
        throw new AdminApiError(400, `${fieldName} must be an ISO date-time string or null.`);
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
        throw new AdminApiError(400, `${fieldName} must be a valid date-time.`);
    }
    return new Date(parsed).toISOString();
}
function sanitizeAutomationPayload(value) {
    if (typeof value === "undefined")
        return undefined;
    if (value === null)
        return {};
    if (typeof value === "object" && !Array.isArray(value))
        return value;
    throw new AdminApiError(400, "default_payload must be an object.");
}
function getRequestActor(res) {
    const locals = res.locals;
    return {
        userId: typeof locals.auth?.user?.id === "number" ? locals.auth.user.id : null,
        email: typeof locals.auth?.user?.email === "string" ? locals.auth.user.email : null,
        triggerMode: "admin_ui",
    };
}
function requireIngestionAccess(req, res, next) {
    const sharedToken = process.env.INGEST_API_TOKEN;
    if (sharedToken) {
        const supplied = req.get("x-ingest-token");
        if (supplied && supplied === sharedToken)
            return next();
    }
    return requireAdminRole(req, res, next);
}
// Simple endpoint to test DB connectivity
app.get("/api/db/ping", async (_req, res) => {
    try {
        const { rows } = await db_1.pool.query("SELECT 1 as ok");
        res.json(rows[0]);
    }
    catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    }
});
app.get("/api/billing/me", requireSession, async (_req, res) => {
    try {
        const locals = res.locals;
        const billing = locals.auth?.user?.billing ?? null;
        const urls = (0, billing_1.getBillingPublicUrls)();
        return res.json({
            billing: billing || {
                paywall_enabled: false,
                has_access: true,
                reason: "paywall_disabled",
                checkout_url: urls.checkout_url,
                portal_url: urls.portal_url,
                subscription: null,
            },
        });
    }
    catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.get("/api/briefings/daily/latest", requireAuthenticated, async (_req, res) => {
    try {
        const { rows } = await (0, db_1.query)(`SELECT
         id,
         briefing_date,
         title,
         update_text,
         key_takeaways,
         status,
         source_window_start,
         source_window_end,
         generated_by,
         metadata,
         published_at,
         created_at,
         updated_at
       FROM daily_signal_briefing
       WHERE status = 'published'
       ORDER BY briefing_date DESC, updated_at DESC
       LIMIT 1`);
        return res.json({ briefing: rows[0] ? toDailySignalBriefing(rows[0]) : null });
    }
    catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.get("/api/admin/briefings/daily", requireAdminRole, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(String(req.query.limit || "20"), 10) || 20, 1), 100);
        const { rows } = await (0, db_1.query)(`SELECT
         id,
         briefing_date,
         title,
         update_text,
         key_takeaways,
         status,
         source_window_start,
         source_window_end,
         generated_by,
         metadata,
         published_at,
         created_at,
         updated_at
       FROM daily_signal_briefing
       ORDER BY briefing_date DESC, updated_at DESC
       LIMIT $1`, [limit]);
        return res.json({ briefings: rows.map(toDailySignalBriefing) });
    }
    catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.put("/api/admin/briefings/daily/:date", requireAdminRole, async (req, res) => {
    try {
        const briefingDate = parseBriefingDate(req.params.date);
        const payload = sanitizeBriefingPayload(req.body);
        const briefing = await upsertDailySignalBriefing(briefingDate, payload);
        return res.json({ briefing });
    }
    catch (e) {
        if (e instanceof AdminApiError)
            return res.status(e.status).json({ error: e.message });
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.put("/api/ingest/briefings/daily/:date", requireIngestionAccess, async (req, res) => {
    try {
        const briefingDate = parseBriefingDate(req.params.date);
        const payload = sanitizeBriefingPayload(req.body);
        const briefing = await upsertDailySignalBriefing(briefingDate, payload);
        return res.json({ briefing });
    }
    catch (e) {
        if (e instanceof AdminApiError)
            return res.status(e.status).json({ error: e.message });
        return res.status(500).json({ error: e.message || String(e) });
    }
});
// List recent news items with optional filters
app.get("/api/news", requireAuthenticated, async (req, res) => {
    try {
        (0, ingestion_automation_1.trackDemandSignal)("news");
        const limit = Math.min(Math.max(parseInt(String(req.query.limit || "20"), 10) || 20, 1), 200);
        const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);
        const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
        const country = typeof req.query.country === "string" ? req.query.country.trim().toUpperCase() : "";
        const params = [];
        const where = [];
        if (q) {
            const i1 = params.push(`%${q}%`); // returns new length as index
            const i2 = params.push(`%${q}%`);
            where.push(`(i.title ILIKE $${i1} OR i.summary ILIKE $${i2})`);
        }
        if (country) {
            const ci = params.push(country);
            where.push(`upper(i.country_iso2) = $${ci}`);
        }
        const li = params.push(limit);
        const oi = params.push(offset);
        const sql = `
      SELECT i.id, i.kind, i.title, i.summary, i.url, i.country_iso2, i.event_time, i.payload, s.name AS source_name
      FROM item i
      JOIN source s ON s.id = i.source_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY i.event_time DESC NULLS LAST, i.id DESC
      LIMIT $${li} OFFSET $${oi}
    `;
        const { rows } = await db_1.pool.query(sql, params);
        res.json({ items: rows });
    }
    catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    }
});
// Aggregate counts by country (for map bubbles)
app.get("/api/news/country-stats", requireAuthenticated, async (req, res) => {
    try {
        (0, ingestion_automation_1.trackDemandSignal)("news");
        const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 365);
        const params = [days];
        const { rows } = await db_1.pool.query(`SELECT country_iso2 AS country, COUNT(*)::int AS count
       FROM item
       WHERE country_iso2 IS NOT NULL
         AND (event_time IS NULL OR event_time >= now() - ($1 || ' days')::interval)
       GROUP BY country_iso2
       ORDER BY count DESC`, params);
        res.json({ stats: rows });
    }
    catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    }
});
// Admin user/role management
app.get("/api/admin/roles", requireAdminRole, async (_req, res) => {
    try {
        const { rows } = await (0, db_1.query)(`SELECT
         r.id,
         r.key,
         r.description,
         COUNT(ur.user_id)::int AS user_count
       FROM auth_role r
       LEFT JOIN auth_user_role ur ON ur.role_id = r.id
       GROUP BY r.id
       ORDER BY r.key ASC`);
        return res.json({ roles: rows });
    }
    catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.post("/api/admin/roles", requireAdminRole, async (req, res) => {
    try {
        const keyRaw = typeof req.body?.key === "string" ? req.body.key.trim().toLowerCase() : "";
        const descriptionRaw = typeof req.body?.description === "string" ? req.body.description.trim() : "";
        if (!keyRaw)
            return res.status(400).json({ error: "body.key is required." });
        if (!isValidRoleKey(keyRaw)) {
            return res.status(400).json({ error: "Invalid role key format. Use lowercase letters, numbers, '-' or '_'." });
        }
        const { rows } = await (0, db_1.query)(`INSERT INTO auth_role (key, description)
       VALUES ($1, $2)
       RETURNING id, key, description`, [keyRaw, descriptionRaw || null]);
        return res.status(201).json({ role: rows[0] });
    }
    catch (e) {
        if (e?.code === "23505") {
            return res.status(409).json({ error: "Role already exists." });
        }
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.get("/api/admin/users", requireAdminRole, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(String(req.query.limit || "100"), 10) || 100, 1), 250);
        const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);
        const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
        const role = typeof req.query.role === "string" ? req.query.role.trim().toLowerCase() : "";
        const includeInactive = String(req.query.includeInactive || "false").toLowerCase() === "true";
        if (role && !isValidRoleKey(role)) {
            return res.status(400).json({ error: "Invalid role filter." });
        }
        const params = [];
        const where = [];
        if (!includeInactive) {
            where.push("u.is_active = true");
        }
        if (q) {
            const qi = params.push(`%${q}%`);
            where.push(`(u.email ILIKE $${qi} OR u.display_name ILIKE $${qi})`);
        }
        if (role) {
            const ri = params.push(role);
            where.push(`EXISTS (
          SELECT 1
          FROM auth_user_role ur2
          JOIN auth_role r2 ON r2.id = ur2.role_id
          WHERE ur2.user_id = u.id
            AND r2.key = $${ri}
        )`);
        }
        const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
        const limitIdx = params.push(limit);
        const offsetIdx = params.push(offset);
        const { rows } = await (0, db_1.query)(`${ADMIN_USER_BASE_SELECT}
       ${whereClause}
       GROUP BY
         u.id,
         bs_latest.subscription_id,
         bs_latest.subscription_status,
         bs_latest.subscription_provider,
         bs_latest.subscription_started_at,
         bs_latest.subscription_current_period_end,
         bs_latest.subscription_canceled_at,
         bs_latest.subscription_plan_code,
         bs_latest.subscription_plan_name
       ORDER BY COALESCE(MAX(s.last_seen_at), u.created_at) DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`, params);
        const { rows: countRows } = await (0, db_1.query)(`SELECT COUNT(*)::int AS total
       FROM app_user u
       ${whereClause}`, params.slice(0, params.length - 2));
        const users = rows.map(toAdminUser);
        const total = Number(countRows[0]?.total || 0);
        return res.json({ users, total, limit, offset });
    }
    catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.patch("/api/admin/users/:userId/roles", requireAdminRole, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        if (!Number.isFinite(userId) || userId <= 0) {
            return res.status(400).json({ error: "Invalid user id." });
        }
        const nextRoleKeys = normalizeRoleKeys(req.body?.roles);
        await (0, db_1.withTransaction)(async (client) => {
            const { rows: userRows } = await client.query(`SELECT id, is_active FROM app_user WHERE id = $1 LIMIT 1`, [userId]);
            const user = userRows[0];
            if (!user)
                throw new AdminApiError(404, "User not found.");
            const { rows: currentRoleRows } = await client.query(`SELECT r.key
         FROM auth_user_role ur
         JOIN auth_role r ON r.id = ur.role_id
         WHERE ur.user_id = $1`, [userId]);
            const currentRoles = new Set(currentRoleRows.map((row) => row.key));
            const removingAdmin = user.is_active && currentRoles.has("admin") && !nextRoleKeys.includes("admin");
            if (removingAdmin) {
                const adminCount = await getActiveAdminCountTx(client);
                if (adminCount <= 1) {
                    throw new AdminApiError(400, "Cannot remove the last active admin.");
                }
            }
            let roleIds = [];
            if (nextRoleKeys.length > 0) {
                const { rows: roleRows } = await client.query(`SELECT id, key
           FROM auth_role
           WHERE key = ANY($1::text[])`, [nextRoleKeys]);
                if (roleRows.length !== nextRoleKeys.length) {
                    const found = new Set(roleRows.map((row) => row.key));
                    const missing = nextRoleKeys.filter((key) => !found.has(key));
                    throw new AdminApiError(400, `Unknown role keys: ${missing.join(", ")}`);
                }
                roleIds = roleRows.map((row) => row.id);
            }
            await client.query(`DELETE FROM auth_user_role WHERE user_id = $1`, [userId]);
            if (roleIds.length > 0) {
                const params = [userId, ...roleIds];
                const values = roleIds.map((_, idx) => `($1, $${idx + 2})`).join(", ");
                await client.query(`INSERT INTO auth_user_role (user_id, role_id)
           VALUES ${values}
           ON CONFLICT DO NOTHING`, params);
            }
        });
        const user = await getAdminUserById(userId);
        return res.json({ user });
    }
    catch (e) {
        if (e instanceof AdminApiError) {
            return res.status(e.status).json({ error: e.message });
        }
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.patch("/api/admin/users/:userId/status", requireAdminRole, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        if (!Number.isFinite(userId) || userId <= 0) {
            return res.status(400).json({ error: "Invalid user id." });
        }
        if (typeof req.body?.is_active !== "boolean") {
            return res.status(400).json({ error: "body.is_active (boolean) is required." });
        }
        const nextIsActive = req.body.is_active;
        await (0, db_1.withTransaction)(async (client) => {
            const { rows: userRows } = await client.query(`SELECT
           u.id,
           u.is_active,
           EXISTS (
             SELECT 1
             FROM auth_user_role ur
             JOIN auth_role r ON r.id = ur.role_id
             WHERE ur.user_id = u.id
               AND r.key = 'admin'
           ) AS is_admin
         FROM app_user u
         WHERE u.id = $1
         LIMIT 1`, [userId]);
            const user = userRows[0];
            if (!user)
                throw new AdminApiError(404, "User not found.");
            if (user.is_active === nextIsActive)
                return;
            if (user.is_admin && user.is_active && !nextIsActive) {
                const adminCount = await getActiveAdminCountTx(client);
                if (adminCount <= 1) {
                    throw new AdminApiError(400, "Cannot deactivate the last active admin.");
                }
            }
            await client.query(`UPDATE app_user SET is_active = $2 WHERE id = $1`, [userId, nextIsActive]);
            if (!nextIsActive) {
                await client.query(`UPDATE auth_session
           SET revoked_at = now()
           WHERE user_id = $1
             AND revoked_at IS NULL`, [userId]);
            }
        });
        const user = await getAdminUserById(userId);
        return res.json({ user });
    }
    catch (e) {
        if (e instanceof AdminApiError) {
            return res.status(e.status).json({ error: e.message });
        }
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.get("/api/admin/billing/plans", requireAdminRole, async (_req, res) => {
    try {
        const { rows } = await (0, db_1.query)(`SELECT
         id,
         code,
         name,
         description,
         price_cents,
         currency,
         interval_unit,
         is_active,
         metadata
       FROM billing_plan
       ORDER BY price_cents ASC, code ASC`);
        return res.json({ plans: rows });
    }
    catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.post("/api/admin/billing/plans", requireAdminRole, async (req, res) => {
    try {
        const code = typeof req.body?.code === "string" ? req.body.code.trim().toLowerCase() : "";
        const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
        const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
        const intervalUnitRaw = typeof req.body?.interval_unit === "string" ? req.body.interval_unit.trim().toLowerCase() : "month";
        const currencyRaw = typeof req.body?.currency === "string" ? req.body.currency.trim().toUpperCase() : "USD";
        const priceCentsRaw = req.body?.price_cents;
        const isActive = typeof req.body?.is_active === "boolean" ? req.body.is_active : true;
        const metadata = req.body?.metadata;
        if (!code || !/^[a-z][a-z0-9_-]{1,63}$/.test(code)) {
            return res.status(400).json({ error: "code must match ^[a-z][a-z0-9_-]{1,63}$." });
        }
        if (!name) {
            return res.status(400).json({ error: "name is required." });
        }
        if (!/^[A-Z]{3}$/.test(currencyRaw)) {
            return res.status(400).json({ error: "currency must be a 3-letter ISO code." });
        }
        if (intervalUnitRaw !== "month" && intervalUnitRaw !== "year" && intervalUnitRaw !== "one_time") {
            return res.status(400).json({ error: "interval_unit must be one of: month, year, one_time." });
        }
        const priceCents = typeof priceCentsRaw === "number" && Number.isFinite(priceCentsRaw)
            ? Math.trunc(priceCentsRaw)
            : typeof priceCentsRaw === "string" && priceCentsRaw.trim()
                ? Number.parseInt(priceCentsRaw, 10)
                : 0;
        if (!Number.isFinite(priceCents) || priceCents < 0) {
            return res.status(400).json({ error: "price_cents must be a non-negative integer." });
        }
        if (typeof metadata !== "undefined" && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) {
            return res.status(400).json({ error: "metadata must be an object when provided." });
        }
        const { rows } = await (0, db_1.query)(`INSERT INTO billing_plan (
         code,
         name,
         description,
         price_cents,
         currency,
         interval_unit,
         is_active,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING
         id,
         code,
         name,
         description,
         price_cents,
         currency,
         interval_unit,
         is_active,
         metadata`, [
            code,
            name,
            description || null,
            priceCents,
            currencyRaw,
            intervalUnitRaw,
            isActive,
            JSON.stringify(metadata || {}),
        ]);
        return res.status(201).json({ plan: rows[0] });
    }
    catch (e) {
        if (e?.code === "23505") {
            return res.status(409).json({ error: "Billing plan code already exists." });
        }
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.put("/api/admin/users/:userId/subscription", requireAdminRole, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        if (!Number.isFinite(userId) || userId <= 0) {
            return res.status(400).json({ error: "Invalid user id." });
        }
        const planCode = typeof req.body?.plan_code === "string" ? req.body.plan_code.trim().toLowerCase() : "";
        if (!planCode) {
            return res.status(400).json({ error: "plan_code is required." });
        }
        const status = parseBillingStatus(req.body?.status);
        if (!status) {
            return res.status(400).json({
                error: "status is required and must be one of: trialing, active, past_due, grace_period, canceled, unpaid, incomplete.",
            });
        }
        const provider = typeof req.body?.provider === "string" ? req.body.provider.trim() : "manual";
        const startedAt = parseOptionalIsoDateTime(req.body?.started_at, "started_at");
        const currentPeriodEnd = parseOptionalIsoDateTime(req.body?.current_period_end, "current_period_end");
        const canceledAtRaw = parseOptionalIsoDateTime(req.body?.canceled_at, "canceled_at");
        const canceledAt = typeof canceledAtRaw !== "undefined" ? canceledAtRaw : status === "canceled" ? new Date().toISOString() : null;
        const providerCustomerId = typeof req.body?.provider_customer_id === "string" ? req.body.provider_customer_id.trim() || null : null;
        const providerSubscriptionId = typeof req.body?.provider_subscription_id === "string" ? req.body.provider_subscription_id.trim() || null : null;
        const metadata = req.body?.metadata;
        if (typeof metadata !== "undefined" && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) {
            return res.status(400).json({ error: "metadata must be an object when provided." });
        }
        await (0, db_1.withTransaction)(async (client) => {
            const { rows: userRows } = await client.query(`SELECT id FROM app_user WHERE id = $1 LIMIT 1`, [userId]);
            if (!userRows[0])
                throw new AdminApiError(404, "User not found.");
            const { rows: planRows } = await client.query(`SELECT id FROM billing_plan WHERE code = $1 LIMIT 1`, [planCode]);
            const planId = planRows[0]?.id;
            if (!planId) {
                throw new AdminApiError(400, `Unknown billing plan code: ${planCode}`);
            }
            // Close any currently-accessible subscription before writing the new state.
            // This keeps billing access deterministic when admins change a user to non-active statuses.
            await client.query(`UPDATE billing_subscription
         SET status = 'canceled',
             canceled_at = COALESCE(canceled_at, now()),
             updated_at = now()
         WHERE user_id = $1
           AND status IN ('trialing', 'active', 'grace_period')
           AND canceled_at IS NULL`, [userId]);
            await client.query(`INSERT INTO billing_subscription (
           user_id,
           plan_id,
           status,
           provider,
           provider_customer_id,
           provider_subscription_id,
           started_at,
           current_period_end,
           canceled_at,
           metadata
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
         )`, [
                userId,
                planId,
                status,
                provider || "manual",
                providerCustomerId,
                providerSubscriptionId,
                startedAt || new Date().toISOString(),
                currentPeriodEnd ?? null,
                canceledAt ?? null,
                JSON.stringify(metadata || {}),
            ]);
        });
        const user = await getAdminUserById(userId);
        return res.json({ user });
    }
    catch (e) {
        if (e instanceof AdminApiError) {
            return res.status(e.status).json({ error: e.message });
        }
        if (e?.code === "23505") {
            return res.status(409).json({ error: "Only one active or trial subscription is allowed per user." });
        }
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.get("/api/admin/ingestion/automation", requireAdminRole, async (_req, res) => {
    try {
        const overview = await (0, ingestion_automation_1.getAutomationOverview)();
        return res.json(overview);
    }
    catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.patch("/api/admin/ingestion/automation/:pipeline", requireAdminRole, async (req, res) => {
    try {
        const pipeline = parsePipeline(req.params.pipeline?.trim().toLowerCase());
        if (!pipeline) {
            return res.status(400).json({ error: "Invalid pipeline. Expected one of: news, weather, market." });
        }
        const patchInput = { ...(req.body || {}) };
        if (Object.prototype.hasOwnProperty.call(patchInput, "default_payload")) {
            patchInput.default_payload = sanitizeAutomationPayload(patchInput.default_payload);
        }
        const patch = (0, ingestion_automation_1.parseAutomationRulePatch)(patchInput);
        const rule = await (0, ingestion_automation_1.updateAutomationRule)(pipeline, patch);
        return res.json({ rule });
    }
    catch (e) {
        if (e instanceof ingestion_automation_1.AutomationValidationError || e instanceof ingestion_admin_1.IngestionValidationError || e instanceof AdminApiError) {
            return res.status(400).json({ error: e.message || String(e) });
        }
        return res.status(500).json({ error: e.message || String(e) });
    }
});
// Admin ingestion orchestration (run + logs + metrics)
app.post("/api/admin/ingestion/news/run", requireAdminRole, async (req, res) => {
    try {
        const plan = (0, ingestion_admin_1.buildNewsRunPlan)(req.body || {});
        const run = await (0, ingestion_admin_1.triggerNewsRun)({
            actor: getRequestActor(res),
            plan,
        });
        const detail = await (0, ingestion_admin_1.getRunDetail)(run.runId, 150);
        if (!detail)
            return res.status(500).json({ error: "Failed to load created run." });
        return res.status(202).json(detail);
    }
    catch (e) {
        if (e instanceof ingestion_admin_1.IngestionValidationError) {
            return res.status(400).json({ error: e.message || String(e) });
        }
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.post("/api/admin/ingestion/weather/run", requireAdminRole, async (req, res) => {
    try {
        const plan = (0, ingestion_admin_1.buildWeatherRunPlan)(req.body || {});
        const run = await (0, ingestion_admin_1.triggerWeatherRun)({
            actor: getRequestActor(res),
            plan,
        });
        const detail = await (0, ingestion_admin_1.getRunDetail)(run.runId, 150);
        if (!detail)
            return res.status(500).json({ error: "Failed to load created run." });
        return res.status(202).json(detail);
    }
    catch (e) {
        if (e instanceof ingestion_admin_1.IngestionValidationError) {
            return res.status(400).json({ error: e.message || String(e) });
        }
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.post("/api/admin/ingestion/market/run", requireAdminRole, async (req, res) => {
    try {
        const plan = (0, ingestion_admin_1.buildMarketRunPlan)(req.body || {});
        const run = await (0, ingestion_admin_1.triggerMarketRun)({
            actor: getRequestActor(res),
            plan,
        });
        const detail = await (0, ingestion_admin_1.getRunDetail)(run.runId, 150);
        if (!detail)
            return res.status(500).json({ error: "Failed to load created run." });
        return res.status(202).json(detail);
    }
    catch (e) {
        if (e instanceof ingestion_admin_1.IngestionValidationError) {
            return res.status(400).json({ error: e.message || String(e) });
        }
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.get("/api/admin/ingestion/runs", requireAdminRole, async (req, res) => {
    try {
        const pipelineRaw = typeof req.query.pipeline === "string" ? req.query.pipeline.trim().toLowerCase() : undefined;
        const pipeline = parsePipeline(pipelineRaw);
        if (pipelineRaw && !pipeline) {
            return res.status(400).json({ error: "Invalid pipeline. Expected one of: news, weather, market." });
        }
        const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1), 200);
        const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);
        const runs = await (0, ingestion_admin_1.listRuns)({ pipeline, limit, offset });
        return res.json({ runs });
    }
    catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.get("/api/admin/ingestion/runs/:runId", requireAdminRole, async (req, res) => {
    try {
        const runId = parseInt(req.params.runId, 10);
        if (!Number.isFinite(runId) || runId <= 0) {
            return res.status(400).json({ error: "Invalid run id." });
        }
        const logLimit = Math.min(Math.max(parseInt(String(req.query.logLimit || "200"), 10) || 200, 1), 1000);
        const detail = await (0, ingestion_admin_1.getRunDetail)(runId, logLimit);
        if (!detail)
            return res.status(404).json({ error: "Run not found." });
        return res.json(detail);
    }
    catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.get("/api/admin/ingestion/runs/:runId/logs", requireAdminRole, async (req, res) => {
    try {
        const runId = parseInt(req.params.runId, 10);
        if (!Number.isFinite(runId) || runId <= 0) {
            return res.status(400).json({ error: "Invalid run id." });
        }
        const afterId = Math.max(parseInt(String(req.query.afterId || "0"), 10) || 0, 0);
        const limit = Math.min(Math.max(parseInt(String(req.query.limit || "200"), 10) || 200, 1), 1000);
        const logs = await (0, ingestion_admin_1.getRunLogs)(runId, { afterId, limit });
        return res.json({ logs });
    }
    catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
    }
});
app.get("/api/admin/ingestion/metrics", requireAdminRole, async (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 180);
        const pipelineRaw = typeof req.query.pipeline === "string" ? req.query.pipeline.trim().toLowerCase() : undefined;
        const pipeline = parsePipeline(pipelineRaw);
        if (pipelineRaw && !pipeline) {
            return res.status(400).json({ error: "Invalid pipeline. Expected one of: news, weather, market." });
        }
        const metrics = await (0, ingestion_admin_1.getMetrics)({ days, pipeline });
        return res.json(metrics);
    }
    catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
    }
});
// Ingest NewsAPI 'everything'
app.post("/api/ingest/newsapi/everything", requireIngestionAccess, async (req, res) => {
    try {
        const { q, language, pageSize, maxPages } = req.body || {};
        if (!q || typeof q !== "string") {
            return res.status(400).json({ error: "Missing body.q (string)" });
        }
        const result = await (0, newsapi_1.ingestNewsApiEverything)({ q, language, pageSize, maxPages });
        res.json(result);
    }
    catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    }
});
// Ingest NewsAPI 'top-headlines'
app.post("/api/ingest/newsapi/top-headlines", requireIngestionAccess, async (req, res) => {
    try {
        const { country, category, q, pageSize, maxPages } = req.body || {};
        const result = await (0, newsapi_1.ingestNewsApiTopHeadlines)({ country, category, q, pageSize, maxPages });
        res.json(result);
    }
    catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    }
});
// Ingest TheNewsAPI '/news/top'
app.post("/api/ingest/thenewsapi/news", requireIngestionAccess, async (req, res) => {
    try {
        const { q, search, language, locale, pageSize, maxPages, publishedAfter } = req.body || {};
        const result = await (0, thenewsapi_1.ingestTheNewsApiNews)({
            search: typeof search === "string" && search.trim() ? search : (typeof q === "string" ? q : undefined),
            language,
            locale,
            pageSize,
            maxPages,
            publishedAfter,
        });
        res.json(result);
    }
    catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    }
});
// Ingest OpenWeather current weather for countries (centroid-based)
app.post("/api/ingest/openweather/country-current", requireIngestionAccess, async (req, res) => {
    try {
        const { country } = req.body || {};
        const result = await (0, openweather_1.ingestOpenWeatherCountryCurrent)(typeof country === 'string' ? country : undefined);
        res.json(result);
    }
    catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    }
});
// Ingest Finnhub quotes for a symbol list (or defaults)
app.post("/api/ingest/finnhub/quotes", requireIngestionAccess, async (req, res) => {
    try {
        let symbols;
        const includeNews = req.body?.includeNews === true ||
            String(req.body?.includeNews || "").trim().toLowerCase() === "true";
        const newsCategory = typeof req.body?.newsCategory === "string" ? req.body.newsCategory : undefined;
        const newsMinId = typeof req.body?.newsMinId === "number"
            ? req.body.newsMinId
            : typeof req.body?.newsMinId === "string"
                ? Number.parseInt(req.body.newsMinId, 10)
                : undefined;
        const newsMaxItems = typeof req.body?.newsMaxItems === "number"
            ? req.body.newsMaxItems
            : typeof req.body?.newsMaxItems === "string"
                ? Number.parseInt(req.body.newsMaxItems, 10)
                : undefined;
        try {
            const parsed = (0, finnhub_1.parseMarketSymbolsInput)(req.body?.symbols);
            symbols = parsed.length > 0 ? parsed : undefined;
        }
        catch (validationError) {
            return res.status(400).json({
                error: validationError instanceof Error ? validationError.message : String(validationError),
            });
        }
        const result = await (0, finnhub_1.ingestFinnhubQuotes)(symbols);
        const news = includeNews
            ? await (0, finnhub_1.ingestFinnhubMarketNews)({
                category: newsCategory,
                minId: Number.isFinite(newsMinId) ? newsMinId : undefined,
                maxItems: Number.isFinite(newsMaxItems) ? newsMaxItems : undefined,
            })
            : null;
        res.json({ ...result, news });
    }
    catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    }
});
// Ingest Finnhub market news into the shared news item feed
app.post("/api/ingest/finnhub/news", requireIngestionAccess, async (req, res) => {
    try {
        const category = typeof req.body?.category === "string" ? req.body.category : undefined;
        const minId = typeof req.body?.minId === "number"
            ? req.body.minId
            : typeof req.body?.minId === "string"
                ? Number.parseInt(req.body.minId, 10)
                : undefined;
        const maxItems = typeof req.body?.maxItems === "number"
            ? req.body.maxItems
            : typeof req.body?.maxItems === "string"
                ? Number.parseInt(req.body.maxItems, 10)
                : undefined;
        const result = await (0, finnhub_1.ingestFinnhubMarketNews)({
            category,
            minId: Number.isFinite(minId) ? minId : undefined,
            maxItems: Number.isFinite(maxItems) ? maxItems : undefined,
        });
        res.json(result);
    }
    catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    }
});
// Latest weather per country for map overlay
app.get("/api/weather/country-latest", requireAuthenticated, async (_req, res) => {
    try {
        (0, ingestion_automation_1.trackDemandSignal)("weather");
        const rows = await (0, openweather_1.getCountryWeatherLatest)();
        res.json({ stats: rows });
    }
    catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    }
});
// Latest market quotes with optional on-demand refresh for near real-time views
app.get("/api/market/quotes", requireAuthenticated, async (req, res) => {
    try {
        (0, ingestion_automation_1.trackDemandSignal)("market");
        let symbols;
        try {
            const parsed = (0, finnhub_1.parseMarketSymbolsInput)(req.query.symbols);
            symbols = parsed.length > 0 ? parsed : undefined;
        }
        catch (validationError) {
            return res.status(400).json({
                error: validationError instanceof Error ? validationError.message : String(validationError),
            });
        }
        const refreshRaw = typeof req.query.refresh === "string" ? req.query.refresh.trim().toLowerCase() : "";
        const shouldRefresh = refreshRaw === "" ||
            refreshRaw === "1" ||
            refreshRaw === "true" ||
            refreshRaw === "yes" ||
            refreshRaw === "on";
        if (shouldRefresh) {
            await (0, finnhub_1.refreshMarketQuotesRealtime)(symbols);
        }
        const quotes = await (0, finnhub_1.getMarketQuotesLatest)(symbols);
        res.json({ quotes, refreshed: shouldRefresh, count: quotes.length });
    }
    catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    }
});
// Live market open/close status by exchange
app.get("/api/market/status", requireAuthenticated, async (req, res) => {
    try {
        (0, ingestion_automation_1.trackDemandSignal)("market");
        const exchangesRaw = typeof req.query.exchanges === "string" ? req.query.exchanges : "";
        const exchanges = exchangesRaw
            .split(/[,\s]+/)
            .map((value) => value.trim().toUpperCase())
            .filter(Boolean);
        const refreshRaw = typeof req.query.refresh === "string" ? req.query.refresh.trim().toLowerCase() : "";
        const shouldRefresh = refreshRaw === "1" ||
            refreshRaw === "true" ||
            refreshRaw === "yes" ||
            refreshRaw === "on";
        const status = await (0, finnhub_1.getFinnhubMarketStatus)(exchanges.length > 0 ? exchanges : undefined, shouldRefresh);
        res.json({ status, refreshed: shouldRefresh, count: status.length });
    }
    catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    }
});
// Upcoming earnings events
app.get("/api/market/earnings", requireAuthenticated, async (req, res) => {
    try {
        (0, ingestion_automation_1.trackDemandSignal)("market");
        const from = typeof req.query.from === "string" ? req.query.from : undefined;
        const to = typeof req.query.to === "string" ? req.query.to : undefined;
        const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
        const limitRaw = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined;
        const events = await (0, finnhub_1.getFinnhubEarningsCalendar)({
            from,
            to,
            symbol,
            limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
        });
        res.json({ events, count: events.length });
    }
    catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    }
});
// Lightweight image proxy for remote thumbnails that block hotlinking
app.get("/api/proxy-image", requireAuthenticated, async (req, res) => {
    try {
        const url = String(req.query.url || "");
        if (!url || !/^https?:\/\//i.test(url)) {
            return res.status(400).send("invalid url");
        }
        const r = await fetch(url, { redirect: "follow" });
        if (!r.ok) {
            return res.status(r.status).send("upstream error");
        }
        const ct = r.headers.get("content-type") || "image/jpeg";
        res.setHeader("content-type", ct);
        res.setHeader("cache-control", "public, max-age=86400, s-maxage=86400, immutable");
        res.setHeader("access-control-allow-origin", "*");
        const buf = Buffer.from(await r.arrayBuffer());
        res.status(200).send(buf);
    }
    catch (e) {
        res.status(500).send("proxy error");
    }
});
(0, ingestion_automation_1.startIngestionAutomationWorker)();
app.listen(PORT, "0.0.0.0", () => {
    console.log(`API listening on http://0.0.0.0:${PORT}`);
});
