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
                                     URLQueryItem(name: "offset", value: String(offset)),
                                     URLQueryItem(name: "display_language", value: ClaritasInterfaceLanguage.current)]
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

    func fetchCountryMarkets() async throws -> CountryMarketOverviewResponse {
        let url = baseURL.appendingPathComponent("/api/market/countries")
        return try await request(URLRequest(url: url), as: CountryMarketOverviewResponse.self)
    }

    func fetchTransportOverview(
        detail: String = "aggregate",
        mode: TransportMode? = nil,
        country: String,
        entityLimit: Int? = nil,
        refresh: Bool = false
    ) async throws -> TransportOverview {
        let normalizedCountry = country.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard normalizedCountry.range(of: "^[A-Z]{2}$", options: .regularExpression) != nil else {
            throw APIError(status: 400, message: "Transport intelligence requires an ISO alpha-2 country.")
        }
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("/api/transport/overview"),
            resolvingAgainstBaseURL: false
        )!
        var items = [URLQueryItem(name: "detail", value: detail)]
        if let mode {
            items.append(URLQueryItem(name: "mode", value: mode.rawValue))
        }
        items.append(URLQueryItem(name: "country", value: normalizedCountry))
        if let entityLimit {
            items.append(URLQueryItem(name: "entity_limit", value: String(entityLimit)))
        }
        if refresh {
            items.append(URLQueryItem(name: "refresh", value: "true"))
        }
        comps.queryItems = items
        return try await request(URLRequest(url: comps.url!), as: TransportOverview.self)
    }

    func fetchTransportEntity(
        mode: TransportMode,
        entityID: String
    ) async throws -> TransportEntityDetail {
        let encodedID = entityID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? entityID
        let url = baseURL.appendingPathComponent(
            "/api/transport/entities/\(mode.rawValue)/\(encodedID)"
        )
        return try await request(URLRequest(url: url), as: TransportEntityDetail.self)
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
        runGdeltProvider: Bool,
        runInstitutionalRssProvider: Bool
    ) async throws -> AdminIngestionRunDetail {
        let payload: [String: Any] = [
            "providers": [
                "gdelt": runGdeltProvider,
                "institutionalRss": runInstitutionalRssProvider
            ]
        ]

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

    func triggerAdminMarketIngestion() async throws -> AdminIngestionRunDetail {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/admin/ingestion/market/run"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload: [String: Any] = [
            "providers": ["secEdgar": true, "ecb": true, "oecd": true]
        ]
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

    func fetchIntelligenceEvents(limit: Int = 40, country: String? = nil) async throws -> [IntelligenceEvent] {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("/api/intelligence/events"),
            resolvingAgainstBaseURL: false
        )!
        var items = [URLQueryItem(name: "limit", value: String(min(max(limit, 1), 100)))]
        if let country, country.range(of: "^[A-Za-z]{2}$", options: .regularExpression) != nil {
            items.append(URLQueryItem(name: "country", value: country.uppercased()))
        }
        comps.queryItems = items
        return try await request(URLRequest(url: comps.url!), as: [IntelligenceEvent].self, rootKey: "events")
    }

    func fetchIntelligenceEvent(id: String) async throws -> IntelligenceEventDetail {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let url = baseURL.appendingPathComponent("/api/intelligence/events/\(encoded)")
        return try await request(URLRequest(url: url), as: IntelligenceEventDetail.self)
    }

    func fetchEventGibsContext(id: String) async throws -> GibsEventContext? {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let url = baseURL.appendingPathComponent("/api/earth-observation/events/\(encoded)/gibs")
        let (data, response) = try await session.data(for: authedRequest(URLRequest(url: url)))
        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: -1, message: "No HTTP response")
        }
        if http.statusCode == 404 || http.statusCode == 503 { return nil }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError(status: http.statusCode, message: errorMessage(data: data, statusCode: http.statusCode))
        }
        return try JSONDecoder.api.decode(GibsEventContext.self, from: data)
    }

    func fetchIntelligenceWatchlist() async throws -> [IntelligenceWatch] {
        let url = baseURL.appendingPathComponent("/api/intelligence/watchlist")
        return try await request(URLRequest(url: url), as: [IntelligenceWatch].self, rootKey: "watches")
    }

    func saveIntelligenceWatch(type: String, key: String) async throws -> IntelligenceWatch {
        var request = URLRequest(url: baseURL.appendingPathComponent("/api/intelligence/watchlist"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "watch_type": type,
            "watch_key": key,
            "minimum_severity": "high",
            "alerts_enabled": true,
        ])
        return try await self.request(request, as: IntelligenceWatch.self, rootKey: "watch")
    }

    func deleteIntelligenceWatch(id: String) async throws {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        var request = URLRequest(url: baseURL.appendingPathComponent("/api/intelligence/watchlist/\(encoded)"))
        request.httpMethod = "DELETE"
        let (data, response) = try await session.data(for: authedRequest(request))
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) || http.statusCode == 404 else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw APIError(status: status, message: errorMessage(data: data, statusCode: status))
        }
    }

    func fetchIntelligenceAlerts() async throws -> [IntelligenceAlert] {
        let url = baseURL.appendingPathComponent("/api/intelligence/alerts")
        return try await request(URLRequest(url: url), as: [IntelligenceAlert].self, rootKey: "alerts")
    }

    func acknowledgeIntelligenceAlert(id: String) async throws {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        var request = URLRequest(url: baseURL.appendingPathComponent("/api/intelligence/alerts/\(encoded)"))
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["action": "acknowledge"])
        let (data, response) = try await session.data(for: authedRequest(request))
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw APIError(status: status, message: errorMessage(data: data, statusCode: status))
        }
    }

    func registerPushDevice(
        token: String,
        environment: String,
        bundleID: String,
        installationID: String
    ) async throws -> PushDeviceRegistration {
        var request = URLRequest(url: baseURL.appendingPathComponent("/api/intelligence/devices"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "device_token": token,
            "environment": environment,
            "platform": "ios",
            "installation_id": installationID,
            "app_bundle_id": bundleID,
            "metadata": ["client": "claritas-native"],
        ])
        return try await self.request(request, as: PushDeviceRegistration.self, rootKey: "device")
    }

    func unregisterPushDevice(id: String) async throws {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        var request = URLRequest(url: baseURL.appendingPathComponent("/api/intelligence/devices/\(encoded)"))
        request.httpMethod = "DELETE"
        let (data, response) = try await session.data(for: authedRequest(request))
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) || http.statusCode == 404 else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw APIError(status: status, message: errorMessage(data: data, statusCode: status))
        }
    }

    func unregisterAllPushDevices() async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("/api/intelligence/devices"))
        request.httpMethod = "DELETE"
        let (data, response) = try await session.data(for: authedRequest(request))
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw APIError(status: status, message: errorMessage(data: data, statusCode: status))
        }
    }

    func fetchEarthObservations(limit: Int = 40) async throws -> EarthObservationListResponse {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent("/api/earth-observation/observations"),
            resolvingAgainstBaseURL: false
        )!
        comps.queryItems = [URLQueryItem(name: "limit", value: String(min(max(limit, 1), 100)))]
        return try await request(URLRequest(url: comps.url!), as: EarthObservationListResponse.self)
    }

    func fetchEarthAsset(path: String) async throws -> Data {
        guard path.hasPrefix("/api/earth-observation/assets/") else {
            throw APIError(status: 400, message: "Invalid Earth observation asset path")
        }
        let url = baseURL.appendingPathComponent(path)
        let (data, response) = try await session.data(for: authedRequest(URLRequest(url: url)))
        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: -1, message: "No HTTP response")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError(status: http.statusCode, message: errorMessage(data: data, statusCode: http.statusCode))
        }
        return data
    }

    func fetchProxiedImage(url original: String) async throws -> Data {
        guard let remoteURL = URL(string: original), remoteURL.scheme?.lowercased() == "https" else {
            throw APIError(status: 400, message: "Invalid remote image URL")
        }
        guard let proxyURL = imageProxyURL(for: remoteURL) else {
            throw APIError(status: 400, message: "Unable to build image proxy URL")
        }
        let (data, response) = try await session.data(for: authedRequest(URLRequest(url: proxyURL)))
        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: -1, message: "No HTTP response")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError(status: http.statusCode, message: errorMessage(data: data, statusCode: http.statusCode))
        }
        return data
    }

    func fetchAdminIntelligenceStatus() async throws -> AdminIntelligenceStatus {
        let url = baseURL.appendingPathComponent("/api/admin/intelligence/status")
        return try await request(URLRequest(url: url), as: AdminIntelligenceStatus.self)
    }

    func runIntelligenceProvider(_ provider: String) async throws {
        guard provider == "usgs" || provider == "nasa-firms" else {
            throw APIError(status: 400, message: "Unsupported provider run")
        }
        var request = URLRequest(url: baseURL.appendingPathComponent("/api/admin/intelligence/providers/\(provider)/run"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)
        let (data, response) = try await session.data(for: authedRequest(request))
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw APIError(status: status, message: errorMessage(data: data, statusCode: status))
        }
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
