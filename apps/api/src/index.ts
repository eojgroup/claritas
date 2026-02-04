import express from "express";
import { ingestNewsApiEverything, ingestNewsApiTopHeadlines } from "./connectors/newsapi";
import { getCountryWeatherLatest, ingestOpenWeatherCountryCurrent } from "./connectors/openweather";
import { pool } from "./db";
import authRouter, { requireAuth, requireRole } from "./auth";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

app.set("trust proxy", 1);
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.get("/api/hello", (_req, res) => res.json({ hello: "world" }));
app.use("/api/auth", authRouter);

const requireAdminRole = requireRole("admin");
const requireAuthenticated = requireAuth();

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

// List recent news items with optional filters
app.get("/api/news", requireAuthenticated, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || "20"), 10) || 20, 1), 200);
    const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const country = typeof req.query.country === "string" ? req.query.country.trim().toUpperCase() : "";

    const params: any[] = [];
    const where: string[] = [];
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
    const { rows } = await pool.query(sql, params);
    res.json({ items: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Aggregate counts by country (for map bubbles)
app.get("/api/news/country-stats", requireAuthenticated, async (req, res) => {
  try {
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

// Latest weather per country for map overlay
app.get("/api/weather/country-latest", requireAuthenticated, async (_req, res) => {
  try {
    const rows = await getCountryWeatherLatest();
    res.json({ stats: rows });
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API listening on http://0.0.0.0:${PORT}`);
});
