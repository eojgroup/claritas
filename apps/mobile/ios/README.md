# Claritas Apple Apps (SwiftUI)

Project path: `apps/mobile/ios/Claritas/Claritas.xcodeproj`
Generator source: `apps/mobile/ios/generate_xcodeproj.rb`

The project contains the paired `Claritas` iPhone/iPad target and `Claritas Watch App` watchOS 10+ target.

## Quick Start

1. Open the project in Xcode: `File -> Open` and select `apps/mobile/ios/Claritas/Claritas.xcodeproj`.
2. Set your signing team:
   - Select the `Claritas` target -> Signing & Capabilities -> Team -> choose your team.
   - Select `Claritas Watch App` and choose the same team.
   - Optionally change the Bundle Identifier from the default `com.eojgroup.claritas`.
   - Keep the watch bundle identifier as a child identifier, such as `com.yourorg.claritas.watchkitapp`.
3. Configure the API base URL:
   - Edit `apps/mobile/ios/Claritas/Config.plist` -> `API_BASE_URL` to point to your backend (e.g. `https://your-host.com`).
   - Keep `apps/mobile/ios/ClaritasWatch/Config.plist` aligned for first launch. The iPhone app sends its active URL to the watch after pairing.
   - Ensure `AUTH_CALLBACK_URL` matches your registered iOS URL scheme (default: `claritas://auth/callback`).
   - Or at runtime set `UserDefaults.standard.set("https://your-host.com", forKey: "API_BASE_URL")` in AppDelegate for advanced configs.
4. Run `Claritas` on a paired iPhone + Apple Watch simulator or devices and sign in on iPhone.
5. Run/install `Claritas Watch App`. It loads the latest published briefing, news, markets, and weather, and caches the last successful update.
6. The iPhone app will load:
   - Country news list (with thumbnail proxy).
   - Weather list (with filters + refresh).
   - Country profile panel reflecting your selection.
   - Admin panel (for users with `admin` role) with ingestion controls and user/role management.

## Watch Authentication

- Authentication remains on iPhone.
- The iPhone sends the API URL and active session through Apple WatchConnectivity.
- The watch stores the session token in its device-only Keychain and calls the same authenticated Claritas API.
- Signing out on iPhone clears the watch token on the next sync.
- Open the iPhone app once after installing the watch app, then tap `Connect` on watch if it does not sync automatically.

## Source Of Truth

- Swift/resources under `apps/mobile/ios/Claritas/` and `apps/mobile/ios/ClaritasWatch/` are the source of truth.
- `apps/mobile/ios/Claritas/Claritas.xcodeproj/project.pbxproj` is generated; avoid manual edits.
- If files are added/moved/renamed, regenerate the project rather than editing `.pbxproj` directly.

## Regenerate the Xcode Project

The Xcode project was generated with Ruby `xcodeproj`. If you add/move files, you can regenerate it:

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
