import { query, withWorkerLease } from "./db";
import {
  assessNewsItem,
  NEWS_ASSESSMENT_METHODOLOGY,
  type NewsAssessmentLinkedEvent,
} from "./news-intelligence";

type AssessmentCandidateRow = {
  id: number | string;
  title: string | null;
  summary: string | null;
  event_time: string | Date | null;
  created_at: string | Date | null;
  payload: unknown;
  source_name: string;
  linked_events: NewsAssessmentLinkedEvent[] | null;
  assessment_watermark: string | Date;
  queue_revision: number | string;
};

let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = false;

function enabledUnlessFalse(name: string): boolean {
  return !["0", "false", "no", "off"].includes(process.env[name]?.trim().toLowerCase() ?? "");
}

function integerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}

// Keep the live reader current during methodology upgrades and source replay.
// Within each time window the oldest assessment goes first, so a repeatedly
// updated article cannot monopolise the batch.
export const NEWS_ASSESSMENT_QUEUE_PRIORITY_SQL = `CASE
  WHEN item.event_time>=now()-interval '4 hours'
   AND item.event_time<=now()+interval '5 minutes' THEN 0
  WHEN item.event_time>=now()-interval '8 days'
   AND item.event_time<=now()+interval '5 minutes' THEN 1
  WHEN assessment.item_id IS NOT NULL THEN 2
  ELSE 3 END`;

/**
 * Evidence identities are strings shared by several domains. Convert only a
 * canonical positive bigint item ID, so malformed/overflow IDs remain absent
 * evidence and the join can use item_pkey instead of scanning item.id::text.
 */
export function newsEvidenceItemIdSql(evidenceAlias: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(evidenceAlias)) throw new Error("Invalid evidence SQL alias.");
  const id = `${evidenceAlias}.source_record_id`;
  return `CASE
    WHEN ${id} ~ '^[1-9][0-9]{0,18}$'
     AND (length(${id}) < 19 OR ${id} COLLATE "C" <= '9223372036854775807' COLLATE "C")
    THEN ${id}::bigint END`;
}

/** Advance only a fixed item-ID slice, even when that slice is ineligible. */
export async function seedNewsAssessmentQueue(scanSize = 500): Promise<void> {
  await query(
    `INSERT INTO news_assessment_queue_state(singleton,methodology_version)
     VALUES(true,$1)
     ON CONFLICT(singleton) DO UPDATE SET methodology_version=EXCLUDED.methodology_version,
       backfill_before_item_id=9223372036854775807
     WHERE news_assessment_queue_state.methodology_version<>EXCLUDED.methodology_version`,
    [NEWS_ASSESSMENT_METHODOLOGY],
  );
  await query(
    `WITH state AS MATERIALIZED (
       SELECT backfill_before_item_id FROM news_assessment_queue_state
       WHERE singleton AND methodology_version=$1 AND backfill_before_item_id>0 FOR UPDATE
     ), scanned AS MATERIALIZED (
       SELECT item.id FROM state JOIN item ON item.id<=state.backfill_before_item_id
       ORDER BY item.id DESC LIMIT $2
     ), seeded AS (
       INSERT INTO news_assessment_queue(item_id,due_at,priority)
       SELECT item.id,statement_timestamp(),news_assessment_priority(item.event_time)
       FROM scanned JOIN item ON item.id=scanned.id JOIN source ON source.id=item.source_id
       WHERE item.kind='news_article'
         AND (lower(source.name)<>'gdelt' OR item.payload->>'quality_status'='accepted')
       ORDER BY item.id
       ON CONFLICT(item_id) DO UPDATE SET
         due_at=LEAST(news_assessment_queue.due_at,EXCLUDED.due_at),
         priority=EXCLUDED.priority,revision=news_assessment_queue.revision+1
       RETURNING item_id
     )
     UPDATE news_assessment_queue_state SET
       backfill_before_item_id=COALESCE((SELECT min(id)-1 FROM scanned),0)
     WHERE singleton AND methodology_version=$1 AND EXISTS(SELECT 1 FROM state)
     RETURNING (SELECT count(*)::int FROM seeded) AS seeded`,
    [NEWS_ASSESSMENT_METHODOLOGY, Math.min(2_000, Math.max(1, Math.trunc(scanSize)))],
  );
}

/** Fan out event invalidations outside source/event writer transactions. */
export async function expandNewsAssessmentEvents(batchSize = 100): Promise<void> {
  await query(
    `WITH events AS MATERIALIZED (
       SELECT event_id,revision FROM news_assessment_event_queue ORDER BY enqueued_at,event_id LIMIT $1
     ), items AS MATERIALIZED (
       SELECT DISTINCT item.id,item.event_time
       FROM events JOIN intelligence_event_evidence evidence ON evidence.event_id=events.event_id
       JOIN item ON item.id=${newsEvidenceItemIdSql("evidence")}
       JOIN source ON source.id=item.source_id
       WHERE evidence.domain='news' AND evidence.source_record_type='item' AND item.kind='news_article'
         AND (lower(source.name)<>'gdelt' OR item.payload->>'quality_status'='accepted')
     ), queued AS (
       INSERT INTO news_assessment_queue(item_id,due_at,priority)
       SELECT id,statement_timestamp(),news_assessment_priority(event_time) FROM items ORDER BY id
       ON CONFLICT(item_id) DO UPDATE SET
         due_at=LEAST(news_assessment_queue.due_at,EXCLUDED.due_at),
         priority=EXCLUDED.priority,revision=news_assessment_queue.revision+1
       RETURNING item_id
     )
     DELETE FROM news_assessment_event_queue pending USING events
     WHERE pending.event_id=events.event_id AND pending.revision=events.revision
       AND (SELECT count(*) FROM queued)>=0`,
    [Math.min(100, Math.max(1, Math.trunc(batchSize)))],
  );
}

/** Wake at the governed age boundaries, just after their inclusive cutoff. */
export function nextNewsAssessmentRefresh(eventTime: string | Date | null, assessedAt: Date): string | null {
  if (!eventTime) return null;
  const publishedAt = new Date(eventTime).getTime();
  if (!Number.isFinite(publishedAt)) return null;
  const boundaries = [-5 / 60, 1, 6, 24, 72, 168];
  const next = boundaries.map((hours) => publishedAt + hours * 3_600_000 + 1)
    .find((time) => time > assessedAt.getTime());
  return next === undefined ? null : new Date(next).toISOString();
}

export async function assessPendingNewsItems(batchSize = integerEnv("NEWS_ASSESSMENT_BATCH_SIZE", 200, 1, 200)) {
  const boundedBatch = Math.max(1, Math.min(Math.trunc(batchSize), 200));
  await seedNewsAssessmentQueue();
  await expandNewsAssessmentEvents();
  const { rows } = await query<AssessmentCandidateRow>(
    `WITH candidates AS MATERIALIZED (
       SELECT due.item_id,due.revision,due.priority,due.due_at
       FROM (VALUES(0),(1),(2)) AS priority(value)
       CROSS JOIN LATERAL (
         SELECT pending.item_id,pending.revision,pending.priority,pending.due_at
         FROM news_assessment_queue pending
         WHERE pending.priority=priority.value AND pending.due_at<=statement_timestamp()
         ORDER BY pending.due_at,pending.item_id LIMIT $1
       ) due
       ORDER BY due.priority,due.due_at,due.item_id LIMIT $1
     ), discarded AS (
       DELETE FROM news_assessment_queue pending USING candidates,item,source
       WHERE pending.item_id=candidates.item_id AND pending.revision=candidates.revision
         AND item.id=candidates.item_id AND source.id=item.source_id
         AND (item.kind IS DISTINCT FROM 'news_article'
              OR (lower(source.name)='gdelt' AND item.payload->>'quality_status' IS DISTINCT FROM 'accepted'))
     )
     SELECT item.id,item.title,item.summary,item.event_time,item.created_at,item.payload,
            source.name AS source_name,
            COALESCE(linked.linked_events,'[]'::jsonb) AS linked_events,
            statement_timestamp() AS assessment_watermark,candidates.revision AS queue_revision
     FROM candidates
     JOIN item ON item.id=candidates.item_id
     JOIN source ON source.id=item.source_id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(to_jsonb(event_link) ORDER BY
                event_link.relevance_score DESC,
                event_link.materiality_score DESC,
                event_link.urgency_score DESC,
                event_link.id) AS linked_events
       FROM (
         SELECT event.id,event.event_type,event.status,event.severity,event.confidence,
                event.relevance_score,event.urgency_score,event.materiality_score,
                event.source_diversity,event.domain_count,
                evidence.correlation_score,evidence.correlation_factors,
                (
                  SELECT count(DISTINCT canonical_news_publisher_key(
                           publisher_item.url,
                           publisher_item.payload,
                           publisher_source.name
                         ))::int
                  FROM intelligence_event_evidence publisher_evidence
                  JOIN item publisher_item
                    ON publisher_evidence.source_record_type='item'
                   AND publisher_item.id=${newsEvidenceItemIdSql("publisher_evidence")}
                  JOIN source publisher_source ON publisher_source.id=publisher_item.source_id
                  WHERE publisher_evidence.event_id=event.id
                    AND publisher_evidence.domain='news'
                    AND (lower(publisher_source.name)<>'gdelt'
                         OR publisher_item.payload->>'quality_status'='accepted')
                ) AS distinct_publisher_count
         FROM intelligence_event_evidence evidence
         JOIN intelligence_event event ON event.id=evidence.event_id
         WHERE evidence.domain='news'
           AND evidence.source_record_type='item'
           AND evidence.source_record_id=item.id::text
           AND event.status<>'dismissed'
       ) event_link
     ) linked ON true
     WHERE item.kind='news_article'
       AND (lower(source.name)<>'gdelt' OR item.payload->>'quality_status'='accepted')
     ORDER BY COALESCE(item.event_time,item.created_at) DESC NULLS LAST,item.id DESC`,
    [boundedBatch],
  );
  if (!rows.length) return { selected: 0, assessed: 0 };

  // Persist the database statement-start watermark, not a later pod timestamp.
  // A source/event update racing this read will then remain newer and eligible
  // for the following cycle instead of being hidden behind stale assessment data.
  const assessedAt = new Date(rows[0].assessment_watermark);
  if (Number.isNaN(assessedAt.getTime())) throw new Error("News assessment watermark is invalid.");
  const assessments = rows.map((row) => assessNewsItem({
    itemId: Number(row.id),
    title: row.title,
    summary: row.summary,
    eventTime: row.event_time,
    createdAt: row.created_at,
    sourceName: row.source_name,
    payload: row.payload,
    linkedEvents: Array.isArray(row.linked_events) ? row.linked_events : [],
  }, assessedAt));
  const values: unknown[] = [];
  const valueSql = assessments.map((assessment, index) => {
    const first = values.length + 1;
    values.push(
      assessment.itemId,
      assessment.methodologyVersion,
      assessment.primaryCategory,
      JSON.stringify(assessment.categories),
      JSON.stringify(assessment.tags),
      JSON.stringify(assessment.reasons),
      JSON.stringify(assessment.components),
      assessment.score,
      assessment.tier,
      assessment.confidence,
      assessment.assessedAt,
      assessment.inputsHash,
      rows[index].queue_revision,
      nextNewsAssessmentRefresh(rows[index].event_time, assessedAt),
    );
    return `($${first}::bigint,$${first + 1}::text,$${first + 2}::text,$${first + 3}::jsonb,$${first + 4}::jsonb,$${first + 5}::jsonb,$${first + 6}::jsonb,$${first + 7}::double precision,$${first + 8}::text,$${first + 9}::double precision,$${first + 10}::timestamptz,$${first + 11}::text,$${first + 12}::bigint,$${first + 13}::timestamptz)`;
  });
  const result = await query<{ item_id: number }>(
    `WITH inputs(item_id,methodology_version,primary_category,categories,tags,reasons,components,score,tier,confidence,assessed_at,inputs_hash,queue_revision,next_due_at) AS (
       VALUES ${valueSql.join(",")}
     ), persisted AS (
     INSERT INTO news_item_assessment (
       item_id,methodology_version,primary_category,categories,tags,reasons,
       components,score,tier,confidence,assessed_at,inputs_hash
     ) SELECT item_id,methodology_version,primary_category,categories,tags,reasons,components,score,tier,confidence,assessed_at,inputs_hash FROM inputs
     ON CONFLICT (item_id) DO UPDATE SET
       methodology_version=EXCLUDED.methodology_version,
       primary_category=EXCLUDED.primary_category,
       categories=EXCLUDED.categories,
       tags=EXCLUDED.tags,
       reasons=EXCLUDED.reasons,
       components=EXCLUDED.components,
       score=EXCLUDED.score,
       tier=EXCLUDED.tier,
       confidence=EXCLUDED.confidence,
       assessed_at=EXCLUDED.assessed_at,
       inputs_hash=EXCLUDED.inputs_hash,
       updated_at=now()
     WHERE news_item_assessment.assessed_at<=EXCLUDED.assessed_at
     RETURNING item_id
     ), rescheduled AS (
       UPDATE news_assessment_queue pending SET due_at=inputs.next_due_at,
         priority=news_assessment_priority(item.event_time)
       FROM inputs JOIN persisted USING(item_id) JOIN item ON item.id=inputs.item_id
       WHERE pending.item_id=inputs.item_id AND pending.revision=inputs.queue_revision
         AND inputs.next_due_at IS NOT NULL
     ), completed AS (
       DELETE FROM news_assessment_queue pending USING inputs,persisted
       WHERE pending.item_id=inputs.item_id AND persisted.item_id=inputs.item_id
         AND pending.revision=inputs.queue_revision AND inputs.next_due_at IS NULL
     ) SELECT item_id FROM persisted`,
    values,
  );
  return { selected: rows.length, assessed: result.rows.length };
}

async function runWorkerCycle(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    await withWorkerLease("news-item-assessment", 120, async () => {
      const result = await assessPendingNewsItems();
      if (result.assessed > 0) {
        console.log(JSON.stringify({ event: "news_assessment_cycle", ...result }));
      }
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "news_assessment_worker_failed",
      message: error instanceof Error ? error.message : String(error),
    }));
  } finally {
    workerRunning = false;
  }
}

export function startNewsAssessmentWorker(): void {
  if (workerTimer || !enabledUnlessFalse("NEWS_ASSESSMENT_WORKER_ENABLED")) return;
  // The event fan-out and assessment stages must both keep up with source
  // refreshes. Small, leased batches avoid a long queue of stale reader data.
  const intervalSeconds = integerEnv("NEWS_ASSESSMENT_POLL_SECONDS", 10, 10, 300);
  workerTimer = setInterval(() => void runWorkerCycle(), intervalSeconds * 1_000);
  workerTimer.unref();
  const startup = setTimeout(() => void runWorkerCycle(), 5_000);
  startup.unref();
}
