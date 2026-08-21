import Foundation
import WatchConnectivity

extension Notification.Name {
    static let claritasWatchOpenDestination = Notification.Name("claritasWatchOpenDestination")
}

final class WatchSyncCoordinator: NSObject, WCSessionDelegate {
    static let shared = WatchSyncCoordinator()

    private let lock = NSLock()
    private var context: [String: Any] = [:]

    private override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func update(
        baseURL: String,
        authToken: String?,
        selectedCountry: String?,
        newsCategory: String
    ) {
        lock.lock()
        context = [
            "apiBaseURL": baseURL,
            "authToken": authToken ?? "",
            "selectedCountry": selectedCountry ?? "",
            "newsCategory": NewsCategoryCatalog.normalized(newsCategory),
            "updatedAt": ISO8601DateFormatter().string(from: Date())
        ]
        let nextContext = context
        lock.unlock()

        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        try? WCSession.default.updateApplicationContext(nextContext)
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        guard activationState == .activated else { return }
        lock.lock()
        let nextContext = context
        lock.unlock()
        guard !nextContext.isEmpty else { return }
        try? session.updateApplicationContext(nextContext)
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        if handleOpenDestination(message) {
            replyHandler(["status": "opened"])
            return
        }

        lock.lock()
        let nextContext = context
        lock.unlock()
        replyHandler(nextContext)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        _ = handleOpenDestination(message)
    }

    @discardableResult
    private func handleOpenDestination(_ message: [String: Any]) -> Bool {
        guard let destination = message["openOnPhone"] as? String else { return false }
        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: .claritasWatchOpenDestination,
                object: destination,
                userInfo: [
                    "country": message["country"] as? String ?? "",
                    "eventID": message["eventID"] as? String ?? "",
                    "newsID": message["newsID"] as? String ?? "",
                    "category": message["category"] as? String ?? ""
                ]
            )
        }
        return true
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}
