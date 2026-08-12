import {
  getEmailRuntimeConfig,
  sendImportantEventEmail,
  type BriefingEmailEvent,
  type ImportantEventEmailContent,
} from "./email";
import {
  getBriefingIntelligenceEvent,
  type BriefingIntelligenceEvent,
} from "./briefing-event-context";

type ClaimedAlertEmail = {
  id: string;
  candidate_id: string;
  event_id: string;
  user_id: number | string;
  recipient_email: string;
  deterministic_message_id: string;
  context_snapshot: unknown;
  attempts: number | string;
  max_attempts: number | string;
  display_name: string | null;
  candidate_created_at: string | Date;
};

export type ImportantEventEmailOperationalState =
  | "disabled"
  | "not_configured"
  | "ready"
  | "degraded";

export type ImportantEventSmtpFailureClassification = {
  retryable: boolean;
  counts_as_submission: boolean;
  reason: "explicit_transient_rejection" | "explicit_permanent_rejection" |
    "definitive_pre_submission_failure" | "local_configuration_failure" |
    "pre_submission_processing_failure" | "ambiguous_submission_outcome";
};

const DEFAULT_POLL_SECONDS = 20;
const DEFAULT_CYCLE_CAP = 10;
const DEFAULT_USER_DAILY_CAP = 5;
let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = false;
let lastCycleError: string | null = null;
let lastDeliveryError: string | null = null;
let lastDeliveryErrorAt: string | null = null;
let lastSuccessfulDeliveryAt: string | null = null;
let lastCycleAt: string | null = null;

async function dbQuery<T = any>(sql: string, params?: unknown[]) {
  const { query } = await import("./db");
  return query<T>(sql, params);
}

function flag(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value ? ["1", "true", "yes", "on"].includes(value) : fallback;
}

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown, maximum = 30): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string")
      .map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean))).slice(0, maximum)
    : [];
}

function text(value: unknown, maximum = 2_000): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum).trim()
    : "";
}

export function classifyImportantEventSmtpFailure(
  error: unknown,
): ImportantEventSmtpFailureClassification {
  const candidate = record(error);
  const responseCode = Number(candidate.responseCode);
  const command = text(candidate.command, 40).toUpperCase();
  const code = text(candidate.code, 40).toUpperCase();
  const message = text(candidate.message, 500).toLowerCase();

  // A relay response is an explicit rejection, including a response to DATA;
  // no acceptance ambiguity remains. 4xx is transient, 5xx is terminal.
  if (Number.isFinite(responseCode) && responseCode >= 400 && responseCode < 500) {
    return { retryable: true, counts_as_submission: false, reason: "explicit_transient_rejection" };
  }
  if (Number.isFinite(responseCode) && responseCode >= 500 && responseCode < 600) {
    return { retryable: false, counts_as_submission: false, reason: "explicit_permanent_rejection" };
  }

  if (
    message.includes("smtp delivery is not configured") ||
    message.includes("smtp_user") ||
    code === "EAUTH" || code === "EENVELOPE"
  ) {
    return { retryable: false, counts_as_submission: false, reason: "local_configuration_failure" };
  }

  // These commands all precede the message body. A transport failure here is
  // definitively safe to retry. Once DATA begins, a lost 250 response or socket
  // timeout can mean the relay accepted the email despite Nodemailer's error.
  if (["CONN", "EHLO", "HELO", "STARTTLS", "AUTH", "MAIL FROM", "RCPT TO"].includes(command)) {
    return { retryable: true, counts_as_submission: false, reason: "definitive_pre_submission_failure" };
  }
  return { retryable: false, counts_as_submission: true, reason: "ambiguous_submission_outcome" };
}

export function classifyImportantEventDeliveryFailure(
  error: unknown,
  submissionTransitioned: boolean,
): ImportantEventSmtpFailureClassification {
  if (!submissionTransitioned) {
    return {
      retryable: true,
      counts_as_submission: false,
      reason: "pre_submission_processing_failure",
    };
  }
  return classifyImportantEventSmtpFailure(error);
}

export async function submitAndReconcileImportantEventEmail<T>(input: {
  submit: () => Promise<T>;
  on_submitted: (submission: T) => void;
  reconcile: (submission: T) => Promise<void>;
}): Promise<{ submission: T; reconciliation_error: unknown | null }> {
  // A rejected submit is classified by the caller because post-DATA errors can
  // be ambiguous. Once submit resolves, reconciliation failure is deliberately
  // returned as data so it can never enter any retry path and duplicate an
  // already accepted email.
  const submission = await input.submit();
  input.on_submitted(submission);
  try {
    await input.reconcile(submission);
    return { submission, reconciliation_error: null };
  } catch (error) {
    return { submission, reconciliation_error: error };
  }
}

export function getImportantEventEmailConfig(): {
  enabled: boolean;
  configured: boolean;
  state: ImportantEventEmailOperationalState;
  reason: string | null;
  per_cycle_cap: number;
  per_user_24h_cap: number;
  global_24h_cap: number;
  poll_seconds: number;
} {
  const enabled = flag("IMPORTANT_EVENT_EMAIL_ENABLED", false);
  const smtp = getEmailRuntimeConfig();
  const user = text(process.env.SMTP_USER, 500);
  const password = text(process.env.SMTP_PASSWORD, 2_000);
  const credentialMismatch = Boolean(user) !== Boolean(password);
  const configured = smtp.configured && !credentialMismatch;
  const reason = !enabled
    ? "IMPORTANT_EVENT_EMAIL_ENABLED is false."
    : !smtp.host
      ? "SMTP_HOST is not configured; no important-event email will be queued or sent."
      : credentialMismatch
        ? "SMTP_USER and SMTP_PASSWORD must either both be configured or both be absent."
        : lastDeliveryError ?? lastCycleError;
  return {
    enabled,
    configured,
    state: !enabled
      ? "disabled"
      : !configured
        ? "not_configured"
        : lastDeliveryError || lastCycleError
          ? "degraded"
          : "ready",
    reason,
    per_cycle_cap: integerEnv("IMPORTANT_EVENT_EMAIL_CYCLE_CAP", DEFAULT_CYCLE_CAP, 1, 50),
    per_user_24h_cap: integerEnv("IMPORTANT_EVENT_EMAIL_USER_DAILY_CAP", DEFAULT_USER_DAILY_CAP, 1, 20),
    global_24h_cap: integerEnv("IMPORTANT_EVENT_EMAIL_GLOBAL_DAILY_CAP", 200, 1, 5_000),
    poll_seconds: integerEnv("IMPORTANT_EVENT_EMAIL_POLL_SECONDS", DEFAULT_POLL_SECONDS, 10, 3_600),
  };
}

function toEmailEvent(
  event: BriefingIntelligenceEvent,
  profileReasons: string[],
): BriefingEmailEvent {
  return {
    id: event.id,
    event_type: event.event_type,
    title: event.title,
    summary: event.summary,
    severity: event.severity,
    confidence: event.confidence,
    relevance_score: event.relevance_score,
    start_time: event.start_time,
    where: event.where,
    why_interesting: event.why_interesting,
    profile_reasons: profileReasons,
    linked_news: event.linked_news.map((item) => ({
      title: item.title,
      publisher: item.publisher,
      url: item.url,
      published_at: item.published_at,
    })),
    earth_observation: event.earth_observation.map((item) => ({
      product_type: item.product_type,
      provider: item.provider,
      captured_at: item.captured_at,
      imagery_available: item.imagery_available,
      evidentiary_role: item.evidentiary_role,
      analysis_summary: item.analysis_summary,
      temporal_alignment: item.temporal_alignment ?? null,
      assessment_boundary: item.assessment_boundary ?? null,
    })),
  };
}

export function buildImportantEventEmailContent(
  delivery: Pick<ClaimedAlertEmail, "context_snapshot" | "display_name" | "candidate_created_at">,
  event: BriefingIntelligenceEvent,
): ImportantEventEmailContent {
  const snapshot = record(delivery.context_snapshot);
  const watch = record(snapshot.matched_watch);
  const preferences = record(snapshot.preferences);
  const watchType = text(watch.type, 80) || "event";
  const watchKey = text(watch.key, 160) || event.event_type;
  const minimumSeverity = text(watch.minimum_severity, 40) || "high";
  const profileTopics = [
    ...stringArray(preferences.industries, 20),
    ...stringArray(preferences.company_symbols, 30),
    ...stringArray(preferences.country_iso2s, 30),
    ...stringArray(preferences.regions, 20),
  ].slice(0, 30);
  const profileReasons = [
    `Enabled ${watchType.replace(/_/g, " ")} watch: ${watchKey}`,
    ...(profileTopics.length ? [`Saved profile: ${profileTopics.slice(0, 8).join(", ")}`] : []),
  ];
  return {
    event: toEmailEvent(event, profileReasons),
    recipient_name: text(delivery.display_name, 160) || null,
    matched_watch: {
      type: watchType,
      key: watchKey,
      minimum_severity: minimumSeverity,
    },
    profile_topics: profileTopics,
    alert_created_at: delivery.candidate_created_at instanceof Date
      ? delivery.candidate_created_at.toISOString()
      : new Date(delivery.candidate_created_at).toISOString(),
    theme: preferences.email_theme === "light" ? "light" : "dark",
  };
}

async function suppressDelivery(delivery: Pick<ClaimedAlertEmail, "id">, reason: string): Promise<void> {
  await dbQuery(
    `WITH suppressed AS (
       UPDATE alert_email_delivery SET status='suppressed',last_error=$2,updated_at=now()
       WHERE id=$1 RETURNING candidate_id,user_id
     )
     UPDATE alert_candidate_recipient recipient
     SET eligibility_status='muted',last_error=$2,updated_at=now()
     FROM suppressed
     WHERE recipient.candidate_id=suppressed.candidate_id
       AND recipient.user_id=suppressed.user_id AND recipient.channel='email'`,
    [delivery.id, reason],
  );
}

async function userRetainsBillingAccess(userId: number): Promise<{ allowed: boolean; reason: string }> {
  const { rows } = await dbQuery<{ key: string }>(
    `SELECT role.key FROM auth_user_role user_role
     JOIN auth_role role ON role.id=user_role.role_id
     WHERE user_role.user_id=$1`,
    [userId],
  );
  const { resolveBillingAccessState } = await import("./billing");
  const access = await resolveBillingAccessState({ userId, roles: rows.map((row) => row.key) });
  return { allowed: access.has_access, reason: access.reason };
}

async function materializeImportantEventEmails(config: ReturnType<typeof getImportantEventEmailConfig>): Promise<number> {
  const { rows } = await dbQuery<{ changed: number | string }>(
    `SELECT materialize_alert_email_deliveries(
       NULL,NULL,$1::int,$2::int,$3::int,$4::int
     ) AS changed`,
    [
      integerEnv("IMPORTANT_EVENT_EMAIL_MAX_AGE_HOURS", 48, 1, 168),
      config.per_user_24h_cap,
      config.global_24h_cap,
      integerEnv("IMPORTANT_EVENT_EMAIL_MATERIALIZATION_CAP", 200, 1, 1_000),
    ],
  );
  return Number(rows[0]?.changed ?? 0);
}

async function claimAlertEmail(
  config: ReturnType<typeof getImportantEventEmailConfig>,
): Promise<ClaimedAlertEmail | null> {
  const { rows } = await dbQuery<ClaimedAlertEmail>(
    `WITH next_delivery AS (
       SELECT delivery.id
       FROM alert_email_delivery delivery
       JOIN alert_candidate_recipient recipient
         ON recipient.candidate_id=delivery.candidate_id
        AND recipient.user_id=delivery.user_id
        AND recipient.channel='email'
        AND recipient.eligibility_status='eligible'
       JOIN user_intelligence_watchlist watch ON watch.id=recipient.matched_watch_id
       JOIN app_user account ON account.id=delivery.user_id
       JOIN user_daily_briefing_schedule schedule ON schedule.user_id=delivery.user_id
       JOIN alert_candidate candidate ON candidate.id=delivery.candidate_id
       JOIN intelligence_event event ON event.id=candidate.event_id
       WHERE delivery.status IN ('queued','failed')
         AND delivery.attempts<delivery.max_attempts
         AND delivery.available_at<=now()
         AND watch.alerts_enabled
         AND watch.metadata->'email_enabled' = 'true'::jsonb
         AND account.is_active AND account.email_verified
         AND account.email=delivery.recipient_email
         AND schedule.enabled AND schedule.email_enabled
         AND candidate.status IN ('candidate','eligible','delivered')
         AND candidate.severity IN ('high','critical')
         AND candidate.created_at >= now()-make_interval(hours=>$1::int)
         AND event.status NOT IN ('resolved','dismissed')
         AND (SELECT count(*) FROM alert_email_delivery submitted_for_user
              WHERE submitted_for_user.user_id=delivery.user_id
                AND COALESCE(submitted_for_user.sent_at,submitted_for_user.submission_started_at)
                    >= now()-interval '24 hours') < $2::int
         AND (SELECT count(*) FROM alert_email_delivery submitted_globally
              WHERE COALESCE(submitted_globally.sent_at,submitted_globally.submission_started_at)
                    >= now()-interval '24 hours') < $3::int
       ORDER BY delivery.queued_at,delivery.id
       FOR UPDATE OF delivery SKIP LOCKED LIMIT 1
     ), claimed AS (
       UPDATE alert_email_delivery delivery
       SET status='sending',attempts=delivery.attempts+1,last_error=NULL,updated_at=now()
       FROM next_delivery WHERE delivery.id=next_delivery.id
       RETURNING delivery.*
     )
     SELECT claimed.id,claimed.candidate_id,candidate.event_id,claimed.user_id,
            claimed.recipient_email,claimed.deterministic_message_id,
            claimed.context_snapshot,claimed.attempts,claimed.max_attempts,
            account.display_name,candidate.created_at AS candidate_created_at
     FROM claimed
     JOIN alert_candidate candidate ON candidate.id=claimed.candidate_id
     JOIN app_user account ON account.id=claimed.user_id`,
    [
      integerEnv("IMPORTANT_EVENT_EMAIL_MAX_AGE_HOURS", 48, 1, 168),
      config.per_user_24h_cap,
      config.global_24h_cap,
    ],
  );
  return rows[0] ?? null;
}

export async function processImportantEventEmailDelivery(
  config = getImportantEventEmailConfig(),
): Promise<boolean> {
  const delivery = await claimAlertEmail(config);
  if (!delivery) return false;
  let smtpSubmitted = false;
  let submissionTransitioned = false;
  try {
    const billing = await userRetainsBillingAccess(Number(delivery.user_id));
    if (!billing.allowed) {
      await suppressDelivery(delivery, `Billing access no longer permits alert email (${billing.reason}).`);
      return true;
    }
    const event = await getBriefingIntelligenceEvent(delivery.event_id);
    if (!event) {
      await suppressDelivery(delivery, "The intelligence event is resolved, dismissed, or no longer priority-eligible.");
      return true;
    }
    const content = buildImportantEventEmailContent(delivery, event);
    const { rows: submitting } = await dbQuery<{ id: string }>(
      `UPDATE alert_email_delivery
       SET status='submitting',submission_started_at=now(),updated_at=now()
       WHERE id=$1 AND status='sending' RETURNING id`,
      [delivery.id],
    );
    if (!submitting[0]) {
      // Consent or eligibility can be revoked by materialization while the
      // delivery is being prepared. Never submit after that state transition.
      return true;
    }
    submissionTransitioned = true;
    const outcome = await submitAndReconcileImportantEventEmail({
      submit: () => sendImportantEventEmail(delivery.recipient_email, content, {
        message_id: delivery.deterministic_message_id,
      }),
      on_submitted: () => {
        smtpSubmitted = true;
        // An idle cycle must not make a broken relay look healthy. Only a real,
        // accepted SMTP submission clears the retained delivery failure.
        lastDeliveryError = null;
        lastDeliveryErrorAt = null;
        lastCycleError = null;
        lastSuccessfulDeliveryAt = new Date().toISOString();
      },
      reconcile: async (sent) => {
        await dbQuery(
        `WITH marked AS (
           UPDATE alert_email_delivery SET status='sent',provider_message_id=$2,sent_at=now(),
                  last_error=NULL,updated_at=now() WHERE id=$1 RETURNING candidate_id,user_id
         )
         UPDATE alert_candidate_recipient recipient
         SET eligibility_status='delivered',delivered_at=now(),last_error=NULL,updated_at=now()
         FROM marked
         WHERE recipient.candidate_id=marked.candidate_id AND recipient.user_id=marked.user_id
           AND recipient.channel='email'`,
          [delivery.id, sent.message_id],
        );
      },
    });
    if (outcome.reconciliation_error) {
      // SMTP has accepted this deterministic Message-ID. The durable row stays
      // in the non-retryable `submitting` state if reconciliation cannot reach
      // the database; retrying could send a duplicate notification.
      const error = outcome.reconciliation_error;
      lastCycleError = text(error instanceof Error ? error.message : String(error), 2_000)
        || "SMTP accepted the message, but delivery reconciliation failed.";
      console.error(`Important-event email delivery ${delivery.id} was accepted but could not be reconciled:`, error);
    }
    return true;
  } catch (error) {
    const classification = classifyImportantEventDeliveryFailure(error, submissionTransitioned);
    const baseMessage = text(error instanceof Error ? error.message : String(error), 1_800) || "SMTP delivery failed.";
    const message = `${classification.reason.replace(/_/g, " ")}: ${baseMessage}`;
    if (smtpSubmitted) {
      lastCycleError = message;
    } else {
      await dbQuery(
        `WITH transitioned AS (
           UPDATE alert_email_delivery
           SET status=CASE WHEN NOT $3::boolean OR attempts>=max_attempts THEN 'dead_letter' ELSE 'failed' END,
               submission_started_at=CASE WHEN $4::boolean THEN submission_started_at ELSE NULL END,
               last_error=$2,
               available_at=now()+make_interval(secs=>LEAST(21600,300*power(2,GREATEST(0,attempts-1)))::int),
               updated_at=now()
           WHERE id=$1
           RETURNING candidate_id,user_id,status,last_error
         )
         UPDATE alert_candidate_recipient recipient
         SET eligibility_status='failed',last_error=transitioned.last_error,updated_at=now()
         FROM transitioned
         WHERE transitioned.status='dead_letter'
           AND recipient.candidate_id=transitioned.candidate_id
           AND recipient.user_id=transitioned.user_id
           AND recipient.channel='email'`,
        [delivery.id, message, classification.retryable, classification.counts_as_submission],
      );
      lastDeliveryError = message;
      lastDeliveryErrorAt = new Date().toISOString();
    }
    console.error(`Important-event email delivery ${delivery.id} failed:`, error);
    return true;
  }
}

async function recoverAbandonedDeliveries(): Promise<void> {
  // Once SMTP submission has begun, its outcome is ambiguous after a worker or
  // database interruption. Quarantine instead of retrying and risking a
  // duplicate. Operators can reconcile these rows using the deterministic
  // Message-ID and relay logs.
  await dbQuery(
    `WITH terminal AS (
       UPDATE alert_email_delivery
       SET status='dead_letter',
           last_error=COALESCE(last_error,
             'Submission outcome is ambiguous after worker interruption; not retried to prevent duplicate email.'),
           updated_at=now()
       WHERE status='submitting' AND updated_at<now()-interval '10 minutes'
       RETURNING candidate_id,user_id,last_error
     )
     UPDATE alert_candidate_recipient recipient
     SET eligibility_status='failed',last_error=terminal.last_error,updated_at=now()
     FROM terminal
     WHERE recipient.candidate_id=terminal.candidate_id
       AND recipient.user_id=terminal.user_id AND recipient.channel='email'`,
  );
  await dbQuery(
    `WITH recovered AS (
       UPDATE alert_email_delivery
       SET status=CASE WHEN attempts>=max_attempts THEN 'dead_letter' ELSE 'failed' END,
           submission_started_at=NULL,
           last_error=COALESCE(last_error,'Recovered after email worker interruption.'),
           available_at=now(),updated_at=now()
       WHERE status='sending' AND updated_at<now()-interval '10 minutes'
       RETURNING candidate_id,user_id,status,last_error
     )
     UPDATE alert_candidate_recipient recipient
     SET eligibility_status='failed',last_error=recovered.last_error,updated_at=now()
     FROM recovered
     WHERE recovered.status='dead_letter'
       AND recipient.candidate_id=recovered.candidate_id
       AND recipient.user_id=recovered.user_id AND recipient.channel='email'`,
  );
}

async function runWorkerCycle(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    const config = getImportantEventEmailConfig();
    if (!config.enabled || !config.configured) return;
    const { withWorkerLease } = await import("./db");
    await withWorkerLease("important-event-email", Math.max(60, config.poll_seconds * 3), async () => {
      await recoverAbandonedDeliveries();
      await materializeImportantEventEmails(config);
      for (let index = 0; index < config.per_cycle_cap; index += 1) {
        if (!(await processImportantEventEmailDelivery(config))) break;
      }
      lastCycleAt = new Date().toISOString();
    });
  } catch (error) {
    lastCycleError = text(error instanceof Error ? error.message : String(error), 1_000) || "Email worker cycle failed.";
    console.error("Important-event email worker cycle failed:", error);
  } finally {
    workerRunning = false;
  }
}

export async function getImportantEventEmailStatus() {
  const config = getImportantEventEmailConfig();
  const { rows } = await dbQuery<{
    status: string;
    count: number | string;
    latest_error: string | null;
  }>(
    `SELECT status,count(*)::int AS count,
            (array_agg(last_error ORDER BY updated_at DESC) FILTER (WHERE last_error IS NOT NULL))[1] AS latest_error
     FROM alert_email_delivery GROUP BY status ORDER BY status`,
  );
  const queue = Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  const terminal = rows.find((row) => row.status === "dead_letter");
  const durableDegraded = Number(terminal?.count ?? 0) > 0;
  return {
    ...config,
    state: config.state === "ready" && durableDegraded ? "degraded" : config.state,
    reason: config.reason ?? (durableDegraded
      ? terminal?.latest_error || `${terminal?.count} important-event email deliveries require reconciliation.`
      : null),
    last_cycle_at: lastCycleAt,
    last_cycle_error: lastCycleError,
    last_delivery_error: lastDeliveryError,
    last_delivery_error_at: lastDeliveryErrorAt,
    last_successful_delivery_at: lastSuccessfulDeliveryAt,
    queue,
    delivery_semantics: "SMTP submission is tracked separately from reading; verified email, daily-email opt-in, watch metadata.email_enabled=true, a current high/critical candidate and billing access are all required.",
  };
}

export function startImportantEventEmailWorker(): void {
  const config = getImportantEventEmailConfig();
  if (!config.enabled || !config.configured) {
    console.log(`Important-event email worker ${config.state}: ${config.reason}`);
    return;
  }
  if (workerTimer) return;
  console.log(`Important-event email worker started (interval=${config.poll_seconds}s, cycle cap=${config.per_cycle_cap}, user 24h cap=${config.per_user_24h_cap}, global 24h cap=${config.global_24h_cap}).`);
  workerTimer = setInterval(() => void runWorkerCycle(), config.poll_seconds * 1_000);
  setTimeout(() => {
    void runWorkerCycle().catch((error) => {
      lastCycleError = text(error instanceof Error ? error.message : String(error), 1_000);
      console.error("Important-event email worker startup failed:", error);
    });
  }, 6_000);
}
