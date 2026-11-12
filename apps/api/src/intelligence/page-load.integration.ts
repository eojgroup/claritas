import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Pool, type PoolClient } from "pg";

function disposableDatabase() {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  // Deliberate table locks are permitted only on the disposable local/CI DB.
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(DB_HOST || ""), "page-load test requires a loopback test database");
  assert.ok(["15439", "54329"].includes(DB_PORT || ""), "page-load test requires the local or CI disposable database port");
  assert.equal(DB_NAME, "claritas");
  assert.equal(DB_USER, "postgres");
  assert.equal(DB_PASSWORD, "claritas_test", "page-load test requires disposable database credentials");
  return { host: DB_HOST, port: Number(DB_PORT), database: DB_NAME, user: DB_USER, password: DB_PASSWORD };
}

async function availablePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function within<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function until(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(25);
  }
  throw new Error(message);
}

type ReadResponse = { path: string; status: number; body: any; poolWaiting: string | null };
type OptionalResponse = { response: ReadResponse } | { error: unknown };

test("authenticated overview page and readiness survive a real HTTP burst of blocked optional reads", { timeout: 45_000 }, async () => {
  const database = disposableDatabase();
  const fixture = randomUUID();
  const applicationName = `claritas-page-load-${fixture}`;
  const pool = new Pool({ ...database, max: 2, connectionTimeoutMillis: 5_000, statement_timeout: 10_000 });
  const token = randomBytes(32).toString("hex");
  const requestAbort = new AbortController();
  let userID: string | undefined;
  let blocker: PoolClient | undefined;
  let child: ChildProcess | undefined;
  let childClosed: Promise<void> | undefined;
  let spawnError: Error | undefined;
  let serverOutput = "";
  let optionalRequests: Promise<OptionalResponse>[] = [];
  let optionalFinished = 0;

  try {
    const apiDirectory = path.resolve(__dirname, "../..");
    const entry = path.join(apiDirectory, "dist/index.js");
    await access(entry);
    const account = await pool.query<{ id: string }>(
      "INSERT INTO app_user(email,email_verified,display_name) VALUES($1,true,'HTTP page-load fixture') RETURNING id",
      [`page-load-${fixture}@example.invalid`],
    );
    userID = account.rows[0].id;
    const role = await pool.query(
      "INSERT INTO auth_user_role(user_id,role_id) SELECT $1,id FROM auth_role WHERE key='admin' RETURNING role_id", [userID],
    );
    assert.equal(role.rowCount, 1, "fixture must use real admin billing access rather than bypassing auth middleware");
    await pool.query(
      "INSERT INTO auth_session(user_id,session_token_hash,expires_at,last_seen_at) VALUES($1,$2,now()+interval '1 hour',now())",
      [userID, createHash("sha256").update(token).digest("hex")],
    );
    await pool.query(`INSERT INTO intelligence_event(id,dedupe_key,event_type,title,summary,start_time,last_activity_time)
      VALUES($1::uuid,$1::text,'transport_activity_anomaly','Port movement anomaly','Observed movement comparison',now(),now())`, [fixture]);
    await pool.query(`INSERT INTO intelligence_event_evidence(event_id,domain,evidence_type,source_record_type,source_record_id,observed_at,confidence,relationship,provenance)
      VALUES($1::uuid,'transport','rolling_baseline_anomaly','fixture',$1::text,now(),0.7,'observed','{}')`, [fixture]);

    const port = await availablePort();
    const origin = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [entry], {
      cwd: apiDirectory,
      env: {
        ...process.env,
        PORT: String(port), CLARITAS_RUNTIME_ROLE: "api", CLARITAS_DB_APPLICATION_NAME: applicationName,
        DB_POOL_MAX: "5", DB_CONNECTION_TIMEOUT_MS: "2500", DB_STATEMENT_TIMEOUT_MS: "15000",
        PAYWALL_ENABLED: "true", PAYWALL_BYPASS_ROLES: "admin",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.once("error", (error) => { spawnError = error; });
    childClosed = new Promise<void>((resolve) => child!.once("close", () => resolve()));
    const recordOutput = (chunk: Buffer) => { serverOutput = (serverOutput + chunk.toString()).slice(-12_000); };
    child.stdout!.on("data", recordOutput);
    child.stderr!.on("data", recordOutput);
    await until(async () => {
      if (spawnError) throw spawnError;
      assert.equal(child!.exitCode, null, `API exited during startup:\n${serverOutput}`);
      try {
        const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(500) });
        await response.text();
        return response.status === 200;
      } catch { return false; }
    }, `API did not start:\n${serverOutput}`);

    const read = async (route: string, authenticated = true): Promise<ReadResponse> => {
      const response = await fetch(`${origin}${route}`, {
        headers: authenticated ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.any([requestAbort.signal, AbortSignal.timeout(12_000)]),
      });
      const text = await response.text();
      let body: any = text;
      try { body = JSON.parse(text); } catch { /* readiness is plain text */ }
      return { path: route, status: response.status, body, poolWaiting: response.headers.get("X-Claritas-DB-Pool-Waiting") };
    };
    const unauthorized = await read("/api/intelligence/overview", false);
    assert.equal(unauthorized.status, 401, "spawned application must enforce actual paid-access authentication");

    blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SET LOCAL lock_timeout='8s'");
    // Actual optional routes wait on these fixture locks after their normal
    // session/billing checks, filling both optional admission slots.
    await blocker.query("LOCK TABLE weather_snapshot,market_indicator IN ACCESS EXCLUSIVE MODE");
    const blockedOptionalQueries = async () => {
      const { rows } = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM pg_stat_activity
         WHERE application_name=$1 AND wait_event_type='Lock'
           AND (query LIKE '%weather_snapshot%' OR query LIKE '%market_indicator%')`, [applicationName],
      );
      return rows[0].count;
    };
    const optionalPaths = ["/api/weather/country-latest", "/api/market/countries", "/api/transport/overview?detail=aggregate&refresh=false"];
    optionalRequests = Array.from({ length: 24 }, (_unused, index) => read(optionalPaths[index % optionalPaths.length])
      .then((response): OptionalResponse => ({ response }), (error): OptionalResponse => ({ error }))
      .finally(() => { optionalFinished++; }));
    await until(async () => await blockedOptionalQueries() >= 2, "optional HTTP reads never occupied both reserved optional query slots");

    const routes = ["/api/auth/me", "/api/auth/providers", "/api/intelligence/overview?hours=24&priority=high", "/api/briefings/daily/latest", `/api/intelligence/events/${fixture}`, "/readyz"];
    const core = await within(Promise.all(routes.map((route) => read(route))), 10_000,
      "core page waited behind optional HTTP requests instead of using reserved reader capacity");
    for (const response of core) {
      assert.equal(response.status, 200, `${response.path}: ${JSON.stringify(response.body)}\n${serverOutput}`);
    }
    const auth = core.find((response) => response.path === "/api/auth/me")!.body;
    assert.equal(String(auth.user.id), userID);
    assert.equal(auth.user.billing.has_access, true);
    assert.equal(auth.user.billing.reason, "admin_override");
    assert.ok(Array.isArray(core.find((response) => response.path === "/api/auth/providers")!.body.providers));
    const overview = core.find((response) => response.path.startsWith("/api/intelligence/overview"))!.body;
    assert.equal(overview.filters.priority, "high");
    assert.ok(["warming", "fresh", "stale"].includes(overview.snapshot.status));
    assert.ok(Array.isArray(overview.buckets));
    const detail = core.find((response) => response.path === `/api/intelligence/events/${fixture}`)!.body;
    assert.equal(detail.event.id, fixture);
    assert.equal(detail.context_included, false);
    assert.equal(detail.regional_reporting, null, "unrequested object-valued context must never be an array");
    assert.ok(Object.hasOwn(core.find((response) => response.path === "/api/briefings/daily/latest")!.body, "briefing"));
    assert.equal(core.find((response) => response.path === "/readyz")!.body, "ready");
    assert.equal(core.find((response) => response.path === "/readyz")!.poolWaiting, "0");
    assert.ok(optionalFinished < 24, "core must finish while the optional HTTP backlog remains blocked");
    assert.ok(await blockedOptionalQueries() >= 2, "optional DB locks must still be held when core responses finish");

    await blocker.query("ROLLBACK");
    blocker.release();
    blocker = undefined;
    const optional = await within(Promise.all(optionalRequests), 10_000, "optional HTTP reads did not drain after releasing their fixture locks");
    for (const result of optional) {
      assert.ok("response" in result, `optional request failed: ${"error" in result ? String(result.error) : ""}`);
      assert.equal(result.response.status, 200, `${result.response.path}: ${JSON.stringify(result.response.body)}\n${serverOutput}`);
    }
  } finally {
    try {
      if (blocker) {
        await blocker.query("ROLLBACK").catch(() => undefined);
        blocker.release();
      }
      requestAbort.abort();
      await within(Promise.allSettled(optionalRequests), 3_000, "optional request cleanup timed out").catch(() => undefined);
      if (child && childClosed) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        await within(childClosed, 2_000, "API did not stop after SIGTERM").catch(async () => {
          child!.kill("SIGKILL");
          await within(childClosed!, 2_000, "API did not stop after SIGKILL");
        });
      }
    } finally {
      try {
        await pool.query("DELETE FROM intelligence_event WHERE id=$1", [fixture]);
        if (userID) await pool.query("DELETE FROM app_user WHERE id=$1", [userID]);
      } finally { await pool.end(); }
    }
  }
});
