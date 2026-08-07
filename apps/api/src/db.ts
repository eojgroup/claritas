import { Pool } from "pg";
import { randomUUID } from "crypto";

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
const poolMax = Math.max(
  1,
  Math.min(parseInt(process.env.DB_POOL_MAX || "5", 10) || 5, 20),
);
const idleTimeoutMillis = Math.max(
  5_000,
  Math.min(
    parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || "30000", 10) || 30_000,
    300_000,
  ),
);
const maxLifetimeSeconds = Math.max(
  60,
  Math.min(
    parseInt(process.env.DB_POOL_MAX_LIFETIME_SECONDS || "1800", 10) || 1_800,
    7_200,
  ),
);
const statementTimeoutMillis = Math.max(
  1_000,
  Math.min(
    parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || "15000", 10) || 15_000,
    120_000,
  ),
);
const slowQueryMillis = Math.max(
  100,
  Math.min(parseInt(process.env.DB_SLOW_QUERY_MS || "750", 10) || 750, 60_000),
);

export const pool = new Pool({
  host,
  port,
  database,
  user,
  password,
  ssl: false,
  application_name:
    process.env.CLARITAS_DB_APPLICATION_NAME?.trim() || "claritas-api",
  max: poolMax,
  min: 0,
  idleTimeoutMillis,
  maxLifetimeSeconds,
  connectionTimeoutMillis,
  statement_timeout: statementTimeoutMillis,
  query_timeout: statementTimeoutMillis + 2_000,
});

pool.on("error", (error) => {
  console.error(
    JSON.stringify({
      event: "database_pool_error",
      message: error.message,
      pool: getDatabasePoolStats(),
    }),
  );
});

export function getDatabasePoolStats() {
  return {
    max: poolMax,
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

let poolMonitorTimer: NodeJS.Timeout | null = null;

export function startDatabasePoolMonitoring(): void {
  if (poolMonitorTimer) return;
  const seconds = Math.max(
    10,
    Math.min(
      parseInt(process.env.DB_POOL_MONITOR_INTERVAL_SECONDS || "30", 10) || 30,
      300,
    ),
  );
  poolMonitorTimer = setInterval(() => {
    const stats = getDatabasePoolStats();
    if (stats.waiting > 0 || stats.total >= stats.max) {
      console.warn(
        JSON.stringify({
          event: "database_pool_pressure",
          ...stats,
        }),
      );
    }
  }, seconds * 1_000);
  poolMonitorTimer.unref();
}

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
  const startedAt = Date.now();
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return { rows: res.rows as T[] };
  } finally {
    client.release();
    const durationMs = Date.now() - startedAt;
    if (durationMs >= slowQueryMillis) {
      console.warn(
        JSON.stringify({
          event: "database_slow_query",
          duration_ms: durationMs,
          statement: text.replace(/\s+/g, " ").trim().slice(0, 180),
          pool: getDatabasePoolStats(),
        }),
      );
    }
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

const workerLeaseOwnerId = `${process.pid}-${randomUUID()}`;

/**
 * Coordinates short background cycles without holding a pool connection while
 * the cycle performs its own database work. The lease is renewed for longer
 * cycles and expires automatically if the process terminates.
 */
export async function withWorkerLease(
  workerName: string,
  leaseSeconds: number,
  task: () => Promise<void>,
): Promise<boolean> {
  const boundedLeaseSeconds = Math.max(30, Math.min(Math.trunc(leaseSeconds), 600));
  const { rows } = await query<{ acquired: boolean }>(
    `INSERT INTO background_worker_lease (worker_name, owner_id, lease_until, updated_at)
     VALUES ($1, $2, now() + make_interval(secs => $3::int), now())
     ON CONFLICT (worker_name)
     DO UPDATE SET
       owner_id = EXCLUDED.owner_id,
       lease_until = EXCLUDED.lease_until,
       updated_at = now()
     WHERE background_worker_lease.lease_until <= now()
        OR background_worker_lease.owner_id = EXCLUDED.owner_id
     RETURNING true AS acquired`,
    [workerName, workerLeaseOwnerId, boundedLeaseSeconds],
  );
  if (!rows[0]?.acquired) return false;

  const renewal = setInterval(() => {
    void query(
      `UPDATE background_worker_lease
       SET lease_until = now() + make_interval(secs => $3::int),
           updated_at = now()
       WHERE worker_name = $1
         AND owner_id = $2`,
      [workerName, workerLeaseOwnerId, boundedLeaseSeconds],
    ).catch((error) => {
      console.warn(
        JSON.stringify({
          event: "background_worker_lease_renewal_failed",
          worker: workerName,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }, Math.max(10_000, Math.floor((boundedLeaseSeconds * 1_000) / 3)));
  renewal.unref();

  try {
    await task();
    return true;
  } finally {
    clearInterval(renewal);
    await query(
      `UPDATE background_worker_lease
       SET lease_until = now(),
           updated_at = now()
       WHERE worker_name = $1
         AND owner_id = $2`,
      [workerName, workerLeaseOwnerId],
    ).catch((error) => {
      console.warn(
        JSON.stringify({
          event: "background_worker_lease_release_failed",
          worker: workerName,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }
}
