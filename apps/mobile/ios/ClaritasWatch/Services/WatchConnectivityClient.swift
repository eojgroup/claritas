import Foundation
import WatchConnectivity

final class WatchConnectivityClient: NSObject, WCSessionDelegate {
    var onContext: (([String: Any]) -> Void)?

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func requestContext() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        if !session.applicationContext.isEmpty {
            onContext?(session.applicationContext)
        }
        guard session.isReachable else { return }
        session.sendMessage(["request": "claritasContext"], replyHandler: { [weak self] context in
            self?.onContext?(context)
        })
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        guard activationState == .activated else { return }
        if !session.applicationContext.isEmpty {
            onContext?(session.applicationContext)
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        onContext?(applicationContext)
    }
}
