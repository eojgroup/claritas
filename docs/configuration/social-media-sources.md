# Social-media source setup

Claritas supports X, YouTube, Reddit, and Bluesky as a separate social-signal
pipeline. A stored record means that the attributed platform account published
the message. It does **not** mean that the message is true. Social-only content
does not become a news article or a canonical fact, and an account verification
badge is never converted into a credibility score.

## Provider and credential matrix

| Provider | Claritas capability | Required configuration | External access needed |
| --- | --- | --- | --- |
| Bluesky | Public post search through the Bluesky AppView | None | None; both official AppView hosts are keyless |
| X | Recent post search with author, public metrics, place, and media expansions | Secret `X_BEARER_TOKEN` | Approved X developer project/app and API access that includes recent search |
| YouTube | Public video search followed by video metadata lookup, including uploader/channel attribution | Secret `YOUTUBE_API_KEY` | Google Cloud project with YouTube Data API v3 enabled |
| Reddit | Public submission search with subreddit/author attribution | Secrets `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`; variables `REDDIT_USER_AGENT`, `REDDIT_API_APPROVED=true`, `SOCIAL_REDDIT_ENABLED=true` | Reddit Data API approval and any commercial agreement Reddit requires for the intended use |

Meta/Facebook/Instagram, TikTok, and LinkedIn are not silently scraped. Their
standard APIs do not provide a generally available, commercially safe public-
post search surface for this use case. Add one only after its owner grants the
specific product permission and its retention/display terms are implemented.

Official implementation references:

- [X recent-search quickstart](https://docs.x.com/x-api/posts/search/quickstart/recent-search)
- [Bluesky public post-search API](https://docs.bsky.app/docs/api/app-bsky-feed-search-posts)
- [YouTube Data API setup](https://developers.google.com/youtube/v3/getting-started),
  [`search.list`](https://developers.google.com/youtube/v3/docs/search/list), and
  [`videos.list`](https://developers.google.com/youtube/v3/docs/videos/list)
- [Reddit Data API access guidance](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data),
  [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy),
  [Data API Terms](https://redditinc.com/policies/data-api-terms), and
  [API reference](https://www.reddit.com/dev/api/)
- [LinkedIn Posts API permissions](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
  and [TikTok Research API eligibility](https://developers.tiktok.com/products/research-api/),
  which explain why those platforms are not in the production shortlist

## 1. Create provider access outside the repository

### X

1. In the [X Developer Console](https://developer.x.com/), create or select a
   Project and App owned by the production organization.
2. Obtain API access that permits `GET /2/tweets/search/recent`. X product names,
   prices, post caps, and access tiers can change; verify the current limit in
   the console before enabling a schedule.
3. Generate the App-only Bearer Token. Do not store it in a local file committed
   to Git.
4. Add it to GitHub at **Settings → Secrets and variables → Actions → Secrets**
   as `X_BEARER_TOKEN`.

### YouTube

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select
   the production project.
2. Open **APIs & Services → Library**, enable **YouTube Data API v3**, then open
   **Credentials → Create credentials → API key**.
3. Restrict the key to YouTube Data API v3. If the deployment has a stable
   outbound IP, also apply an IP restriction after verifying that egress path.
4. Add the value as the GitHub Actions secret `YOUTUBE_API_KEY`.
5. Review the project's current search-query limit and quota usage. Start with
   the default bounded query list and disabled schedule.

### Reddit

1. Read the current [Reddit Data API terms](https://redditinc.com/policies/data-api-terms)
   and request approval for this commercial monitoring use case.
2. Create the approved OAuth application and record its client ID and client
   secret.
3. Agree on a descriptive user agent, for example
   `Claritas/1.0 by ClaritasEngineering (engineering@claritas.info)`.
4. Add `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` as GitHub Actions secrets.
5. Add `REDDIT_USER_AGENT` as a GitHub Actions variable. Only after
   approval/contract review is recorded, set **both**
   `REDDIT_API_APPROVED=true` and `SOCIAL_REDDIT_ENABLED=true`. The repository
   and workflow defaults keep both gates false, and the connector refuses to
   call Reddit without approval even when credentials exist.

### Bluesky

No key is required. Claritas first uses `https://public.api.bsky.app`. If that
request is rejected or fails, it makes one bounded retry through the fixed
official fallback `https://api.bsky.app`; caller-supplied hosts are never
accepted. Keep the identifying `SOCIAL_USER_AGENT` configured and monitor
public-service rate limits.

## 2. Configure repository deployment values

In GitHub **Actions variables**, set the non-secret controls as needed:

```text
SOCIAL_X_ENABLED=true
SOCIAL_YOUTUBE_ENABLED=true
SOCIAL_REDDIT_ENABLED=false
SOCIAL_BLUESKY_ENABLED=true
SOCIAL_DISCOVERY_QUERIES=geopolitics|security|markets|transport disruption|extreme weather
SOCIAL_MAX_RESULTS_PER_QUERY=25
SOCIAL_LOOKBACK_HOURS=24
SOCIAL_RETENTION_DAYS=7
SOCIAL_USER_AGENT=Claritas/1.0 (+https://app.claritas.info; engineering@claritas.info)
REDDIT_USER_AGENT=Claritas/1.0 by ClaritasEngineering (engineering@claritas.info)
REDDIT_API_APPROVED=false
```

Migration V57 enables hourly Bluesky-only collection with seven-day retention.
Credentialed providers remain explicitly opt-in. The social coverage response
includes collection enablement, scheduling, and the last run status. API
availability alone does not establish live ingestion.
deployment reads tokens and client secrets from three optional Secrets created
by the release workflow:

- `claritas-x-social`, key `X_BEARER_TOKEN`;
- `claritas-youtube`, key `YOUTUBE_API_KEY`;
- `claritas-reddit`, keys `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`.

The workflow only creates/upserts a Secret when its corresponding GitHub Actions
secret values exist. It never writes those values into the ConfigMap or an API
response. The repository's `REDDIT_USER_AGENT` default is intentionally empty,
and the connector rejects the former placeholder value, so Reddit cannot become
ready until an identifying value is explicitly configured.

Deleting a GitHub Actions secret does not revoke a credential that was already
copied into Kubernetes: the deployment workflows preserve existing provider
Secrets when their GitHub inputs are absent. To disable a source immediately,
set its `SOCIAL_*_ENABLED` variable to `false`, revoke the credential with the
provider, delete the corresponding Kubernetes Secret, and restart the API. Use
the same explicit process during incident response; do not treat removal from
GitHub alone as revocation.

For local API development, export the same values in the shell that starts the
API. Do not put live secrets in `.env` files that could be committed. Bluesky is
enough to exercise the full database/API/client path without a credential.

## 3. Apply the repository implementation

1. Apply Flyway migration `V55__governed_social_signals.sql`. It creates the
   separate `social_signal` table, chronological indexes, seven-day-expiry
   support, and expands the pipeline constraints. The migration deliberately
   does not insert an automation row while the previous API is still serving;
   automatic startup also leaves that row absent so a failed rollout remains
   compatible with the previous API.
2. Deploy the API and web clients. The API exposes:
   - `GET /api/social/signals` — authenticated, newest-first reader endpoint;
   - `GET /api/social/coverage` — provider readiness and non-secret coverage;
   - `GET /api/social/providers` — non-secret provider configuration status;
   - `POST /api/admin/ingestion/social/run` — administrator-only bounded run.
3. The iPhone, iPad, Watch, and web clients use the same record contract and
   label every item as an unverified claim. They display both `posted_by` and
   `responsible_party` rather than presenting Claritas as the speaker.
4. The connector excludes posts explicitly marked sensitive by X, Reddit, or
   reviewed Bluesky adult/graphic labels. YouTube requests
   `safeSearch=moderate`. This conservative enterprise-display default is not a
   substitute for provider moderation or organizational content policy.

## 4. Run a controlled first ingestion

Sign in as a Claritas administrator, open **Admin → Ingestion → Social signal
run**, select only configured providers, keep results at 25 and lookback at 24
hours, and enter one narrowly scoped query per line. Alternatively call:

```http
POST /api/admin/ingestion/social/run
Content-Type: application/json

{
  "providers": {
    "x": false,
    "youtube": false,
    "reddit": false,
    "bluesky": true
  },
  "queries": ["transport disruption"],
  "maxResultsPerQuery": 25,
  "lookbackHours": 24
}
```

The endpoint requires the normal authenticated administrator session. Do not
publish an ingestion token in a command example or browser console.

The body also accepts the snake-case aliases `max_results_per_query` and
`lookback_hours`. The API de-duplicates and limits the request to 10 queries,
1–100 results per query, and a 1–168 hour lookback. A `202` response is the
normal ingestion-run detail, whose ID can be followed through
`GET /api/admin/ingestion/runs/{id}`. When the entire `providers` object is
omitted, the plan defaults to providers whose status is currently `available`.
Once a `providers` object is supplied, every omitted provider defaults to false,
so a partial explicit selection cannot silently add a configured, billable
source. Production callers should still send all four booleans so the selected
scope is auditable.

## Reader and coverage API contract

`GET /api/social/signals` accepts `platform`, `country`, `q`, `limit`, and
`offset`. Rows are ordered strictly by `posted_at DESC, id DESC`, independently
of engagement or importance. The root contains `items`, `count`, `page`, and a
claim `classification`. Each item has this attribution/trust shape:

```json
{
  "id": 123,
  "platform": "x",
  "content_type": "social_post",
  "signal_nature": "claim",
  "verification_status": "unverified",
  "is_fact": false,
  "text": "Unconfirmed report...",
  "url": "https://x.com/example/status/123",
  "posted_at": "2026-09-07T08:10:00.000Z",
  "posted_by": {
    "account_id": "42",
    "handle": "@example",
    "display_name": "Example account",
    "profile_url": "https://x.com/example",
    "avatar_url": null,
    "platform_verified": true
  },
  "responsible_party": {
    "name": "Example account",
    "account_id": "42",
    "type": "account_holder",
    "attribution_basis": "platform_account",
    "caveat": "The platform account is responsible for publishing this message; Claritas has not established the real-world controller of the account."
  },
  "credibility": {
    "tier": "unverified_social",
    "score": null,
    "platform_verified_account": true,
    "rationale": "Social posts are signals and claims. They require independent corroboration before factual use."
  },
  "warning": "Unverified social-media claim. Account attribution and platform verification do not establish factual accuracy."
}
```

An unavailable provider verification marker is serialized as `false`; that
means “the API did not establish a platform marker,” not “the person is
untrustworthy.” `GET /api/social/coverage?days=7` returns no credentials:

```json
{
  "window_days": 7,
  "coverage": [
    {
      "platform": "bluesky",
      "signal_count": 42,
      "account_count": 18,
      "latest_posted_at": "2026-09-07T08:10:00.000Z",
      "latest_acquired_at": "2026-09-07T08:11:00.000Z"
    }
  ],
  "providers": [
    {
      "id": "bluesky",
      "label": "Bluesky",
      "enabled": true,
      "configured": true,
      "available": true,
      "authentication": "none",
      "required_environment": [],
      "access_note": "Uses the public Bluesky AppView search endpoint; no API key is required."
    }
  ],
  "classification": {
    "content_type": "social_post",
    "signal_nature": "claim",
    "default_verification_status": "unverified",
    "is_fact": false,
    "warning": "Unverified social-media claim. Account attribution and platform verification do not establish factual accuracy."
  }
}
```

## 5. Verify before enabling automation

1. Open `/api/social/coverage?days=7`. Confirm that no secret values are present.
   `available=true` means enabled and locally configured; prove actual delivery
   with the provider's `latest_acquired_at` coverage timestamp and the latest
   ingestion-run steps.
2. Open the Social signal monitor on web, iPhone/iPad, and Watch. Confirm newest-
   first order, original links, handle/display name, responsible party, and the
   unverified warning.
3. Sample records in the database. `content_type` must be `social_post`,
   `signal_nature` must be `claim`, and country attribution must state its basis;
   absence of geotag evidence stays unmapped.
4. Check duplicate handling by rerunning the same query. Provider external IDs
   update engagement instead of creating a second post.
5. V57 schedules Bluesky hourly. Use Admin to pause collection or change its
   cadence. Review quotas and credentials before adding other providers.
   Physical expiry does not depend on a successful social-provider run: the
   general ingestion maintenance cycle deletes expired social rows at least
   every six hours while the production automation worker is running.

## Trust and operating rules

- Never word a social-only item as “confirmed”, even for a platform-verified
  account.
- Never infer a country from a language, profile biography, display name, or
  subreddit alone. Only provider geotags or another explicit attribution basis
  may map geography.
- Preserve the original post URL and account attribution. A repost does not
  transfer responsibility for the original message.
- Treat engagement as mutable platform metadata, not support for a claim.
- Treat a platform badge only as platform metadata. Never describe it as proof
  of identity or as validation of the message.
- The connectors poll search APIs; they do not consume platform deletion or
  tombstone streams. Keep a credentialed provider disabled unless its reviewed
  terms permit the configured 1–30 day retention plus the maintenance-cycle
  deletion lag. On a provider deletion notice, disable that provider and purge
  the affected local row or platform dataset through a controlled database
  operation before re-enabling it.
- Respect each provider's deletion, retention, attribution, branding, and quota
  terms. Disable a provider immediately when its approved access no longer
  covers Claritas usage.


## Investigation alignment

Social runs add up to eight bounded discovery queries from active map events.
Retained posts link only when their publisher timestamp fits the event window,
at least three meaningful title terms overlap (at least 60% of title terms),
and the event's named country or location appears in the post when known.
Links are contextual, not corroboration. Event confidence, severity, canonical
evidence counts, and map ranking are unchanged by social volume or verification
badges. Country filtering can follow the linked investigation's geography without
claiming that the author posted from that location.

The web source explorer passes `eventId` from the selected map investigation.
Event details and briefing inputs share the same bounded `social_context` with
account attribution, original URL, timestamp, matched terms, and an explicit
uncertainty boundary. Conclusions must label these as unverified claims. Expired
posts are excluded immediately and deletion cascades to context links. No
matching posts means coverage is unavailable, not that discussion is absent.
