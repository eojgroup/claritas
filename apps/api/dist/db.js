"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
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
exports.pool = new pg_1.Pool({
    host,
    port,
    database,
    user,
    password,
    ssl: false,
    connectionTimeoutMillis,
});
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
    const client = await exports.pool.connect();
    try {
        const res = await client.query(text, params);
        return { rows: res.rows };
    }
    finally {
        client.release();
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
