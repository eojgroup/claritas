import Foundation
import UIKit
import UserNotifications

extension Notification.Name {
    static let claritasPushTokenAvailable = Notification.Name("claritasPushTokenAvailable")
}

final class PushNotificationDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: "APNS_DEVICE_TOKEN")
        NotificationCenter.default.post(name: .claritasPushTokenAvailable, object: token)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .claritasPushTokenAvailable,
            object: nil,
            userInfo: ["error": error.localizedDescription]
        )
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let payload = response.notification.request.content.userInfo
        let eventID = payload["event_id"] as? String
        let country = payload["country_iso2"] as? String
        var context: [AnyHashable: Any] = [:]
        if let eventID { context["eventID"] = eventID }
        if let country { context["country"] = country }
        NotificationCenter.default.post(
            name: .claritasWatchOpenDestination,
            object: "intelligence",
            userInfo: context
        )
        completionHandler()
    }
}

@MainActor
enum PushNotificationCoordinator {
    static func requestAuthorizationAndRegister() async throws -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        let granted: Bool
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            granted = true
        case .notDetermined:
            granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
        case .denied:
            granted = false
        @unknown default:
            granted = false
        }
        if granted {
            UIApplication.shared.registerForRemoteNotifications()
        }
        return granted
    }
}
