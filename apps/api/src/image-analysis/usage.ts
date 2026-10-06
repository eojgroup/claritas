import { withTransaction } from "../db";
import { normalizeVisionDailyLimit } from "../earth-observation/openrouter-vision";
/** Atomic shared reservation. News photos use at most three of the daily requests. */
export async function reserveVisionRequest(source: "satellite" | "news" = "satellite") {
  const dailyLimit = normalizeVisionDailyLimit(process.env.EO_VISION_MAX_DAILY_REQUESTS);
  if (dailyLimit <= 0) return { reserved: false, dailyLimit };
  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('image-vision-daily-budget',0))`);
    if (source === "news") {
      const usage = await client.query<{ vision_requests: number }>(`SELECT vision_requests FROM news_image_collection_usage WHERE usage_date=(now() AT TIME ZONE 'UTC')::date`);
      if (Number(usage.rows[0]?.vision_requests ?? 0) >= Math.min(3,dailyLimit)) return { reserved: false,dailyLimit };
    }
    const { rows } = await client.query<{ process_requests: number }>(
      `INSERT INTO earth_provider_usage (provider,usage_date,process_requests)
       VALUES ('openrouter_vision',(now() AT TIME ZONE 'UTC')::date,1)
       ON CONFLICT (provider,usage_date) DO UPDATE SET
         process_requests=earth_provider_usage.process_requests+1,updated_at=now()
       WHERE earth_provider_usage.process_requests < $1 RETURNING process_requests`, [dailyLimit]);
    if (source === "news" && rows.length) await client.query(`INSERT INTO news_image_collection_usage(usage_date,vision_requests)
      VALUES ((now() AT TIME ZONE 'UTC')::date,1) ON CONFLICT (usage_date) DO UPDATE SET vision_requests=news_image_collection_usage.vision_requests+1`);
    return { reserved: rows.length > 0,dailyLimit,used: Number(rows[0]?.process_requests ?? dailyLimit) };
  });
}
