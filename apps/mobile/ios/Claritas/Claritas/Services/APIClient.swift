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

    init(session: URLSession = .shared) {
        self.session = session

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
        return try await request(req, as: [AuthProvider].self, rootKey: "providers")
    }

    func fetchAuthMe() async throws -> AuthUser? {
        let url = baseURL.appendingPathComponent("/api/auth/me")
        var req = URLRequest(url: url)
        let (data, resp) = try await session.data(for: authedRequest(req))
        guard let http = resp as? HTTPURLResponse else { throw APIError(status: -1, message: "No HTTP response") }
        if http.statusCode == 401 {
            return nil
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw APIError(status: http.statusCode, message: message)
        }
        let container = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any]
        let value = container?["user"]
        let valueData = try JSONSerialization.data(withJSONObject: value ?? NSNull(), options: [])
        return try JSONDecoder.api.decode(AuthUser?.self, from: valueData)
    }

    func logout() async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/auth/logout"))
        req.httpMethod = "POST"
        _ = try await request(req, as: EmptyResponse.self)
    }

    func authStartURL(provider: AuthProviderId, redirect: URL) -> URL? {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/auth/\(provider.rawValue)/start"), resolvingAgainstBaseURL: false)
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
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw APIError(status: http.statusCode, message: message)
        }
        if let rootKey {
            let container = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any]
            let value = container?[rootKey]
            let valueData = try JSONSerialization.data(withJSONObject: value ?? NSNull(), options: [])
            return try JSONDecoder.api.decode(T.self, from: valueData)
        }
        return try JSONDecoder.api.decode(T.self, from: data)
    }

    private func authedRequest(_ req: URLRequest) -> URLRequest {
        guard let token = authToken, !token.isEmpty else { return req }
        var next = req
        next.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return next
    }
}

private struct EmptyResponse: Decodable {}

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
