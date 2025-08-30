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
app.listen(PORT, "0.0.0.0", () => {
    console.log(`API listening on http://0.0.0.0:${PORT}`);
});
