# Claritas Apple Apps (SwiftUI)

Claritas is a map-led global intelligence workspace that brings attributed news
and social signals, weather, markets, transport, and satellite evidence into
one operating picture. The native apps provide the same Signal Desk and
evidence-first workflow on iPhone, iPad, and Apple Watch.

The iPhone and iPad signal map uses [Natural Earth country geometry](https://www.naturalearthdata.com/about/terms-of-use/)
(public domain), distributed through the `world-atlas` dataset, for its native
MapKit signal-concentration layer. Apple Maps remains the basemap and interaction
engine; the bundled geometry only supplies country boundaries.

Natural Earth rings at the ±180° meridian are split before MapKit consumes
them. After replacing or regenerating the resource, run
`node apps/mobile/ios/sanitize_world_countries.mjs` and then the project
validator; the validator rejects any remaining cross-world ring segment.

Project path: `apps/mobile/ios/Claritas/Claritas.xcodeproj`
Generator source: `apps/mobile/ios/generate_xcodeproj.rb`

The project contains one App Store product with two application targets and two
embedded WidgetKit extension targets:

- `Claritas`: universal iPhone/iPad app and Apple Watch companion authority.
- `Claritas Watch App`: embedded watchOS SwiftUI companion app.
- `Claritas Widgets`: iPhone/iPad overview and configurable signal widgets.
- `Claritas Watch Widgets`: watchOS complications and rectangular overview widgets.

## Quick Start

1. Open the project in Xcode: `File -> Open` and select `apps/mobile/ios/Claritas/Claritas.xcodeproj`.
2. Set your signing team:
   - Select the `Claritas` target -> Signing & Capabilities -> Team -> choose your team.
   - Select `Claritas Watch App` and choose the same team.
   - To change the bundle identifier, regenerate the project with
     `BUNDLE_ID=com.yourorg.claritas ruby generate_xcodeproj.rb`. The generator
     writes concrete identifiers for every target and derives the Watch app
     and extension identifiers from that value.
3. Configure the API base URL:
   - Edit `apps/mobile/ios/Claritas/Config.plist` -> `API_BASE_URL` to point to your backend (e.g. `https://your-host.com`).
   - Keep `apps/mobile/ios/ClaritasWatch/Config.plist` aligned for first launch. The iPhone app sends its active URL to the watch after pairing.
   - Register and allowlist the fixed native callback `claritas://auth/callback`.
     The app intentionally does not accept runtime callback overrides.
   - Or at runtime set `UserDefaults.standard.set("https://your-host.com", forKey: "API_BASE_URL")` in AppDelegate for advanced configs.
4. Run `Claritas` on a paired iPhone + Apple Watch simulator or devices and sign in on iPhone.
5. Run/install `Claritas Watch App`. Its companion flow preserves the interactive signal map, adds a read-only published briefing glance, and condenses urgent cross-domain event context into one Pulse page. It caches the last successful update and can hand an exact event to iPhone.
6. Run `Claritas` on an iPad simulator or device. The same universal app provides:
   - Persistent split-view navigation.
   - One event-centred Signal Desk with a prioritized event list, labelled evidence timeline, source links, and event-specific satellite observations.
   - Workspace destinations for the Signal Desk and Daily briefing; News, Social, Podcasts, Weather, Markets, and Transport remain source lenses rather than parallel event systems.
   - Admin, profile, and policies workspaces according to role.
   - Multi-window iPadOS support.
7. The iPhone app will load:
   - Four stable tabs: Overview, News, Investigate, and More.
   - A condensed map-first Dashboard for posture and country context, with the Signal Desk as the canonical investigation path.
   - News cards that open the linked canonical event when one exists; the event timeline links back to the original source URL.
   - News search queries the server across the selected country, category and Recent/Archive window, with loaded/total counts. Source and image filters refine the returned results.
   - Social, podcast, weather, market, transport, daily briefing, imagery catalogue, account/reference tools, and eligible admin controls under More.

## Widget configuration and data contract

- On iOS/iPadOS 17 or newer, add **Claritas scoped intelligence**, long-press it,
  and choose a country plus one of Overview, News, Markets, Weather, or
  Transport. **Claritas global overview** remains available on iOS/iPadOS 16
  and newer as a zero-configuration overview.
- On watchOS 10 or newer, edit the Claritas complication/widget to choose the
  same country and domain. Inline, circular, and rectangular accessory families
  use the same scope and freshness state.
- Widgets read a bounded presentation snapshot from the configured App Group;
  they never store an auth token or make an authenticated API request. Open the
  containing app after first install/sign-in so it can populate the snapshot.
- The snapshot refreshes after news, market, weather, and transport updates.
  News search, archive and category filters preserve the last unfiltered recent
  widget snapshot and its original freshness time.
  A visible stale state is shown after two hours instead of presenting old data
  as current.
- Widget taps use
  `claritas://widget?domain={overview|news|markets|weather|transport}&country={GLOBAL|ISO2}`
  so the app can restore the exact workspace and country scope.

## Unified Signal Desk contract

- World overview shares one bounded `/api/intelligence/overview` read between its event map, activity chart and investigation timeline. The 24-hour, three-day and seven-day controls combine with topic and country focus. Counts describe investigations by their latest recorded update; they are not totals of new incidents or articles. Capped samples display lower bounds and suppress momentum comparisons. Priority explanations remain available beside the timeline and in the measurement disclosure.
- iPad uses the retained preview already included in that response for its imagery card. If none exists, it inspects one event with suitable geography instead of probing eight events serially. Watch presents the same scoped pulse with two exact-event handoffs to iPhone; briefing, news and overview results appear independently while optional resources continue loading. Identical simultaneous Watch refreshes share the active refresh.
- The source lenses explain where a signal came from. The Signal Desk explains the event assembled from those sources.
- Selecting an event loads its grouped evidence, original news/official URLs, correlation labels, locations and available EO observations as one thread.
- Event observations retain their event-specific evidence status. Previously collected satellite and article images may also appear as labelled location context when the API establishes the rendered area or the same specific location. These cards retain original dates, attribution, licence, uncertainty notices and source-investigation links; they never count as evidence of the new event.
- Authenticated images share concurrent downloads and use a memory-only 16 MB cache for five minutes, recreated when the auth token changes. Display decoding runs off the main actor and downsamples to 1536 pixels. Event refreshes retain the loaded evidence while refreshing or displaying a recoverable refresh error.
- Model-written imagery text is displayed as interpretation, not as an observation or fact. Provider/prompt provenance and limitations remain part of the API model.
- The Imagery library is useful for provenance and asset review but is not a second Earth Observation investigation workflow.

## Watch Authentication

- Authentication remains on iPhone.
- The watch app is an embedded SwiftUI companion inside the `Claritas` universal app. The iOS app copies `Claritas Watch App.app` to `$(CONTENTS_FOLDER_PATH)/Watch`.
- The watch target keeps its child bundle identifier, `com.eojgroup.claritas.watchkitapp`, and declares `WKCompanionAppBundleIdentifier` for the iOS app bundle.
- The iPhone sends the API URL and active session through Apple WatchConnectivity.
- The watch stores the session token in its device-only Keychain and calls the same authenticated Claritas API.
- Signing out on iPhone clears the watch token on the next sync.
- Open the iPhone app once after installing the watch app, then tap `Connect` on watch if it does not sync automatically.
- Relaunching Watch restores the latest context received from iPhone, including
  offline session and scope updates. “Open on iPhone” reports acknowledgement or
  connection errors and carries a bounded article snapshot so an older selected
  story remains available even when it has left the phone's latest feed.

## Remote notifications and APNs

The iOS target now contains the Push Notifications capability, an `aps-environment` entitlement and native device registration. The backend APNs worker is separately feature-gated and credentialed.

1. Use a paid Apple Developer team and an explicitly registered App ID with Push Notifications enabled. Automatic signing must produce a provisioning profile containing the matching `aps-environment` entitlement.
2. The generator sets `APNS_ENVIRONMENT=development` for Debug and `production` for Release. `Claritas.entitlements` expands that build setting. Do not hard-code production into a Debug build or infer environment from the device token.
3. Keep the backend `APNS_BUNDLE_TOPIC` identical to the generated `BUNDLE_ID`. If `BUNDLE_ID` changes, update the backend topic and Apple App ID before registering devices.
4. Configure the server's `APNS_PRIVATE_KEY`, `APNS_KEY_ID` and `APNS_TEAM_ID`. Never embed the `.p8` key in the app or this repository.
5. Test on a physical device. After a signed-in paid-access user grants notification permission, iOS obtains the token and the app registers it through `POST /api/intelligence/devices` with the build environment and bundle topic. Profile → Event alerts can retry authorization/registration.
6. The app persists a random installation UUID and sends it with every registration, allowing token rotation to retire the previous token without accumulating active registrations. On logout it unregisters its saved device ID and falls back to account-wide revocation when needed; revocation remains available after paid access lapses. An active token cannot be reassigned to another account without explicit unregister.
7. Tapping a Claritas alert selects the payload's exact `event_id` in the Signal Desk and applies its optional country context.

Simulator UI tests can exercise permission and routing code, but they are not production APNs readiness evidence. Backend `configured_unverified` means only that the current key/topic is locally valid; `ready` requires an HTTP 200 for that credential fingerprint, while a newer provider failure reports `degraded`. Validate both a Debug/sandbox build and a signed Release/TestFlight production build when promoting delivery.

Backend `accepted` means APNs returned HTTP 200 for the provider request. It does not mean iOS displayed the alert or the user saw it. In-app acknowledgement is a separate state and should be the only user-confirmation signal.

## Source Of Truth

- Swift/resources under `apps/mobile/ios/Claritas/` and `apps/mobile/ios/ClaritasWatch/` are the source of truth.
- Push behaviour lives in `Claritas/Services/PushNotificationCoordinator.swift`, registration calls in `Claritas/Services/APIClient.swift`, and the environment entitlement in `Claritas/Claritas.entitlements`.
- `apps/mobile/ios/Claritas/Claritas.xcodeproj/project.pbxproj` is generated; avoid manual edits.
- If files are added/moved/renamed, regenerate the project rather than editing `.pbxproj` directly.

## Regenerate the Xcode Project

The Xcode project was generated with Ruby `xcodeproj`. Version values are read from `apps/mobile/ios/VERSION`, unless overridden by environment variables.

```bash
gem install xcodeproj --no-document
cd apps/mobile/ios
BUNDLE_ID=com.yourorg.claritas \
DEVELOPMENT_TEAM=YOURTEAMID \
IOS_DEPLOYMENT_TARGET=16.0 \
WATCHOS_DEPLOYMENT_TARGET=10.0 \
ruby generate_xcodeproj.rb
```

Then re-open the `.xcodeproj` in Xcode.

The generator always derives the watch app identifier as
`<BUNDLE_ID>.watchkitapp`. Do not set `WATCH_BUNDLE_ID` to a separate value:
Apple requires every embedded watch app identifier to be prefixed by its iOS
container app identifier.

Do not paste `$(CLARITAS_BUNDLE_IDENTIFIER)` into a target's Bundle Identifier
field in Signing & Capabilities. Xcode can leave the custom setting unresolved
during embedded-binary validation and sanitize it to a value such as
`--CLARITAS-BUNDLE-IDENTIFIER-.watchkitapp.widgets`. Change `BUNDLE_ID` through
the generator and keep the generated concrete target identifiers intact.

Validate the checked-in project, both WidgetKit extension plists, embedding
phases, automatic signing, and all parent-child bundle identifier relationships:

```bash
ruby validate_xcodeproj.rb
```

## Versioning

`apps/mobile/ios/VERSION` is the committed source of truth for Apple app versions:

```text
MARKETING_VERSION=1.0
BUILD_NUMBER=2
```

When the project is regenerated, the same `MARKETING_VERSION` and `BUILD_NUMBER` are applied to both native targets:

- `Claritas` universal iPhone/iPad app.
- `Claritas Watch App` embedded watchOS companion.

For CI builds that regenerate the project, `MARKETING_VERSION`, `BUILD_NUMBER`, or `GITHUB_RUN_NUMBER` can override the file values.

## Automated TestFlight delivery

Every main-branch Apple change first compiles the iPhone, iPad and Watch products. When signing is configured, the same workflow then archives the universal app, exports and uploads its IPA, waits for App Store Connect processing, and assigns the build to the explicitly configured `Claritas Test Group`. The workflow uses an exact group-name match and stops if that group is missing or ambiguous, so `Claritas Test Group External` cannot receive a build accidentally.

Configure these repository secrets once. Paste the App Store Connect `.p8` key as its complete PEM text, including its `BEGIN` and `END` lines. Base64 encode the binary distribution `.p12` without line wrapping:

- `APPLE_DISTRIBUTION_CERTIFICATE_P12`
- `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY_P8`

The App Store Connect key must be a team key with Admin access because CI uses the provisioning API as well as app and TestFlight build/group management. CI reuses or creates App Store profiles for all four bundle identifiers, installs them only on the ephemeral runner, and signs every Release target with the imported distribution identity; no persistent development certificate is required. Export the Apple Distribution certificate and its private key from Keychain Access as a password-protected `.p12`; the GitHub secret stores its base64 representation. The distribution certificate, registered App IDs, Push Notifications capability and both App Groups must belong to team `VTBJTFDTQY`. If credentials are absent, unsigned compile validation can still run, but the main-branch TestFlight job fails explicitly instead of reporting a deceptive release success. Archive and export logs are retained as workflow artifacts for 14 days.

## Keep Project In Sync

1. Make code/file changes under `apps/mobile/ios/Claritas/` or `apps/mobile/ios/ClaritasWatch/`.
2. Run `ruby apps/mobile/ios/generate_xcodeproj.rb` (or run from `apps/mobile/ios`).
3. Commit both source files and `apps/mobile/ios/Claritas/Claritas.xcodeproj/project.pbxproj`.
4. If a merge conflict happens in `project.pbxproj`, regenerate from `generate_xcodeproj.rb` and commit the regenerated file.
5. Open only `apps/mobile/ios/Claritas/Claritas.xcodeproj` (the legacy nested template project was removed).

## Notes

- ATS is currently permissive (NSAllowsArbitraryLoads=true) to simplify dev. For production, replace with explicit domain exceptions or HTTPS endpoints.
- Native authentication accepts only the allowlisted callback
  `claritas://auth/callback`; scheme-only callback trust and runtime callback
  overrides are intentionally unsupported.
- Country centroids support overview navigation only; they are not valid substitutes for event-specific EO coordinates.
- The native iPhone/iPad map uses Apple Maps with a Natural Earth country
  choropleth, a bounded set of priority labels, event/satellite markers,
  scoped transport markers, country profiles, native pan/zoom, and reset
  behavior aligned with web. Watch retains its intentionally compact glance map.
- The structure is modular (Models, Services, Views) to ease future extensions (auth, settings, notifications, charts).
