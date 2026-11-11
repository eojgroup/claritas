const READY_SQL = `SELECT state.generated_at,state.pending_events,
  (SELECT count(*)::int FROM intelligence_overview_snapshot snapshot WHERE snapshot.generation_id=state.generation_id) AS snapshots,
  (SELECT count(*)::int FROM intelligence_overview_snapshot snapshot WHERE snapshot.generation_id=state.generation_id
    AND snapshot.payload ?& ARRAY['countries','map_events','visual_events']) AS coverage_snapshots,
  refresh.scanned_events
  FROM (SELECT 1) anchor LEFT JOIN intelligence_overview_state state ON state.singleton=true
  LEFT JOIN intelligence_overview_refresh refresh ON refresh.singleton=true`;

async function waitForOverviewSnapshot({ read, timeoutMs = 1_200_000, pollMs = 5000,
  now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log = console.log }) {
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    let row;
    try { row = (await read(READY_SQL)).rows[0] ?? {}; }
    catch (error) {
      if (["42P01", "42703", "42601", "42501"].includes(error?.code)) throw error;
      log(JSON.stringify({ event: "overview_snapshot_status_retry" }));
      await sleep(pollMs);
      continue;
    }
    const generated = Date.parse(row.generated_at ?? "");
    if (Number(row.snapshots) === 6 && Number(row.coverage_snapshots) === 6 && Number(row.pending_events ?? 0) === 0 && Number.isFinite(generated) && now() - generated < 180_000) {
      log(JSON.stringify({ event: "overview_snapshot_ready", generated_at: row.generated_at, snapshots: 6 }));
      return;
    }
    log(JSON.stringify({ event: "overview_snapshot_warming", scanned_events: Number(row.scanned_events ?? 0), snapshots: Number(row.snapshots ?? 0), coverage_snapshots: Number(row.coverage_snapshots ?? 0), pending_events: Number(row.pending_events ?? 0) }));
    await sleep(pollMs);
  }
  throw new Error("Complete overview snapshots were not ready before the release deadline.");
}
module.exports = { waitForOverviewSnapshot };
if (!module.parent) {
  const { pool } = require(`${process.cwd()}/dist/db.js`);
  waitForOverviewSnapshot({ read: (sql) => pool.query(sql) })
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
