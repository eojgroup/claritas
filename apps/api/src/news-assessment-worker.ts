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

export async function assessPendingNewsItems(batchSize = integerEnv("NEWS_ASSESSMENT_BATCH_SIZE", 80, 1, 200)) {
  const boundedBatch = Math.max(1, Math.min(Math.trunc(batchSize), 200));
  const { rows } = await query<AssessmentCandidateRow>(
    `WITH candidates AS MATERIALIZED (
       SELECT item.id
       FROM item
       JOIN source ON source.id=item.source_id
       LEFT JOIN news_item_assessment assessment ON assessment.item_id=item.id
       WHERE item.kind='news_article'
         AND (lower(source.name)<>'gdelt' OR item.payload->>'quality_status'='accepted')
         AND (
           assessment.item_id IS NULL
           OR assessment.methodology_version<>$1
           OR assessment.assessed_at<item.updated_at
           OR (
             item.event_time>=now()-interval '8 days'
             AND (
               (now()>item.event_time+interval '1 hour'
                AND assessment.assessed_at<=item.event_time+interval '1 hour')
               OR (now()>item.event_time+interval '6 hours'
                   AND assessment.assessed_at<=item.event_time+interval '6 hours')
               OR (now()>item.event_time+interval '24 hours'
                   AND assessment.assessed_at<=item.event_time+interval '24 hours')
               OR (now()>item.event_time+interval '72 hours'
                   AND assessment.assessed_at<=item.event_time+interval '72 hours')
               OR (now()>item.event_time+interval '168 hours'
                   AND assessment.assessed_at<=item.event_time+interval '168 hours')
             )
           )
           OR EXISTS (
             SELECT 1
             FROM intelligence_event_evidence changed_evidence
             JOIN intelligence_event changed_event ON changed_event.id=changed_evidence.event_id
             WHERE changed_evidence.domain='news'
               AND changed_evidence.source_record_type='item'
               AND changed_evidence.source_record_id=item.id::text
               AND GREATEST(changed_event.updated_at,changed_evidence.created_at)>assessment.assessed_at
           )
         )
       ORDER BY CASE
                  WHEN assessment.item_id IS NULL
                   AND item.event_time>=now()-interval '8 days'
                   AND item.event_time<=now()+interval '5 minutes' THEN 0
                  WHEN assessment.item_id IS NOT NULL
                   AND item.event_time>=now()-interval '8 days'
                   AND item.event_time<=now()+interval '5 minutes' THEN 1
                  WHEN assessment.item_id IS NOT NULL THEN 2
                  ELSE 3
                END,
                assessment.assessed_at ASC NULLS LAST,
                COALESCE(item.event_time,item.created_at) DESC NULLS LAST,
                item.id DESC
       LIMIT $2
     )
     SELECT item.id,item.title,item.summary,item.event_time,item.created_at,item.payload,
            source.name AS source_name,
            COALESCE(linked.linked_events,'[]'::jsonb) AS linked_events,
            statement_timestamp() AS assessment_watermark
     FROM candidates
     JOIN item ON item.id=candidates.id
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
                   AND publisher_evidence.source_record_id=publisher_item.id::text
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
     ORDER BY COALESCE(item.event_time,item.created_at) DESC NULLS LAST,item.id DESC`,
    [NEWS_ASSESSMENT_METHODOLOGY, boundedBatch],
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
  const valueSql = assessments.map((assessment) => {
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
    );
    return `($${first},$${first + 1},$${first + 2},$${first + 3}::jsonb,$${first + 4}::jsonb,$${first + 5}::jsonb,$${first + 6}::jsonb,$${first + 7},$${first + 8},$${first + 9},$${first + 10}::timestamptz,$${first + 11})`;
  });
  const result = await query<{ item_id: number }>(
    `INSERT INTO news_item_assessment (
       item_id,methodology_version,primary_category,categories,tags,reasons,
       components,score,tier,confidence,assessed_at,inputs_hash
     ) VALUES ${valueSql.join(",")}
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
     RETURNING item_id`,
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
  const intervalSeconds = integerEnv("NEWS_ASSESSMENT_POLL_SECONDS", 30, 10, 300);
  workerTimer = setInterval(() => void runWorkerCycle(), intervalSeconds * 1_000);
  workerTimer.unref();
  const startup = setTimeout(() => void runWorkerCycle(), 5_000);
  startup.unref();
}
