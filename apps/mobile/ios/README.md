# Claritas iOS App (SwiftUI)

Project path: `apps/mobile/ios/Claritas/Claritas.xcodeproj`

## Quick Start

1. Open the project in Xcode: `File -> Open` and select `apps/mobile/ios/Claritas/Claritas.xcodeproj`.
2. Set your signing team:
   - Select the `Claritas` target -> Signing & Capabilities -> Team -> choose your team.
   - Optionally change the Bundle Identifier from the default `com.eojc.claritas`.
3. Configure the API base URL:
   - Edit `apps/mobile/ios/Claritas/Claritas/Config.plist` -> `API_BASE_URL` to point to your backend (e.g. `https://your-host.com`).
   - Or at runtime set `UserDefaults.standard.set("https://your-host.com", forKey: "API_BASE_URL")` in AppDelegate for advanced configs.
4. Run on a simulator. The app will load:
   - Country news list (with thumbnail proxy).
   - Weather list (with filters + refresh).
   - Country profile panel reflecting your selection.

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

## Notes

- ATS is currently permissive (NSAllowsArbitraryLoads=true) to simplify dev. For production, replace with explicit domain exceptions or HTTPS endpoints.
- The map view is a placeholder; a future step can add country bubble overlays using MapKit annotations and an ISO2->centroid dataset.
- The structure is modular (Models, Services, Views) to ease future extensions (auth, settings, notifications, charts).

