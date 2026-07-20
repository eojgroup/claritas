import { Pool } from "pg";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
};

const host = required("DB_HOST");
const port = parseInt(process.env.DB_PORT || "5432", 10);
const database = required("DB_NAME");
const user = required("DB_USER");
const password = required("DB_PASSWORD");
const connectionTimeoutMillis = Math.max(
  500,
  parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || "2500", 10) || 2500,
);

export const pool = new Pool({
  host,
  port,
  database,
  user,
  password,
  ssl: false,
  connectionTimeoutMillis,
});

export function isDatabaseUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  if (
    [
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
    ].includes(code)
  ) {
    return true;
  }
  if (
    message.includes("connection terminated") ||
    message.includes("connection timeout") ||
    message.includes("connection refused") ||
    message.includes("the database system is starting up")
  ) {
    return true;
  }
  return candidate.cause ? isDatabaseUnavailableError(candidate.cause) : false;
}

export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }>{
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return { rows: res.rows as T[] };
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
