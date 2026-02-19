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
const openweather_1 = require("./connectors/openweather");
const db_1 = require("./db");
const auth_1 = __importStar(require("./auth"));
const ingestion_admin_1 = require("./ingestion-admin");
const app = (0, express_1.default)();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
app.set("trust proxy", 1);
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: false }));
app.get("/api/hello", (_req, res) => res.json({ hello: "world" }));
app.use("/api/auth", auth_1.default);
const requireAdminRole = (0, auth_1.requireRole)("admin");
const requireAuthenticated = (0, auth_1.requireAuth)();
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
    MAX(s.last_seen_at) AS last_seen_at
  FROM app_user u
  LEFT JOIN auth_user_role ur ON ur.user_id = u.id
  LEFT JOIN auth_role r ON r.id = ur.role_id
  LEFT JOIN auth_identity ai ON ai.user_id = u.id
  LEFT JOIN auth_session s ON s.user_id = u.id
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
    };
}
async function getAdminUserById(userId) {
    const { rows } = await (0, db_1.query)(`${ADMIN_USER_BASE_SELECT}
     WHERE u.id = $1
     GROUP BY u.id
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
    if (value === "news" || value === "weather")
        return value;
    return undefined;
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
// List recent news items with optional filters
app.get("/api/news", requireAuthenticated, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(String(req.query.limit || "20"), 10) || 20, 1), 200);
        const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);
        const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
        const country = typeof req.query.country === "string" ? req.query.country.trim().toUpperCase() : "";
        const params = [];
        const where = [];
        if (q) {
            const i1 = params.push(`%${q}%`); // returns new length as index
            const i2 = params.push(`%${q}%`);
            where.push(`(title ILIKE $${i1} OR summary ILIKE $${i2})`);
        }
        if (country) {
            const ci = params.push(country);
            where.push(`upper(country_iso2) = $${ci}`);
        }
        const li = params.push(limit);
        const oi = params.push(offset);
        const sql = `
      SELECT id, kind, title, summary, url, country_iso2, event_time, payload
      FROM item
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY event_time DESC NULLS LAST, id DESC
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
       GROUP BY u.id
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
app.get("/api/admin/ingestion/runs", requireAdminRole, async (req, res) => {
    try {
        const pipelineRaw = typeof req.query.pipeline === "string" ? req.query.pipeline.trim().toLowerCase() : undefined;
        const pipeline = parsePipeline(pipelineRaw);
        if (pipelineRaw && !pipeline) {
            return res.status(400).json({ error: "Invalid pipeline. Expected one of: news, weather." });
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
            return res.status(400).json({ error: "Invalid pipeline. Expected one of: news, weather." });
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
// Latest weather per country for map overlay
app.get("/api/weather/country-latest", requireAuthenticated, async (_req, res) => {
    try {
        const rows = await (0, openweather_1.getCountryWeatherLatest)();
        res.json({ stats: rows });
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
app.listen(PORT, "0.0.0.0", () => {
    console.log(`API listening on http://0.0.0.0:${PORT}`);
});
