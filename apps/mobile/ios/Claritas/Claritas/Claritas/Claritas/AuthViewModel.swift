import AuthenticationServices
import SwiftUI
import UIKit

enum AuthProvider: String, CaseIterable, Identifiable {
    case google
    case microsoft
    case apple

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .google:
            return "Google"
        case .microsoft:
            return "Microsoft"
        case .apple:
            return "Apple"
        }
    }

    var helperText: String {
        switch self {
        case .google:
            return "Personal or Workspace accounts"
        case .microsoft:
            return "Azure AD or Microsoft 365"
        case .apple:
            return "Apple ID for iOS and macOS"
        }
    }
}

final class AuthViewModel: NSObject, ObservableObject {
    @AppStorage("isLoggedIn") var isLoggedIn: Bool = false
    @Published var errorMessage: String? = nil
    @Published var isAuthenticating: Bool = false
    @Published var providerStates: [AuthProvider: Bool] = [:]

    private var authSession: ASWebAuthenticationSession?
    private let callbackScheme = "claritas"

    override init() {
        super.init()
        providerStates = Dictionary(uniqueKeysWithValues: AuthProvider.allCases.map { ($0, true) })
        refreshProviders()
    }

    func refreshProviders() {
        guard let baseURL = authBaseURL() else { return }
        guard let url = URL(string: "\(baseURL.absoluteString)/api/auth/providers") else { return }

        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self, let data else { return }
            do {
                let response = try JSONDecoder().decode(ProviderResponse.self, from: data)
                var nextStates = self.providerStates
                for provider in response.providers {
                    if let id = AuthProvider(rawValue: provider.id) {
                        nextStates[id] = provider.enabled
                    }
                }
                DispatchQueue.main.async {
                    self.providerStates = nextStates
                }
            } catch {
                // Keep existing provider states if decoding fails.
            }
        }.resume()
    }

    func startProviderAuth(_ provider: AuthProvider) {
        errorMessage = nil
        guard providerStates[provider] ?? false else { return }
        guard let authURL = authStartURL(for: provider) else {
            errorMessage = "Missing API base URL."
            return
        }

        isAuthenticating = true
        let session = ASWebAuthenticationSession(url: authURL, callbackURLScheme: callbackScheme) { [weak self] callbackURL, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.isAuthenticating = false

                if let error = error as? ASWebAuthenticationSessionError,
                   error.code == .canceledLogin {
                    return
                }

                if callbackURL != nil {
                    self.isLoggedIn = true
                } else if error != nil {
                    self.errorMessage = "Unable to complete sign in."
                }
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session

        if !session.start() {
            isAuthenticating = false
            errorMessage = "Unable to start sign in."
        }
    }

    func signOut() {
        isLoggedIn = false
        errorMessage = nil
    }

    private func authStartURL(for provider: AuthProvider) -> URL? {
        guard let baseURL = authBaseURL() else { return nil }
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else { return nil }
        components.path = "/api/auth/\(provider.rawValue)/start"
        components.queryItems = [
            URLQueryItem(name: "redirect", value: "\(callbackScheme)://auth/callback")
        ]
        return components.url
    }

    private func authBaseURL() -> URL? {
        if let override = UserDefaults.standard.string(forKey: "API_BASE_URL"),
           let url = URL(string: override) {
            return normalizedURL(url)
        }

        guard let configURL = Bundle.main.url(forResource: "Config", withExtension: "plist"),
              let data = try? Data(contentsOf: configURL),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              let base = plist["API_BASE_URL"] as? String,
              let url = URL(string: base) else {
            return nil
        }

        return normalizedURL(url)
    }

    private func normalizedURL(_ url: URL) -> URL {
        var value = url.absoluteString
        while value.hasSuffix("/") {
            value.removeLast()
        }
        return URL(string: value) ?? url
    }
}

extension AuthViewModel: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap { $0.windows }.first { $0.isKeyWindow }
        return window ?? ASPresentationAnchor()
    }
}

private struct ProviderResponse: Decodable {
    let providers: [ProviderItem]
}

private struct ProviderItem: Decodable {
    let id: String
    let enabled: Bool
}
