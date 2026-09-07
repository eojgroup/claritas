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
        if !session.receivedApplicationContext.isEmpty {
            onContext?(session.receivedApplicationContext)
        }
        guard session.isReachable else { return }
        session.sendMessage(["request": "claritasContext"], replyHandler: { [weak self] context in
            self?.onContext?(context)
        })
    }

    func openOnPhone(
        _ destination: String,
        country: String? = nil,
        eventID: String? = nil,
        newsID: Int? = nil,
        category: String? = nil,
        newsSnapshot: Data? = nil,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard WCSession.isSupported(), WCSession.default.isReachable else {
            completion(.failure(HandoffError.phoneUnavailable))
            return
        }
        var message: [String: Any] = ["openOnPhone": destination]
        if let country, !country.isEmpty {
            message["country"] = country.uppercased()
        }
        if let eventID, !eventID.isEmpty {
            message["eventID"] = eventID
        }
        if let newsID {
            message["newsID"] = String(newsID)
        }
        if let category {
            message["category"] = NewsCategoryCatalog.normalized(category)
        }
        if let newsSnapshot, newsSnapshot.count <= NewsHandoffSnapshot.maximumBytes {
            message["newsSnapshot"] = newsSnapshot
        }
        WCSession.default.sendMessage(
            message,
            replyHandler: { reply in
                if reply["status"] as? String == "opened" {
                    completion(.success(()))
                } else {
                    completion(.failure(HandoffError.notAcknowledged))
                }
            },
            errorHandler: { error in completion(.failure(error)) }
        )
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        guard activationState == .activated else { return }
        if !session.receivedApplicationContext.isEmpty {
            onContext?(session.receivedApplicationContext)
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        onContext?(applicationContext)
    }

    private enum HandoffError: LocalizedError {
        case phoneUnavailable
        case notAcknowledged

        var errorDescription: String? {
            switch self {
            case .phoneUnavailable:
                return "iPhone is not reachable. Open Claritas on your paired iPhone, then try again."
            case .notAcknowledged:
                return "iPhone did not confirm this selection. Open Claritas on iPhone and try again."
            }
        }
    }
}
