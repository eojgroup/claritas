/** Keep the queue predicate explicit so PostgreSQL can use the partial
 * (occurred_at,id) index directly, rather than BitmapOr plus a backlog sort. */
export const CLAIM_OUTBOX_SQL = `WITH candidates AS (
         SELECT id FROM event_outbox
         WHERE status IN ('pending','failed','publishing')
           AND (status<>'publishing' OR locked_at<now()-interval '5 minutes') AND available_at<=now() AND attempts<$1
         ORDER BY occurred_at,id FOR UPDATE SKIP LOCKED LIMIT $2
       )
       UPDATE event_outbox outbox SET status='publishing',attempts=attempts+1,
              locked_at=now(),last_error=NULL,updated_at=now()
       FROM candidates WHERE outbox.id=candidates.id
       RETURNING outbox.id,outbox.event_type,outbox.aggregate_type,outbox.aggregate_id,
                 outbox.payload,outbox.occurred_at,outbox.attempts`;
