# Claritas iOS App (SwiftUI)

Project path: `apps/mobile/ios/Claritas/Claritas.xcodeproj`
Generator source: `apps/mobile/ios/generate_xcodeproj.rb`

## Quick Start

1. Open the project in Xcode: `File -> Open` and select `apps/mobile/ios/Claritas/Claritas.xcodeproj`.
2. Set your signing team:
   - Select the `Claritas` target -> Signing & Capabilities -> Team -> choose your team.
   - Optionally change the Bundle Identifier from the default `com.eojgroup.claritas`.
3. Configure the API base URL:
   - Edit `apps/mobile/ios/Claritas/Claritas/Config.plist` -> `API_BASE_URL` to point to your backend (e.g. `https://your-host.com`).
   - Or at runtime set `UserDefaults.standard.set("https://your-host.com", forKey: "API_BASE_URL")` in AppDelegate for advanced configs.
4. Run on a simulator. The app will load:
   - Country news list (with thumbnail proxy).
   - Weather list (with filters + refresh).
   - Country profile panel reflecting your selection.
   - Admin panel (for users with `admin` role) with ingestion controls and user/role management.

## Source Of Truth

- Swift/resources under `apps/mobile/ios/Claritas/Claritas/` are the source of truth.
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
ruby generate_xcodeproj.rb
```

Then re-open the `.xcodeproj` in Xcode.

## Keep Project In Sync

1. Make your code/file changes under `apps/mobile/ios/Claritas/Claritas/`.
2. Run `ruby apps/mobile/ios/generate_xcodeproj.rb` (or run from `apps/mobile/ios`).
3. Commit both source files and `apps/mobile/ios/Claritas/Claritas.xcodeproj/project.pbxproj`.
4. If a merge conflict happens in `project.pbxproj`, regenerate from `generate_xcodeproj.rb` and commit the regenerated file.
5. Open only `apps/mobile/ios/Claritas/Claritas.xcodeproj` (the legacy nested template project was removed).
6. CI workflow `iOS Xcodeproj Sync` also validates this on pull requests and `main`.

## Notes

- ATS is currently permissive (NSAllowsArbitraryLoads=true) to simplify dev. For production, replace with explicit domain exceptions or HTTPS endpoints.
- The map view is a placeholder; a future step can add country bubble overlays using MapKit annotations and an ISO2->centroid dataset.
- The structure is modular (Models, Services, Views) to ease future extensions (auth, settings, notifications, charts).
