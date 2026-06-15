import SwiftUI

@main
struct ClaritasPadApp: App {
    @StateObject private var appModel = AppModel()

    var body: some Scene {
        WindowGroup {
            PadRootView()
                .environmentObject(appModel)
        }
    }
}
