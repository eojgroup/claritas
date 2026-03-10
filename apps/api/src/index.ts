import express from "express";
import { ingestNewsApiEverything, ingestNewsApiTopHeadlines } from "./connectors/newsapi";
import { ingestTheNewsApiNews } from "./connectors/thenewsapi";
import { getCountryWeatherLatest, ingestOpenWeatherCountryCurrent } from "./connectors/openweather";
import {
  getMarketQuotesLatest,
  ingestFinnhubQuotes,
  parseMarketSymbolsInput,
  refreshMarketQuotesRealtime,
} from "./connectors/finnhub";
import { pool, query, withTransaction } from "./db";
import authRouter, { requireAuth, requirePaidAccess, requireRole } from "./auth";
import {
  IngestionValidationError,
  buildMarketRunPlan,
  buildNewsRunPlan,
  buildWeatherRunPlan,
  getMetrics,
  getRunDetail,
  getRunLogs,
  listRuns,
  triggerMarketRun,
  triggerNewsRun,
  triggerWeatherRun,
  type IngestionPipeline,
} from "./ingestion-admin";
import {
  AutomationValidationError,
  getAutomationOverview,
  parseAutomationRulePatch,
  startIngestionAutomationWorker,
  trackDemandSignal,
  updateAutomationRule,
} from "./ingestion-automation";
import { getBillingPublicUrls } from "./billing";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

app.set("trust proxy", 1);
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.get("/api/hello", (_req, res) => res.json({ hello: "world" }));
app.use("/api/auth", authRouter);

const requireAdminRole = requireRole("admin");
const requireSession = requireAuth();
const requireAuthenticated = requirePaidAccess();

type AdminRoleRow = {
  id: number;
  key: string;
  description: string | null;
  user_count: number;
};

type AdminUserRow = {
  id: number;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  roles: string[] | null;
  providers: string[] | null;
  last_seen_at: string | null;
  subscription_id: number | null;
  subscription_status: string | null;
  subscription_provider: string | null;
  subscription_started_at: string | null;
  subscription_current_period_end: string | null;
  subscription_canceled_at: string | null;
  subscription_plan_code: string | null;
  subscription_plan_name: string | null;
};

type BillingPlanRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  interval_unit: string;
  is_active: boolean;
  metadata: unknown;
};

class AdminApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
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

function isValidRoleKey(key: string): boolean {
  return /^[a-z][a-z0-9_-]{1,31}$/.test(key);
}

function normalizeRoleKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new AdminApiError(400, "body.roles must be an array of role keys.");
  const keys = raw
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .filter(Boolean);
  for (const key of keys) {
    if (!isValidRoleKey(key)) throw new AdminApiError(400, `Invalid role key: ${key}`);
  }
  return Array.from(new Set(keys)).sort();
}

function toAdminUser(row: AdminUserRow) {
  const subscription =
    row.subscription_id == null
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

async function getAdminUserById(userId: number): Promise<ReturnType<typeof toAdminUser> | null> {
  const { rows } = await query<AdminUserRow>(
    `${ADMIN_USER_BASE_SELECT}
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
     LIMIT 1`,
    [userId]
  );
  return rows[0] ? toAdminUser(rows[0]) : null;
}

async function getActiveAdminCountTx(client: import("pg").PoolClient): Promise<number> {
  const { rows } = await client.query<{ count: number }>(
    `SELECT COUNT(DISTINCT ur.user_id)::int AS count
     FROM auth_user_role ur
     JOIN auth_role r ON r.id = ur.role_id
     JOIN app_user u ON u.id = ur.user_id
     WHERE r.key = 'admin'
       AND u.is_active = true`
  );
  return Number(rows[0]?.count || 0);
}

function parsePipeline(value: unknown): IngestionPipeline | undefined {
  if (value === "news" || value === "weather" || value === "market") return value;
  return undefined;
}

function parseBillingStatus(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "trialing" ||
    normalized === "active" ||
    normalized === "past_due" ||
    normalized === "grace_period" ||
    normalized === "canceled" ||
    normalized === "unpaid" ||
    normalized === "incomplete"
  ) {
    return normalized;
  }
  return undefined;
}

function parseOptionalIsoDateTime(value: unknown, fieldName: string): string | null | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AdminApiError(400, `${fieldName} must be an ISO date-time string or null.`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new AdminApiError(400, `${fieldName} must be a valid date-time.`);
  }
  return new Date(parsed).toISOString();
}

function sanitizeAutomationPayload(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === null) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new AdminApiError(400, "default_payload must be an object.");
}

function getRequestActor(res: express.Response): { userId: number | null; email: string | null; triggerMode: string } {
  const locals = res.locals as {
    auth?: {
      user?: {
        id?: number;
        email?: string | null;
      };
    };
  };
  return {
    userId: typeof locals.auth?.user?.id === "number" ? locals.auth.user.id : null,
    email: typeof locals.auth?.user?.email === "string" ? locals.auth.user.email : null,
    triggerMode: "admin_ui",
  };
}

function requireIngestionAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
  const sharedToken = process.env.INGEST_API_TOKEN;
  if (sharedToken) {
    const supplied = req.get("x-ingest-token");
    if (supplied && supplied === sharedToken) return next();
  }
  return requireAdminRole(req, res, next);
}

// Simple endpoint to test DB connectivity
app.get("/api/db/ping", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT 1 as ok");
    res.json(rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/billing/me", requireSession, async (_req, res) => {
  try {
    const locals = res.locals as {
      auth?: {
        user?: {
          billing?: unknown;
        };
      };
    };
    const billing = locals.auth?.user?.billing ?? null;
    const urls = getBillingPublicUrls();
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
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// List recent news items with optional filters
app.get("/api/news", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("news");
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "20"), 10) || 20, 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const country = typeof req.query.country === "string" ? req.query.country.trim().toUpperCase() : "";

    const params: any[] = [];
    const where: string[] = [];
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
    const { rows } = await pool.query(sql, params);
    res.json({ items: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Aggregate counts by country (for map bubbles)
app.get("/api/news/country-stats", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("news");
    const days = Math.min(Math.max(parseInt(String(req.query.days || "30"), 10) || 30, 1), 365);
    const params: any[] = [days];
    const { rows } = await pool.query(
      `SELECT country_iso2 AS country, COUNT(*)::int AS count
       FROM item
       WHERE country_iso2 IS NOT NULL
         AND (event_time IS NULL OR event_time >= now() - ($1 || ' days')::interval)
       GROUP BY country_iso2
       ORDER BY count DESC`,
      params
    );
    res.json({ stats: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Admin user/role management
app.get("/api/admin/roles", requireAdminRole, async (_req, res) => {
  try {
    const { rows } = await query<AdminRoleRow>(
      `SELECT
         r.id,
         r.key,
         r.description,
         COUNT(ur.user_id)::int AS user_count
       FROM auth_role r
       LEFT JOIN auth_user_role ur ON ur.role_id = r.id
       GROUP BY r.id
       ORDER BY r.key ASC`
    );
    return res.json({ roles: rows });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/admin/roles", requireAdminRole, async (req, res) => {
  try {
    const keyRaw = typeof req.body?.key === "string" ? req.body.key.trim().toLowerCase() : "";
    const descriptionRaw = typeof req.body?.description === "string" ? req.body.description.trim() : "";
    if (!keyRaw) return res.status(400).json({ error: "body.key is required." });
    if (!isValidRoleKey(keyRaw)) {
      return res.status(400).json({ error: "Invalid role key format. Use lowercase letters, numbers, '-' or '_'." });
    }
    const { rows } = await query<{ id: number; key: string; description: string | null }>(
      `INSERT INTO auth_role (key, description)
       VALUES ($1, $2)
       RETURNING id, key, description`,
      [keyRaw, descriptionRaw || null]
    );
    return res.status(201).json({ role: rows[0] });
  } catch (e: any) {
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

    const params: any[] = [];
    const where: string[] = [];
    if (!includeInactive) {
      where.push("u.is_active = true");
    }
    if (q) {
      const qi = params.push(`%${q}%`);
      where.push(`(u.email ILIKE $${qi} OR u.display_name ILIKE $${qi})`);
    }
    if (role) {
      const ri = params.push(role);
      where.push(
        `EXISTS (
          SELECT 1
          FROM auth_user_role ur2
          JOIN auth_role r2 ON r2.id = ur2.role_id
          WHERE ur2.user_id = u.id
            AND r2.key = $${ri}
        )`
      );
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limitIdx = params.push(limit);
    const offsetIdx = params.push(offset);

    const { rows } = await query<AdminUserRow>(
      `${ADMIN_USER_BASE_SELECT}
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
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`
      ,
      params
    );

    const { rows: countRows } = await query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM app_user u
       ${whereClause}`,
      params.slice(0, params.length - 2)
    );
    const users = rows.map(toAdminUser);
    const total = Number(countRows[0]?.total || 0);
    return res.json({ users, total, limit, offset });
  } catch (e: any) {
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

    await withTransaction(async (client) => {
      const { rows: userRows } = await client.query<{ id: number; is_active: boolean }>(
        `SELECT id, is_active FROM app_user WHERE id = $1 LIMIT 1`,
        [userId]
      );
      const user = userRows[0];
      if (!user) throw new AdminApiError(404, "User not found.");

      const { rows: currentRoleRows } = await client.query<{ key: string }>(
        `SELECT r.key
         FROM auth_user_role ur
         JOIN auth_role r ON r.id = ur.role_id
         WHERE ur.user_id = $1`,
        [userId]
      );
      const currentRoles = new Set(currentRoleRows.map((row) => row.key));
      const removingAdmin = user.is_active && currentRoles.has("admin") && !nextRoleKeys.includes("admin");
      if (removingAdmin) {
        const adminCount = await getActiveAdminCountTx(client);
        if (adminCount <= 1) {
          throw new AdminApiError(400, "Cannot remove the last active admin.");
        }
      }

      let roleIds: number[] = [];
      if (nextRoleKeys.length > 0) {
        const { rows: roleRows } = await client.query<{ id: number; key: string }>(
          `SELECT id, key
           FROM auth_role
           WHERE key = ANY($1::text[])`,
          [nextRoleKeys]
        );
        if (roleRows.length !== nextRoleKeys.length) {
          const found = new Set(roleRows.map((row) => row.key));
          const missing = nextRoleKeys.filter((key) => !found.has(key));
          throw new AdminApiError(400, `Unknown role keys: ${missing.join(", ")}`);
        }
        roleIds = roleRows.map((row) => row.id);
      }

      await client.query(`DELETE FROM auth_user_role WHERE user_id = $1`, [userId]);
      if (roleIds.length > 0) {
        const params: any[] = [userId, ...roleIds];
        const values = roleIds.map((_, idx) => `($1, $${idx + 2})`).join(", ");
        await client.query(
          `INSERT INTO auth_user_role (user_id, role_id)
           VALUES ${values}
           ON CONFLICT DO NOTHING`,
          params
        );
      }
    });

    const user = await getAdminUserById(userId);
    return res.json({ user });
  } catch (e: any) {
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
    const nextIsActive = req.body.is_active as boolean;

    await withTransaction(async (client) => {
      const { rows: userRows } = await client.query<{ id: number; is_active: boolean; is_admin: boolean }>(
        `SELECT
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
         LIMIT 1`,
        [userId]
      );
      const user = userRows[0];
      if (!user) throw new AdminApiError(404, "User not found.");
      if (user.is_active === nextIsActive) return;

      if (user.is_admin && user.is_active && !nextIsActive) {
        const adminCount = await getActiveAdminCountTx(client);
        if (adminCount <= 1) {
          throw new AdminApiError(400, "Cannot deactivate the last active admin.");
        }
      }

      await client.query(`UPDATE app_user SET is_active = $2 WHERE id = $1`, [userId, nextIsActive]);
      if (!nextIsActive) {
        await client.query(
          `UPDATE auth_session
           SET revoked_at = now()
           WHERE user_id = $1
             AND revoked_at IS NULL`,
          [userId]
        );
      }
    });

    const user = await getAdminUserById(userId);
    return res.json({ user });
  } catch (e: any) {
    if (e instanceof AdminApiError) {
      return res.status(e.status).json({ error: e.message });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/admin/billing/plans", requireAdminRole, async (_req, res) => {
  try {
    const { rows } = await query<BillingPlanRow>(
      `SELECT
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
       ORDER BY price_cents ASC, code ASC`
    );
    return res.json({ plans: rows });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/admin/billing/plans", requireAdminRole, async (req, res) => {
  try {
    const code = typeof req.body?.code === "string" ? req.body.code.trim().toLowerCase() : "";
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
    const intervalUnitRaw =
      typeof req.body?.interval_unit === "string" ? req.body.interval_unit.trim().toLowerCase() : "month";
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
    const priceCents =
      typeof priceCentsRaw === "number" && Number.isFinite(priceCentsRaw)
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

    const { rows } = await query<BillingPlanRow>(
      `INSERT INTO billing_plan (
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
         metadata`,
      [
        code,
        name,
        description || null,
        priceCents,
        currencyRaw,
        intervalUnitRaw,
        isActive,
        JSON.stringify((metadata as Record<string, unknown>) || {}),
      ]
    );

    return res.status(201).json({ plan: rows[0] });
  } catch (e: any) {
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
        error:
          "status is required and must be one of: trialing, active, past_due, grace_period, canceled, unpaid, incomplete.",
      });
    }

    const provider = typeof req.body?.provider === "string" ? req.body.provider.trim() : "manual";
    const startedAt = parseOptionalIsoDateTime(req.body?.started_at, "started_at");
    const currentPeriodEnd = parseOptionalIsoDateTime(req.body?.current_period_end, "current_period_end");
    const canceledAtRaw = parseOptionalIsoDateTime(req.body?.canceled_at, "canceled_at");
    const canceledAt =
      typeof canceledAtRaw !== "undefined" ? canceledAtRaw : status === "canceled" ? new Date().toISOString() : null;
    const providerCustomerId =
      typeof req.body?.provider_customer_id === "string" ? req.body.provider_customer_id.trim() || null : null;
    const providerSubscriptionId =
      typeof req.body?.provider_subscription_id === "string" ? req.body.provider_subscription_id.trim() || null : null;
    const metadata = req.body?.metadata;
    if (typeof metadata !== "undefined" && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) {
      return res.status(400).json({ error: "metadata must be an object when provided." });
    }

    await withTransaction(async (client) => {
      const { rows: userRows } = await client.query<{ id: number }>(
        `SELECT id FROM app_user WHERE id = $1 LIMIT 1`,
        [userId]
      );
      if (!userRows[0]) throw new AdminApiError(404, "User not found.");

      const { rows: planRows } = await client.query<{ id: number }>(
        `SELECT id FROM billing_plan WHERE code = $1 LIMIT 1`,
        [planCode]
      );
      const planId = planRows[0]?.id;
      if (!planId) {
        throw new AdminApiError(400, `Unknown billing plan code: ${planCode}`);
      }

      // Close any currently-accessible subscription before writing the new state.
      // This keeps billing access deterministic when admins change a user to non-active statuses.
      await client.query(
        `UPDATE billing_subscription
         SET status = 'canceled',
             canceled_at = COALESCE(canceled_at, now()),
             updated_at = now()
         WHERE user_id = $1
           AND status IN ('trialing', 'active', 'grace_period')
           AND canceled_at IS NULL`,
        [userId]
      );

      await client.query(
        `INSERT INTO billing_subscription (
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
         )`,
        [
          userId,
          planId,
          status,
          provider || "manual",
          providerCustomerId,
          providerSubscriptionId,
          startedAt || new Date().toISOString(),
          currentPeriodEnd ?? null,
          canceledAt ?? null,
          JSON.stringify((metadata as Record<string, unknown>) || {}),
        ]
      );
    });

    const user = await getAdminUserById(userId);
    return res.json({ user });
  } catch (e: any) {
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
    const overview = await getAutomationOverview();
    return res.json(overview);
  } catch (e: any) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.patch("/api/admin/ingestion/automation/:pipeline", requireAdminRole, async (req, res) => {
  try {
    const pipeline = parsePipeline(req.params.pipeline?.trim().toLowerCase());
    if (!pipeline) {
      return res.status(400).json({ error: "Invalid pipeline. Expected one of: news, weather, market." });
    }

    const patchInput: Record<string, unknown> = { ...(req.body || {}) };
    if (Object.prototype.hasOwnProperty.call(patchInput, "default_payload")) {
      patchInput.default_payload = sanitizeAutomationPayload(patchInput.default_payload);
    }
    const patch = parseAutomationRulePatch(patchInput);
    const rule = await updateAutomationRule(pipeline, patch);
    return res.json({ rule });
  } catch (e: any) {
    if (e instanceof AutomationValidationError || e instanceof IngestionValidationError || e instanceof AdminApiError) {
      return res.status(400).json({ error: e.message || String(e) });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// Admin ingestion orchestration (run + logs + metrics)
app.post("/api/admin/ingestion/news/run", requireAdminRole, async (req, res) => {
  try {
    const plan = buildNewsRunPlan(req.body || {});
    const run = await triggerNewsRun({
      actor: getRequestActor(res),
      plan,
    });
    const detail = await getRunDetail(run.runId, 150);
    if (!detail) return res.status(500).json({ error: "Failed to load created run." });
    return res.status(202).json(detail);
  } catch (e: any) {
    if (e instanceof IngestionValidationError) {
      return res.status(400).json({ error: e.message || String(e) });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/admin/ingestion/weather/run", requireAdminRole, async (req, res) => {
  try {
    const plan = buildWeatherRunPlan(req.body || {});
    const run = await triggerWeatherRun({
      actor: getRequestActor(res),
      plan,
    });
    const detail = await getRunDetail(run.runId, 150);
    if (!detail) return res.status(500).json({ error: "Failed to load created run." });
    return res.status(202).json(detail);
  } catch (e: any) {
    if (e instanceof IngestionValidationError) {
      return res.status(400).json({ error: e.message || String(e) });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/admin/ingestion/market/run", requireAdminRole, async (req, res) => {
  try {
    const plan = buildMarketRunPlan(req.body || {});
    const run = await triggerMarketRun({
      actor: getRequestActor(res),
      plan,
    });
    const detail = await getRunDetail(run.runId, 150);
    if (!detail) return res.status(500).json({ error: "Failed to load created run." });
    return res.status(202).json(detail);
  } catch (e: any) {
    if (e instanceof IngestionValidationError) {
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
    const runs = await listRuns({ pipeline, limit, offset });
    return res.json({ runs });
  } catch (e: any) {
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
    const detail = await getRunDetail(runId, logLimit);
    if (!detail) return res.status(404).json({ error: "Run not found." });
    return res.json(detail);
  } catch (e: any) {
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
    const logs = await getRunLogs(runId, { afterId, limit });
    return res.json({ logs });
  } catch (e: any) {
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
    const metrics = await getMetrics({ days, pipeline });
    return res.json(metrics);
  } catch (e: any) {
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
    const result = await ingestNewsApiEverything({ q, language, pageSize, maxPages });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Ingest NewsAPI 'top-headlines'
app.post("/api/ingest/newsapi/top-headlines", requireIngestionAccess, async (req, res) => {
  try {
    const { country, category, q, pageSize, maxPages } = req.body || {};
    const result = await ingestNewsApiTopHeadlines({ country, category, q, pageSize, maxPages });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Ingest TheNewsAPI '/news/top'
app.post("/api/ingest/thenewsapi/news", requireIngestionAccess, async (req, res) => {
  try {
    const { q, search, language, locale, pageSize, maxPages, publishedAfter } = req.body || {};
    const result = await ingestTheNewsApiNews({
      search: typeof search === "string" && search.trim() ? search : (typeof q === "string" ? q : undefined),
      language,
      locale,
      pageSize,
      maxPages,
      publishedAfter,
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Ingest OpenWeather current weather for countries (centroid-based)
app.post("/api/ingest/openweather/country-current", requireIngestionAccess, async (req, res) => {
  try {
    const { country } = req.body || {};
    const result = await ingestOpenWeatherCountryCurrent(typeof country === 'string' ? country : undefined);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Ingest Finnhub quotes for a symbol list (or defaults)
app.post("/api/ingest/finnhub/quotes", requireIngestionAccess, async (req, res) => {
  try {
    let symbols: string[] | undefined;
    try {
      const parsed = parseMarketSymbolsInput(req.body?.symbols);
      symbols = parsed.length > 0 ? parsed : undefined;
    } catch (validationError) {
      return res.status(400).json({
        error: validationError instanceof Error ? validationError.message : String(validationError),
      });
    }
    const result = await ingestFinnhubQuotes(symbols);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Latest weather per country for map overlay
app.get("/api/weather/country-latest", requireAuthenticated, async (_req, res) => {
  try {
    trackDemandSignal("weather");
    const rows = await getCountryWeatherLatest();
    res.json({ stats: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Latest market quotes with optional on-demand refresh for near real-time views
app.get("/api/market/quotes", requireAuthenticated, async (req, res) => {
  try {
    trackDemandSignal("market");
    let symbols: string[] | undefined;
    try {
      const parsed = parseMarketSymbolsInput(req.query.symbols);
      symbols = parsed.length > 0 ? parsed : undefined;
    } catch (validationError) {
      return res.status(400).json({
        error: validationError instanceof Error ? validationError.message : String(validationError),
      });
    }

    const refreshRaw = typeof req.query.refresh === "string" ? req.query.refresh.trim().toLowerCase() : "";
    const shouldRefresh =
      refreshRaw === "" ||
      refreshRaw === "1" ||
      refreshRaw === "true" ||
      refreshRaw === "yes" ||
      refreshRaw === "on";

    if (shouldRefresh) {
      await refreshMarketQuotesRealtime(symbols);
    }
    const quotes = await getMarketQuotesLatest(symbols);
    res.json({ quotes, refreshed: shouldRefresh, count: quotes.length });
  } catch (e: any) {
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
    const r = await fetch(url, { redirect: "follow" as any });
    if (!r.ok) {
      return res.status(r.status).send("upstream error");
    }
    const ct = r.headers.get("content-type") || "image/jpeg";
    res.setHeader("content-type", ct);
    res.setHeader("cache-control", "public, max-age=86400, s-maxage=86400, immutable");
    res.setHeader("access-control-allow-origin", "*");
    const buf = Buffer.from(await r.arrayBuffer());
    res.status(200).send(buf);
  } catch (e: any) {
    res.status(500).send("proxy error");
  }
});

startIngestionAutomationWorker();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API listening on http://0.0.0.0:${PORT}`);
});
