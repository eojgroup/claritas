# Global feed recovery and native map review

GKE run `43223394342` failed after rollout when the global 100-event ranking
query exceeded its 15-second statement timeout. Application rollback completed.
Apple build 59 had succeeded; the corresponding web/API changes were rolled back.

The production query ranked about 12,900 live candidates against 1.37 million
evidence records before selecting a page. Repeated random evidence/assessment
reads dominated execution. A bulk join alone scanned too much history. Covering
indexes and a bounded indexed evidence batch reduced a measured build to about
seven seconds, which is still inappropriate on the interactive path.

V72 codifies two concurrently built covering indexes and earlier vacuum/analyze
thresholds for the hot cohort. The two indexes were first built online during
diagnosis; the migration rebuilds them safely, including invalid interrupted
builds. Evidence vacuum was attempted with the application's timeout; subsequent
feed/assessment vacuum used a dedicated maintenance connection and completed.
No database tier, disk size or paid model configuration changed.

V73 adds one durable global feed snapshot. The worker computes the same complete
priority/diversity ordering once per two-minute cycle, using a bounded 30-second
background query. Interactive reads use the prepared 100-card page and recheck
current status, expiry, publisher acceptance and retained social evidence only
for its IDs. Scoped searches keep their existing exact query. Cached translations
retain their originals and can be presented in another requested language.
The expensive fallback remains for cold/scoped reads; deployment prevents cold
global traffic by waiting for a fresh feed snapshot before changing API/web images.
The runtime gate additionally rejects feed reads over five seconds.

A rollback-only production probe using the compiled implementation and a
session-local temporary snapshot measured **8,886 ms** to build the complete
ranking and **31 ms** to read/revalidate its 100-card page, with identical order.
The reported Valencia event decoded to `regional_reporting: null`, one evidence
record and its original title. This probe did not deploy application code or
write persistent feed data.

The iPhone/iPad map now uses Natural Earth 1 with one uniform fit scale, matching
web instead of stretching longitude and latitude independently. Projected country
rings are cached once; panning applies a cheap transform. Controls and labels
remain a fixed readable size. Nearby pins become count groups that open an event
list, preserving coincident events. Country names/flags, an explicit activity/
event/imagery legend and two-finger map pan distinguish map interaction from page
scrolling. Single taps still open country profiles or event context.

Apple CI captures the actual component in iPhone/iPad simulators using a captured
production overview (112 countries, 87 located events). The fixture lives under
Tests and is not bundled in the app. The review entry exists only under `DEBUG`;
App Store builds use the normal authenticated root. These are native rendering
checks, not substitute production mockups.

Local validation: 458 API unit tests, all 35 PostGIS integration tests against
V1–V73, and a focused rerun of the updated HTTP test passed. The latter prepares
the real feed and verifies feed/detail/auth/overview/briefing/readiness during
blocked optional requests. Regression tests preserve quality, social retention,
assessment freshness, critical ranking and pagination, and invalidate rejected/
expired saved cards without reranking all history. Swift parse and project
validation passed; full device builds and native captures run in Apple CI.
