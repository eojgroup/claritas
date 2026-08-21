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

    enum NewsSortMode: String {
        case importance
        case newest
    }

    @Published var selectedCountry: String? = nil {
        didSet {
            guard normalizedCountry(selectedCountry) != normalizedCountry(oldValue) else { return }
            scheduleTransportRefresh()
        }
    }
    @Published var selectedSymbol: String? = nil
    @Published var selectedNewsItemID: Int? = nil
    @Published var selectedIntelligenceEventID: String? = nil
    @Published var dailyBriefing: DailySignalBriefing? = nil
    @Published var dailyBriefingSchedule: DailyBriefingSchedule? = nil
    @Published var news: [NewsItem] = []
    @Published var podcasts: [PodcastEpisode] = []
    @Published var countryStats: [CountryStat] = []
    @Published var weather: [CountryWeather] = []
    @Published var leadership: [CountryLeadership] = []
    @Published var marketQuotes: [MarketQuote] = []
    @Published var countryMarkets: [CountryMarketOverview] = []
    @Published var transportOverview: TransportOverview? = nil
    @Published private(set) var transportOverviewCountry: String? = nil
    @Published var isRefreshingNews: Bool = false
    @Published var isRefreshingPodcasts: Bool = false
    @Published var isRefreshingWeather: Bool = false
    @Published var isRefreshingMarketQuotes: Bool = false
    @Published var isRefreshingTransport: Bool = false
    @Published var newsLoadMode: NewsLoadMode = .recent
    @Published private(set) var newsScopeCountry: String? = nil
    @Published var selectedNewsCategory: String = NewsCategoryCatalog.allCode
    @Published private(set) var newsScopeCategory: String = NewsCategoryCatalog.allCode
    @Published private(set) var newsScopeSort: NewsSortMode = .importance
    @Published private(set) var newsCategoryFacets: [NewsCategoryFacet] = []
    @Published private(set) var newsPageTotal: Int? = nil
    @Published private(set) var newsUnassessedCount: Int? = nil
    @Published private(set) var newsMetadataIncluded: Bool = false
    @Published var newsLoadError: String? = nil
    @Published var podcastLoadError: String? = nil
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
    private let authPresenter = AuthSessionPresenter()
    private let watchSync = WatchSyncCoordinator.shared

    private let authTokenKey = "AUTH_TOKEN"
    private let pushInstallationIDKey = "APNS_INSTALLATION_ID"
    private let authCallbackScheme: String
    private let authCallbackURL: URL
    private let recentNewsLimit = 120
    private let archiveNewsPageSize = 100
    private let archiveNewsMaxPages = 4
    private var newsRequestID = UUID()
    private var transportRefreshTask: Task<Void, Never>?
    private var transportRequestID = UUID()

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
        self.api = APIClient()
        self.authToken = UserDefaults.standard.string(forKey: authTokenKey)
        self.authCallbackURL = callbackURL
        self.authCallbackScheme = callbackURL.scheme ?? "claritas"
        self.api.setAuthToken(authToken)
        self.watchSync.update(baseURL: api.baseURLDescription, authToken: authToken)
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
                    await configurePushNotifications()
                } else {
                    clearAppData()
                }
            }
        }
    }

    func logout() async {
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
        if let token {
            UserDefaults.standard.set(token, forKey: authTokenKey)
        } else {
            UserDefaults.standard.removeObject(forKey: authTokenKey)
        }
        watchSync.update(baseURL: api.baseURLDescription, authToken: token)
    }

    func loadInitial() async {
        guard hasPaidAccess else {
            clearAppData()
            return
        }

        let initialNewsCountry = normalizedCountry(selectedCountry)
        let initialNewsCategory = NewsCategoryCatalog.normalized(selectedNewsCategory)
        let initialNewsRequestID = UUID()
        newsRequestID = initialNewsRequestID

        async let statsResult: Result<[CountryStat], Error> = {
            do { return .success(try await api.fetchCountryStats(days: 30)) }
            catch { return .failure(error) }
        }()
        async let briefingResult: Result<DailySignalBriefing?, Error> = {
            do { return .success(try await api.fetchLatestDailyBriefing()) }
            catch { return .failure(error) }
        }()
        async let scheduleResult: Result<DailyBriefingSchedule, Error> = {
            do { return .success(try await api.fetchDailyBriefingSchedule()) }
            catch { return .failure(error) }
        }()
        async let weatherResult: Result<[CountryWeather], Error> = {
            do { return .success(try await api.fetchCountryWeather()) }
            catch { return .failure(error) }
        }()
        async let leadershipResult: Result<[CountryLeadership], Error> = {
            do { return .success(try await api.fetchCountryLeadership()) }
            catch { return .failure(error) }
        }()
        async let newsResult: Result<NewsPage, Error> = {
            do {
                return .success(try await fetchNewsBatch(
                    mode: .recent,
                    country: initialNewsCountry,
                    category: initialNewsCategory,
                    sort: .importance
                ))
            }
            catch { return .failure(error) }
        }()
        async let podcastResult: Result<[PodcastEpisode], Error> = {
            do { return .success(try await api.fetchPodcasts(limit: 40)) }
            catch { return .failure(error) }
        }()
        async let marketResult: Result<CountryMarketOverviewResponse, Error> = {
            do { return .success(try await api.fetchCountryMarkets()) }
            catch { return .failure(error) }
        }()
        async let marketQuoteResult: Result<[MarketQuote], Error> = {
            do { return .success(try await api.fetchMarketQuotes(refresh: false)) }
            catch { return .failure(error) }
        }()
        let (
            resolvedStats,
            resolvedBriefing,
            resolvedSchedule,
            resolvedWeather,
            resolvedLeadership,
            resolvedNews,
            resolvedPodcasts,
            resolvedMarket,
            resolvedMarketQuotes
        ) = await (
            statsResult,
            briefingResult,
            scheduleResult,
            weatherResult,
            leadershipResult,
            newsResult,
            podcastResult,
            marketResult,
            marketQuoteResult
        )

        var paymentRequiredDetected = false
        if case .failure(let error) = resolvedStats, isPaymentRequired(error) {
            paymentRequiredDetected = true
        }
        if case .failure(let error) = resolvedBriefing, isPaymentRequired(error) {
            paymentRequiredDetected = true
        }
        if case .failure(let error) = resolvedSchedule, isPaymentRequired(error) {
            paymentRequiredDetected = true
        }
        if case .failure(let error) = resolvedWeather, isPaymentRequired(error) {
            paymentRequiredDetected = true
        }
        if case .failure(let error) = resolvedLeadership, isPaymentRequired(error) {
            paymentRequiredDetected = true
        }
        if case .failure(let error) = resolvedNews, isPaymentRequired(error) {
            paymentRequiredDetected = true
        }
        if case .failure(let error) = resolvedPodcasts, isPaymentRequired(error) {
            paymentRequiredDetected = true
        }
        if case .failure(let error) = resolvedMarket, isPaymentRequired(error) {
            paymentRequiredDetected = true
        }
        if case .failure(let error) = resolvedMarketQuotes, isPaymentRequired(error) {
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
        if case .success(let briefing) = resolvedBriefing {
            dailyBriefing = briefing
        }
        if case .success(let schedule) = resolvedSchedule {
            dailyBriefingSchedule = schedule
            dailyBriefingScheduleError = nil
        }
        if case .success(let weatherRows) = resolvedWeather {
            weather = weatherRows
        }
        if case .success(let leadershipRows) = resolvedLeadership {
            leadership = leadershipRows
        }
        if case .success(let newsPage) = resolvedNews, newsRequestID == initialNewsRequestID {
            applyNewsPage(newsPage)
            newsLoadMode = .recent
            newsScopeCountry = initialNewsCountry
            newsScopeCategory = initialNewsCategory
            newsScopeSort = .importance
            newsLoadError = nil
        }
        if case .failure(let error) = resolvedNews, newsRequestID == initialNewsRequestID {
            newsLoadError = (error as? APIError)?.message ?? error.localizedDescription
        }
        if case .success(let podcastItems) = resolvedPodcasts {
            podcasts = podcastItems
            podcastLoadError = nil
        }
        if case .failure(let error) = resolvedPodcasts {
            podcastLoadError = (error as? APIError)?.message ?? error.localizedDescription
        }
        if case .success(let overview) = resolvedMarket {
            countryMarkets = overview.countries
        }
        if case .success(let quotes) = resolvedMarketQuotes {
            marketQuotes = quotes
        }
        await refreshTransport(forceRefresh: false)
        WidgetSnapshotStore.save(
            newsCount: news.count,
            countryMarkets: countryMarkets,
            weather: weather
        )
    }

    func clearAppData() {
        clearSelection()
        transportRefreshTask?.cancel()
        transportRefreshTask = nil
        transportRequestID = UUID()
        dailyBriefing = nil
        dailyBriefingSchedule = nil
        dailyBriefingScheduleError = nil
        dailyBriefingScheduleNotice = nil
        countryStats = []
        weather = []
        leadership = []
        news = []
        newsScopeCountry = nil
        selectedNewsCategory = NewsCategoryCatalog.allCode
        newsScopeCategory = NewsCategoryCatalog.allCode
        newsScopeSort = .importance
        newsCategoryFacets = []
        newsPageTotal = nil
        newsUnassessedCount = nil
        newsMetadataIncluded = false
        newsRequestID = UUID()
        isRefreshingNews = false
        podcasts = []
        marketQuotes = []
        countryMarkets = []
        transportOverview = nil
        transportOverviewCountry = nil
        newsLoadError = nil
        podcastLoadError = nil
        transportLoadError = nil
    }

    func clearSelection() {
        selectedCountry = nil
        selectedSymbol = nil
        selectedNewsItemID = nil
        selectedIntelligenceEventID = nil
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
    }

    func newsCategoryOptions(mode: NewsLoadMode, country: String?) -> [NewsCategoryOption] {
        guard newsMetadataIncluded,
              newsLoadMode == mode,
              newsScopeCountry == normalizedCountry(country) else {
            return NewsCategoryCatalog.options
        }
        return NewsCategoryCatalog.options(
            facets: newsCategoryFacets,
            allCount: newsScopeCategory == NewsCategoryCatalog.allCode ? newsPageTotal : nil,
            metadataIncluded: true
        )
    }

    func refreshNews(
        mode: NewsLoadMode = .recent,
        country: String? = nil,
        category: String? = nil,
        sort: NewsSortMode = .importance
    ) async {
        guard hasPaidAccess else {
            clearAppData()
            return
        }

        let requestedCountry = normalizedCountry(country)
        let requestedCategory = NewsCategoryCatalog.normalized(category ?? selectedNewsCategory)
        let requestID = UUID()
        newsRequestID = requestID
        isRefreshingNews = true
        newsLoadError = nil
        defer {
            if newsRequestID == requestID {
                isRefreshingNews = false
            }
        }

        do {
            let loadedPage = try await fetchNewsBatch(
                mode: mode,
                country: requestedCountry,
                category: requestedCategory,
                sort: sort
            )
            guard newsRequestID == requestID else { return }
            applyNewsPage(loadedPage)
            newsLoadMode = mode
            newsScopeCountry = requestedCountry
            newsScopeCategory = requestedCategory
            newsScopeSort = sort
        } catch {
            guard newsRequestID == requestID else { return }
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

        isRefreshingPodcasts = true
        podcastLoadError = nil
        defer { isRefreshingPodcasts = false }

        do {
            podcasts = try await api.fetchPodcasts(
                limit: 60,
                q: query,
                signalType: signalType
            )
        } catch {
            if isPaymentRequired(error) {
                clearAppData()
                await refreshAccess()
                return
            }
            podcastLoadError = (error as? APIError)?.message ?? error.localizedDescription
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
            async let overviewRequest = api.fetchCountryMarkets()
            async let quotesRequest = api.fetchMarketQuotes(refresh: false)
            let (overview, quotes) = try await (overviewRequest, quotesRequest)
            countryMarkets = overview.countries
            marketQuotes = quotes
        } catch {
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

        guard let country = transportFocusCountry else {
            transportOverview = nil
            transportOverviewCountry = nil
            transportLoadError = "Transport intelligence is waiting for a highlighted country."
            return
        }
        if transportOverviewCountry != country {
            // Never relabel a previous country's live positions as the newly
            // selected scope while the replacement request is in flight.
            transportOverview = nil
            transportOverviewCountry = nil
        }

        do {
            let overview = try await api.fetchTransportOverview(
                detail: "full",
                country: country,
                entityLimit: 320,
                refresh: forceRefresh
            )
            guard transportRequestID == requestID, transportFocusCountry == country else { return }
            transportOverview = overview
            transportOverviewCountry = country
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

    private func fetchNewsBatch(
        mode: NewsLoadMode,
        country: String?,
        category: String,
        sort: NewsSortMode
    ) async throws -> NewsPage {
        switch mode {
        case .recent:
            return try await api.fetchNews(
                limit: recentNewsLimit,
                offset: 0,
                q: nil,
                country: country,
                category: category,
                sort: sort.rawValue,
                archive: false,
                includeMetadata: true
            )
        case .archive:
            var combined: [NewsItem] = []
            var seenIds = Set<Int>()
            var offset = 0
            var metadataPage: NewsPage?

            for pageIndex in 0..<archiveNewsMaxPages {
                let batch = try await api.fetchNews(
                    limit: archiveNewsPageSize,
                    offset: offset,
                    q: nil,
                    country: country,
                    category: category,
                    sort: sort.rawValue,
                    archive: true,
                    includeMetadata: pageIndex == 0
                )
                if metadataPage == nil { metadataPage = batch }
                if batch.items.isEmpty { break }

                for item in batch.items where !seenIds.contains(item.id) {
                    seenIds.insert(item.id)
                    combined.append(item)
                }

                offset += batch.items.count
                if batch.items.count < archiveNewsPageSize { break }
            }

            let metadata = metadataPage ?? NewsPage(items: [])
            return NewsPage(
                items: combined,
                facets: metadata.facets,
                ranking: metadata.ranking,
                page: NewsPageMetadata(
                    limit: combined.count,
                    offset: 0,
                    total: metadata.page.total,
                    metadataIncluded: metadata.page.metadata_included
                )
            )
        }
    }

    private func applyNewsPage(_ loadedPage: NewsPage) {
        let includesMetadata = loadedPage.page.metadata_included
            ?? !loadedPage.facets.categories.isEmpty
        news = loadedPage.items
        newsCategoryFacets = includesMetadata ? loadedPage.facets.categories : []
        newsPageTotal = includesMetadata ? loadedPage.page.total : nil
        newsUnassessedCount = includesMetadata ? loadedPage.ranking.unassessed_count : nil
        newsMetadataIncluded = includesMetadata
    }
}
