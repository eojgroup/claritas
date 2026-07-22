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
    @Published private(set) var personalBriefing: PersonalDailyBriefing?
    @Published private(set) var news: [NewsItem] = []
    @Published private(set) var podcasts: [PodcastEpisode] = []
    @Published private(set) var weather: [CountryWeather] = []
    @Published private(set) var leadership: [CountryLeadership] = []
    @Published private(set) var markets: [MarketQuote] = []
    @Published private(set) var briefingSchedule: DailyBriefingSchedule?
    @Published private(set) var isSavingBriefingSchedule: Bool = false
    @Published private(set) var briefingScheduleError: String?
    @Published private(set) var connectionState: ConnectionState = .waitingForPhone
    @Published private(set) var lastUpdated: Date?

    private let connectivity = WatchConnectivityClient()
    private var api = APIClient()
    private let cacheKey = "CLARITAS_WATCH_SNAPSHOT"

    var hasSession: Bool {
        WatchKeychain.authToken != nil
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
        weatherAlerts.count + marketBreaches.count
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
            connectionState = .waitingForPhone
            return
        }
        await refresh()
    }

    func refresh() async {
        guard let token = WatchKeychain.authToken else {
            connectionState = .waitingForPhone
            connectivity.requestContext()
            return
        }

        connectionState = .refreshing
        api = APIClient()
        api.setAuthToken(token)

        async let briefingResult = result { try await api.fetchLatestDailyBriefing() }
        async let personalBriefingResult = result { try await api.fetchLatestPersonalDailyBriefing() }
        async let newsResult = result { try await api.fetchNews(limit: 12) }
        async let podcastResult = result { try await api.fetchPodcasts(limit: 8) }
        async let weatherResult = result { try await api.fetchCountryWeather() }
        async let leadershipResult = result { try await api.fetchCountryLeadership() }
        async let marketResult = result { try await api.fetchMarketQuotes(refresh: false) }
        async let scheduleResult = result { try await api.fetchDailyBriefingSchedule() }

        let results = await (
            briefingResult,
            personalBriefingResult,
            newsResult,
            podcastResult,
            weatherResult,
            leadershipResult,
            marketResult,
            scheduleResult
        )
        var errors: [Error] = []

        switch results.0 {
        case .success(let value): briefing = value
        case .failure(let error): errors.append(error)
        }
        switch results.1 {
        case .success(let value): personalBriefing = value
        case .failure(let error): errors.append(error)
        }
        switch results.2 {
        case .success(let value): news = Array(value.prefix(12))
        case .failure(let error): errors.append(error)
        }
        switch results.3 {
        case .success(let value): podcasts = Array(value.prefix(8))
        case .failure(let error): errors.append(error)
        }
        switch results.4 {
        case .success(let value): weather = Array(value.prefix(20))
        case .failure(let error): errors.append(error)
        }
        switch results.5 {
        case .success(let value): leadership = value
        case .failure(let error): errors.append(error)
        }
        switch results.6 {
        case .success(let value): markets = Array(value.prefix(20))
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

        if errors.isEmpty {
            lastUpdated = Date()
            connectionState = .ready
            saveCache()
        } else if errors.contains(where: isUnauthorized) {
            WatchKeychain.authToken = nil
            connectionState = .waitingForPhone
        } else {
            connectionState = .failed(errors[0].localizedDescription)
        }
    }

    func requestPhoneSync() {
        connectivity.requestContext()
    }

    func openOnPhone(_ destination: String) {
        connectivity.openOnPhone(destination)
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
            briefingSchedule = try await api.updateDailyBriefingSchedule(
                enabled: enabled,
                scheduledTime: scheduledTime,
                timezone: timezone
            )
            lastUpdated = Date()
            connectionState = .ready
            saveCache()
        } catch {
            if isUnauthorized(error) {
                WatchKeychain.authToken = nil
                connectionState = .waitingForPhone
                return
            }
            briefingScheduleError = error.localizedDescription
        }
    }

    private func apply(context: [String: Any]) {
        if let baseURL = context["apiBaseURL"] as? String, !baseURL.isEmpty {
            UserDefaults.standard.set(baseURL, forKey: "API_BASE_URL")
        }
        if let token = context["authToken"] as? String {
            WatchKeychain.authToken = token.isEmpty ? nil : token
        }
        api = APIClient()
        Task { await refresh() }
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
            personalBriefing: personalBriefing,
            news: news,
            podcasts: podcasts,
            weather: weather,
            leadership: leadership,
            markets: markets,
            briefingSchedule: briefingSchedule,
            lastUpdated: lastUpdated
        )
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        UserDefaults.standard.set(data, forKey: cacheKey)
    }

    private func loadCache() {
        guard let data = UserDefaults.standard.data(forKey: cacheKey),
              let snapshot = try? JSONDecoder.api.decode(WatchSnapshot.self, from: data) else {
            return
        }
        briefing = snapshot.briefing
        personalBriefing = snapshot.personalBriefing
        news = snapshot.news
        podcasts = snapshot.podcasts
        weather = snapshot.weather
        leadership = snapshot.leadership
        markets = snapshot.markets
        briefingSchedule = snapshot.briefingSchedule
        lastUpdated = snapshot.lastUpdated
    }
}

private struct WatchSnapshot: Codable {
    let briefing: DailySignalBriefing?
    let personalBriefing: PersonalDailyBriefing?
    let news: [NewsItem]
    let podcasts: [PodcastEpisode]
    let weather: [CountryWeather]
    let leadership: [CountryLeadership]
    let markets: [MarketQuote]
    let briefingSchedule: DailyBriefingSchedule?
    let lastUpdated: Date?
}
