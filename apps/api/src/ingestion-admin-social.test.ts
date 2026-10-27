import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

const ingestion = import("./ingestion-admin");

test("social plan defaults to available providers and records an unverified-claim classification", async () => {
  const previous = {
    x: process.env.X_BEARER_TOKEN,
    redditId: process.env.REDDIT_CLIENT_ID,
    redditSecret: process.env.REDDIT_CLIENT_SECRET,
    redditApproved: process.env.REDDIT_API_APPROVED,
    youtube: process.env.YOUTUBE_API_KEY,
    bskyEnabled: process.env.SOCIAL_BLUESKY_ENABLED,
  };
  delete process.env.X_BEARER_TOKEN;
  delete process.env.REDDIT_CLIENT_ID;
  delete process.env.REDDIT_CLIENT_SECRET;
  process.env.REDDIT_API_APPROVED = "false";
  delete process.env.YOUTUBE_API_KEY;
  process.env.SOCIAL_BLUESKY_ENABLED = "true";
  try {
    const { buildSocialRunPlan } = await ingestion;
    const plan = buildSocialRunPlan({ queries: ["port disruption"] });
    assert.deepEqual(plan.providers, { x: false, reddit: false, youtube: false, bluesky: true });
    assert.equal(plan.requestPayload.content_classification, "unverified_social_claim");
    assert.deepEqual(plan.queries, ["port disruption"]);
  } finally {
    if (previous.x == null) delete process.env.X_BEARER_TOKEN; else process.env.X_BEARER_TOKEN = previous.x;
    if (previous.redditId == null) delete process.env.REDDIT_CLIENT_ID; else process.env.REDDIT_CLIENT_ID = previous.redditId;
    if (previous.redditSecret == null) delete process.env.REDDIT_CLIENT_SECRET; else process.env.REDDIT_CLIENT_SECRET = previous.redditSecret;
    if (previous.redditApproved == null) delete process.env.REDDIT_API_APPROVED; else process.env.REDDIT_API_APPROVED = previous.redditApproved;
    if (previous.youtube == null) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = previous.youtube;
    if (previous.bskyEnabled == null) delete process.env.SOCIAL_BLUESKY_ENABLED; else process.env.SOCIAL_BLUESKY_ENABLED = previous.bskyEnabled;
  }
});

test("social plan refuses explicitly selected unconfigured or unapproved providers", async () => {
  const { buildSocialRunPlan, IngestionValidationError } = await ingestion;
  const oldToken = process.env.X_BEARER_TOKEN;
  const oldApproved = process.env.REDDIT_API_APPROVED;
  const oldRedditEnabled = process.env.SOCIAL_REDDIT_ENABLED;
  delete process.env.X_BEARER_TOKEN;
  process.env.SOCIAL_REDDIT_ENABLED = "true";
  process.env.REDDIT_API_APPROVED = "false";
  try {
    assert.throws(
      () => buildSocialRunPlan({ providers: { x: true, bluesky: false }, queries: ["security"] }),
      IngestionValidationError,
    );
    assert.throws(
      () => buildSocialRunPlan({ providers: { reddit: true, bluesky: false }, queries: ["security"] }),
      /REDDIT_API_APPROVED=true/,
    );
  } finally {
    if (oldToken == null) delete process.env.X_BEARER_TOKEN; else process.env.X_BEARER_TOKEN = oldToken;
    if (oldApproved == null) delete process.env.REDDIT_API_APPROVED; else process.env.REDDIT_API_APPROVED = oldApproved;
    if (oldRedditEnabled == null) delete process.env.SOCIAL_REDDIT_ENABLED; else process.env.SOCIAL_REDDIT_ENABLED = oldRedditEnabled;
  }
});

test("social run parameters are bounded before provider execution", async () => {
  const { buildSocialRunPlan } = await ingestion;
  const plan = buildSocialRunPlan({
    providers: { bluesky: true, x: false, reddit: false, youtube: false },
    queries: Array.from({ length: 14 }, (_, index) => `query-${index}`),
    max_results_per_query: 999,
    lookback_hours: 999,
  });
  assert.equal(plan.queries.length, 10);
  assert.equal(plan.maxResultsPerQuery, 100);
  assert.equal(plan.lookbackHours, 168);
});

test("an explicit provider map never silently adds other configured providers", async () => {
  const { buildSocialRunPlan } = await ingestion;
  const oldToken = process.env.X_BEARER_TOKEN;
  process.env.X_BEARER_TOKEN = "configured-but-not-selected";
  try {
    const plan = buildSocialRunPlan({
      providers: { bluesky: true },
      queries: ["security"],
    });
    assert.deepEqual(plan.providers, { x: false, reddit: false, youtube: false, bluesky: true });
  } finally {
    if (oldToken == null) delete process.env.X_BEARER_TOKEN; else process.env.X_BEARER_TOKEN = oldToken;
  }
});

test("social provider results distinguish partial degradation from total failure", async () => {
  const { classifySocialProviderResult } = await ingestion;
  assert.equal(classifySocialProviderResult({
    fetched: 4,
    inserted: 4,
    updated: 0,
    successful_queries: 2,
    failed_queries: 1,
    http_failures: 1,
    db_errors: 0,
  }, 3), "degraded");
  assert.equal(classifySocialProviderResult({
    fetched: 0,
    inserted: 0,
    updated: 0,
    successful_queries: 0,
    failed_queries: 3,
    http_failures: 3,
    db_errors: 0,
  }, 3), "failed");
  assert.equal(classifySocialProviderResult({
    fetched: 2,
    inserted: 0,
    updated: 0,
    successful_queries: 3,
    failed_queries: 0,
    http_failures: 0,
    db_errors: 2,
  }, 3), "failed");
  assert.equal(classifySocialProviderResult({
    fetched: 0,
    inserted: 0,
    updated: 0,
    successful_queries: 0,
    failed_queries: 0,
    http_failures: 1,
    db_errors: 0,
  }, 3), "failed");
});

test("social is wired through automation, admin run metrics, API, and deployment secrets", () => {
  const automation = readFileSync(resolve(__dirname, "ingestion-automation.ts"), "utf8");
  const admin = readFileSync(resolve(__dirname, "ingestion-admin.ts"), "utf8");
  const api = readFileSync(resolve(__dirname, "index.ts"), "utf8");
  const deployment = readFileSync(resolve(__dirname, "../../../infra/k8s/api-deployment.yaml"), "utf8");
  const config = readFileSync(resolve(__dirname, "../../../infra/k8s/config/claritas-config.yaml"), "utf8");
  const workflow = readFileSync(resolve(__dirname, "../../../.github/workflows/gke-deploy.yml"), "utf8");
  const terraformWorkflow = readFileSync(resolve(__dirname, "../../../.github/workflows/terraform-deploy.yml"), "utf8");
  const guide = readFileSync(resolve(__dirname, "../../../docs/configuration/social-media-sources.md"), "utf8");
  const migration = readFileSync(resolve(__dirname, "../../../infra/gcp/sql/V55__governed_social_signals.sql"), "utf8");
  const dbVerification = readFileSync(resolve(__dirname, "../../../infra/k8s/migrations/db-verify-job.yaml"), "utf8");
  const adminPanel = readFileSync(resolve(__dirname, "../../web/src/components/AdminIngestionPanel.tsx"), "utf8");

  assert.match(automation, /social:\s*\{[\s\S]*schedule_enabled: false/);
  assert.match(automation, /SELECT 'social', MAX\(posted_at\)/);
  assert.match(automation, /await pruneExpiredSocialSignals\(\)/);
  assert.match(automation, /triggerSocialRun/);
  assert.match(admin, /pipeline === "social"/);
  assert.match(admin, /steps\.filter\(\(step\) => step\.status !== "success"\)/);
  assert.match(admin, /x_social','reddit_social','youtube_social','bluesky_social/);
  assert.match(api, /app\.get\("\/api\/social\/signals"/);
  assert.match(api, /app\.get\("\/api\/social\/coverage"/);
  assert.match(api, /app\.post\("\/api\/admin\/ingestion\/social\/run"/);
  assert.match(deployment, /name: X_BEARER_TOKEN[\s\S]*name: claritas-x-social/);
  assert.match(deployment, /name: REDDIT_CLIENT_ID[\s\S]*name: claritas-reddit/);
  assert.match(deployment, /name: YOUTUBE_API_KEY[\s\S]*name: claritas-youtube/);
  assert.match(workflow, /secrets\.X_BEARER_TOKEN/);
  assert.match(workflow, /secrets\.REDDIT_CLIENT_SECRET/);
  assert.match(workflow, /secrets\.YOUTUBE_API_KEY/);
  assert.match(config, /SOCIAL_REDDIT_ENABLED: "false"/);
  assert.match(config, /REDDIT_API_APPROVED: "false"/);
  assert.match(config, /REDDIT_USER_AGENT: ""/);
  assert.doesNotMatch(migration, /INSERT INTO ingestion_automation_rule[\s\S]*'social'/);
  assert.match(migration, /administrator explicitly prepares social automation/i);
  assert.match(automation, /const pipelines = \["news", "weather", "market", "podcasts", "leadership"\]/);
  assert.match(automation, /if \(!current && pipeline === "social"\)[\s\S]*ensureAutomationRuleExists\(pipeline\)/);
  assert.match(adminPanel, /Prepare social automation/);
  assert.match(dbVerification, /\('social_signal'\)/);
  assert.match(workflow, /SOCIAL_REDDIT_ENABLED: \$\{\{ vars\.SOCIAL_REDDIT_ENABLED \|\| 'false' \}\}/);
  assert.match(terraformWorkflow, /SOCIAL_REDDIT_ENABLED: \$\{\{ vars\.SOCIAL_REDDIT_ENABLED \|\| 'false' \}\}/);
  for (const secretName of ["claritas-x-social", "claritas-reddit", "claritas-youtube"]) {
    assert.match(deployment, new RegExp(`name: ${secretName}`));
    assert.match(workflow, new RegExp(`secret generic ${secretName}`));
    assert.match(terraformWorkflow, new RegExp(`secret generic ${secretName}`));
    assert.match(guide, new RegExp(secretName));
  }
});
