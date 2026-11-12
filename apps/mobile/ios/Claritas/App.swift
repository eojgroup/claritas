import SwiftUI

@main
struct ClaritasApp: App {
    @UIApplicationDelegateAdaptor(PushNotificationDelegate.self) private var notificationDelegate
    @StateObject private var appModel = AppModel()

    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-qa-map-snapshot") {
                SignalMapSnapshotReview()
            } else {
                RootView().environmentObject(appModel)
            }
            #else
            RootView()
                .environmentObject(appModel)
            #endif
        }
    }
}
