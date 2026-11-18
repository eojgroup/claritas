# Overview interactions and event visuals — 18 November 2026

## Previous release verified

PRs #65 and #66 merged as f501c12461f824524242fa8878d1c1e8a623eeb9 and 261b8d8bcc7a7312472620cbc41ae140a21e606a. GKE run 44071136889 succeeded after card selection was bounded before reading full event payloads. Production verified 11,776 developments, 116 countries, 51 precise map events, eight eligible image contexts and 12 complete activity buckets for 24h/all. The seven-day view covered 80,165 developments and 14 buckets. Core feed/detail/overview reads measured 277/371/22 ms. Retained publisher preview bytes were available.

Apple run 44066178448 succeeded, including shared model tests, iPhone/iPad and Watch builds, simulator captures, archive, signing and upload. Build 1000.0.76 became available to Claritas Test Group on 17 November at 11:11 UTC.

## New interactions

PR https://github.com/eojgroup/claritas/pull/67 adds saved-data interval selection across the map and development list while preserving complete chart totals. Topic controls are shared across all seven categories. Development rows keep photos, source context and compact transport/weather observations inline. Map explanations distinguish country update volume from event severity and include a clickable mapped story; native layer descriptions follow the active map mode.

The first native PR attempt could not acquire an ARM hosted runner and ran no build steps. Apple jobs now default to the standard macos-15-intel pool, configurable through APPLE_RUNNER, retaining Xcode 26.3 and all validation and distribution checks. Runner labels are documented at https://docs.github.com/en/actions/reference/runners/github-hosted-runners.

Local validation passed 463 API tests, 198 web tests, builds and project validation. Lint reports only the two existing warnings. PostGIS checks cover older developments outside the first card page, exclusive interval boundaries, country/map coordination and full chart totals. Browser reviews at 390×844, 1024×1366 and 1512×1000 used saved production data and retained image bytes. No horizontal overflow was found. Representative transport rows decreased from 199–211 px to 139 px; photos remained visible at 88×80 to 104×84 px. The temporary preview files and server were removed.

A production read on 18 November was fresh with no queued overview work and contained all seven categories, including 192 Markets & economy developments. The retained satellite preview used in the browser review returned 1,162,842 bytes. Its acquisition date remained visible separately from the development update date.

## Web delivery and production verification

PR #67 merged as `860134f1148c3f574357c48d7adfa4307c881410`. GKE run [44318770600](https://github.com/eojgroup/claritas/actions/runs/44318770600) succeeded. Its API, worker and web workloads used that source. Public JavaScript and CSS bytes matched the tested local build.

The release gate verified 12,400 developments, 122 countries, 123 precise map events, eight eligible image contexts and 12 complete activity buckets for 24h/all. The seven-day view covered 88,694 developments and 14 buckets. Feed/detail/overview reads measured 484/454/30 ms. The older-interval probe returned 744 updates with 40 selected cards and two precise map events in 2,527 ms. The full-period chart totals remained intact. Retained publisher image bytes were verified.

An independent production topic/interval probe at 14:20 UTC verified all seven categories, including 192 market developments. Market interval 0 returned 14 updates, 13 selected cards and no precise map positions; every returned event timestamp was inside the selected interval. Its snapshot was fresh with no pending events. A live Safari check loaded the released assets, but authenticated interaction verification could not finish after the computer-use host lost its window. This is not counted as a successful live-browser data check. Component reviews and authenticated production API probes supply the interaction/data coverage above.

## Web cache follow-up

The live browser initially reused the previous entry page until a reload. Public headers confirmed that HTML and assets had no explicit cache policy. PR [#68](https://github.com/eojgroup/claritas/pull/68) makes HTML revalidate and allows immutable, content-named Vite assets to be reused for a year. Missing assets return 404; HSTS remains present. The generated configuration passed `nginx -t` against the deployed runtime without replacing or reloading its live configuration.

PR #68 passed the full API/web/PostGIS/workflow validation suite and merged as `47f1ec6f59b30d29b6114e78c282cf0ec86b5c92`. GKE run [44326781746](https://github.com/eojgroup/claritas/actions/runs/44326781746) succeeded. API, worker and web deployments now use that revision. The Apple source remains `860134f`; this follow-up changes only the web Dockerfile.

Public HTTPS checks verified HTML `Cache-Control: no-cache`, hashed JavaScript `Cache-Control: public, max-age=31536000, immutable`, conditional HTML responses returning 304 with the revalidation policy, and missing assets returning 404. HSTS remained present on HTML and assets.

The final runtime gate verified 12,176 developments, 122 countries, 121 precise map events, eight eligible image contexts and 12 activity buckets for 24h/all. The seven-day view covered 88,382 developments and 14 buckets. Feed/detail/overview reads measured 384/470/31 ms; an older interval returned 817 updates and 40 selected cards in 776 ms while preserving full chart totals. Publisher preview bytes were available. Counts differ from the earlier rollout because the saved reporting window advances as ingestion continues.

## Apple delivery

Main run [44318770611](https://github.com/eojgroup/claritas/actions/runs/44318770611) passed all 63 shared model tests, universal iPhone/iPad compilation, both simulator captures and Watch compilation. The main-run captures were downloaded and visually reviewed on both devices. These captures use the saved review fixture without authentication; they do not independently verify authenticated image delivery.

The signed archive, export and App Store Connect upload succeeded. Build `1000.0.81` finished processing and became available to **Claritas Test Group** through automatic access at **14:39 UTC on 18 November**. The complete Apple workflow succeeded. This is a TestFlight delivery, not an App Store publication.
