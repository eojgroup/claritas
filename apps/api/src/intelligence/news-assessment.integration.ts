import assert from "node:assert/strict";
import test from "node:test";
import { pool, query } from "../db";
import { newsEvidenceItemIdSql } from "../news-assessment-worker";

test("news publisher lookup rejects malformed identities without losing valid bigint IDs", async () => {
  const ids = [
    "1", "9223372036854775807", "0", "01", "-1", "1.0",
    "9223372036854775808", "999999999999999999999999", "report/not-an-item", "",
    " 1", "1 ", "+1", "١", "0001", "1\n", "1e3", null,
  ];
  const { rows } = await query<{ source_record_id: string | null; item_id: string | null }>(
    `SELECT evidence.source_record_id,(${newsEvidenceItemIdSql("evidence")})::text AS item_id
     FROM unnest($1::text[]) WITH ORDINALITY AS evidence(source_record_id, ordinal)
     ORDER BY ordinal`, [ids],
  );
  assert.deepEqual(rows.map((row) => row.item_id), [
    "1", "9223372036854775807", ...Array(ids.length - 2).fill(null),
  ]);
});

test("indexed publisher lookup preserves independent publisher counts and accepted-source gating", async () => {
  const { rows } = await query<{ publishers: number }>(
    `WITH publisher_item(id,url,payload,source_name) AS (VALUES
       (1::bigint,'https://www.example.org/report-a','{}'::jsonb,'institutional_rss'),
       (2::bigint,'https://example.org/report-b','{}'::jsonb,'institutional_rss'),
       (3::bigint,'https://another.example/report','{"quality_status":"accepted"}'::jsonb,'gdelt'),
       (4::bigint,'https://rejected.example/report','{"quality_status":"rejected"}'::jsonb,'gdelt')
     ), publisher_evidence(source_record_type,source_record_id) AS (VALUES
       ('item','1'),('item','2'),('item','3'),('item','4'),
       ('item','01'),('item','9223372036854775808'),('item','invalid'),('social','3')
     )
     SELECT count(DISTINCT canonical_news_publisher_key(publisher_item.url,publisher_item.payload,publisher_item.source_name))::int AS publishers
     FROM publisher_evidence JOIN publisher_item
       ON publisher_evidence.source_record_type='item'
      AND publisher_item.id=${newsEvidenceItemIdSql("publisher_evidence")}
     WHERE lower(publisher_item.source_name)<>'gdelt' OR publisher_item.payload->>'quality_status'='accepted'`,
  );
  assert.equal(rows[0].publishers, 2);
});

test.after(async () => { await pool.end(); });
