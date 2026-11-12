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

## Successful release receipt

[GKE run 43239242243](https://github.com/eojgroup/claritas/actions/runs/43239242243)
deployed backend/web commit `e889356` successfully. V72/V73 applied, all six
overview views and the prepared feed were fresh before API/web rollout, and
ingestion/transport/runtime checks passed. Production measured the 100-event feed
at **407 ms**, event detail at **360 ms**, and the saved overview at **25 ms**
while 24 optional queries were pending. The previous release failed at the
15-second feed timeout. The interactive deadline was not increased.

The 24-hour All overview contained 12,361 developments, 111 countries, 80 located
map events and eight images; all 12 chart buckets reconciled with the full count.
The seven-day view contained 62,094 developments, 170 countries, 200 bounded pins
and eight images. Retained publisher preview bytes were read successfully.
News runtime verified 1,680 current stories and current transport reception.

An independent post-deployment check loaded the exact Valencia event with
`regional_reporting: null` and valid transport evidence. It measured feed/detail
reads at 453/256 ms and found eight timely weather forecast points. Public event
HTML and its JavaScript assets returned HTTP 200; the live `index-slhSRV36.js`
and `IntelligenceWorkspace-B8Jdi3u3.js` match the Linux CI build. The event bundle
contains the weather loader, forecast and visual selector.

[Apple run 43240620106](https://github.com/eojgroup/claritas/actions/runs/43240620106)
released mobile commit `5603046` as **1.0 (1000.0.62)** to Claritas Test Group.
All 60 model tests, iPhone/iPad/Watch builds, simulator captures and signed
distribution passed. The phone/tablet captures were visually inspected. Country
proportions, names/flags and grouped pins are visible; iPad count labels stay on
one line, and the explanatory event/image/group key sits below the map.

The intermediate native build exposed a transport dependency on shared country
polygons, which was restored. Superseded GKE runs were cancelled during validation,
before production mutations. Mobile-only pushes now trigger Apple CI without
restarting web/API deployments. Native QA fixtures and launch handling remain
test-only; production still uses the authenticated application and live data.
Temporary validation pods and the isolated production-probe files were removed.
