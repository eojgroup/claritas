import { PubSub, type Message } from "@google-cloud/pubsub";
import { query, withTransaction, withWorkerLease } from "../db";
import { consumeDomainEvent } from "./consumer";
import type { DomainEventEnvelope } from "./types";

type OutboxRow = {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  occurred_at: string | Date;
  attempts: number;
};

const eventBusMode = (process.env.EVENT_BUS_MODE?.trim().toLowerCase() === "pubsub" ? "pubsub" : "local") as "pubsub" | "local";
const topicName = process.env.EVENT_PUBSUB_TOPIC?.trim() || "claritas-domain-events";
const subscriptionName = process.env.EVENT_PUBSUB_SUBSCRIPTION?.trim() || "claritas-domain-events-api";
const pubsub = eventBusMode === "pubsub" ? new PubSub() : null;
let publisherTimer: NodeJS.Timeout | null = null;
let publisherRunning = false;
let subscriptionStarted = false;

const integerEnv = (name: string, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
};

function toEnvelope(row: OutboxRow): DomainEventEnvelope {
  return {
    id: row.id,
    type: row.event_type,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    occurred_at: new Date(row.occurred_at).toISOString(),
    payload: row.payload ?? {},
  };
}

async function claimOutboxBatch(limit: number) {
  return withTransaction(async (client) => {
    const { rows } = await client.query<OutboxRow>(
      `WITH candidates AS (
         SELECT id FROM event_outbox
         WHERE (
           status IN ('pending','failed') OR
           (status='publishing' AND locked_at<now()-interval '5 minutes')
         ) AND available_at<=now() AND attempts<$1
         ORDER BY occurred_at,id FOR UPDATE SKIP LOCKED LIMIT $2
       )
       UPDATE event_outbox outbox SET status='publishing',attempts=attempts+1,
              locked_at=now(),last_error=NULL,updated_at=now()
       FROM candidates WHERE outbox.id=candidates.id
       RETURNING outbox.id,outbox.event_type,outbox.aggregate_type,outbox.aggregate_id,
                 outbox.payload,outbox.occurred_at,outbox.attempts`,
      [integerEnv("EVENT_OUTBOX_MAX_ATTEMPTS", 8, 1, 30), limit],
    );
    return rows;
  });
}

async function markPublished(id: string) {
  await query(`UPDATE event_outbox SET status='published',published_at=now(),locked_at=NULL,updated_at=now() WHERE id=$1`, [id]);
}

async function markFailed(row: OutboxRow, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const maxAttempts = integerEnv("EVENT_OUTBOX_MAX_ATTEMPTS", 8, 1, 30);
  const dead = row.attempts >= maxAttempts;
  const delay = Math.min(3_600, 5 * (2 ** Math.max(0, row.attempts - 1)));
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE event_outbox SET status=$2,last_error=$3,locked_at=NULL,
              available_at=now()+make_interval(secs=>$4),updated_at=now()
       WHERE id=$1`,
      [row.id, dead ? "dead_letter" : "failed", message.slice(0, 2_000), delay],
    );
    if (dead) {
      await client.query(
        `INSERT INTO event_dead_letter (outbox_event_id,event_type,payload,attempts,last_error)
         VALUES ($1,$2,$3::jsonb,$4,$5)
         ON CONFLICT (outbox_event_id) DO UPDATE SET attempts=EXCLUDED.attempts,last_error=EXCLUDED.last_error`,
        [row.id, row.event_type, JSON.stringify(row.payload), row.attempts, message.slice(0, 2_000)],
      );
    }
  });
}

async function publishEnvelope(envelope: DomainEventEnvelope) {
  if (eventBusMode === "local") {
    await consumeDomainEvent(envelope);
    return;
  }
  await pubsub!.topic(topicName).publishMessage({
    json: envelope,
    attributes: { type: envelope.type, aggregate_type: envelope.aggregate_type, aggregate_id: envelope.aggregate_id },
  });
}

async function publisherCycle() {
  const batch = await claimOutboxBatch(integerEnv("EVENT_OUTBOX_BATCH_SIZE", 25, 1, 100));
  for (const row of batch) {
    try {
      await publishEnvelope(toEnvelope(row));
      await markPublished(row.id);
    } catch (error) {
      await markFailed(row, error);
    }
  }
  if (batch.length) {
    console.log(JSON.stringify({ event: "event_outbox_cycle", mode: eventBusMode, published: batch.length }));
  }
}

function handlePubSubMessage(message: Message) {
  void (async () => {
    try {
      const envelope = JSON.parse(message.data.toString("utf8")) as DomainEventEnvelope;
      if (!envelope.id || !envelope.type) throw new Error("Pub/Sub message is not a Claritas domain-event envelope.");
      await consumeDomainEvent(envelope);
      message.ack();
    } catch (error) {
      console.error(JSON.stringify({ event: "event_consumer_failed", message_id: message.id, message: error instanceof Error ? error.message : String(error) }));
      message.nack();
    }
  })();
}

function startPubSubConsumer() {
  if (eventBusMode !== "pubsub" || subscriptionStarted) return;
  subscriptionStarted = true;
  const subscription = pubsub!.subscription(subscriptionName, {
    flowControl: { maxMessages: integerEnv("EVENT_CONSUMER_MAX_MESSAGES", 8, 1, 100), allowExcessMessages: false },
  });
  subscription.on("message", handlePubSubMessage);
  subscription.on("error", (error) => {
    console.error(JSON.stringify({ event: "event_subscription_error", subscription: subscriptionName, message: error.message }));
  });
}

export function startEventBackbone() {
  if (publisherTimer || process.env.EVENT_BACKBONE_ENABLED?.toLowerCase() === "false") return;
  startPubSubConsumer();
  const tick = () => {
    if (publisherRunning) return;
    publisherRunning = true;
    void withWorkerLease("event-outbox-publisher", 90, publisherCycle)
      .catch((error) => console.error(JSON.stringify({ event: "event_outbox_worker_failed", message: error instanceof Error ? error.message : String(error) })))
      .finally(() => { publisherRunning = false; });
  };
  tick();
  publisherTimer = setInterval(tick, integerEnv("EVENT_OUTBOX_POLL_SECONDS", 5, 1, 60) * 1_000);
  publisherTimer.unref();
}

export async function getEventBackboneHealth() {
  const { rows: outbox } = await query(
    `SELECT status,count(*)::int AS count,min(occurred_at) AS oldest,max(attempts)::int AS max_attempts
     FROM event_outbox WHERE created_at>=now()-interval '30 days' GROUP BY status ORDER BY status`,
  );
  const { rows: consumers } = await query(
    `SELECT consumer_name,status,count(*)::int AS count,max(updated_at) AS latest
     FROM consumed_domain_event WHERE created_at>=now()-interval '30 days'
     GROUP BY consumer_name,status ORDER BY consumer_name,status`,
  );
  const { rows: deadLetters } = await query<{ count: number }>(`SELECT count(*)::int AS count FROM event_dead_letter WHERE resolved_at IS NULL`);
  const { rows: correlation } = await query(
    `SELECT provider,enabled,last_attempt_at,last_success_at,last_event_at,consecutive_failures,last_error
     FROM provider_runtime_state WHERE provider='event_correlation'`,
  );
  return { mode: eventBusMode, topic: eventBusMode === "pubsub" ? topicName : null, subscription: eventBusMode === "pubsub" ? subscriptionName : null, outbox, consumers, unresolved_dead_letters: Number(deadLetters[0]?.count ?? 0), correlation: correlation[0] ?? null };
}
