import Combine
import Foundation

@MainActor
final class WatchAppModel: ObservableObject {
    enum ConnectionState {
        case waitingForPhone
        case ready
        case refreshing
        case failed(String)
    }

    @Published private(set) var briefing: DailySignalBriefing?
    /// Category-unfiltered reporting within the phone's overarching country scope.
    @Published private(set) var news: [NewsItem] = []
    /// Reporting shown by the News tab for the user's selected category.
    @Published private(set) var selectedCategoryNews: [NewsItem] = []
    @Published private(set) var podcasts: [PodcastEpisode] = []
    @Published private(set) var social: [SocialSignal] = []
    @Published private(set) var weather: [CountryWeather] = []
    @Published private(set) var leadership: [CountryLeadership] = []
    @Published private(set) var markets: [MarketQuote] = []
    @Published private(set) var transport: TransportOverview?
    @Published private(set) var intelligenceEvents: [IntelligenceEvent] = []
    @Published private(set) var intelligenceOverview: IntelligenceOverview?
    @Published private(set) var overviewError: String?
    @Published private(set) var isRefreshingOverview = false
    @Published var overviewHours = 24
    @Published var overviewTopic: String? = nil
    @Published var overviewPriority = "high"
    private var overviewRequestID = UUID()
    private var overviewPendingScope: IntelligenceOverviewScope?

    var overviewScope: IntelligenceOverviewScope {
        IntelligenceOverviewScope(hours: overviewHours, country: selectedCountry, topic: overviewTopic, priority: overviewPriority)
    }
    @Published private(set) var briefingSchedule: DailyBriefingSchedule?
    @Published private(set) var isSavingBriefingSchedule: Bool = false
    @Published private(set) var briefingScheduleError: String?
    @Published private(set) var connectionState: ConnectionState = .waitingForPhone
    @Published private(set) var lastUpdated: Date?
    @Published private(set) var selectedCountry: String?
    @Published private(set) var selectedNewsCategory: String = NewsCategoryCatalog.allCode
    @Published private(set) var isRefreshingNews: Bool = false
    @Published private(set) var newsLoadError: String?
    @Published private(set) var socialLoadError: String?
    @Published private(set) var newsCategoryFacets: [NewsCategoryFacet] = []
    @Published private(set) var newsPageTotal: Int?
    @Published private(set) var newsUnassessedCount: Int?
    @Published private(set) var newsMetadataIncluded: Bool = false
    @Published var phoneHandoffMessage: String?

    private let connectivity = WatchConnectivityClient()
    private var api = APIClient()
    private let cacheKey = "CLARITAS_WATCH_SNAPSHOT"
    private var refreshRequestID = UUID()
    private var pendingRefreshKey: String?
    private var widgetFreshness = WatchWidgetFreshness.empty

    var hasSession: Bool {
        WatchKeychain.authToken != nil
    }

    var newsCategoryOptions: [NewsCategoryOption] {
        NewsCategoryCatalog.options(
            facets: newsCategoryFacets,
            allCount: newsPageTotal,
            metadataIncluded: newsMetadataIncluded
        )
    }

    var marketDirection: Double {
        let changes = markets.compactMap(\.percent_change)
        guard !changes.isEmpty else { return 0 }
        return changes.reduce(0, +) / Double(changes.count)
    }

    var weatherAlerts: [CountryWeather] {
        weather.filter {
            ($0.temp_c.map { $0 >= 35 || $0 <= 0 } ?? false) ||
            ($0.humidity.map { $0 >= 85 } ?? false) ||
            ($0.wind_speed.map { $0 >= 15 } ?? false)
        }
    }

    var marketBreaches: [MarketQuote] {
        markets.filter { abs($0.percent_change ?? 0) >= 2 }
    }

    var criticalSignalCount: Int {
        intelligenceEvents.filter {
            !$0.isArchived && ($0.severity == .critical || $0.severity == .high)
        }.count +
            weatherAlerts.count + marketBreaches.count + (transport?.summary.alerts ?? 0)
    }

    init() {
        loadCache()
        connectivity.onContext = { [weak self] context in
            Task { @MainActor in
                self?.apply(context: context)
            }
        }
        connectivity.activate()
    }

    func bootstrap() async {
        connectivity.requestContext()
        guard hasSession else {
            clearProtectedData()
            connectionState = .waitingForPhone
            return
        }
        await refresh()
    }

    func refresh() async {
        guard let token = WatchKeychain.authToken else {
            clearProtectedData()
            connectionState = .waitingForPhone
            connectivity.requestContext()
            return
        }

        let refreshKey = "\(token)|\(api.baseURLDescription)|\(selectedCountry ?? "global")|\(selectedNewsCategory)|\(overviewScope.requestKey)"
        guard pendingRefreshKey != refreshKey else { return }
        pendingRefreshKey = refreshKey
        let requestID = UUID()
        refreshRequestID = requestID
        let requestedCountry = selectedCountry
        let requestedNewsCategory = selectedNewsCategory
        let requestedOverviewScope = overviewScope
        isRefreshingNews = true
        newsLoadError = nil
        socialLoadError = nil
        defer {
            if refreshRequestID == requestID {
                isRefreshingNews = false
                pendingRefreshKey = nil
            }
        }
        connectionState = .refreshing
        let requestAPI = APIClient()
        requestAPI.setAuthToken(token)
        api = requestAPI

        async let briefingResult = progressiveResult(requestID: requestID, fetch: {
            try await requestAPI.fetchLatestDailyBriefing()
        }, apply: { self.briefing = $0; self.widgetFreshness.overview = Date() })
        async let newsResult: Result<NewsPage, Error> = progressiveResult(requestID: requestID, fetch: {
            try await requestAPI.fetchNews(
                limit: 12,
                country: requestedCountry,
                category: NewsCategoryCatalog.allCode,
                sort: "newest",
                archive: false,
                includeMetadata: true
            )
        }, apply: { page in
            self.news = Array(NewsChronology.sorted(page.items, order: .newestFirst).prefix(12))
            self.applyNewsMetadata(page)
            if requestedNewsCategory == NewsCategoryCatalog.allCode { self.selectedCategoryNews = self.news }
            self.isRefreshingNews = false
            self.widgetFreshness.news = Date()
        })
        async let intelligenceResult = progressiveResult(requestID: requestID, fetch: {
            try await requestAPI.fetchIntelligenceOverview(scope: requestedOverviewScope)
        }, apply: { overview in
            guard self.overviewScope == requestedOverviewScope, overview.matches(scope: requestedOverviewScope) else { return }
            self.intelligenceOverview = overview
            self.intelligenceEvents = Array(overview.timelineEvents.filter { !$0.isArchived }.prefix(8))
            self.overviewError = nil
        })

        // The overview is the shared event/chart read. Optional lenses load
        // when their page is selected, without a background reader-pool burst.
        let core = await (briefingResult, newsResult, intelligenceResult)
        guard refreshRequestID == requestID, !Task.isCancelled else { return }
        var errors: [Error] = []
        if case .failure(let error) = core.0 { errors.append(error) }
        if case .failure(let error) = core.1 {
            newsLoadError = error.localizedDescription
            errors.append(error)
        }
        if case .failure(let error) = core.2 {
            overviewError = error.localizedDescription
            errors.append(error)
        }
        if requestedNewsCategory != NewsCategoryCatalog.allCode {
            do {
                let page = try await requestAPI.fetchNews(limit: 12, country: requestedCountry,
                    category: requestedNewsCategory, sort: "newest", archive: false, includeMetadata: false)
                guard refreshRequestID == requestID else { return }
                selectedCategoryNews = Array(NewsChronology.sorted(page.items, order: .newestFirst).prefix(12))
            } catch { errors.append(error); newsLoadError = error.localizedDescription }
        }
        guard refreshRequestID == requestID else { return }

        if errors.contains(where: isUnauthorized) {
            WatchKeychain.authToken = nil
            clearProtectedData()
            connectionState = .waitingForPhone
        } else {
            lastUpdated = widgetFreshness.latest ?? lastUpdated
            saveCache()
            WatchWidgetSnapshotStore.save(
                news: news,
                markets: markets,
                weather: weather,
                transport: transport,
                intelligenceEvents: intelligenceEvents,
                selectedCountry: selectedCountry,
                freshness: widgetFreshness.withDerivedOverview
            )
            connectionState = errors.isEmpty ? .ready : .failed(errors[0].localizedDescription)
        }
    }

    func loadOptionalContext(_ context: String) async {
        guard let token = WatchKeychain.authToken else { return }
        api.setAuthToken(token)
        let country = selectedCountry
        do {
            switch context {
            case "weather":
                let rows = try await api.fetchCountryWeather()
                guard selectedCountry == country, WatchKeychain.authToken == token else { return }
                weather = Array((country.map { code in rows.filter { self.normalizedCountry($0.country) == code } } ?? rows).prefix(20))
                widgetFreshness.weather = Date()
            case "markets":
                let rows = try await api.fetchMarketQuotes(refresh: false)
                guard selectedCountry == country, WatchKeychain.authToken == token else { return }
                markets = Array((country.map { code in rows.filter { self.normalizedCountry($0.country) == code } } ?? rows).prefix(20))
                widgetFreshness.markets = Date()
            case "transport":
                let value = try await api.fetchTransportOverview(detail: "aggregate", country: country, refresh: false)
                guard selectedCountry == country, WatchKeychain.authToken == token else { return }
                transport = value
                widgetFreshness.transport = Date()
            case "social":
                let rows = try await api.fetchSocialSignals(limit: 8, country: country)
                guard selectedCountry == country, WatchKeychain.authToken == token else { return }
                social = Array(SocialSignal.newestFirst(rows).prefix(8))
                socialLoadError = nil
            case "schedule":
                let value = try await api.fetchDailyBriefingSchedule()
                guard WatchKeychain.authToken == token else { return }
                briefingSchedule = value
            default: return
            }
            saveCache()
        } catch {
            if context == "social" { socialLoadError = error.localizedDescription }
            if context == "schedule" { briefingScheduleError = error.localizedDescription }
        }
    }

    func requestPhoneSync() {
        connectivity.requestContext()
    }

    func readEvent(id: String) async throws -> IntelligenceEventDetail {
        api.setAuthToken(WatchKeychain.authToken)
        return try await api.fetchIntelligenceEvent(id: id)
    }
    func readEventTransport(id: String) async throws -> EventTransportDetail? {
        api.setAuthToken(WatchKeychain.authToken)
        return try await api.fetchEventTransport(id: id)
    }
    func readEventImage(path: String) async throws -> Data {
        api.setAuthToken(WatchKeychain.authToken)
        return try await api.fetchStoredImage(path: path)
    }
    func readCountryWeather(country: String) async throws -> CountryWeather? {
        api.setAuthToken(WatchKeychain.authToken)
        return try await api.fetchCountryWeather().first { $0.country.uppercased() == country.uppercased() }
    }
    func readCountryMarket(country: String) async throws -> CountryMarketOverview? {
        api.setAuthToken(WatchKeychain.authToken)
        return try await api.fetchCountryMarkets().countries.first { $0.country.uppercased() == country.uppercased() }
    }

    func openOnPhone(
        _ destination: String,
        country: String? = nil,
        eventID: String? = nil,
        newsID: Int? = nil,
        category: String? = nil
    ) {
        let selectedReport = newsID.flatMap { id in
            (selectedCategoryNews + news).first { $0.id == id }
        }
        connectivity.openOnPhone(
            destination,
            country: country,
            eventID: eventID,
            newsID: newsID,
            category: category,
            newsSnapshot: selectedReport.flatMap(NewsHandoffSnapshot.encode)
        ) { [weak self] result in
            Task { @MainActor in
                switch result {
                case .success:
                    self?.phoneHandoffMessage = "Your selection is ready in Claritas on iPhone."
                case .failure(let error):
                    self?.phoneHandoffMessage = error.localizedDescription
                }
            }
        }
    }

    func selectNewsCategory(_ category: String) async {
        let normalized = NewsCategoryCatalog.normalized(category)
        guard normalized != selectedNewsCategory else { return }
        selectedNewsCategory = normalized
        newsLoadError = nil
        selectedCategoryNews = normalized == NewsCategoryCatalog.allCode ? news : []
        await refresh()
    }

    /// Applies a complication's country scope without relying on the paired
    /// iPhone to resend its application context first. `GLOBAL` is the
    /// explicit deep-link representation of an unscoped view.
    func selectCountry(_ country: String?) async {
        let normalized = country?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let nextCountry: String?
        if normalized == "GLOBAL" {
            nextCountry = nil
        } else {
            nextCountry = normalizedCountry(normalized)
        }
        guard normalized == "GLOBAL" || nextCountry != nil else { return }
        guard nextCountry != selectedCountry else { return }

        selectedCountry = nextCountry
        refreshRequestID = UUID()
        isRefreshingNews = false
        news = []
        selectedCategoryNews = []
        newsCategoryFacets = []
        newsPageTotal = nil
        newsUnassessedCount = nil
        newsMetadataIncluded = false
        social = []
        socialLoadError = nil
        weather = []
        leadership = []
        markets = []
        transport = nil
        intelligenceEvents = []
        intelligenceOverview = nil
        overviewError = nil
        overviewRequestID = UUID()
        overviewPendingScope = nil
        isRefreshingOverview = false
        widgetFreshness = .empty
        await refresh()
    }

    func updateDailyBriefingSchedule(enabled: Bool, scheduledTime: String, timezone: String) async {
        guard !isSavingBriefingSchedule else { return }
        guard let token = WatchKeychain.authToken else {
            connectionState = .waitingForPhone
            connectivity.requestContext()
            return
        }

        isSavingBriefingSchedule = true
        briefingScheduleError = nil
        api = APIClient()
        api.setAuthToken(token)
        defer { isSavingBriefingSchedule = false }

        do {
            let updatedSchedule = try await api.updateDailyBriefingSchedule(
                enabled: enabled,
                scheduledTime: scheduledTime,
                timezone: timezone
            )
            guard WatchKeychain.authToken == token else { return }
            briefingSchedule = updatedSchedule
            lastUpdated = Date()
            connectionState = .ready
            saveCache()
        } catch {
            guard WatchKeychain.authToken == token else { return }
            if isUnauthorized(error) {
                WatchKeychain.authToken = nil
                clearProtectedData()
                connectionState = .waitingForPhone
                return
            }
            briefingScheduleError = error.localizedDescription
        }
    }

    private func apply(context: [String: Any]) {
        let previousCountry = selectedCountry
        let previousCategory = selectedNewsCategory
        let previousToken = WatchKeychain.authToken
        var removedSession = false
        if let baseURL = context["apiBaseURL"] as? String, !baseURL.isEmpty {
            UserDefaults.standard.set(baseURL, forKey: "API_BASE_URL")
        }
        if let token = context["authToken"] as? String {
            let nextToken = token.isEmpty ? nil : token
            WatchKeychain.authToken = nextToken
            if token.isEmpty {
                removedSession = true
            } else if previousToken != nextToken {
                clearProtectedData()
            }
        }
        if let rawCountry = context["selectedCountry"] as? String {
            selectedCountry = normalizedCountry(rawCountry)
        }
        if let rawCategory = context["newsCategory"] as? String {
            selectedNewsCategory = NewsCategoryCatalog.normalized(rawCategory)
        }
        if previousCountry != selectedCountry || previousCategory != selectedNewsCategory {
            refreshRequestID = UUID()
            isRefreshingNews = false
            news = []
            selectedCategoryNews = []
            newsCategoryFacets = []
            newsPageTotal = nil
            newsUnassessedCount = nil
            newsMetadataIncluded = false
        }
        if previousCountry != selectedCountry {
            social = []
            socialLoadError = nil
            weather = []
            leadership = []
            markets = []
            transport = nil
            intelligenceEvents = []
            intelligenceOverview = nil
            overviewError = nil
            overviewRequestID = UUID()
            overviewPendingScope = nil
            isRefreshingOverview = false
            widgetFreshness = .empty
        }
        api = APIClient()
        if removedSession {
            clearProtectedData()
            connectionState = .waitingForPhone
            return
        }
        Task { await refresh() }
    }

    private func normalizedCountry(_ value: String?) -> String? {
        let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard let normalized, normalized.range(of: "^[A-Z]{2}$", options: .regularExpression) != nil else {
            return nil
        }
        return normalized == "UK" ? "GB" : normalized
    }

    /// Publish each useful glance as it arrives instead of waiting for the
    /// slowest optional resource in the ten-request refresh batch.
    private func progressiveResult<Value>(
        requestID: UUID,
        fetch: @MainActor () async throws -> Value,
        apply: @MainActor (Value) -> Void
    ) async -> Result<Value, Error> {
        let response = await result(fetch)
        if refreshRequestID == requestID, !Task.isCancelled, case .success(let value) = response { apply(value) }
        return response
    }

    func refreshOverview() async {
        guard let token = WatchKeychain.authToken else { return }
        let scope = overviewScope
        guard overviewPendingScope != scope else { return }
        let requestID = UUID()
        overviewRequestID = requestID
        overviewPendingScope = scope
        isRefreshingOverview = true
        overviewError = nil
        if intelligenceOverview?.filters.country != scope.country || intelligenceOverview?.filters.topic != scope.topic
            || intelligenceOverview?.window.hours != scope.hours
            || (intelligenceOverview?.filters.priority ?? "high") != scope.priority {
            intelligenceOverview = nil
            intelligenceEvents = []
        }
        api.setAuthToken(token)
        defer {
            if overviewRequestID == requestID { overviewPendingScope = nil; isRefreshingOverview = false }
        }
        do {
            let overview = try await api.fetchIntelligenceOverview(scope: scope)
            guard !Task.isCancelled, overviewRequestID == requestID, overviewScope == scope,
                  WatchKeychain.authToken == token else { return }
            guard overview.matches(scope: scope) else { return }
            intelligenceOverview = overview
            intelligenceEvents = Array(overview.timelineEvents.filter { !$0.isArchived }.prefix(8))
            saveCache()
        } catch {
            guard !Task.isCancelled, overviewRequestID == requestID, overviewScope == scope,
                  WatchKeychain.authToken == token else { return }
            overviewError = error.localizedDescription
        }
    }

    private func result<T>(_ operation: @MainActor () async throws -> T) async -> Result<T, Error> {
        do { return .success(try await operation()) }
        catch { return .failure(error) }
    }

    private func isUnauthorized(_ error: Error) -> Bool {
        if let apiError = error as? APIError, apiError.status == 401 {
            return true
        }
        let message = error.localizedDescription.lowercased()
        return message.contains("401") || message.contains("unauthorized") || message.contains("authentication required")
    }

    private func saveCache() {
        let snapshot = WatchSnapshot(
            briefing: briefing,
            news: news,
            selectedCategoryNews: selectedCategoryNews,
            newsCategoryFacets: newsCategoryFacets,
            newsPageTotal: newsPageTotal,
            newsUnassessedCount: newsUnassessedCount,
            newsMetadataIncluded: newsMetadataIncluded,
            podcasts: podcasts,
            social: social,
            weather: weather,
            leadership: leadership,
            markets: markets,
            transport: transport,
            intelligenceEvents: intelligenceEvents,
            briefingSchedule: briefingSchedule,
            selectedCountry: selectedCountry,
            selectedNewsCategory: selectedNewsCategory,
            lastUpdated: lastUpdated,
            widgetFreshness: widgetFreshness,
            intelligenceOverview: intelligenceOverview
        )
        let encoder = JSONEncoder()
        // `JSONDecoder.api` treats numeric dates as Unix seconds, so the cache
        // encoder must use the same epoch rather than Foundation's reference date.
        encoder.dateEncodingStrategy = .secondsSince1970
        guard let data = try? encoder.encode(snapshot) else { return }
        UserDefaults.standard.set(data, forKey: cacheKey)
    }

    private func loadCache() {
        guard let data = UserDefaults.standard.data(forKey: cacheKey),
              let snapshot = try? JSONDecoder.api.decode(WatchSnapshot.self, from: data) else {
            return
        }
        briefing = snapshot.briefing
        selectedCountry = normalizedCountry(snapshot.selectedCountry)
        let cachedCategory = NewsCategoryCatalog.normalized(snapshot.selectedNewsCategory)
        selectedNewsCategory = cachedCategory
        if let cachedCategoryNews = snapshot.selectedCategoryNews {
            news = NewsChronology.sorted(snapshot.news, order: .newestFirst)
            selectedCategoryNews = NewsChronology.sorted(cachedCategoryNews, order: .newestFirst)
            newsCategoryFacets = snapshot.newsCategoryFacets ?? []
            newsPageTotal = snapshot.newsPageTotal
            newsUnassessedCount = snapshot.newsUnassessedCount
            newsMetadataIncluded = snapshot.newsMetadataIncluded ?? false
        } else if cachedCategory == NewsCategoryCatalog.allCode {
            // Snapshots written before category selection stored the global feed in `news`.
            news = NewsChronology.sorted(snapshot.news, order: .newestFirst)
            selectedCategoryNews = news
            newsCategoryFacets = []
            newsPageTotal = nil
            newsUnassessedCount = nil
            newsMetadataIncluded = false
        } else {
            // A short-lived pre-separation build cached a filtered feed as `news`.
            // Keep it visible, but never reuse it for global Watch metrics.
            news = []
            selectedCategoryNews = NewsChronology.sorted(snapshot.news, order: .newestFirst)
            newsCategoryFacets = []
            newsPageTotal = nil
            newsUnassessedCount = nil
            newsMetadataIncluded = false
        }
        podcasts = snapshot.podcasts
        social = SocialSignal.newestFirst(snapshot.social ?? [])
        weather = snapshot.weather
        leadership = snapshot.leadership
        markets = snapshot.markets
        transport = snapshot.transport
        intelligenceEvents = snapshot.intelligenceEvents.filter { !$0.isArchived }
        intelligenceOverview = snapshot.intelligenceOverview
        overviewHours = snapshot.intelligenceOverview?.window.hours ?? 24
        overviewTopic = snapshot.intelligenceOverview?.filters.topic
        overviewPriority = snapshot.intelligenceOverview?.filters.priority ?? "high"
        briefingSchedule = snapshot.briefingSchedule
        lastUpdated = snapshot.lastUpdated
        widgetFreshness = snapshot.widgetFreshness ?? .empty
    }

    private func clearProtectedData() {
        refreshRequestID = UUID()
        pendingRefreshKey = nil
        overviewHours = 24
        overviewTopic = nil
        isRefreshingNews = false
        briefing = nil
        news = []
        selectedCategoryNews = []
        podcasts = []
        social = []
        weather = []
        leadership = []
        markets = []
        transport = nil
        intelligenceEvents = []
        intelligenceOverview = nil
        overviewError = nil
        overviewRequestID = UUID()
        overviewPendingScope = nil
        isRefreshingOverview = false
        briefingSchedule = nil
        isSavingBriefingSchedule = false
        briefingScheduleError = nil
        socialLoadError = nil
        newsLoadError = nil
        newsCategoryFacets = []
        newsPageTotal = nil
        newsUnassessedCount = nil
        newsMetadataIncluded = false
        lastUpdated = nil
        widgetFreshness = .empty
        UserDefaults.standard.removeObject(forKey: cacheKey)
        WatchWidgetSnapshotStore.clear()
    }

    private func applyNewsMetadata(_ page: NewsPage) {
        let includesMetadata = page.page.metadata_included ?? !page.facets.categories.isEmpty
        newsCategoryFacets = includesMetadata ? page.facets.categories : []
        newsPageTotal = includesMetadata ? page.page.total : nil
        newsUnassessedCount = includesMetadata ? page.ranking.unassessed_count : nil
        newsMetadataIncluded = includesMetadata
    }
}

private struct WatchSnapshot: Codable {
    let briefing: DailySignalBriefing?
    let news: [NewsItem]
    let selectedCategoryNews: [NewsItem]?
    let newsCategoryFacets: [NewsCategoryFacet]?
    let newsPageTotal: Int?
    let newsUnassessedCount: Int?
    let newsMetadataIncluded: Bool?
    let podcasts: [PodcastEpisode]
    let social: [SocialSignal]?
    let weather: [CountryWeather]
    let leadership: [CountryLeadership]
    let markets: [MarketQuote]
    let transport: TransportOverview?
    let intelligenceEvents: [IntelligenceEvent]
    let briefingSchedule: DailyBriefingSchedule?
    let selectedCountry: String?
    let selectedNewsCategory: String?
    let lastUpdated: Date?
    let widgetFreshness: WatchWidgetFreshness?
    let intelligenceOverview: IntelligenceOverview?
}
