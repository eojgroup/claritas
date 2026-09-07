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

    private let connectivity = WatchConnectivityClient()
    private var api = APIClient()
    private let cacheKey = "CLARITAS_WATCH_SNAPSHOT"
    private var refreshRequestID = UUID()
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
        intelligenceEvents.filter { $0.severity == .critical || $0.severity == .high }.count +
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

        let requestID = UUID()
        refreshRequestID = requestID
        let requestedCountry = selectedCountry
        let requestedNewsCategory = selectedNewsCategory
        isRefreshingNews = true
        newsLoadError = nil
        socialLoadError = nil
        defer {
            if refreshRequestID == requestID {
                isRefreshingNews = false
            }
        }
        connectionState = .refreshing
        let requestAPI = APIClient()
        requestAPI.setAuthToken(token)
        api = requestAPI

        async let briefingResult = result { try await requestAPI.fetchLatestDailyBriefing() }
        async let newsResult: Result<NewsPage, Error> = result {
            try await requestAPI.fetchNews(
                limit: 12,
                country: requestedCountry,
                category: NewsCategoryCatalog.allCode,
                sort: "newest",
                archive: false,
                includeMetadata: true
            )
        }
        async let categoryNewsResult: Result<NewsPage?, Error> = result {
            guard requestedNewsCategory != NewsCategoryCatalog.allCode else { return nil }
            return try await requestAPI.fetchNews(
                limit: 12,
                country: requestedCountry,
                category: requestedNewsCategory,
                sort: "newest",
                archive: false,
                includeMetadata: false
            )
        }
        async let podcastResult = result { try await requestAPI.fetchPodcasts(limit: 8) }
        async let weatherResult = result { try await requestAPI.fetchCountryWeather() }
        async let leadershipResult = result { try await requestAPI.fetchCountryLeadership() }
        async let marketResult = result { try await requestAPI.fetchMarketQuotes(refresh: false) }
        async let scheduleResult = result { try await requestAPI.fetchDailyBriefingSchedule() }
        async let intelligenceResult = result {
            try await requestAPI.fetchIntelligenceEvents(limit: 8, country: requestedCountry)
        }
        async let socialResult = result {
            try await requestAPI.fetchSocialSignals(limit: 8, country: requestedCountry)
        }

        let results = await (
            briefingResult,
            newsResult,
            categoryNewsResult,
            podcastResult,
            weatherResult,
            leadershipResult,
            marketResult,
            scheduleResult,
            intelligenceResult,
            socialResult
        )
        guard refreshRequestID == requestID else { return }
        var errors: [Error] = []
        let refreshedAt = Date()

        switch results.0 {
        case .success(let value):
            briefing = value
            widgetFreshness.overview = refreshedAt
        case .failure(let error): errors.append(error)
        }
        switch results.1 {
        case .success(let page):
            news = Array(NewsChronology.sorted(page.items, order: .newestFirst).prefix(12))
            applyNewsMetadata(page)
            if requestedNewsCategory == NewsCategoryCatalog.allCode {
                selectedCategoryNews = news
                newsLoadError = nil
            }
            widgetFreshness.news = refreshedAt
        case .failure(let error):
            if requestedNewsCategory == NewsCategoryCatalog.allCode {
                newsLoadError = error.localizedDescription
            }
            errors.append(error)
        }
        switch results.2 {
        case .success(let page):
            if requestedNewsCategory != NewsCategoryCatalog.allCode, let page {
                selectedCategoryNews = Array(
                    NewsChronology.sorted(page.items, order: .newestFirst).prefix(12)
                )
                newsLoadError = nil
            }
        case .failure(let error):
            newsLoadError = error.localizedDescription
            errors.append(error)
        }
        switch results.3 {
        case .success(let value): podcasts = Array(value.prefix(8))
        case .failure(let error): errors.append(error)
        }
        switch results.4 {
        case .success(let value):
            let scoped = requestedCountry.map { country in
                value.filter { normalizedCountry($0.country) == country }
            } ?? value
            weather = Array(scoped.prefix(20))
            widgetFreshness.weather = refreshedAt
        case .failure(let error): errors.append(error)
        }
        switch results.5 {
        case .success(let value):
            leadership = requestedCountry.map { country in
                value.filter { normalizedCountry($0.country) == country }
            } ?? value
        case .failure(let error): errors.append(error)
        }
        switch results.6 {
        case .success(let value):
            let scoped = requestedCountry.map { country in
                value.filter { normalizedCountry($0.country) == country }
            } ?? value
            markets = Array(scoped.prefix(20))
            widgetFreshness.markets = refreshedAt
        case .failure(let error): errors.append(error)
        }
        switch results.7 {
        case .success(let value):
            briefingSchedule = value
            briefingScheduleError = nil
        case .failure(let error):
            briefingScheduleError = error.localizedDescription
            if isUnauthorized(error) {
                errors.append(error)
            }
        }
        switch results.8 {
            case .success(let value):
                let scoped = requestedCountry.map { country in
                    value.filter { normalizedCountry($0.primary_country_iso2) == country }
                } ?? value
                intelligenceEvents = Array(scoped.prefix(8))
            case .failure(let error): errors.append(error)
        }
        switch results.9 {
        case .success(let value):
            social = Array(SocialSignal.newestFirst(value).prefix(8))
            socialLoadError = nil
        case .failure(let error):
            if isUnauthorized(error) {
                errors.append(error)
            } else {
                socialLoadError = error.localizedDescription
            }
        }

        do {
            let loadedTransport = try await requestAPI.fetchTransportOverview(
                detail: "aggregate",
                country: requestedCountry,
                refresh: false
            )
            guard refreshRequestID == requestID else { return }
            transport = loadedTransport
            widgetFreshness.transport = Date()
        } catch {
            guard refreshRequestID == requestID else { return }
            if isUnauthorized(error) {
                errors.append(error)
            }
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

    func requestPhoneSync() {
        connectivity.requestContext()
    }

    func openOnPhone(
        _ destination: String,
        country: String? = nil,
        eventID: String? = nil,
        newsID: Int? = nil,
        category: String? = nil
    ) {
        connectivity.openOnPhone(
            destination,
            country: country,
            eventID: eventID,
            newsID: newsID,
            category: category
        )
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

    private func result<T>(_ operation: () async throws -> T) async -> Result<T, Error> {
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
            widgetFreshness: widgetFreshness
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
        intelligenceEvents = snapshot.intelligenceEvents
        briefingSchedule = snapshot.briefingSchedule
        lastUpdated = snapshot.lastUpdated
        widgetFreshness = snapshot.widgetFreshness ?? .empty
    }

    private func clearProtectedData() {
        refreshRequestID = UUID()
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
}
