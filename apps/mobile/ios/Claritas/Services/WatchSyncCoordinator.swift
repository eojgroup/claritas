import Foundation
import WatchConnectivity

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

    func update(baseURL: String, authToken: String?) {
        lock.lock()
        context = [
            "apiBaseURL": baseURL,
            "authToken": authToken ?? "",
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
        lock.lock()
        let nextContext = context
        lock.unlock()
        replyHandler(nextContext)
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}
