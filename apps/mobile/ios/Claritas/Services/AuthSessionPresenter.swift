import AuthenticationServices
import UIKit

final class AuthSessionPresenter: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .sorted { lhs, rhs in
                lhs.activationState.sortPriority < rhs.activationState.sortPriority
            }

        for scene in scenes where scene.activationState != .unattached {
            if let keyWindow = scene.windows.first(where: \.isKeyWindow) {
                return keyWindow
            }
            if let visibleWindow = scene.windows.first(where: { !$0.isHidden && $0.alpha > 0 }) {
                return visibleWindow
            }
        }

        return ASPresentationAnchor()
    }
}

private extension UIScene.ActivationState {
    var sortPriority: Int {
        switch self {
        case .foregroundActive: return 0
        case .foregroundInactive: return 1
        case .background: return 2
        case .unattached: return 3
        @unknown default: return 4
        }
    }
}
