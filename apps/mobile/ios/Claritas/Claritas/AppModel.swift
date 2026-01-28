import Foundation
import Combine
import AuthenticationServices
import UIKit

@MainActor
final class AppModel: ObservableObject {
    enum AuthStatus: String {
        case checking
        case authed
        case unauthed
    }

    @Published var selectedCountry: String? = nil
    @Published var news: [NewsItem] = []
    @Published var countryStats: [CountryStat] = []
    @Published var weather: [CountryWeather] = []
    @Published var isRefreshingWeather: Bool = false
    @Published var authStatus: AuthStatus = .checking
    @Published var authUser: AuthUser? = nil
    @Published var authProviders: [AuthProvider] = []
    @Published var authError: String? = nil

    let api: APIClient
    private var authToken: String? = nil
    private var authSession: ASWebAuthenticationSession?
    private let authPresenter = AuthSessionPresenter()

    private let authTokenKey = "AUTH_TOKEN"
    private let authCallbackScheme = "claritas"
    private let authCallbackURL = URL(string: "claritas://auth/callback")!

    init() {
        self.api = APIClient()
        self.authToken = UserDefaults.standard.string(forKey: authTokenKey)
        self.api.setAuthToken(authToken)
    }

    func bootstrap() async {
        await loadAuth()
        if authStatus == .authed {
            await loadInitial()
        }
    }

    func loadAuth() async {
        authStatus = .checking
        authError = nil
        do {
            async let me = api.fetchAuthMe()
            async let providers = api.fetchAuthProviders()
            let (user, providerList) = try await (me, providers)
            authUser = user
            authProviders = providerList
            authStatus = user == nil ? .unauthed : .authed
        } catch {
            authError = error.localizedDescription
            authStatus = .unauthed
            authProviders = []
        }
    }

    func startSignIn(provider: AuthProviderId) {
        guard let authURL = api.authStartURL(provider: provider, redirect: authCallbackURL) else {
            authError = "Unable to start sign-in."
            return
        }

        let session = ASWebAuthenticationSession(url: authURL, callbackURLScheme: authCallbackScheme) { [weak self] callbackURL, error in
            guard let self else { return }
            Task { @MainActor in
                if let callbackURL {
                    self.handleAuthCallback(callbackURL)
                } else if let error {
                    self.authError = error.localizedDescription
                }
            }
        }
        session.presentationContextProvider = authPresenter
        session.prefersEphemeralWebBrowserSession = false
        session.start()
        authSession = session
    }

    func handleAuthCallback(_ url: URL) {
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let items = comps?.queryItems ?? []
        if let error = items.first(where: { $0.name == "error" })?.value {
            authError = error
            authStatus = .unauthed
            return
        }
        guard let token = items.first(where: { $0.name == "token" })?.value, !token.isEmpty else {
            authError = "Missing session token."
            authStatus = .unauthed
            return
        }
        setAuthToken(token)
        Task {
            await loadAuth()
            if authStatus == .authed {
                await loadInitial()
            }
        }
    }

    func logout() async {
        do { try await api.logout() } catch { }
        setAuthToken(nil)
        authUser = nil
        authStatus = .unauthed
        clearAppData()
    }

    private func setAuthToken(_ token: String?) {
        authToken = token
        api.setAuthToken(token)
        if let token {
            UserDefaults.standard.set(token, forKey: authTokenKey)
        } else {
            UserDefaults.standard.removeObject(forKey: authTokenKey)
        }
    }

    func loadInitial() async {
        async let stats = api.fetchCountryStats(days: 30)
        async let weath = api.fetchCountryWeather()
        async let newsItems = api.fetchNews(limit: 20, offset: 0, q: nil, country: nil)
        do {
            let (s, w, n) = try await (stats, weath, newsItems)
            self.countryStats = s
            self.weather = w
            self.news = n
        } catch {
            // Basic fallback: clear on failure
            self.countryStats = []
            self.weather = []
            self.news = []
        }
    }

    func clearAppData() {
        countryStats = []
        weather = []
        news = []
    }

    func reloadNewsForSelectedCountry() async {
        do {
            news = try await api.fetchNews(limit: 20, offset: 0, q: nil, country: selectedCountry)
        } catch {
            news = []
        }
    }

    func refreshWeatherNow() async {
        guard !isRefreshingWeather else { return }
        isRefreshingWeather = true
        defer { isRefreshingWeather = false }
        do {
            _ = try await api.ingestWeatherNow(country: selectedCountry)
            weather = try await api.fetchCountryWeather()
        } catch {
            // ignore
        }
    }
}
