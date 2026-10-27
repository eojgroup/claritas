import assert from "node:assert/strict";
import test from "node:test";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

test("parallel authenticated reads avoid activity writes while still checking permissions each time", async (t) => {
  const { pool } = await import("./db");
  const { requireAuth } = await import("./auth");
  const statements: string[] = [];
  let revoked = false;
  let activityDue = false;
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes("FROM auth_session s")) {
        return { rows: revoked ? [] : [{ session_id: "1", user_id: "2", email: null,
          display_name: null, avatar_url: null, roles: [], refresh_activity: activityDue }] };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => client as never);
  const middleware = requireAuth();
  const request = { headers: { authorization: "Bearer test-session" } } as any;
  const invoke = async () => {
    let status = 200;
    let passed = false;
    const response = { locals: {}, status: (value: number) => { status = value; return response; },
      json: () => {}, setHeader: () => {} } as any;
    await middleware(request, response, () => { passed = true; });
    return { status, passed };
  };

  const reads = await Promise.all(Array.from({ length: 8 }, invoke));
  assert.ok(reads.every((result) => result.passed));
  assert.equal(statements.filter((sql) => sql.includes("FROM auth_session s")).length, 8);
  assert.equal(statements.filter((sql) => sql.includes("UPDATE auth_session")).length, 0);
  for (const sql of statements.filter((sql) => sql.includes("FROM auth_session s"))) {
    assert.match(sql, /s\.revoked_at IS NULL/);
    assert.match(sql, /s\.expires_at > now\(\)/);
    assert.match(sql, /u\.is_active = true/);
  }

  activityDue = true;
  assert.equal((await invoke()).passed, true);
  const update = statements.find((sql) => sql.includes("UPDATE auth_session"));
  assert.match(update ?? "", /WHERE id = \$1 AND \(last_seen_at IS NULL OR last_seen_at <= now\(\) - interval '1 minute'\)/);
  revoked = true;
  assert.deepEqual(await invoke(), { status: 401, passed: false });
});
