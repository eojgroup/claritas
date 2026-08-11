import SwiftUI

@main
struct ClaritasApp: App {
    @UIApplicationDelegateAdaptor(PushNotificationDelegate.self) private var notificationDelegate
    @StateObject private var appModel = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appModel)
        }
    }
}
