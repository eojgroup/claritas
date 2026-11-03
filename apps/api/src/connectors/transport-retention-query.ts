const timestamps: Record<string, string> = {
  transport_track_point: "observed_at",
  transport_movement_event: "observed_at",
  transport_movement_hour: "bucket",
  transport_entity_activity_hour: "bucket",
  transport_country_activity_day: "bucket",
  transport_corridor_activity_day: "bucket",
  transport_snapshot: "observed_at",
};

export function buildTransportRetentionBatchQuery(table: string, timestampColumn: string): string {
  if (timestamps[table] !== timestampColumn) throw new Error("Invalid transport retention target.");
  return `WITH candidates AS MATERIALIZED (
    SELECT ctid, ${timestampColumn} AS expired_at FROM ${table}
    WHERE ${timestampColumn}<now()-($1*interval '1 day')
    -- Thousands of entities share an hourly bucket. Sorting that complete
    -- bucket by physical tuple address defeats the indexed LIMIT.
    ORDER BY ${timestampColumn} LIMIT ($2+1) FOR UPDATE SKIP LOCKED
  ), doomed AS (
    SELECT ctid FROM candidates ORDER BY expired_at LIMIT $2
  ), removed AS (
    DELETE FROM ${table} target USING doomed WHERE target.ctid=doomed.ctid RETURNING 1
  ) SELECT count(*) AS deleted,
    (SELECT min(candidate.expired_at) FROM candidates candidate
     LEFT JOIN doomed USING(ctid) WHERE doomed.ctid IS NULL) AS oldest_expired_at
  FROM removed`;
}
