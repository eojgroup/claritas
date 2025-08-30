"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const newsapi_1 = require("./connectors/newsapi");
const db_1 = require("./db");
const app = (0, express_1.default)();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.use(express_1.default.json());
app.get("/api/hello", (_req, res) => res.json({ hello: "world" }));
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
app.get("/api/news", async (req, res) => {
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
app.get("/api/news/country-stats", async (req, res) => {
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
// Ingest NewsAPI 'everything'
app.post("/api/ingest/newsapi/everything", async (req, res) => {
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
app.post("/api/ingest/newsapi/top-headlines", async (req, res) => {
    try {
        const { country, category, q, pageSize, maxPages } = req.body || {};
        const result = await (0, newsapi_1.ingestNewsApiTopHeadlines)({ country, category, q, pageSize, maxPages });
        res.json(result);
    }
    catch (e) {
        res.status(500).json({ error: e.message || String(e) });
    }
});
// Lightweight image proxy for remote thumbnails that block hotlinking
app.get("/api/proxy-image", async (req, res) => {
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
