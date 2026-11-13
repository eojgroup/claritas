# Map workspace release — 13 November 2026

PR https://github.com/eojgroup/claritas/pull/63 replaced the World map card with a continuous map and movable context. Its final revision c79e22e passed both PR pipelines, including 60 Apple model tests, universal iPhone/iPad and Watch builds, retained-source PostGIS checks and 187 web tests. Actual native simulator captures from the production WorldMapWorkspace were reviewed on iPhone and iPad. They use captured overview data through a Debug-only entry point; their unauthenticated image errors do not establish production image availability.

The squash merge is f59d1ae66dab1100a4877eab032cbc36dbd7fef8. The Apple delivery run is https://github.com/eojgroup/claritas/actions/runs/43396760000.

A final web review caught controls appearing above event context on direct event links. Follow-up 63eff758b2fe6753e2e61353d24687b2915c8dd9 puts the event first and preserves the general controls below it. All 188 web tests and the production build passed locally. The prior GKE run 43396760050 was intentionally cancelled during validation, before rollout, and replaced by https://github.com/eojgroup/claritas/actions/runs/43397457658. The web-only follow-up does not change the Apple release.

The map keeps full-period country shading, located events, labels/flags and grouped native pins. Context retains the timeline, briefing, timely image strips, country profile, event evidence and transport/weather visuals. The native overview refresh moved to the workspace so it continues while an event is open; the initial source request budget remains unchanged.

Before rollout the public app returned HTTP 200 in 0.116 seconds with index-slhSRV36.js. The local preview and temporary preview harness were stopped and removed. Final runtime and distribution results follow below.

Apple's compile/test/capture/Watch job passed. Delivery of build 1000.0.66 stopped in `Prepare App Store provisioning profiles`: certificate discovery returned HTTP 403 with `FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`. This is an Apple account agreement requirement, not a compilation or map failure. The Account Holder was asked to review the pending agreement. Resume by rerunning only failed jobs on run 43396760000 after that action is confirmed; do not repeat completed build/capture jobs or bypass Apple's account requirement.

## Verified web delivery

GKE run 43397457658 succeeded on 63eff758b2fe6753e2e61353d24687b2915c8dd9, including validation, image builds, rollout and production runtime gates. Six overview snapshots and a fresh prepared feed were ready before the read probe. Production measured feed 420 ms (100 events), detail 423 ms, overview 45 ms and 1,570 ms total. The overview returned while all 24 optional probe requests were still pending; feed/detail timings precede that optional backlog.

The public app returned HTTP 200 in 0.186 seconds. Its live JavaScript is `/assets/index-CicA4kgz.js` (369,557 bytes) and stylesheet `/assets/index-hpmxpHiN.css` (226,979 bytes). Both contain the new map workspace; the JavaScript includes the resize-context interaction. These filenames match the production build.

Apple remains pending the Account Holder's agreement action. Its completed compile/test/Watch/simulator jobs do not imply that build 1000.0.66 is available in TestFlight. Retry only the failed delivery job after confirmation; its run ID is recorded above.

The production overview gate verified 12,023 developments, 124 countries, 66 precise map events, eight images and 12 complete buckets for 24h/all. The 7-day view covered 62,662 developments and 14 complete buckets, with 200 bounded map events. A retained publisher image's actual preview bytes were verified. These counts come from production gates, not the simulator fixture.
