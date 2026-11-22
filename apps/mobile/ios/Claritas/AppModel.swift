import Foundation
import Combine
import AuthenticationServices
import Security
import UIKit

private enum AppKeychain {
    private static let service = "com.eojgroup.claritas"
    private static let account = "auth-token"

    static var authToken: String? {
        get {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne
            ]
            var result: AnyObject?
            guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
                  let data = result as? Data else {
                return nil
            }
            return String(data: data, encoding: .utf8)
        }
        set {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account
            ]
            SecItemDelete(query as CFDictionary)
            guard let newValue, let data = newValue.data(using: .utf8) else { return }
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(item as CFDictionary, nil)
        }
    }
}

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

    enum NewsSortMode: String {
        case importance
        case newest
    }

    @Published var selectedCountry: String? = nil {
        didSet {
            guard normalizedCountry(selectedCountry) != normalizedCountry(oldValue) else { return }
            selectedNewsItemID = nil
            synchronizeWatchContext()
            updateWidgetSnapshot()
        }
    }
    @Published var selectedSymbol: String? = nil
    @Published var selectedNewsItemID: Int? = nil {
        didSet {
            if selectedNewsItem?.id != selectedNewsItemID {
                selectedNewsItem = nil
            }
        }
    }
    @Published private(set) var selectedNewsItem: NewsItem? = nil
    @Published var selectedIntelligenceEventID: String? = nil {
        didSet {
            if selectedIntelligenceEvent?.id != selectedIntelligenceEventID {
                selectedIntelligenceEvent = nil
            }
        }
    }
    @Published private(set) var selectedIntelligenceEvent: IntelligenceEvent?
    @Published private(set) var intelligenceOverview: IntelligenceOverview?
    @Published private(set) var intelligenceOverviewError: String?
    @Published private(set) var isRefreshingIntelligenceOverview = false
    @Published var overviewHours = 24 { didSet { if oldValue != overviewHours { overviewBucket = nil } } }
    @Published var overviewBucket: Int? = nil
    @Published var overviewTopic: String? = nil
    @Published var overviewPriority = "all"
    private var overviewRequestID = UUID()
    private var overviewLoadedScope: IntelligenceOverviewScope?
    private var overviewPendingScope: IntelligenceOverviewScope?
    private var overviewLoadedAt: Date?

    var overviewScope: IntelligenceOverviewScope {
        IntelligenceOverviewScope(hours: overviewHours, country: selectedCountry, topic: overviewTopic, priority: overviewPriority, bucket: overviewBucket)
    }

    @Published var dailyBriefing: DailySignalBriefing? = nil
    @Published private(set) var isRefreshingDailyBriefing = false
    @Published private(set) var dailyBriefingError: String? = nil
    @Published var dailyBriefingSchedule: DailyBriefingSchedule? = nil
    @Published var news: [NewsItem] = []
    /// A small importance-ranked feed for overview cards. It is intentionally
    /// separate from `news`, whose ordering belongs to the News workspace.
    @Published private(set) var rankedNews: [NewsItem] = []
    @Published var podcasts: [PodcastEpisode] = []
    @Published private(set) var socialSignals: [SocialSignal] = []
    @Published private(set) var socialCoverage: SocialCoverageResponse? = nil
    @Published var countryStats: [CountryStat] = []
    @Published private(set) var countryStatsLoadError: String?
    @Published private(set) var isRefreshingCountryStats = false
    private var countryStatsRequestID = UUID()
    @Published var weather: [CountryWeather] = []
    @Published var leadership: [CountryLeadership] = []
    @Published var marketQuotes: [MarketQuote] = []
    @Published var countryMarkets: [CountryMarketOverview] = []
    @Published private(set) var isLoadingMarketGlance = false
    private var marketGlanceLoadedAt: Date?
    @Published var transportOverview: TransportOverview? = nil
    @Published private(set) var signalTransportOverview: TransportOverview? = nil
    @Published private(set) var transportOverviewCountry: String? = nil
    @Published var isRefreshingNews: Bool = false
    @Published private(set) var isLoadingMoreNews = false
    @Published private(set) var newsHasMore = false
    @Published private(set) var newsLoadMoreError: String?
    @Published private(set) var isRefreshingRankedNews: Bool = false
    @Published var isRefreshingPodcasts: Bool = false
    @Published private(set) var isRefreshingSocial: Bool = false
    @Published var isRefreshingWeather: Bool = false
    @Published var isRefreshingMarketQuotes: Bool = false
    @Published var isRefreshingTransport: Bool = false
    @Published var newsLoadMode: NewsLoadMode = .recent
    @Published private(set) var newsScopeCountry: String? = nil
    @Published var selectedNewsCategory: String = NewsCategoryCatalog.allCode
    @Published private(set) var newsScopeCategory: String = NewsCategoryCatalog.allCode
    @Published private(set) var newsScopeSort: NewsSortMode = .newest
    @Published private(set) var newsScopeQuery: String = ""
    @Published private(set) var newsCategoryFacets: [NewsCategoryFacet] = []
    @Published private(set) var newsPageTotal: Int? = nil
    @Published private(set) var newsUnassessedCount: Int? = nil
    @Published private(set) var newsMetadataIncluded: Bool = false
    @Published private(set) var rankedNewsScopeCountry: String? = nil
    @Published private(set) var rankedNewsScopeCategory: String = NewsCategoryCatalog.allCode
    @Published private(set) var rankedNewsCategoryFacets: [NewsCategoryFacet] = []
    @Published private(set) var rankedNewsPageTotal: Int? = nil
    @Published private(set) var rankedNewsMetadataIncluded: Bool = false
    @Published var newsLoadError: String? = nil
    @Published private(set) var rankedNewsLoadError: String? = nil
    @Published var podcastLoadError: String? = nil
    @Published private(set) var socialLoadError: String? = nil
    @Published private(set) var socialCoverageLoadError: String? = nil
    @Published var transportLoadError: String? = nil
    @Published var authStatus: AuthStatus = .checking
    @Published var authUser: AuthUser? = nil
    @Published var authProviders: [AuthProvider] = []
    @Published var authError: String? = nil
    @Published var isRefreshingAccess: Bool = false
    @Published var isLoadingDailyBriefingSchedule: Bool = false
    @Published var isSavingDailyBriefingSchedule: Bool = false
    @Published var dailyBriefingScheduleError: String? = nil
    @Published var dailyBriefingScheduleNotice: String? = nil
    @Published var pushRegistrationError: String? = nil

    let api: APIClient
    private var authToken: String? = nil
    private var authSession: ASWebAuthenticationSession?
    private var authSessionAttemptID = UUID()
    private var authCodeVerifier: String?
    private var authHandoffRequestID = UUID()
    private let authPresenter = AuthSessionPresenter()
    private let watchSync = WatchSyncCoordinator.shared

    private static let legacyAuthTokenKey = "AUTH_TOKEN"
    private let pushInstallationIDKey = "APNS_INSTALLATION_ID"
    private let authCallbackScheme: String
    private let authCallbackURL: URL
    private let recentNewsLimit = 120
    private let archiveNewsPageSize = 100
    private var newsNextOffset = 0
    private var newsRequestID = UUID()
    private var rankedNewsRequestID = UUID()
    private var socialRequestID = UUID()
    private var socialScopeKey: String?
    private var transportRefreshTask: Task<Void, Never>?
    private var transportRequestID = UUID()
    private var dataGeneration = UUID()
    private var initialLoadID: UUID?
    private var briefingRequestID: UUID?
    private var widgetFreshness = WidgetSnapshotFreshness.empty
    private var widgetNews: [NewsItem] = []
    private var widgetNewsTotal: Int?
    private var widgetNewsCountry: String?

    var isAdmin: Bool {
        (authUser?.roles ?? []).contains { $0.lowercased() == "admin" }
    }

    var hasPaidAccess: Bool {
        authUser?.billing?.has_access ?? true
    }

    var billingState: BillingAccessState? {
        authUser?.billing
    }

    var transportFocusCountry: String? {
        normalizedCountry(selectedCountry) ?? CountryRelevanceResolver.ranked(
            countryStats: countryStats,
            podcasts: podcasts,
            weather: weather,
            countryMarkets: countryMarkets
        ).first?.country
    }

    init() {
        let callbackURL = Self.resolveAuthCallbackURL()
        let legacyAuthToken = UserDefaults.standard.string(forKey: Self.legacyAuthTokenKey)
        let storedAuthToken = AppKeychain.authToken ?? legacyAuthToken
        if AppKeychain.authToken == nil, let legacyAuthToken {
            AppKeychain.authToken = legacyAuthToken
        }
        // Bearer sessions belong in the Keychain. Remove the legacy preference
        // after this one-time migration even if secure storage is unavailable;
        // a fresh sign-in is safer than retaining a reusable token in defaults.
        UserDefaults.standard.removeObject(forKey: Self.legacyAuthTokenKey)
        self.api = APIClient()
        self.authToken = storedAuthToken
        self.authCallbackURL = callbackURL
        self.authCallbackScheme = callbackURL.scheme ?? "claritas"
        self.api.setAuthToken(authToken)
        self.watchSync.update(
            baseURL: api.baseURLDescription,
            authToken: authToken,
            selectedCountry: nil,
            newsCategory: selectedNewsCategory
        )
    }

    func bootstrap() async {
        await loadAuth()
        if authStatus == .authed {
            if hasPaidAccess {
                await loadInitial()
                await configurePushNotifications()
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
        guard AuthProviderAvailability.isEnabled(provider, in: authProviders) else {
            authError = "This identity provider is not currently available."
            return
        }
        authSessionAttemptID = UUID()
        let sessionAttemptID = authSessionAttemptID
        authHandoffRequestID = UUID()
        authSession?.cancel()
        authSession = nil
        authCodeVerifier = nil

        let codeVerifier = NativeAuthPKCE.makeVerifier()
        guard NativeAuthPKCE.isValidVerifier(codeVerifier) else {
            authError = "Unable to prepare secure sign-in."
            return
        }
        let codeChallenge = NativeAuthPKCE.challenge(for: codeVerifier)
        authCodeVerifier = codeVerifier

        let startPath = authProviders.first(where: { $0.id == provider })?.start_path
        guard let authURL = api.authStartURL(
            provider: provider,
            redirect: authCallbackURL,
            nativeCodeChallenge: codeChallenge,
            startPathOverride: startPath
        ) else {
            authCodeVerifier = nil
            authError = "Unable to start sign-in."
            return
        }

        let session = ASWebAuthenticationSession(url: authURL, callbackURLScheme: authCallbackScheme) { [weak self] callbackURL, error in
            guard let self else { return }
            Task { @MainActor in
                guard self.authSessionAttemptID == sessionAttemptID else { return }
                self.authSession = nil
                if let callbackURL {
                    self.handleAuthCallback(callbackURL)
                } else if let error {
                    self.authCodeVerifier = nil
                    self.authError = self.describeAuthSessionError(error)
                } else {
                    self.authCodeVerifier = nil
                    self.authError = "Sign-in did not complete."
                }
            }
        }
        session.presentationContextProvider = authPresenter
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        if !session.start() {
            authSessionAttemptID = UUID()
            authSession = nil
            authCodeVerifier = nil
            authError = "Unable to open secure sign-in."
        }
    }

    func handleAuthCallback(_ url: URL) {
        guard NativeAuthCallback.matchesExpectedEndpoint(url) else {
            authCodeVerifier = nil
            authHandoffRequestID = UUID()
            authError = "Invalid sign-in callback."
            if authUser == nil { authStatus = .unauthed }
            return
        }

        guard let payload = NativeAuthCallback.parse(url) else {
            authCodeVerifier = nil
            authHandoffRequestID = UUID()
            authError = "Missing or invalid one-time sign-in code."
            if authUser == nil { authStatus = .unauthed }
            return
        }

        if case .providerError(let message) = payload {
            authCodeVerifier = nil
            authHandoffRequestID = UUID()
            authError = message
            if authUser == nil { authStatus = .unauthed }
            return
        }

        guard case .handoffCode(let code) = payload,
              let codeVerifier = authCodeVerifier,
              NativeAuthPKCE.isValidVerifier(codeVerifier) else {
            authCodeVerifier = nil
            authHandoffRequestID = UUID()
            authError = "Secure sign-in session expired. Please try again."
            if authUser == nil { authStatus = .unauthed }
            return
        }

        authCodeVerifier = nil
        let requestID = UUID()
        authHandoffRequestID = requestID
        authStatus = .checking
        authError = nil
        Task {
            do {
                let handoff = try await api.exchangeAuthHandoffCode(code, codeVerifier: codeVerifier)
                guard authHandoffRequestID == requestID else { return }
                setAuthToken(handoff.token)

                await loadAuth()
                guard authHandoffRequestID == requestID else { return }
                if authStatus == .authed {
                    if hasPaidAccess {
                        await loadInitial()
                        await configurePushNotifications()
                    } else {
                        clearAppData()
                    }
                } else if authError == nil {
                    setAuthToken(nil)
                    authError = "The new sign-in session could not be verified."
                }
            } catch {
                guard authHandoffRequestID == requestID else { return }
                if authUser == nil {
                    setAuthToken(nil)
                    authStatus = .unauthed
                    clearAppData()
                }
                authError = describeAuthLoadError(error, context: "sign-in handoff")
            }
        }
    }

    func logout() async {
        authSessionAttemptID = UUID()
        authHandoffRequestID = UUID()
        authCodeVerifier = nil
        authSession?.cancel()
        authSession = nil
        var pushRevoked = false
        if let deviceID = UserDefaults.standard.string(forKey: "APNS_DEVICE_ID") {
            do {
                try await api.unregisterPushDevice(id: deviceID)
                pushRevoked = true
            } catch {
                do {
                    try await api.unregisterAllPushDevices()
                    pushRevoked = true
                } catch { }
            }
        } else {
            do {
                try await api.unregisterAllPushDevices()
                pushRevoked = true
            } catch { }
        }
        if pushRevoked {
            UserDefaults.standard.removeObject(forKey: "APNS_DEVICE_ID")
        }
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
        AppKeychain.authToken = token
        UserDefaults.standard.removeObject(forKey: Self.legacyAuthTokenKey)
        synchronizeWatchContext()
    }

    private func synchronizeWatchContext() {
        watchSync.update(
            baseURL: api.baseURLDescription,
            authToken: authToken,
            selectedCountry: normalizedCountry(selectedCountry),
            newsCategory: selectedNewsCategory
        )
    }

    func loadInitial() async {
        guard hasPaidAccess else {
            clearAppData()
            return
        }
        guard initialLoadID == nil else { return }
        let loadID = UUID()
        initialLoadID = loadID
        defer { if initialLoadID == loadID { initialLoadID = nil } }

        // Publish the shared map/list/chart snapshot before any optional lens.
        // Weather, markets, transport and source feeds load when opened.
        await refreshIntelligenceOverview(force: true)
        guard !Task.isCancelled, authStatus == .authed, hasPaidAccess else { return }
        await refreshDailyBriefing()
    }

    /// Refresh the saved publication without reloading the map or optional lenses.
    func refreshDailyBriefing() async {
        guard authStatus == .authed, hasPaidAccess, briefingRequestID == nil else { return }
        let requestID = UUID(), generation = dataGeneration
        briefingRequestID = requestID
        isRefreshingDailyBriefing = true
        dailyBriefingError = nil
        defer {
            if briefingRequestID == requestID {
                briefingRequestID = nil
                isRefreshingDailyBriefing = false
            }
        }
        let error = await loadInitialValue(generation: generation, fetch: {
            try await self.api.fetchLatestDailyBriefing()
        }, apply: {
            self.dailyBriefing = $0
            self.widgetFreshness.overview = Date()
        }, onError: { self.dailyBriefingError = $0.localizedDescription })
        if let error, isPaymentRequired(error) { await refreshAccess(); return }
        guard generation == dataGeneration else { return }
        updateWidgetSnapshot()
    }

    /// The World glance reads the saved country summary, never the quote universe.
    func loadMarketGlance() async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-qa-map-snapshot") { return }
        #endif
        guard authStatus == .authed, hasPaidAccess, !isLoadingMarketGlance else { return }
        let lastRead = marketGlanceLoadedAt ?? widgetFreshness.markets
        if !countryMarkets.isEmpty, let lastRead, Date().timeIntervalSince(lastRead) < 600 { return }
        let generation = dataGeneration
        isLoadingMarketGlance = true
        defer { isLoadingMarketGlance = false }
        _ = await loadInitialValue(generation: generation, fetch: {
            try await self.api.fetchCountryMarkets()
        }, apply: {
            self.countryMarkets = $0.countries
            self.marketGlanceLoadedAt = Date()
        })
    }

    /// Read existing optional data only when its workspace or layer is visible.
    func loadOptionalContext(_ context: String, force: Bool = false) async {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-qa-map-snapshot") { return }
        #endif
        guard authStatus == .authed, hasPaidAccess else { return }
        let generation = dataGeneration
        switch context {
        case "weather":
            guard !isRefreshingWeather, force || weather.isEmpty || widgetFreshness.weather.map({ Date().timeIntervalSince($0) >= 600 }) != false else { return }
            isRefreshingWeather = true
            defer { isRefreshingWeather = false }
            _ = await loadInitialValue(generation: generation, fetch: {
                try await self.api.fetchCountryWeather()
            }, apply: { self.weather = $0; self.widgetFreshness.weather = Date() })
        case "leadership":
            guard force || leadership.isEmpty else { return }
            _ = await loadInitialValue(generation: generation, fetch: {
                try await self.api.fetchCountryLeadership()
            }, apply: { self.leadership = $0 })
        case "markets":
            guard force || countryMarkets.isEmpty || widgetFreshness.markets.map({ Date().timeIntervalSince($0) >= 600 }) != false else { return }
            await refreshMarketQuotes(forceRefresh: false)
        case "news":
            guard countryStats.isEmpty else { return }
            await refreshCountryStats()
        case "transport":
            await refreshTransport(forceRefresh: false)
        case "podcasts":
            guard podcasts.isEmpty else { return }
            await refreshPodcasts()
        default: break
        }
        updateWidgetSnapshot()
    }

    #if DEBUG
    var mapReviewEvent: IntelligenceEventDetail?
    var mapReviewTransport: EventTransportDetail?
    var mapReviewScopedTransport: TransportOverview?
    var mapReviewMarket: CountryMarketDetail?
    /// Loaded only by the simulator capture entry point; never bundled data.
    func installMapReview(_ overview: IntelligenceOverview) {
        intelligenceOverview = overview
        overviewPriority = overview.filters.priority ?? "all"
        overviewHours = overview.window.hours
        overviewTopic = overview.filters.topic
        overviewBucket = overview.filters.bucket
    }
    #endif

    func refreshIntelligenceOverview(force: Bool = false) async {
        guard authStatus == .authed, hasPaidAccess else { return }
        let scope = overviewScope
        if overviewPendingScope == scope { return }
        if !force, intelligenceOverview?.hasUsableData == true, overviewLoadedScope == scope, let loadedAt = overviewLoadedAt,
           Date().timeIntervalSince(loadedAt) < 60 { return }
        let requestID = UUID()
        let generation = dataGeneration
        overviewRequestID = requestID
        overviewPendingScope = scope
        if overviewLoadedScope?.baseRequestKey != scope.baseRequestKey { intelligenceOverview = nil }
        isRefreshingIntelligenceOverview = true
        intelligenceOverviewError = nil
        defer {
            if overviewRequestID == requestID {
                overviewPendingScope = nil
                isRefreshingIntelligenceOverview = false
            }
        }
        do {
            let overview = try await api.fetchIntelligenceOverview(scope: scope)
            guard !Task.isCancelled, dataGeneration == generation, overviewRequestID == requestID,
                  overviewScope == scope else { return }
            guard overview.matches(scope: scope) else {
                intelligenceOverviewError = "The overview scope changed. Refresh to try again."
                return
            }
            intelligenceOverview = overview
            overviewLoadedScope = scope
            overviewLoadedAt = Date()
        } catch {
            guard !Task.isCancelled, dataGeneration == generation, overviewRequestID == requestID,
                  overviewScope == scope else { return }
            intelligenceOverviewError = error.localizedDescription
        }
    }

    private func loadInitialValue<Value>(
        generation: UUID,
        fetch: @MainActor () async throws -> Value,
        apply: @MainActor (Value) -> Void,
        onError: @MainActor (Error) -> Void = { _ in }
    ) async -> Error? {
        await ProgressiveResourceLoader.load(fetch: fetch, isCurrent: {
            self.dataGeneration == generation && self.authStatus == .authed && self.hasPaidAccess
        }, apply: apply, onError: { error in
            if self.isPaymentRequired(error) {
                self.clearAppData()
            } else {
                onError(error)
            }
        })
    }

    @discardableResult
    func refreshCountryStats() async -> Error? {
        guard hasPaidAccess, !isRefreshingCountryStats else { return nil }
        let requestID = UUID()
        countryStatsRequestID = requestID
        let generation = dataGeneration
        isRefreshingCountryStats = true
        defer {
            if countryStatsRequestID == requestID { isRefreshingCountryStats = false }
        }
        return await loadInitialValue(generation: generation, fetch: {
            try await self.api.fetchCountryStats(days: 30)
        }, apply: {
            self.countryStats = $0
            self.countryStatsLoadError = nil
        }, onError: {
            self.countryStatsLoadError = ($0 as? APIError)?.message ?? $0.localizedDescription
        })
    }

    func clearAppData() {
        dataGeneration = UUID()
        initialLoadID = nil
        clearSelection()
        transportRefreshTask?.cancel()
        transportRefreshTask = nil
        transportRequestID = UUID()
        intelligenceOverview = nil
        intelligenceOverviewError = nil
        overviewRequestID = UUID()
        overviewLoadedScope = nil
        overviewPendingScope = nil
        overviewLoadedAt = nil
        isRefreshingIntelligenceOverview = false
        overviewHours = 24
        overviewBucket = nil
        overviewTopic = nil
        overviewPriority = "all"
        dailyBriefing = nil
        briefingRequestID = nil
        isRefreshingDailyBriefing = false
        dailyBriefingError = nil
        dailyBriefingSchedule = nil
        dailyBriefingScheduleError = nil
        dailyBriefingScheduleNotice = nil
        countryStats = []
        countryStatsRequestID = UUID()
        countryStatsLoadError = nil
        isRefreshingCountryStats = false
        weather = []
        leadership = []
        news = []
        rankedNews = []
        newsScopeCountry = nil
        selectedNewsCategory = NewsCategoryCatalog.allCode
        newsScopeCategory = NewsCategoryCatalog.allCode
        newsScopeSort = .newest
        newsScopeQuery = ""
        widgetNews = []
        widgetNewsTotal = nil
        widgetNewsCountry = nil
        newsCategoryFacets = []
        newsPageTotal = nil
        newsUnassessedCount = nil
        newsMetadataIncluded = false
        rankedNewsScopeCountry = nil
        rankedNewsScopeCategory = NewsCategoryCatalog.allCode
        rankedNewsCategoryFacets = []
        rankedNewsPageTotal = nil
        rankedNewsMetadataIncluded = false
        newsRequestID = UUID()
        rankedNewsRequestID = UUID()
        socialRequestID = UUID()
        isRefreshingNews = false
        isLoadingMoreNews = false
        newsLoadMoreError = nil
        newsHasMore = false
        newsNextOffset = 0
        isRefreshingRankedNews = false
        isRefreshingPodcasts = false
        isRefreshingSocial = false
        isRefreshingWeather = false
        isRefreshingMarketQuotes = false
        isRefreshingTransport = false
        podcasts = []
        socialSignals = []
        socialCoverage = nil
        socialScopeKey = nil
        marketQuotes = []
        countryMarkets = []
        transportOverview = nil
        signalTransportOverview = nil
        transportOverviewCountry = nil
        newsLoadError = nil
        rankedNewsLoadError = nil
        podcastLoadError = nil
        socialLoadError = nil
        socialCoverageLoadError = nil
        transportLoadError = nil
        widgetFreshness = .empty
        WidgetSnapshotStore.clear()
        synchronizeWatchContext()
    }

    func clearSelection() {
        selectedCountry = nil
        selectedSymbol = nil
        selectedNewsItemID = nil
        selectedIntelligenceEventID = nil
    }

    func selectNewsItem(_ item: NewsItem?) {
        selectedNewsItem = item
        selectedNewsItemID = item?.id
    }

    func selectIntelligenceEvent(_ event: IntelligenceEvent) {
        selectedIntelligenceEventID = event.id
        selectedIntelligenceEvent = event
    }

    func configurePushNotifications() async {
        guard authStatus == .authed else {
            pushRegistrationError = "Sign in before enabling event alerts."
            return
        }
        guard hasPaidAccess else {
            pushRegistrationError = "Event alerts require an account with active access."
            return
        }
        do {
            let granted = try await PushNotificationCoordinator.requestAuthorizationAndRegister()
            guard granted else {
                pushRegistrationError = "Notifications are disabled in system settings. In-app alerts remain available."
                return
            }
            pushRegistrationError = nil
            if let token = UserDefaults.standard.string(forKey: "APNS_DEVICE_TOKEN") {
                await registerPushDevice(token: token)
            }
        } catch {
            pushRegistrationError = error.localizedDescription
        }
    }

    func registerPushDevice(token: String) async {
        guard authStatus == .authed else { return }
        #if DEBUG
        let environment = "development"
        #else
        let environment = "production"
        #endif
        do {
            let registration = try await api.registerPushDevice(
                token: token,
                environment: environment,
                bundleID: Bundle.main.bundleIdentifier ?? "com.eojgroup.claritas",
                installationID: pushInstallationID()
            )
            UserDefaults.standard.set(registration.id, forKey: "APNS_DEVICE_ID")
            pushRegistrationError = nil
        } catch {
            pushRegistrationError = error.localizedDescription
        }
    }

    private func pushInstallationID() -> String {
        if let stored = UserDefaults.standard.string(forKey: pushInstallationIDKey),
           UUID(uuidString: stored) != nil {
            return stored.lowercased()
        }
        let generated = UUID().uuidString.lowercased()
        UserDefaults.standard.set(generated, forKey: pushInstallationIDKey)
        return generated
    }

    func loadDailyBriefingSchedule() async {
        guard !isLoadingDailyBriefingSchedule else { return }
        isLoadingDailyBriefingSchedule = true
        dailyBriefingScheduleError = nil
        defer { isLoadingDailyBriefingSchedule = false }

        do {
            dailyBriefingSchedule = try await api.fetchDailyBriefingSchedule()
        } catch {
            if let apiError = error as? APIError, apiError.status == 401 {
                authUser = nil
                authStatus = .unauthed
                clearAppData()
                return
            }
            dailyBriefingScheduleError = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    func updateDailyBriefingSchedule(
        enabled: Bool,
        scheduledTime: String,
        timezone: String
    ) async {
        guard !isSavingDailyBriefingSchedule else { return }
        isSavingDailyBriefingSchedule = true
        dailyBriefingScheduleError = nil
        dailyBriefingScheduleNotice = nil
        defer { isSavingDailyBriefingSchedule = false }

        do {
            dailyBriefingSchedule = try await api.updateDailyBriefingSchedule(
                enabled: enabled,
                scheduledTime: scheduledTime,
                timezone: timezone
            )
            dailyBriefingScheduleNotice = "Daily briefing schedule saved."
        } catch {
            if let apiError = error as? APIError, apiError.status == 401 {
                authUser = nil
                authStatus = .unauthed
                clearAppData()
                return
            }
            dailyBriefingScheduleError = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    func setNewsCategory(_ category: String) {
        let normalized = NewsCategoryCatalog.normalized(category)
        guard normalized != selectedNewsCategory else { return }
        selectedNewsItemID = nil
        newsLoadError = nil
        selectedNewsCategory = normalized
        synchronizeWatchContext()
    }

    func newsCategoryOptions(mode: NewsLoadMode, country: String?, query: String = "") -> [NewsCategoryOption] {
        guard newsMetadataIncluded,
              newsLoadMode == mode,
              newsScopeQuery == query.trimmingCharacters(in: .whitespacesAndNewlines),
              newsScopeCountry == normalizedCountry(country) else {
            return NewsCategoryCatalog.options
        }
        return NewsCategoryCatalog.options(
            facets: newsCategoryFacets,
            allCount: newsScopeCategory == NewsCategoryCatalog.allCode ? newsPageTotal : nil,
            metadataIncluded: true
        )
    }

    func rankedNewsCategoryOptions(country: String?) -> [NewsCategoryOption] {
        guard rankedNewsMetadataIncluded,
              rankedNewsScopeCountry == normalizedCountry(country) else {
            return NewsCategoryCatalog.options
        }
        return NewsCategoryCatalog.options(
            facets: rankedNewsCategoryFacets,
            allCount: rankedNewsScopeCategory == NewsCategoryCatalog.allCode
                ? rankedNewsPageTotal
                : nil,
            metadataIncluded: true
        )
    }

    func refreshRankedNews(
        country: String? = nil,
        category: String? = nil
    ) async {
        guard hasPaidAccess else {
            clearAppData()
            return
        }

        let requestedCountry = normalizedCountry(country)
        let requestedCategory = NewsCategoryCatalog.normalized(category ?? selectedNewsCategory)
        let requestID = UUID()
        rankedNewsRequestID = requestID
        if rankedNewsScopeCountry != requestedCountry || rankedNewsScopeCategory != requestedCategory {
            rankedNews = []
            rankedNewsCategoryFacets = []
            rankedNewsPageTotal = nil
            rankedNewsMetadataIncluded = false
        }
        rankedNewsScopeCountry = requestedCountry
        rankedNewsScopeCategory = requestedCategory
        isRefreshingRankedNews = true
        rankedNewsLoadError = nil
        defer {
            if rankedNewsRequestID == requestID {
                isRefreshingRankedNews = false
            }
        }

        do {
            let loadedPage = try await api.fetchNews(
                limit: 3,
                offset: 0,
                q: nil,
                country: requestedCountry,
                category: requestedCategory,
                sort: NewsSortMode.newest.rawValue,
                archive: false,
                includeMetadata: true
            )
            guard rankedNewsRequestID == requestID else { return }
            rankedNews = Array(NewsChronology.sorted(loadedPage.items, order: .newestFirst).prefix(3))
            let includesMetadata = loadedPage.page.metadata_included
                ?? !loadedPage.facets.categories.isEmpty
            rankedNewsCategoryFacets = includesMetadata ? loadedPage.facets.categories : []
            rankedNewsPageTotal = includesMetadata ? loadedPage.page.total : nil
            rankedNewsMetadataIncluded = includesMetadata
            if let selectedID = selectedNewsItemID,
               let refreshedSelection = rankedNews.first(where: { $0.id == selectedID }) {
                selectedNewsItem = refreshedSelection
            }
        } catch {
            guard rankedNewsRequestID == requestID else { return }
            if isPaymentRequired(error) {
                clearAppData()
                await refreshAccess()
                return
            }
            rankedNewsLoadError = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    func refreshNews(
        mode: NewsLoadMode = .recent,
        country: String? = nil,
        category: String? = nil,
        sort: NewsSortMode = .newest,
        query: String = ""
    ) async {
        guard hasPaidAccess else {
            clearAppData()
            return
        }

        let requestedCountry = normalizedCountry(country)
        let requestedCategory = NewsCategoryCatalog.normalized(category ?? selectedNewsCategory)
        let requestID = UUID()
        newsRequestID = requestID
        isLoadingMoreNews = false
        newsLoadMoreError = nil
        isRefreshingNews = true
        newsLoadError = nil
        defer {
            if newsRequestID == requestID {
                isRefreshingNews = false
            }
        }

        do {
            let requestedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
            let loadedPage = try await fetchNewsBatch(
                mode: mode,
                country: requestedCountry,
                category: requestedCategory,
                sort: sort,
                query: requestedQuery
            )
            guard newsRequestID == requestID, !Task.isCancelled else { return }
            applyNewsPage(loadedPage, sort: sort)
            newsLoadMode = mode
            newsScopeCountry = requestedCountry
            newsScopeCategory = requestedCategory
            newsScopeSort = sort
            newsScopeQuery = requestedQuery
            captureWidgetNews(loadedPage, country: requestedCountry, category: requestedCategory, mode: mode, query: requestedQuery)
            updateWidgetSnapshot()
        } catch {
            guard newsRequestID == requestID, !Task.isCancelled else { return }
            if isPaymentRequired(error) {
                clearAppData()
                await refreshAccess()
                return
            }
            newsLoadError = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    func refreshPodcasts(query: String? = nil, signalType: String? = nil) async {
        guard !isRefreshingPodcasts else { return }
        guard hasPaidAccess else {
            clearAppData()
            return
        }

        let generation = dataGeneration
        isRefreshingPodcasts = true
        podcastLoadError = nil
        defer { isRefreshingPodcasts = false }

        do {
            let loadedPodcasts = try await api.fetchPodcasts(
                limit: 60,
                q: query,
                signalType: signalType
            )
            guard dataGeneration == generation else { return }
            podcasts = loadedPodcasts
        } catch {
            guard dataGeneration == generation else { return }
            if isPaymentRequired(error) {
                clearAppData()
                await refreshAccess()
                return
            }
            podcastLoadError = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    func refreshSocialSignals(
        platform: SocialPlatform? = nil,
        country: String? = nil,
        query: String? = nil
    ) async {
        guard hasPaidAccess else {
            clearAppData()
            return
        }

        let requestID = UUID()
        socialRequestID = requestID
        let scopeKey = [
            platform?.rawValue ?? "all",
            normalizedCountry(country) ?? "global",
            query?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        ].joined(separator: "|")
        if socialScopeKey != scopeKey {
            socialSignals = []
        }
        isRefreshingSocial = true
        socialLoadError = nil
        socialCoverageLoadError = nil
        defer {
            if socialRequestID == requestID {
                isRefreshingSocial = false
            }
        }

        async let signalsRequest: Result<[SocialSignal], Error> = {
            do {
                return .success(try await api.fetchSocialSignals(
                    limit: 80,
                    platform: platform,
                    country: country,
                    query: query
                ))
            } catch {
                return .failure(error)
            }
        }()
        async let coverageRequest: Result<SocialCoverageResponse, Error> = {
            do {
                return .success(try await api.fetchSocialCoverage(days: 7))
            } catch {
                return .failure(error)
            }
        }()

        let (signalsResult, coverageResult) = await (signalsRequest, coverageRequest)
        guard socialRequestID == requestID else { return }

        if case .failure(let error) = signalsResult, isPaymentRequired(error) {
            clearAppData()
            await refreshAccess()
            return
        }
        if case .failure(let error) = coverageResult, isPaymentRequired(error) {
            clearAppData()
            await refreshAccess()
            return
        }

        switch signalsResult {
        case .success(let signals):
            socialSignals = SocialSignal.newestFirst(signals)
            socialScopeKey = scopeKey
        case .failure(let error):
            socialLoadError = (error as? APIError)?.message ?? error.localizedDescription
        }
        if case .success(let coverage) = coverageResult {
            socialCoverage = coverage
        } else if case .failure(let error) = coverageResult {
            socialCoverageLoadError = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    func refreshWeatherNow() async {
        guard !isRefreshingWeather else { return }
        guard hasPaidAccess else {
            clearAppData()
            return
        }
        let generation = dataGeneration
        isRefreshingWeather = true
        defer { isRefreshingWeather = false }
        do {
            _ = try await api.ingestWeatherNow(country: selectedCountry)
            let loadedWeather = try await api.fetchCountryWeather()
            guard dataGeneration == generation else { return }
            weather = loadedWeather
            widgetFreshness.weather = Date()
            updateWidgetSnapshot()
        } catch {
            guard dataGeneration == generation else { return }
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
        let generation = dataGeneration
        isRefreshingMarketQuotes = true
        defer { isRefreshingMarketQuotes = false }
        do {
            async let overviewRequest = api.fetchCountryMarkets()
            async let quotesRequest = api.fetchMarketQuotes(refresh: false)
            let (overview, quotes) = try await (overviewRequest, quotesRequest)
            guard dataGeneration == generation else { return }
            countryMarkets = overview.countries
            marketQuotes = quotes
            widgetFreshness.markets = Date()
            updateWidgetSnapshot()
        } catch {
            guard dataGeneration == generation else { return }
            if isPaymentRequired(error) {
                clearAppData()
                await refreshAccess()
            }
            // keep current rows on transient failures
        }
    }

    func refreshTransport(forceRefresh: Bool = false) async {
        guard hasPaidAccess else {
            clearAppData()
            return
        }
        let requestID = UUID()
        transportRequestID = requestID
        isRefreshingTransport = true
        transportLoadError = nil
        defer {
            if transportRequestID == requestID {
                isRefreshingTransport = false
            }
        }

        let country = transportFocusCountry
        if transportOverviewCountry != country {
            // Never relabel a previous country's live positions as the newly
            // selected scope while the replacement request is in flight.
            transportOverview = nil
            transportOverviewCountry = nil
        }

        do {
            async let globalRequest = api.fetchTransportOverview(
                detail: "aggregate",
                refresh: forceRefresh
            )
            if let country {
                async let scopedRequest = api.fetchTransportOverview(
                    detail: "full",
                    country: country,
                    entityLimit: 320,
                    refresh: forceRefresh
                )
                let (global, scoped) = try await (globalRequest, scopedRequest)
                guard transportRequestID == requestID, transportFocusCountry == country else { return }
                signalTransportOverview = global
                transportOverview = scoped
                transportOverviewCountry = country
            } else {
                let global = try await globalRequest
                guard transportRequestID == requestID else { return }
                signalTransportOverview = global
                transportOverview = nil
                transportOverviewCountry = nil
            }
            widgetFreshness.transport = Date()
            updateWidgetSnapshot()
        } catch {
            if Task.isCancelled || transportRequestID != requestID { return }
            if isPaymentRequired(error) {
                clearAppData()
                await refreshAccess()
                return
            }
            transportLoadError = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    private func updateWidgetSnapshot() {
        WidgetSnapshotStore.save(
            news: widgetNews,
            newsTotal: widgetNewsTotal,
            newsScopeCountry: widgetNewsCountry,
            countryStats: countryStats,
            countryMarkets: countryMarkets,
            weather: weather,
            transport: signalTransportOverview,
            transportDetail: transportOverview,
            briefing: dailyBriefing,
            selectedCountry: selectedCountry,
            freshness: WidgetSnapshotFreshness(
                overview: widgetFreshness.overview,
                news: widgetFreshness.news,
                markets: widgetFreshness.markets,
                weather: widgetFreshness.weather,
                transport: widgetFreshness.transport
            )
        )
    }

    private func captureWidgetNews(
        _ page: NewsPage,
        country: String?,
        category: String,
        mode: NewsLoadMode,
        query: String
    ) {
        // Search, category and historical views must never become a widget's
        // current, all-category reporting totals or refresh its freshness date.
        guard mode == .recent, category == NewsCategoryCatalog.allCode, query.isEmpty else { return }
        widgetNews = page.items
        widgetNewsTotal = page.page.total
        widgetNewsCountry = country
        widgetFreshness.news = Date()
    }

    private func scheduleTransportRefresh() {
        guard authStatus == .authed, hasPaidAccess else { return }
        transportRefreshTask?.cancel()
        transportRefreshTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: 100_000_000)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            await self?.refreshTransport(forceRefresh: false)
        }
    }

    private func normalizedCountry(_ value: String?) -> String? {
        guard let country = value?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
              country.range(of: "^[A-Z]{2}$", options: .regularExpression) != nil else {
            return nil
        }
        return country
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
        // The API allowlist and callback parser intentionally share this one
        // native endpoint. Runtime overrides must not broaden callback trust.
        NativeAuthCallback.expectedURL
    }

    nonisolated private static func isoDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private func fetchNewsBatch(
        mode: NewsLoadMode,
        country: String?,
        category: String,
        sort: NewsSortMode,
        query: String = ""
    ) async throws -> NewsPage {
        try await api.fetchNews(
            limit: mode == .archive ? archiveNewsPageSize : recentNewsLimit,
            offset: 0,
            q: query.isEmpty ? nil : query,
            country: country,
            category: category,
            sort: sort.rawValue,
            archive: mode == .archive,
            includeMetadata: true
        )
    }

    func loadMoreNews() async {
        guard hasPaidAccess, newsHasMore, !isLoadingMoreNews, !isRefreshingNews else { return }
        let requestID = newsRequestID
        let generation = dataGeneration
        let offset = newsNextOffset
        let mode = newsLoadMode
        let sort = newsScopeSort
        let pageSize = mode == .archive ? archiveNewsPageSize : recentNewsLimit
        isLoadingMoreNews = true
        newsLoadMoreError = nil
        defer { if newsRequestID == requestID { isLoadingMoreNews = false } }
        do {
            let page = try await api.fetchNews(
                limit: pageSize,
                offset: offset,
                q: newsScopeQuery.isEmpty ? nil : newsScopeQuery,
                country: newsScopeCountry,
                category: newsScopeCategory,
                sort: sort.rawValue,
                archive: mode == .archive,
                includeMetadata: false
            )
            guard dataGeneration == generation, newsRequestID == requestID, !Task.isCancelled else { return }
            let existing = Set(news.map(\.id))
            let added = page.items.filter { !existing.contains($0.id) }
            news = sort == .importance ? news + added : NewsChronology.sorted(news + added, order: .newestFirst)
            newsNextOffset = offset + page.items.count
            newsHasMore = !page.items.isEmpty && (newsPageTotal.map { newsNextOffset < $0 } ?? (page.items.count == pageSize))
        } catch {
            guard dataGeneration == generation, newsRequestID == requestID, !Task.isCancelled else { return }
            if isPaymentRequired(error) {
                clearAppData()
                await refreshAccess()
                return
            }
            newsLoadMoreError = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    private func applyNewsPage(_ loadedPage: NewsPage, sort: NewsSortMode) {
        let includesMetadata = loadedPage.page.metadata_included
            ?? !loadedPage.facets.categories.isEmpty
        news = sort == .importance
            ? loadedPage.items
            : NewsChronology.sorted(loadedPage.items, order: .newestFirst)
        if let selectedID = selectedNewsItemID,
           let refreshedSelection = loadedPage.items.first(where: { $0.id == selectedID }) {
            selectedNewsItem = refreshedSelection
        }
        newsCategoryFacets = includesMetadata ? loadedPage.facets.categories : []
        newsPageTotal = includesMetadata ? loadedPage.page.total : nil
        newsNextOffset = (loadedPage.page.offset ?? 0) + loadedPage.items.count
        let pageSize = loadedPage.page.limit ?? recentNewsLimit
        newsHasMore = !loadedPage.items.isEmpty && (newsPageTotal.map { newsNextOffset < $0 } ?? (loadedPage.items.count == pageSize))
        newsUnassessedCount = includesMetadata ? loadedPage.ranking.unassessed_count : nil
        newsMetadataIncluded = includesMetadata
    }
}
