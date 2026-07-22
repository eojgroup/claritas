import Foundation

struct APIError: Error, LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

final class APIClient {
    private let session: URLSession
    private let baseURL: URL
    private var authToken: String?

    var baseURLDescription: String {
        baseURL.absoluteString
    }

    init(session: URLSession? = nil) {
        self.session = session ?? APIClient.makeDefaultSession()

        // Resolve base URL precedence: UserDefaults override -> Config.plist -> default
        if let override = UserDefaults.standard.string(forKey: "API_BASE_URL"),
           let url = URL(string: override) {
            self.baseURL = url
        } else if let configURL = APIClient.loadConfigBaseURL() {
            self.baseURL = configURL
        } else {
            self.baseURL = URL(string: "http://localhost:8080")! // dev default
        }
    }

    private static func makeDefaultSession() -> URLSession {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 15
        return URLSession(configuration: config)
    }

    private static func loadConfigBaseURL() -> URL? {
        guard let url = Bundle.main.url(forResource: "Config", withExtension: "plist"),
              let data = try? Data(contentsOf: url),
              let dict = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any],
              let base = dict["API_BASE_URL"] as? String,
              let out = URL(string: base) else {
            return nil
        }
        return out
    }

    func setAuthToken(_ token: String?) {
        self.authToken = token
    }

    // MARK: - Endpoints

    func fetchAuthProviders() async throws -> [AuthProvider] {
        let url = baseURL.appendingPathComponent("/api/auth/providers")
        let req = URLRequest(url: url)
        let (data, resp) = try await session.data(for: authedRequest(req))
        guard let http = resp as? HTTPURLResponse else { throw APIError(status: -1, message: "No HTTP response") }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError(status: http.statusCode, message: errorMessage(data: data, statusCode: http.statusCode))
        }

        let decoded = try JSONSerialization.jsonObject(with: data, options: [])
        let rawProviders: [Any]
        if let container = decoded as? [String: Any], let providers = container["providers"] as? [Any] {
            rawProviders = providers
        } else if let providers = decoded as? [Any] {
            rawProviders = providers
        } else {
            throw APIError(status: http.statusCode, message: "Unexpected auth providers response format")
        }

        var seen = Set<AuthProviderId>()
        var out: [AuthProvider] = []
        for raw in rawProviders {
            guard let entry = raw as? [String: Any] else { continue }
            guard let id = parseProviderId(entry["id"]) else { continue }
            if seen.contains(id) { continue }
            seen.insert(id)

            out.append(
                AuthProvider(
                    id: id,
                    enabled: parseBool(entry["enabled"]),
                    display_name: nonEmpty(entry["display_name"] as? String),
                    icon: nonEmpty(entry["icon"] as? String),
                    start_path: nonEmpty(entry["start_path"] as? String)
                )
            )
        }

        let providerOrder = AuthProviderId.allCases
        out.sort {
            (providerOrder.firstIndex(of: $0.id) ?? providerOrder.count) < (providerOrder.firstIndex(of: $1.id) ?? providerOrder.count)
        }
        return out
    }

    func fetchAuthMe() async throws -> AuthUser? {
        let url = baseURL.appendingPathComponent("/api/auth/me")
        let req = URLRequest(url: url)
        let (data, resp) = try await session.data(for: authedRequest(req))
        guard let http = resp as? HTTPURLResponse else { throw APIError(status: -1, message: "No HTTP response") }
        if http.statusCode == 401 {
            return nil
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError(status: http.statusCode, message: errorMessage(data: data, statusCode: http.statusCode))
        }
        let decoded = try JSONSerialization.jsonObject(with: data, options: [])
        guard let container = decoded as? [String: Any] else {
            throw APIError(status: http.statusCode, message: "Unexpected auth session response format")
        }
        guard let rawUser = container["user"], !(rawUser is NSNull) else {
            return nil
        }
        guard let user = rawUser as? [String: Any] else {
            throw APIError(status: http.statusCode, message: "Unexpected auth user payload format")
        }
        guard let id = parseInt(user["id"]) else {
            throw APIError(status: http.statusCode, message: "Missing or invalid auth user id")
        }
        let billing = parseBillingAccessState(user["billing"] ?? container["billing"])

        return AuthUser(
            id: id,
            email: nonEmpty(user["email"] as? String),
            display_name: nonEmpty(user["display_name"] as? String),
            avatar_url: nonEmpty(user["avatar_url"] as? String),
            roles: parseStringArray(user["roles"]),
            billing: billing
        )
    }

    func fetchBillingMe() async throws -> BillingAccessState {
        let req = URLRequest(url: baseURL.appendingPathComponent("/api/billing/me"))
        return try await request(req, as: BillingAccessState.self, rootKey: "billing")
    }

    func logout() async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/auth/logout"))
        req.httpMethod = "POST"
        _ = try await request(req, as: EmptyResponse.self)
    }

    func authStartURL(provider: AuthProviderId, redirect: URL, startPathOverride: String? = nil) -> URL? {
        let startPath: String
        if let startPathOverride, !startPathOverride.isEmpty {
            startPath = startPathOverride
        } else {
            startPath = "/api/auth/\(provider.rawValue)/start"
        }
        var comps = URLComponents(url: baseURL.appendingPathComponent(startPath), resolvingAgainstBaseURL: false)
        comps?.queryItems = [URLQueryItem(name: "redirect", value: redirect.absoluteString)]
        return comps?.url
    }

    func fetchNews(limit: Int = 20, offset: Int = 0, q: String? = nil, country: String? = nil) async throws -> [NewsItem] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/news"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [URLQueryItem(name: "limit", value: String(limit)),
                                     URLQueryItem(name: "offset", value: String(offset))]
        if let q { items.append(URLQueryItem(name: "q", value: q)) }
        if let country { items.append(URLQueryItem(name: "country", value: country)) }
        comps.queryItems = items
        let req = URLRequest(url: comps.url!)
        return try await request(req, as: [NewsItem].self, rootKey: "items")
    }

    func fetchPodcasts(
        limit: Int = 40,
        offset: Int = 0,
        q: String? = nil,
        signalType: String? = nil
    ) async throws -> [PodcastEpisode] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/podcasts"), resolvingAgainstBaseURL: false)!
        var items = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset))
        ]
        if let q, !q.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            items.append(URLQueryItem(name: "q", value: q))
        }
        if let signalType, signalType != "all" {
            items.append(URLQueryItem(name: "signal_type", value: signalType))
        }
        comps.queryItems = items
        return try await request(URLRequest(url: comps.url!), as: [PodcastEpisode].self, rootKey: "items")
    }

    func fetchCountryStats(days: Int = 30) async throws -> [CountryStat] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/news/country-stats"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "days", value: String(days))]
        let req = URLRequest(url: comps.url!)
        return try await request(req, as: [CountryStat].self, rootKey: "stats")
    }

    func fetchCountryWeather() async throws -> [CountryWeather] {
        let url = baseURL.appendingPathComponent("/api/weather/country-latest")
        let req = URLRequest(url: url)
        return try await request(req, as: [CountryWeather].self, rootKey: "stats")
    }

    func fetchCountryLeadership() async throws -> [CountryLeadership] {
        let url = baseURL.appendingPathComponent("/api/leadership/countries")
        let req = URLRequest(url: url)
        return try await request(req, as: [CountryLeadership].self, rootKey: "countries")
    }

    func fetchLatestDailyBriefing() async throws -> DailySignalBriefing? {
        let req = URLRequest(url: baseURL.appendingPathComponent("/api/briefings/daily/latest"))
        return try await request(req, as: DailySignalBriefingResponse.self).briefing
    }

    func fetchLatestPersonalDailyBriefing() async throws -> PersonalDailyBriefing? {
        let req = URLRequest(url: baseURL.appendingPathComponent("/api/briefings/daily/personal/latest"))
        return try await request(req, as: PersonalDailyBriefingResponse.self).briefing
    }

    func fetchDailyBriefingSchedule() async throws -> DailyBriefingSchedule {
        let req = URLRequest(url: baseURL.appendingPathComponent("/api/auth/me/briefings/daily/schedule"))
        return try await request(req, as: DailyBriefingSchedule.self, rootKey: "schedule")
    }

    func updateDailyBriefingSchedule(
        enabled: Bool,
        scheduledTime: String,
        timezone: String
    ) async throws -> DailyBriefingSchedule {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/auth/me/briefings/daily/schedule"))
        req.httpMethod = "PUT"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(
            withJSONObject: [
                "enabled": enabled,
                "scheduled_time": scheduledTime,
                "timezone": timezone
            ],
            options: []
        )
        return try await request(req, as: DailyBriefingSchedule.self, rootKey: "schedule")
    }

    func fetchMarketQuotes(refresh: Bool = true, symbols: [String]? = nil) async throws -> [MarketQuote] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/market/quotes"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [URLQueryItem(name: "refresh", value: refresh ? "true" : "false")]
        if let symbols, !symbols.isEmpty {
            items.append(URLQueryItem(name: "symbols", value: symbols.joined(separator: ",")))
        }
        comps.queryItems = items
        return try await request(URLRequest(url: comps.url!), as: [MarketQuote].self, rootKey: "quotes")
    }

    func fetchMarketStatus(refresh: Bool = true, exchanges: [String]? = nil) async throws -> [MarketStatus] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/market/status"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [URLQueryItem(name: "refresh", value: refresh ? "true" : "false")]
        if let exchanges, !exchanges.isEmpty {
            items.append(URLQueryItem(name: "exchanges", value: exchanges.joined(separator: ",")))
        }
        comps.queryItems = items
        return try await request(URLRequest(url: comps.url!), as: [MarketStatus].self, rootKey: "status")
    }

    func fetchMarketEarnings(
        from: String? = nil,
        to: String? = nil,
        symbol: String? = nil,
        limit: Int? = nil
    ) async throws -> [EarningsEvent] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/market/earnings"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = []
        if let from = nonEmpty(from) {
            items.append(URLQueryItem(name: "from", value: from))
        }
        if let to = nonEmpty(to) {
            items.append(URLQueryItem(name: "to", value: to))
        }
        if let symbol = nonEmpty(symbol) {
            items.append(URLQueryItem(name: "symbol", value: symbol))
        }
        if let limit {
            items.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        comps.queryItems = items.isEmpty ? nil : items
        return try await request(URLRequest(url: comps.url!), as: [EarningsEvent].self, rootKey: "events")
    }

    func ingestWeatherNow(country: String?) async throws -> WeatherIngestResponse {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/ingest/openweather/country-current"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let country {
            req.httpBody = try JSONSerialization.data(withJSONObject: ["country": country], options: [])
        } else {
            req.httpBody = Data("{}".utf8)
        }
        return try await request(req, as: WeatherIngestResponse.self)
    }

    func triggerAdminNewsIngestion(
        runNewsApiProvider: Bool,
        runTheNewsApiProvider: Bool,
        runEverything: Bool,
        runTopHeadlines: Bool,
        query: String,
        language: String?,
        country: String?,
        category: String?,
        theNewsApiPublishedAfter: String?
    ) async throws -> AdminIngestionRunDetail {
        var payload: [String: Any] = [
            "providers": [
                "newsapi": runNewsApiProvider,
                "thenewsapi": runTheNewsApiProvider
            ]
        ]

        if runNewsApiProvider && runEverything {
            var everything: [String: Any] = [
                "q": nonEmpty(query) ?? "OpenAI",
                "pageSize": 50,
                "maxPages": 2
            ]
            if let language = nonEmpty(language) {
                everything["language"] = language
            }
            payload["everything"] = everything
        } else {
            payload["everything"] = false
        }

        if runNewsApiProvider && runTopHeadlines {
            var topHeadlines: [String: Any] = [
                "country": nonEmpty(country) ?? "us",
                "category": nonEmpty(category) ?? "technology",
                "pageSize": 50,
                "maxPages": 2
            ]
            if let query = nonEmpty(query) {
                topHeadlines["q"] = query
            }
            payload["topHeadlines"] = topHeadlines
        } else {
            payload["topHeadlines"] = false
        }

        if runTheNewsApiProvider {
            var theNewsApi: [String: Any] = [
                "search": nonEmpty(query) ?? "OpenAI",
                "locale": nonEmpty(country) ?? "us",
                "pageSize": 50,
                "maxPages": 2
            ]
            if let language = nonEmpty(language) {
                theNewsApi["language"] = language
            }
            if let publishedAfter = nonEmpty(theNewsApiPublishedAfter) {
                theNewsApi["publishedAfter"] = publishedAfter
            }
            payload["theNewsApi"] = theNewsApi
        } else {
            payload["theNewsApi"] = false
        }

        var req = URLRequest(url: baseURL.appendingPathComponent("/api/admin/ingestion/news/run"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
        return try await request(req, as: AdminIngestionRunDetail.self)
    }

    func triggerAdminWeatherIngestion(country: String?) async throws -> AdminIngestionRunDetail {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/admin/ingestion/weather/run"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let country = nonEmpty(country) {
            req.httpBody = try JSONSerialization.data(withJSONObject: ["country": country], options: [])
        } else {
            req.httpBody = Data("{}".utf8)
        }
        return try await request(req, as: AdminIngestionRunDetail.self)
    }

    func triggerAdminMarketIngestion(
        symbols: [String]?,
        includeNews: Bool = true,
        newsCategory: String? = nil,
        newsMinId: Int? = nil,
        newsMaxItems: Int? = nil
    ) async throws -> AdminIngestionRunDetail {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/admin/ingestion/market/run"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var payload: [String: Any] = [
            "includeNews": includeNews
        ]
        if let symbols, !symbols.isEmpty {
            payload["symbols"] = symbols
        }
        if let newsCategory = nonEmpty(newsCategory) {
            payload["newsCategory"] = newsCategory
        }
        if let newsMinId {
            payload["newsMinId"] = newsMinId
        }
        if let newsMaxItems {
            payload["newsMaxItems"] = newsMaxItems
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
        return try await request(req, as: AdminIngestionRunDetail.self)
    }

    func fetchAdminIngestionRuns(
        pipeline: IngestionPipeline? = nil,
        limit: Int = 100,
        offset: Int = 0
    ) async throws -> [AdminIngestionRun] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/admin/ingestion/runs"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset))
        ]
        if let pipeline {
            items.append(URLQueryItem(name: "pipeline", value: pipeline.rawValue))
        }
        comps.queryItems = items
        return try await request(URLRequest(url: comps.url!), as: [AdminIngestionRun].self, rootKey: "runs")
    }

    func fetchAdminIngestionRun(runId: Int, logLimit: Int = 400) async throws -> AdminIngestionRunDetail {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("/api/admin/ingestion/runs/\(runId)"),
            resolvingAgainstBaseURL: false
        )!
        comps.queryItems = [URLQueryItem(name: "logLimit", value: String(logLimit))]
        return try await request(URLRequest(url: comps.url!), as: AdminIngestionRunDetail.self)
    }

    func fetchAdminIngestionMetrics(
        days: Int = 30,
        pipeline: IngestionPipeline? = nil
    ) async throws -> AdminIngestionMetricsResponse {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/admin/ingestion/metrics"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [URLQueryItem(name: "days", value: String(days))]
        if let pipeline {
            items.append(URLQueryItem(name: "pipeline", value: pipeline.rawValue))
        }
        comps.queryItems = items
        return try await request(URLRequest(url: comps.url!), as: AdminIngestionMetricsResponse.self)
    }

    func fetchAdminIngestionAutomation() async throws -> AdminIngestionAutomationResponse {
        let req = URLRequest(url: baseURL.appendingPathComponent("/api/admin/ingestion/automation"))
        return try await request(req, as: AdminIngestionAutomationResponse.self)
    }

    func updateAdminIngestionAutomationRule(
        pipeline: IngestionPipeline,
        patch: [String: Any]
    ) async throws -> AdminIngestionAutomationRule {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/admin/ingestion/automation/\(pipeline.rawValue)"))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: patch, options: [])
        return try await request(req, as: AdminIngestionAutomationRule.self, rootKey: "rule")
    }

    func fetchAdminRoles() async throws -> [AdminRole] {
        let req = URLRequest(url: baseURL.appendingPathComponent("/api/admin/roles"))
        return try await request(req, as: [AdminRole].self, rootKey: "roles")
    }

    func createAdminRole(key: String, description: String?) async throws -> AdminRole {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/admin/roles"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: Any] = ["key": key]
        if let description = nonEmpty(description) {
            payload["description"] = description
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
        return try await request(req, as: AdminRole.self, rootKey: "role")
    }

    func fetchAdminBillingPlans() async throws -> [AdminBillingPlan] {
        let req = URLRequest(url: baseURL.appendingPathComponent("/api/admin/billing/plans"))
        return try await request(req, as: [AdminBillingPlan].self, rootKey: "plans")
    }

    func fetchAdminUsers(
        limit: Int = 200,
        offset: Int = 0,
        q: String? = nil,
        role: String? = nil,
        includeInactive: Bool = false
    ) async throws -> AdminUsersResponse {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/admin/users"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset))
        ]
        if let q = nonEmpty(q) {
            items.append(URLQueryItem(name: "q", value: q))
        }
        if let role = nonEmpty(role) {
            items.append(URLQueryItem(name: "role", value: role))
        }
        if includeInactive {
            items.append(URLQueryItem(name: "includeInactive", value: "true"))
        }
        comps.queryItems = items
        return try await request(URLRequest(url: comps.url!), as: AdminUsersResponse.self)
    }

    func updateAdminUserRoles(userId: Int, roles: [String]) async throws -> AdminUser? {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/admin/users/\(userId)/roles"))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["roles": roles], options: [])
        let out = try await request(req, as: AdminUserResponse.self)
        return out.user
    }

    func updateAdminUserStatus(userId: Int, isActive: Bool) async throws -> AdminUser? {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/admin/users/\(userId)/status"))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["is_active": isActive], options: [])
        let out = try await request(req, as: AdminUserResponse.self)
        return out.user
    }

    func updateAdminUserSubscription(
        userId: Int,
        planCode: String,
        status: String,
        provider: String,
        currentPeriodEndISO: String?
    ) async throws -> AdminUser? {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/admin/users/\(userId)/subscription"))
        req.httpMethod = "PUT"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload: [String: Any] = [
            "plan_code": planCode,
            "status": status,
            "provider": provider,
            "current_period_end": currentPeriodEndISO ?? NSNull()
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
        let out = try await request(req, as: AdminUserResponse.self)
        return out.user
    }

    func imageProxyURL(for original: URL?) -> URL? {
        guard let original else { return nil }
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/proxy-image"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "url", value: original.absoluteString)]
        return comps.url
    }

    // MARK: - Generic request

    private func request<T>(_ req: URLRequest, as: T.Type, rootKey: String? = nil) async throws -> T where T: Decodable {
        let (data, resp) = try await session.data(for: authedRequest(req))
        guard let http = resp as? HTTPURLResponse else { throw APIError(status: -1, message: "No HTTP response") }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError(status: http.statusCode, message: errorMessage(data: data, statusCode: http.statusCode))
        }
        if let rootKey {
            let container = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any]
            let value = container?[rootKey]
            let valueData = try JSONSerialization.data(withJSONObject: value ?? NSNull(), options: [])
            return try JSONDecoder.api.decode(T.self, from: valueData)
        }
        return try JSONDecoder.api.decode(T.self, from: data)
    }

    private func errorMessage(data: Data, statusCode: Int) -> String {
        if let object = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any],
           let error = object["error"] as? String,
           !error.isEmpty {
            return error
        }
        return String(data: data, encoding: .utf8) ?? "HTTP \(statusCode)"
    }

    private func nonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func parseProviderId(_ value: Any?) -> AuthProviderId? {
        guard let raw = value as? String else { return nil }
        return AuthProviderId(rawValue: raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    private func parseBool(_ value: Any?) -> Bool {
        switch value {
        case let bool as Bool:
            return bool
        case let number as NSNumber:
            return number.boolValue
        case let string as String:
            let normalized = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return normalized == "true" || normalized == "1" || normalized == "yes"
        default:
            return false
        }
    }

    private func parseInt(_ value: Any?) -> Int? {
        switch value {
        case let int as Int:
            return int
        case let number as NSNumber:
            return Int(exactly: number.int64Value)
        case let string as String:
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            if let int = Int(trimmed) {
                return int
            }
            if let int64 = Int64(trimmed) {
                return Int(exactly: int64)
            }
            return nil
        default:
            return nil
        }
    }

    private func parseStringArray(_ value: Any?) -> [String]? {
        guard let values = value as? [Any] else { return nil }
        return values.compactMap { nonEmpty($0 as? String) }
    }

    private func parseBillingAccessState(_ value: Any?) -> BillingAccessState? {
        guard let object = value as? [String: Any],
              JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: []) else {
            return nil
        }
        return try? JSONDecoder.api.decode(BillingAccessState.self, from: data)
    }

    private func authedRequest(_ req: URLRequest) -> URLRequest {
        guard let token = authToken, !token.isEmpty else { return req }
        var next = req
        next.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return next
    }
}

private struct EmptyResponse: Decodable {}
private struct DailySignalBriefingResponse: Decodable {
    let briefing: DailySignalBriefing?
}
private struct AdminUserResponse: Decodable {
    let user: AdminUser?
}

extension JSONDecoder {
    static var api: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            if let str = try? container.decode(String.self), let date = APIDateParser.parse(str) {
                return date
            }
            if let seconds = try? container.decode(Double.self) {
                return Date(timeIntervalSince1970: seconds)
            }
            if let seconds = try? container.decode(Int.self) {
                return Date(timeIntervalSince1970: TimeInterval(seconds))
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid date")
        }
        return d
    }
}

struct WeatherIngestResponse: Decodable {
    let inserted: Int?
    let updated: Int?
    let skipped: Int?
    let http_failures: Int?
    let db_errors: Int?
    let last_http_status: Int?
    let last_http_error: String?
    let last_db_error: String?
}

private struct PersonalDailyBriefingResponse: Decodable {
    let briefing: PersonalDailyBriefing?
}
