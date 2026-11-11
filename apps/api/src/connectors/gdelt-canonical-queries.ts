// Select narrow numeric keys before fetching payloads. A text-cast output ID
// must never become the sort key, and fetching wide rows before LIMIT can make
// PostgreSQL prefer a full history scan even when the pending index is empty.
export function gdeltCanonicalPendingQuery(table: "item" | "news_signal"): string {
  return `WITH pending AS MATERIALIZED (
    SELECT id FROM ${table}
    WHERE source_id=$1 ${table === "item" ? "AND kind='news_article'" : ""}
      AND payload->>'canonical_url_algorithm' IS DISTINCT FROM $2
      AND id>$3::bigint
    ORDER BY ${table}.id LIMIT $4
  )
  SELECT ${table}.id::text,${table}.url,${table === "item" ? "item.external_id" : "NULLIF(news_signal.payload->>'raw_url','') AS raw_url"}
  FROM pending JOIN ${table} USING(id)
  ORDER BY ${table}.id`;
}

// EXISTS alone optimizes for finding a first row in the heap. Once all history
// is repaired, that becomes the worst case: scanning the whole table for none.
// Keep the bounded ordered index reads materialized for completion checks too.
export const gdeltCanonicalRemainingQuery = `WITH
  pending_items AS MATERIALIZED (
    SELECT id FROM item WHERE source_id=$1 AND kind='news_article'
      AND payload->>'canonical_url_algorithm' IS DISTINCT FROM $2
    ORDER BY item.id LIMIT 1
  ), pending_signals AS MATERIALIZED (
    SELECT id FROM news_signal WHERE source_id=$1
      AND payload->>'canonical_url_algorithm' IS DISTINCT FROM $2
    ORDER BY news_signal.id LIMIT 1
  )
  SELECT EXISTS(SELECT 1 FROM pending_items) AS items,
         EXISTS(SELECT 1 FROM pending_signals) AS signals`;
