import assert from "node:assert/strict";
import test from "node:test";
import {
  buildImportantEventEmailContent,
  classifyImportantEventDeliveryFailure,
  classifyImportantEventSmtpFailure,
  getImportantEventEmailConfig,
  submitAndReconcileImportantEventEmail,
} from "./alert-email";
import { renderImportantEventEmail } from "./email";
import type { BriefingIntelligenceEvent } from "./briefing-event-context";

const event: BriefingIntelligenceEvent = {
  id: "5c2d6f9b-e28d-4e14-bd21-928a5242052f",
  event_type: "port_disruption",
  title: "Port disruption under assessment",
  summary: "Two publisher reports and a sensor observation describe disruption near the terminal.",
  status: "active",
  severity: "high",
  confidence: 0.82,
  country_iso2: "NL",
  region: "Europe",
  location_name: "Port of Rotterdam",
  latitude: 51.95,
  longitude: 4.14,
  relevance_score: 0.88,
  urgency_score: 0.74,
  materiality_score: 0.69,
  source_diversity: 3,
  domain_count: 2,
  start_time: "2026-08-11T09:30:00.000Z",
  last_activity_time: "2026-08-11T12:00:00.000Z",
  what: "Disruption is being assessed.",
  where: "Port of Rotterdam, NL",
  why_interesting: ["2 linked publisher reports", "1 sensor-derived Earth observation asset available"],
  source_quality: {
    publisher_report_count: 2,
    cross_domain: true,
    machine_coded_only: false,
    priority_eligible: true,
  },
  linked_news: [{
    title: "Terminal operator reports delays",
    summary: null,
    url: "https://publisher.example/report",
    publisher: "Publisher",
    published_at: "2026-08-11T11:00:00.000Z",
    relationship: "reported",
  }],
  earth_observation_state: "sensor_imagery_available",
  earth_observation: [{
    observation_id: "scene",
    product_type: "true_color",
    analysis_kind: "rendered_observation",
    status: "available",
    provider: "Copernicus",
    mission: "Sentinel-2",
    captured_at: "2026-08-11T10:00:00.000Z",
    resolution_m: 10,
    cloud_cover: 12,
    imagery_available: true,
    analysis_summary: "Visible context is available.",
    source_url: "https://dataspace.copernicus.eu/",
    attribution: "Copernicus Sentinel data",
    evidentiary_role: "sensor_observation",
    temporal_alignment: "Captured 30 minutes after the recorded event start.",
    assessment_boundary: "Visual context does not establish impact or cause.",
  }],
  evidence: [],
  entities: [],
  epistemic_notice: "Correlation does not establish causation.",
};

test("important-event email is fail-closed without SMTP", () => {
  const prior = {
    enabled: process.env.IMPORTANT_EVENT_EMAIL_ENABLED,
    host: process.env.SMTP_HOST,
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
  };
  process.env.IMPORTANT_EVENT_EMAIL_ENABLED = "true";
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  try {
    const config = getImportantEventEmailConfig();
    assert.equal(config.state, "not_configured");
    assert.equal(config.configured, false);
    assert.match(config.reason ?? "", /SMTP_HOST/);
  } finally {
    if (prior.enabled == null) delete process.env.IMPORTANT_EVENT_EMAIL_ENABLED;
    else process.env.IMPORTANT_EVENT_EMAIL_ENABLED = prior.enabled;
    if (prior.host == null) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = prior.host;
    if (prior.user == null) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = prior.user;
    if (prior.password == null) delete process.env.SMTP_PASSWORD;
    else process.env.SMTP_PASSWORD = prior.password;
  }
});

test("important-event email includes event, geography, news, EO and profile context", () => {
  const priorBase = process.env.EMAIL_PUBLIC_BASE_URL;
  process.env.EMAIL_PUBLIC_BASE_URL = "https://app.claritas.info";
  try {
    const content = buildImportantEventEmailContent({
      context_snapshot: {
        matched_watch: { type: "port", key: "rotterdam", minimum_severity: "high" },
        preferences: {
          industries: ["Transportation"],
          company_symbols: ["MAERSK-B"],
          country_iso2s: ["NL"],
          regions: ["Europe"],
          email_theme: "dark",
        },
      },
      display_name: "A. Analyst",
      candidate_created_at: "2026-08-11T12:00:00.000Z",
    }, event);
    const rendered = renderImportantEventEmail(content);
    assert.match(rendered.subject, /^\[HIGH\]/);
    assert.match(rendered.html, /Port of Rotterdam, NL/);
    assert.match(rendered.html, /Terminal operator reports delays/);
    assert.match(rendered.html, /Event start:<\/strong> 2026-08-11 09:30:00 UTC/);
    assert.match(rendered.html, /published 2026-08-11 11:00:00 UTC/);
    assert.match(rendered.html, /Alert created 2026-08-11 12:00:00 UTC/);
    assert.match(rendered.html, /sensor-derived observation/);
    assert.match(rendered.html, /captured 2026-08-11 10:00:00 UTC/);
    assert.match(rendered.html, /Visual context does not establish impact or cause/);
    assert.match(rendered.html, /Transportation/);
    assert.match(rendered.html, /Open event evidence\/imagery/);
    assert.match(rendered.text, /\?event=5c2d6f9b-e28d-4e14-bd21-928a5242052f/);
    assert.match(rendered.text, /Manage or disable notifications/);
    assert.equal(rendered.preferences_url, "https://app.claritas.info/?view=profile&section=notifications");
  } finally {
    if (priorBase == null) delete process.env.EMAIL_PUBLIC_BASE_URL;
    else process.env.EMAIL_PUBLIC_BASE_URL = priorBase;
  }
});

test("accepted SMTP submission is never retried when database reconciliation fails", async () => {
  let submissions = 0;
  let accepted = 0;
  const result = await submitAndReconcileImportantEventEmail({
    submit: async () => {
      submissions += 1;
      return { message_id: "stable-message-id" };
    },
    on_submitted: () => {
      accepted += 1;
    },
    reconcile: async () => {
      throw new Error("database unavailable after SMTP acceptance");
    },
  });

  assert.equal(submissions, 1);
  assert.equal(accepted, 1);
  assert.equal((result.submission as { message_id: string }).message_id, "stable-message-id");
  assert.match(String(result.reconciliation_error), /database unavailable/);
});

test("SMTP failure classification retries only definitive non-accepted outcomes", () => {
  assert.deepEqual(classifyImportantEventSmtpFailure({
    responseCode: 451,
    command: "DATA",
    message: "Try later",
  }), {
    retryable: true,
    counts_as_submission: false,
    reason: "explicit_transient_rejection",
  });
  assert.equal(classifyImportantEventSmtpFailure({
    code: "ECONNECTION",
    command: "CONN",
    message: "Connection refused",
  }).retryable, true);
  assert.deepEqual(classifyImportantEventSmtpFailure({
    code: "ETIMEDOUT",
    command: "DATA",
    message: "Timed out waiting for final response",
  }), {
    retryable: false,
    counts_as_submission: true,
    reason: "ambiguous_submission_outcome",
  });
  assert.deepEqual(classifyImportantEventSmtpFailure({
    responseCode: 550,
    command: "RCPT TO",
    message: "Mailbox rejected",
  }), {
    retryable: false,
    counts_as_submission: false,
    reason: "explicit_permanent_rejection",
  });
});

test("pre-submission processing failure remains retryable and does not consume outbound caps", () => {
  assert.deepEqual(classifyImportantEventDeliveryFailure(
    new Error("database statement timeout while loading event context"),
    false,
  ), {
    retryable: true,
    counts_as_submission: false,
    reason: "pre_submission_processing_failure",
  });
});
