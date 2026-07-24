"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.getDatabasePoolStats = getDatabasePoolStats;
exports.startDatabasePoolMonitoring = startDatabasePoolMonitoring;
exports.isDatabaseUnavailableError = isDatabaseUnavailableError;
exports.query = query;
exports.withTransaction = withTransaction;
const pg_1 = require("pg");
const required = (name) => {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing required env: ${name}`);
    return v;
};
const host = required("DB_HOST");
const port = parseInt(process.env.DB_PORT || "5432", 10);
const database = required("DB_NAME");
const user = required("DB_USER");
const password = required("DB_PASSWORD");
const connectionTimeoutMillis = Math.max(500, parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || "2500", 10) || 2500);
const poolMax = Math.max(1, Math.min(parseInt(process.env.DB_POOL_MAX || "5", 10) || 5, 20));
const idleTimeoutMillis = Math.max(5_000, Math.min(parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || "30000", 10) || 30_000, 300_000));
const maxLifetimeSeconds = Math.max(60, Math.min(parseInt(process.env.DB_POOL_MAX_LIFETIME_SECONDS || "1800", 10) || 1_800, 7_200));
const statementTimeoutMillis = Math.max(1_000, Math.min(parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || "15000", 10) || 15_000, 120_000));
const slowQueryMillis = Math.max(100, Math.min(parseInt(process.env.DB_SLOW_QUERY_MS || "750", 10) || 750, 60_000));
exports.pool = new pg_1.Pool({
    host,
    port,
    database,
    user,
    password,
    ssl: false,
    application_name: process.env.CLARITAS_DB_APPLICATION_NAME?.trim() || "claritas-api",
    max: poolMax,
    min: 0,
    idleTimeoutMillis,
    maxLifetimeSeconds,
    connectionTimeoutMillis,
    statement_timeout: statementTimeoutMillis,
    query_timeout: statementTimeoutMillis + 2_000,
});
exports.pool.on("error", (error) => {
    console.error(JSON.stringify({
        event: "database_pool_error",
        message: error.message,
        pool: getDatabasePoolStats(),
    }));
});
function getDatabasePoolStats() {
    return {
        max: poolMax,
        total: exports.pool.totalCount,
        idle: exports.pool.idleCount,
        waiting: exports.pool.waitingCount,
    };
}
let poolMonitorTimer = null;
function startDatabasePoolMonitoring() {
    if (poolMonitorTimer)
        return;
    const seconds = Math.max(10, Math.min(parseInt(process.env.DB_POOL_MONITOR_INTERVAL_SECONDS || "30", 10) || 30, 300));
    poolMonitorTimer = setInterval(() => {
        const stats = getDatabasePoolStats();
        if (stats.waiting > 0 || stats.total >= stats.max) {
            console.warn(JSON.stringify({
                event: "database_pool_pressure",
                ...stats,
            }));
        }
    }, seconds * 1_000);
    poolMonitorTimer.unref();
}
function isDatabaseUnavailableError(error) {
    if (!error || typeof error !== "object")
        return false;
    const candidate = error;
    const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
    const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
    if ([
        "ECONNREFUSED",
        "ECONNRESET",
        "ETIMEDOUT",
        "ENETUNREACH",
        "EHOSTUNREACH",
        "57P01",
        "57P02",
        "57P03",
        "08000",
        "08001",
        "08003",
        "08004",
        "08006",
        "08007",
        "08P01",
    ].includes(code)) {
        return true;
    }
    if (message.includes("connection terminated") ||
        message.includes("connection timeout") ||
        message.includes("connection refused") ||
        message.includes("the database system is starting up")) {
        return true;
    }
    return candidate.cause ? isDatabaseUnavailableError(candidate.cause) : false;
}
async function query(text, params) {
    const startedAt = Date.now();
    const client = await exports.pool.connect();
    try {
        const res = await client.query(text, params);
        return { rows: res.rows };
    }
    finally {
        client.release();
        const durationMs = Date.now() - startedAt;
        if (durationMs >= slowQueryMillis) {
            console.warn(JSON.stringify({
                event: "database_slow_query",
                duration_ms: durationMs,
                statement: text.replace(/\s+/g, " ").trim().slice(0, 180),
                pool: getDatabasePoolStats(),
            }));
        }
    }
}
async function withTransaction(fn) {
    const client = await exports.pool.connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    }
    catch (err) {
        await client.query("ROLLBACK");
        throw err;
    }
    finally {
        client.release();
    }
}
