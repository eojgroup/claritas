# Event context recovery and visual continuity

The reported Valencia event (`95b94d45-c7d9-4559-b5c8-e90f091e5032`)
exists and has valid transport evidence. Production returned
`regional_reporting: []` on the default lightweight read. This field is an
object or `null` in the web and Apple contracts. Apple rejected the response;
the web source panel attempted to access `regional_reporting.items.length` and
failed during rendering. The earlier release probe checked event existence but
did not check this nested contract.

The response builder now returns `null` when regional context is unrequested.
This is a read-path fix, so existing and newly created events receive the same
correct shape without a database migration. No compatibility adapter accepts
the erroneous array. The server also checks the inferred regional-reporting
type at compile time. Regression coverage exercises a newly created event,
authenticated HTTP under optional-query contention, web rendering and strict
Apple decoding; the deployment probe rejects an incorrect lightweight shape.

The iPhone/iPad overview uses the retained touch canvas with bundled Natural
Earth country geometry and the existing density/event/imagery overlays. It
focuses on the leading or selected country, supports country profile taps,
pinch/pan/reset and renders without Apple basemap tiles. Country counts retain
count units instead of a `/100` relevance label. The dedicated transport tracking
workspace remains separate.

Event visuals now include stored publisher photos on Apple as well as processed
satellite previews and observed-versus-baseline transport charts. Image matching
uses the event's last-activity window (72 hours before to 24 hours after). Related
article reuse additionally requires the same specific place and event type, or
an explicit event relationship. Satellite reuse still requires actual rendered
coverage. Recently collected bytes cannot make an old capture or old article
eligible. The same time window controls background overview image selection.
Article publication is never represented as a verified photograph capture date.
No image downloads, model inference or extra source fan-out run on event opening.

The event visual selector leads with available images or the recorded transport
comparison. Weather loads only after selection, through an authenticated,
optional-priority, cached endpoint. It reads one retained country reference
snapshot within six hours of the event update, and at most twelve temperature
forecast points from that provider. Temperature, precipitation, wind speed and
direction are rendered from those records. Reference geography is explicitly
separated from the event site; the line is labelled as a forecast, not observed
history. Missing samples return `weather: null`. The initial overview/event
request budget does not grow, and no generated weather or transport scene is used.

## Release handoff — paused at user request

Application commit: `3e420c49da93b147144fac24580286f7a512f8a6` (includes
the event-contract/map fix from `630d13f`). The combined release is pushed;
no further application edits are pending.

- [Apple release 43223394325](https://github.com/eojgroup/claritas/actions/runs/43223394325)
  succeeded. **1.0 (1000.0.59)** is available to Claritas Test Group. All 57 shared
  model tests, iPhone/iPad/Watch builds and signed distribution passed.
- [GKE release 43223394342](https://github.com/eojgroup/claritas/actions/runs/43223394342)
  is still running at handoff. Validation passed; image publishing/deployment
  continues independently. Existing release health gates and application rollback
  remain enabled. Do not treat a running pipeline as a successful deployment.
- Previous GKE run 43221744819 was intentionally cancelled before rollout when
  weather visuals were added. Its matching Apple build succeeded but is superseded
  by build 59.

Local verification: 458 API unit tests, 184 web tests, API/web builds, web lint
(two existing warnings only), all 34 original PostGIS integration tests on a
fresh disposable database, and the additional weather/updated authenticated HTTP
tests passed. The final GKE validation also exercised the complete database suite.
The temporary PostGIS pod `claritas-event-check-1112` was deleted.

A read-only production probe of the new weather query found a timely Spain
reference sample for the reported Valencia event, eight forecast points, and a
31 ms read. This did not deploy the new endpoint. The local Apple toolchain is
inconsistent; rely on the successful full-Xcode CI checks rather than local Swift
linking attempts.

On resume, check GKE run 43223394342 first. If successful, inspect its final
runtime checks and verify the exact reported event with the deployed
`getIntelligenceEvent`: `regional_reporting` must be `null` on the lightweight
read, with valid evidence. Check the authenticated weather endpoint and public
web assets. If failed, inspect the failed step and rollback status before making
changes. Finish with a release receipt after production verification; no new
feature scope is required. Logs are in `/tmp/claritas-3e4-apple.log` and the
`/tmp/claritas-3e4-*-watch.log` files. Local Google authentication was refreshed
and working during this session; credentials may need renewal after the pause.
