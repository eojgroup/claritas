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

    func openOnPhone(_ destination: String, country: String? = nil, eventID: String? = nil) {
        guard WCSession.isSupported(), WCSession.default.isReachable else { return }
        var message = ["openOnPhone": destination]
        if let country, !country.isEmpty {
            message["country"] = country.uppercased()
        }
        if let eventID, !eventID.isEmpty {
            message["eventID"] = eventID
        }
        WCSession.default.sendMessage(
            message,
            replyHandler: nil,
            errorHandler: nil
        )
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
