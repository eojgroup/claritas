# Claritas Apple Apps (SwiftUI)

Project path: `apps/mobile/ios/Claritas/Claritas.xcodeproj`
Generator source: `apps/mobile/ios/generate_xcodeproj.rb`

The project contains one App Store product with two Xcode targets:

- `Claritas`: universal iPhone/iPad app and Apple Watch companion authority.
- `Claritas Watch App`: embedded watchOS SwiftUI companion app.

## Quick Start

1. Open the project in Xcode: `File -> Open` and select `apps/mobile/ios/Claritas/Claritas.xcodeproj`.
2. Set your signing team:
   - Select the `Claritas` target -> Signing & Capabilities -> Team -> choose your team.
   - Select `Claritas Watch App` and choose the same team.
   - To change the bundle identifier, select the `Claritas` **project** (not an
     individual target), then set `CLARITAS_BUNDLE_IDENTIFIER` for both Debug
     and Release. This shared setting defaults to `com.eojgroup.claritas` and
     derives the child identifiers for the Watch app and extensions.
3. Configure the API base URL:
   - Edit `apps/mobile/ios/Claritas/Config.plist` -> `API_BASE_URL` to point to your backend (e.g. `https://your-host.com`).
   - Keep `apps/mobile/ios/ClaritasWatch/Config.plist` aligned for first launch. The iPhone app sends its active URL to the watch after pairing.
   - Ensure `AUTH_CALLBACK_URL` matches your registered iOS URL scheme (default: `claritas://auth/callback`).
   - Or at runtime set `UserDefaults.standard.set("https://your-host.com", forKey: "API_BASE_URL")` in AppDelegate for advanced configs.
4. Run `Claritas` on a paired iPhone + Apple Watch simulator or devices and sign in on iPhone.
5. Run/install `Claritas Watch App`. It loads the latest published briefing, news, markets, and weather, and caches the last successful update.
6. Run `Claritas` on an iPad simulator or device. The same universal app provides:
   - Persistent split-view navigation.
   - Daily briefing and cross-signal command center.
   - Full dashboard, news, weather, markets, admin, profile, and policies workspaces.
   - Multi-window iPadOS support.
7. The iPhone app will load:
   - Country news list (with thumbnail proxy).
   - Weather list (with filters + refresh).
   - Country profile panel reflecting your selection.
   - Admin panel (for users with `admin` role) with ingestion controls and user/role management.

## Watch Authentication

- Authentication remains on iPhone.
- The watch app is an embedded SwiftUI companion inside the `Claritas` universal app. The iOS app copies `Claritas Watch App.app` to `$(CONTENTS_FOLDER_PATH)/Watch`.
- The watch target keeps its child bundle identifier, `com.eojgroup.claritas.watchkitapp`, and declares `WKCompanionAppBundleIdentifier` for the iOS app bundle.
- The iPhone sends the API URL and active session through Apple WatchConnectivity.
- The watch stores the session token in its device-only Keychain and calls the same authenticated Claritas API.
- Signing out on iPhone clears the watch token on the next sync.
- Open the iPhone app once after installing the watch app, then tap `Connect` on watch if it does not sync automatically.

## Source Of Truth

- Swift/resources under `apps/mobile/ios/Claritas/` and `apps/mobile/ios/ClaritasWatch/` are the source of truth.
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

## Keep Project In Sync

1. Make code/file changes under `apps/mobile/ios/Claritas/` or `apps/mobile/ios/ClaritasWatch/`.
2. Run `ruby apps/mobile/ios/generate_xcodeproj.rb` (or run from `apps/mobile/ios`).
3. Commit both source files and `apps/mobile/ios/Claritas/Claritas.xcodeproj/project.pbxproj`.
4. If a merge conflict happens in `project.pbxproj`, regenerate from `generate_xcodeproj.rb` and commit the regenerated file.
5. Open only `apps/mobile/ios/Claritas/Claritas.xcodeproj` (the legacy nested template project was removed).

## Notes

- ATS is currently permissive (NSAllowsArbitraryLoads=true) to simplify dev. For production, replace with explicit domain exceptions or HTTPS endpoints.
- Backend auth redirect validation now supports non-HTTP callback schemes via `AUTH_ALLOWED_REDIRECT_SCHEMES` (default includes `claritas`).
- The map view is a placeholder; a future step can add country bubble overlays using MapKit annotations and an ISO2->centroid dataset.
- The structure is modular (Models, Services, Views) to ease future extensions (auth, settings, notifications, charts).
