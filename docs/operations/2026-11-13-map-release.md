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

## Adaptive context and imagery follow-up

PR https://github.com/eojgroup/claritas/pull/64 merged as aa338a546dfe1e5e1e94dba0e216322b95397783. The workspace now uses a bottom sheet on portrait/narrow layouts and a wider, expandable side panel where space permits. Country profiles open above controls without a competing overview scroll, and their optional resources publish independently with cancellable eight-second reads. Timely image previews are available over the map and earlier in context. Standalone event maps share the interactive Natural Earth renderer. Native transport uses local ocean tiles and bundled country geometry while preserving routes, tracks, vehicle selection and native gestures.

Apple run https://github.com/eojgroup/claritas/actions/runs/43463295674 succeeded after the account agreement was accepted. It passed 62 shared model tests, iPhone/iPad and Watch compilation, actual native map captures, signing, archive, export, upload and TestFlight processing. Build 1000.0.71 is available to Claritas Test Group through automatic access. The simulator captures use an unauthenticated captured-data entry point, so their image placeholders do not verify authenticated image delivery.

Web follow-up af83f8525b712a977bd8576bca0e173b91463cea preserves precise event centering in the shared location map. GKE run https://github.com/eojgroup/claritas/actions/runs/43463695263 succeeded. The earlier aa338a5 web run 43463295618 was intentionally replaced during validation, before deployment began. Public HTML returned HTTP 200 in 0.125 seconds with index-DtxHWGUP.js and index-CL9q8Enk.css.

Production verified 12,520 developments, 125 countries, 155 precise map events, eight images and 12 complete buckets for 24h/all. The high-priority view had 232 developments, 13 countries, one precise pin and no eligible images. The 7-day view had 63,218 developments, 217 countries, 200 bounded precise pins and 14 complete buckets. The gate verified retained publisher image bytes. Feed/detail/overview reads took 431/242/32 ms, with 1,359 ms total and no optional requests completed before the core overview returned.

A final web gesture correction e6a6af8ee6052a843e0ae98632c32da03c64267f enables one-finger pan in the immersive World map. Embedded maps retain scrolling gestures for their surrounding pages. All 195 web tests and the production build pass locally. Run https://github.com/eojgroup/claritas/actions/runs/43466542115 failed before its first step because GitHub reported failed account payments or a spending limit. The owner resolved Billing & plans and the failed jobs were retried. Attempt 2 succeeded through validation, builds, rollout and production runtime checks at 17:08 UTC.


The final live web assets are index-GEscDAwm.js and index-CL9q8Enk.css. Their SHA-256 hashes match the tested local production build. Public HTML returned HTTP 200 in 0.294 seconds. Final production checks measured feed/detail/overview reads at 257/203/25 ms and 1,142 ms total, with the overview finishing before any optional backlog request. The 24h/all view covered 12,417 developments, 125 countries, 155 precise pins, eight images and 12 complete buckets. The 7-day view covered 63,101 developments with 14 complete buckets. Timeline bucket totals matched their period summaries, and retained publisher preview bytes were available. Both the final GKE run and the Apple/TestFlight delivery are successful.
