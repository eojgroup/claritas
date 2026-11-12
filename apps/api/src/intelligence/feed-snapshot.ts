import { query, withTransaction } from "../db";
import type { QueryConfig } from "pg";
import type { IntelligenceEventListOptions, IntelligenceFeedEvent } from "./service";

const PAGE_SIZE = 100;
const REFRESH_MS = 120_000;

/** Country/type/archive searches retain their exact, scoped query path. */
export async function readPreparedIntelligenceFeed(options: IntelligenceEventListOptions,
  read: typeof query = query): Promise<{ generated_at: string; events: IntelligenceFeedEvent[] } | null> {
  const limit = Math.min(PAGE_SIZE, Math.max(1, Math.trunc(options.limit ?? 30)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  if (options.status || options.severity || options.country || options.locationId || options.eventType
    || options.since || options.includeExpired || offset + limit > PAGE_SIZE) return null;
  const { rows } = await read<{ generated_at: string; events: IntelligenceFeedEvent[] }>(
    `SELECT generated_at,events FROM intelligence_feed_snapshot WHERE singleton=true AND schema_version=1
      AND generated_at>now()-interval '10 minutes'`);
  const saved = rows[0];
  return saved ? { ...saved, events: saved.events.slice(offset, offset + limit) } : null;
}

/** Expensive global ranking happens once per refresh, never per reader. */
export async function refreshPreparedIntelligenceFeed() {
  const saved = (await query<{ generated_at: Date }>(
    "SELECT generated_at FROM intelligence_feed_snapshot WHERE singleton=true AND schema_version=1")).rows[0];
  if (saved && Date.now() - new Date(saved.generated_at).getTime() < REFRESH_MS) return;
  const generatedAt = new Date();
  const { rankIntelligenceEvents } = await import("./service");
  await withTransaction(async (client) => {
    await client.query("SET LOCAL jit=off");
    // A bounded background build may take longer than the interactive budget.
    await client.query("SET LOCAL statement_timeout='30s'");
    const read: typeof query = async (text, values) => {
      const config: QueryConfig & { query_timeout: number } = { text, values, query_timeout: 35_000 };
      return { rows: (await client.query(config)).rows };
    };
    const events = await rankIntelligenceEvents({ limit: PAGE_SIZE }, read);
    await client.query(`INSERT INTO intelligence_feed_snapshot(singleton,schema_version,generated_at,events)
      VALUES(true,1,$1,$2::jsonb) ON CONFLICT(singleton) DO UPDATE
      SET schema_version=1,generated_at=EXCLUDED.generated_at,events=EXCLUDED.events`, [generatedAt, JSON.stringify(events)]);
    console.info(JSON.stringify({ event: "intelligence_feed_prepared", count: events.length, duration_ms: Date.now() - generatedAt.getTime() }));
  });
}
