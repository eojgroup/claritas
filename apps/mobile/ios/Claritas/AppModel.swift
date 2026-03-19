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

    enum NewsLoadMode: String {
        case recent
        case archive
    }

    @Published var selectedCountry: String? = nil
    @Published var selectedSymbol: String? = nil
    @Published var news: [NewsItem] = []
    @Published var countryStats: [CountryStat] = []
    @Published var weather: [CountryWeather] = []
    @Published var marketQuotes: [MarketQuote] = []
    @Published var marketStatus: [MarketStatus] = []
    @Published var marketEarnings: [EarningsEvent] = []
    @Published var isRefreshingNews: Bool = false
    @Published var isRefreshingWeather: Bool = false
    @Published var isRefreshingMarketQuotes: Bool = false
    @Published var isRefreshingMarketStatus: Bool = false
    @Published var isRefreshingMarketEarnings: Bool = false
    @Published var newsLoadMode: NewsLoadMode = .recent
    @Published var newsLoadError: String? = nil
    @Published var authStatus: AuthStatus = .checking
    @Published var authUser: AuthUser? = nil
    @Published var authProviders: [AuthProvider] = []
    @Published var authError: String? = nil
    @Published var isRefreshingAccess: Bool = false

    let api: APIClient
    private var authToken: String? = nil
    private var authSession: ASWebAuthenticationSession?
    private let authPresenter = AuthSessionPresenter()

    private let authTokenKey = "AUTH_TOKEN"
    private let authCallbackScheme: String
    private let authCallbackURL: URL
    private let recentNewsLimit = 120
    private let archiveNewsPageSize = 100
    private let archiveNewsMaxPages = 4

    var isAdmin: Bool {
        (authUser?.roles ?? []).contains { $0.lowercased() == "admin" }
    }

    var hasPaidAccess: Bool {
        authUser?.billing?.has_access ?? true
    }

    var billingState: BillingAccessState? {
        authUser?.billing
    }

    init() {
        let callbackURL = Self.resolveAuthCallbackURL()
        self.api = APIClient()
        self.authToken = UserDefaults.standard.string(forKey: authTokenKey)
        self.authCallbackURL = callbackURL
        self.authCallbackScheme = callbackURL.scheme ?? "claritas"
        self.api.setAuthToken(authToken)
    }

    func bootstrap() async {
        await loadAuth()
        if authStatus == .authed {
            if hasPaidAccess {
                await loadInitial()
            } else {
                clearAppData()
            }
        }
    }

    func loadAuth() async {
        authStatus = .checking
        authError = nil

        async let userResult: Result<AuthUser?, Error> = {
            do { return .success(try await api.fetchAuthMe()) }
            catch { return .failure(error) }
        }()

        async let providerResult: Result<[AuthProvider], Error> = {
            do { return .success(try await api.fetchAuthProviders()) }
            catch { return .failure(error) }
        }()

        let (resolvedUser, resolvedProviders) = await (userResult, providerResult)

        var errors: [String] = []
        let user: AuthUser?
        switch resolvedUser {
        case .success(let value):
            user = value
        case .failure(let error):
            user = nil
            errors.append(describeAuthLoadError(error, context: "auth session"))
        }

        let providers: [AuthProvider]
        switch resolvedProviders {
        case .success(let value):
            providers = value
        case .failure(let error):
            providers = []
            errors.append(describeAuthLoadError(error, context: "auth providers"))
        }

        if user == nil, !providers.isEmpty, providers.allSatisfy({ !$0.enabled }) {
            errors.append("No identity providers are currently enabled at \(api.baseURLDescription).")
        }

        authUser = user
        authProviders = providers
        authStatus = user == nil ? .unauthed : .authed
        if authStatus != .authed || !hasPaidAccess {
            clearAppData()
        }
        authError = errors.isEmpty
            ? nil
            : errors
                .reduce(into: [String]()) { acc, item in
                    if !acc.contains(item) { acc.append(item) }
                }
                .joined(separator: " | ")
    }

    func startSignIn(provider: AuthProviderId) {
        authError = nil

        let startPath = authProviders.first(where: { $0.id == provider })?.start_path
        guard let authURL = api.authStartURL(provider: provider, redirect: authCallbackURL, startPathOverride: startPath) else {
            authError = "Unable to start sign-in."
            return
        }

        let session = ASWebAuthenticationSession(url: authURL, callbackURLScheme: authCallbackScheme) { [weak self] callbackURL, error in
            guard let self else { return }
            Task { @MainActor in
                self.authSession = nil
                if let callbackURL {
                    self.handleAuthCallback(callbackURL)
                } else if let error {
                    self.authError = self.describeAuthSessionError(error)
                } else {
                    self.authError = "Sign-in did not complete."
                }
            }
        }
        session.presentationContextProvider = authPresenter
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        if !session.start() {
            authSession = nil
            authError = "Unable to open secure sign-in."
        }
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
                if hasPaidAccess {
                    await loadInitial()
                } else {
                    clearAppData()
                }
            }
        }
    }

    func logout() async {
        do { try await api.logout() } catch { }
        setAuthToken(nil)
        authUser = nil
        authStatus = .unauthed
        isRefreshingAccess = false
        clearAppData()
    }

    func refreshAccess() async {
        guard !isRefreshingAccess else { return }
        isRefreshingAccess = true
        defer { isRefreshingAccess = false }

        do {
            let user = try await api.fetchAuthMe()
            authUser = user
            authStatus = user == nil ? .unauthed : .authed

            guard authStatus == .authed else {
                clearAppData()
                return
            }

            if hasPaidAccess {
                await loadInitial()
            } else {
                clearAppData()
            }
        } catch {
            if let apiError = error as? APIError, apiError.status == 401 {
                authUser = nil
                authStatus = .unauthed
                clearAppData()
                return
            }
            if isPaymentRequired(error) {
                await synchronizeBillingState()
                clearAppData()
                return
            }
            authError = describeAuthLoadError(error, context: "billing refresh")
        }
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
        guard hasPaidAccess else {
            clearAppData()
            return
        }

        async let statsResult: Result<[CountryStat], Error> = {
            do { return .success(try await api.fetchCountryStats(days: 30)) }
            catch { return .failure(error) }
        }()
        async let weatherResult: Result<[CountryWeather], Error> = {
            do { return .success(try await api.fetchCountryWeather()) }
            catch { return .failure(error) }
        }()
        async let newsResult: Result<[NewsItem], Error> = {
            do { return .success(try await fetchNewsBatch(mode: .recent, country: nil)) }
            catch { return .failure(error) }
        }()
        async let marketResult: Result<[MarketQuote], Error> = {
            do { return .success(try await api.fetchMarketQuotes(refresh: true)) }
            catch { return .failure(error) }
        }()
        async let marketStatusResult: Result<[MarketStatus], Error> = {
            do { return .success(try await api.fetchMarketStatus(refresh: true)) }
            catch { return .failure(error) }
        }()
        async let marketEarningsResult: Result<[EarningsEvent], Error> = {
            do {
                let from = Self.isoDate(Date())
                let to = Self.isoDate(Date().addingTimeInterval(14 * 24 * 60 * 60))
                return .success(try await api.fetchMarketEarnings(from: from, to: to, limit: 120))
            }
            catch { return .failure(error) }
        }()

        let (resolvedStats, resolvedWeather, resolvedNews, resolvedMarket, resolvedMarketStatus, resolvedMarketEarnings) =
            await (statsResult, weatherResult, newsResult, marketResult, marketStatusResult, marketEarningsResult)

        var paymentRequiredDetected = false
        if case .failure(let error) = resolvedStats, isPaymentRequired(error) {
            paymentRequiredDetected = true
        }
        if case .failure(let error) = resolvedWeather, isPaymentRequired(error) {
            paymentRequiredDetected = true
        }
        if case .failure(let error) = resolvedNews, isPaymentRequired(error) {
            paymentRequiredDetected = true
        }
        if case .failure(let error) = resolvedMarket, isPaymentRequired(error) {
            paymentRequiredDetected = true
        }
        if case .failure(let error) = resolvedMarketStatus, isPaymentRequired(error) {
            paymentRequiredDetected = true
        }
        if case .failure(let error) = resolvedMarketEarnings, isPaymentRequired(error) {
            paymentRequiredDetected = true
        }
        if paymentRequiredDetected {
            clearAppData()
            await refreshAccess()
            return
        }

        if case .success(let stats) = resolvedStats {
            countryStats = stats
        }
        if case .success(let weatherRows) = resolvedWeather {
            weather = weatherRows
        }
        if case .success(let newsItems) = resolvedNews {
            news = newsItems
            newsLoadMode = .recent
            newsLoadError = nil
        }
        if case .success(let quotes) = resolvedMarket {
            marketQuotes = quotes
        }
        if case .success(let statusRows) = resolvedMarketStatus {
            marketStatus = statusRows
        }
        if case .success(let earningRows) = resolvedMarketEarnings {
            marketEarnings = earningRows
        }
    }

    func clearAppData() {
        clearSelection()
        countryStats = []
        weather = []
        news = []
        marketQuotes = []
        marketStatus = []
        marketEarnings = []
        newsLoadError = nil
    }

    func clearSelection() {
        selectedCountry = nil
        selectedSymbol = nil
    }

    func refreshNews(mode: NewsLoadMode = .recent, country: String? = nil) async {
        guard !isRefreshingNews else { return }
        guard hasPaidAccess else {
            clearAppData()
            return
        }

        isRefreshingNews = true
        newsLoadError = nil
        defer { isRefreshingNews = false }

        do {
            news = try await fetchNewsBatch(mode: mode, country: country)
            newsLoadMode = mode
        } catch {
            if isPaymentRequired(error) {
                clearAppData()
                await refreshAccess()
                return
            }
            newsLoadError = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    func refreshWeatherNow() async {
        guard !isRefreshingWeather else { return }
        guard hasPaidAccess else {
            clearAppData()
            return
        }
        isRefreshingWeather = true
        defer { isRefreshingWeather = false }
        do {
            _ = try await api.ingestWeatherNow(country: selectedCountry)
            weather = try await api.fetchCountryWeather()
        } catch {
            if isPaymentRequired(error) {
                clearAppData()
                await refreshAccess()
            }
            // ignore
        }
    }

    func refreshMarketQuotes(forceRefresh: Bool = true) async {
        guard !isRefreshingMarketQuotes else { return }
        guard hasPaidAccess else {
            clearAppData()
            return
        }
        isRefreshingMarketQuotes = true
        defer { isRefreshingMarketQuotes = false }
        do {
            marketQuotes = try await api.fetchMarketQuotes(refresh: forceRefresh)
        } catch {
            if isPaymentRequired(error) {
                clearAppData()
                await refreshAccess()
            }
            // keep current rows on transient failures
        }
    }

    func refreshMarketStatus(forceRefresh: Bool = true) async {
        guard !isRefreshingMarketStatus else { return }
        guard hasPaidAccess else {
            clearAppData()
            return
        }
        isRefreshingMarketStatus = true
        defer { isRefreshingMarketStatus = false }
        do {
            marketStatus = try await api.fetchMarketStatus(refresh: forceRefresh)
        } catch {
            if isPaymentRequired(error) {
                clearAppData()
                await refreshAccess()
            }
            // keep current rows on transient failures
        }
    }

    func refreshMarketEarnings(windowDays: Int = 14, symbol: String? = nil) async {
        guard !isRefreshingMarketEarnings else { return }
        guard hasPaidAccess else {
            clearAppData()
            return
        }
        isRefreshingMarketEarnings = true
        defer { isRefreshingMarketEarnings = false }

        let safeWindow = max(1, min(windowDays, 60))
        let from = Self.isoDate(Date())
        let to = Self.isoDate(Date().addingTimeInterval(TimeInterval(safeWindow) * 24 * 60 * 60))

        do {
            marketEarnings = try await api.fetchMarketEarnings(
                from: from,
                to: to,
                symbol: symbol,
                limit: 160
            )
        } catch {
            if isPaymentRequired(error) {
                clearAppData()
                await refreshAccess()
            }
            // keep current rows on transient failures
        }
    }

    private func synchronizeBillingState() async {
        do {
            let billing = try await api.fetchBillingMe()
            if let user = authUser {
                authUser = withBilling(user, billing: billing)
            } else {
                let refreshedUser = try await api.fetchAuthMe()
                authUser = refreshedUser
                authStatus = refreshedUser == nil ? .unauthed : .authed
            }
        } catch {
            do {
                let refreshedUser = try await api.fetchAuthMe()
                authUser = refreshedUser
                authStatus = refreshedUser == nil ? .unauthed : .authed
            } catch {
                // Keep the current auth state when refresh attempts fail.
            }
        }
    }

    private func withBilling(_ user: AuthUser, billing: BillingAccessState?) -> AuthUser {
        AuthUser(
            id: user.id,
            email: user.email,
            display_name: user.display_name,
            avatar_url: user.avatar_url,
            roles: user.roles,
            billing: billing
        )
    }

    private func isPaymentRequired(_ error: Error) -> Bool {
        guard let apiError = error as? APIError else { return false }
        return apiError.status == 402
    }

    private func describeAuthLoadError(_ error: Error, context: String) -> String {
        if error is DecodingError {
            return "Could not parse \(context) response."
        }
        if let apiError = error as? APIError {
            return apiError.message
        }
        return error.localizedDescription
    }

    private func describeAuthSessionError(_ error: Error) -> String {
        if let sessionError = error as? ASWebAuthenticationSessionError {
            switch sessionError.code {
            case .canceledLogin:
                return "Sign-in was canceled."
            case .presentationContextInvalid, .presentationContextNotProvided:
                return "Unable to present secure sign-in. Please try again."
            @unknown default:
                return sessionError.localizedDescription
            }
        }
        return error.localizedDescription
    }

    private static func resolveAuthCallbackURL() -> URL {
        let defaultURL = URL(string: "claritas://auth/callback")!

        if let runtimeOverride = UserDefaults.standard.string(forKey: "AUTH_CALLBACK_URL"),
           let runtimeURL = URL(string: runtimeOverride),
           runtimeURL.scheme != nil {
            return runtimeURL
        }

        guard let configURL = Bundle.main.url(forResource: "Config", withExtension: "plist"),
              let data = try? Data(contentsOf: configURL),
              let dict = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any],
              let callbackValue = dict["AUTH_CALLBACK_URL"] as? String,
              let callbackURL = URL(string: callbackValue),
              callbackURL.scheme != nil else {
            return defaultURL
        }

        return callbackURL
    }

    nonisolated private static func isoDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private func fetchNewsBatch(mode: NewsLoadMode, country: String?) async throws -> [NewsItem] {
        switch mode {
        case .recent:
            return try await api.fetchNews(limit: recentNewsLimit, offset: 0, q: nil, country: country)
        case .archive:
            var combined: [NewsItem] = []
            var seenIds = Set<Int>()
            var offset = 0

            for _ in 0..<archiveNewsMaxPages {
                let batch = try await api.fetchNews(
                    limit: archiveNewsPageSize,
                    offset: offset,
                    q: nil,
                    country: country
                )
                if batch.isEmpty { break }

                for item in batch where !seenIds.contains(item.id) {
                    seenIds.insert(item.id)
                    combined.append(item)
                }

                offset += batch.count
                if batch.count < archiveNewsPageSize { break }
            }
            return combined
        }
    }
}
