import Foundation

enum AuthProviderId: String, Codable, CaseIterable, Identifiable {
    case google
    case microsoft
    case apple

    var id: String { rawValue }
}

struct AuthProvider: Codable, Identifiable {
    let id: AuthProviderId
    let enabled: Bool
    let display_name: String?
    let icon: String?
    let start_path: String?
}

struct AuthUser: Codable {
    let id: Int
    let email: String?
    let display_name: String?
    let avatar_url: String?
    let roles: [String]?
}

struct NewsItem: Codable, Identifiable {
    let id: Int
    let kind: String?
    let source_name: String?
    let title: String?
    let summary: String?
    let url: String?
    let country_iso2: String?
    let event_time: String?
    let payload: JSONValue?

    var eventDate: Date? {
        guard let s = event_time else { return nil }
        return APIDateParser.parse(s)
    }

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case source_name
        case title
        case summary
        case url
        case country_iso2
        case event_time
        case payload
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleInt(forKey: .id)
        kind = try container.decodeIfPresent(String.self, forKey: .kind)
        source_name = try container.decodeIfPresent(String.self, forKey: .source_name)
        title = try container.decodeIfPresent(String.self, forKey: .title)
        summary = try container.decodeIfPresent(String.self, forKey: .summary)
        url = try container.decodeIfPresent(String.self, forKey: .url)
        country_iso2 = try container.decodeIfPresent(String.self, forKey: .country_iso2)
        event_time = try container.decodeIfPresent(String.self, forKey: .event_time)
        payload = try container.decodeIfPresent(JSONValue.self, forKey: .payload)
    }
}

struct CountryStat: Codable, Identifiable {
    let country: String
    let count: Int
    var id: String { country }
}

struct CountryWeather: Codable, Identifiable {
    let country: String
    let temp_c: Double?
    let humidity: Double?
    let observed_at: String
    let weather_main: String?
    var id: String { country + observed_at }
    var observedDate: Date? { APIDateParser.parse(observed_at) }
}

struct MarketQuote: Codable, Identifiable {
    let symbol: String
    let company_name: String?
    let exchange: String?
    let country: String?
    let currency: String?
    let price: Double?
    let change: Double?
    let percent_change: Double?
    let high_price: Double?
    let low_price: Double?
    let open_price: Double?
    let previous_close: Double?
    let observed_at: String
    let payload: JSONValue?

    var id: String { "\(symbol)-\(observed_at)" }
    var observedDate: Date? { APIDateParser.parse(observed_at) }

    enum CodingKeys: String, CodingKey {
        case symbol
        case company_name
        case exchange
        case country
        case currency
        case price
        case change
        case percent_change
        case high_price
        case low_price
        case open_price
        case previous_close
        case observed_at
        case payload
    }
}

enum IngestionPipeline: String, Codable, CaseIterable, Identifiable {
    case news
    case weather
    case market

    var id: String { rawValue }
}

enum IngestionRunStatus: String, Codable {
    case queued
    case running
    case success
    case failed
    case unknown

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = (try? container.decode(String.self)) ?? ""
        self = IngestionRunStatus(rawValue: raw) ?? .unknown
    }
}

enum IngestionLogLevel: String, Codable {
    case info
    case warn
    case error

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = (try? container.decode(String.self)) ?? ""
        self = IngestionLogLevel(rawValue: raw) ?? .info
    }
}

struct AdminRole: Codable, Identifiable {
    let id: Int
    let key: String
    let description: String?
    let user_count: Int

    enum CodingKeys: String, CodingKey {
        case id
        case key
        case description
        case user_count
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleInt(forKey: .id)
        key = try container.decode(String.self, forKey: .key)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        user_count = try container.decodeFlexibleInt(forKey: .user_count)
    }
}

struct AdminUser: Codable, Identifiable {
    let id: Int
    let email: String?
    let display_name: String?
    let avatar_url: String?
    let is_active: Bool
    let created_at: String
    let updated_at: String
    let roles: [String]
    let providers: [String]
    let last_seen_at: String?

    enum CodingKeys: String, CodingKey {
        case id
        case email
        case display_name
        case avatar_url
        case is_active
        case created_at
        case updated_at
        case roles
        case providers
        case last_seen_at
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleInt(forKey: .id)
        email = try container.decodeIfPresent(String.self, forKey: .email)
        display_name = try container.decodeIfPresent(String.self, forKey: .display_name)
        avatar_url = try container.decodeIfPresent(String.self, forKey: .avatar_url)
        is_active = try container.decode(Bool.self, forKey: .is_active)
        created_at = try container.decode(String.self, forKey: .created_at)
        updated_at = try container.decode(String.self, forKey: .updated_at)
        roles = try container.decodeIfPresent([String].self, forKey: .roles) ?? []
        providers = try container.decodeIfPresent([String].self, forKey: .providers) ?? []
        last_seen_at = try container.decodeIfPresent(String.self, forKey: .last_seen_at)
    }
}

struct AdminUsersResponse: Codable {
    let users: [AdminUser]
    let total: Int
    let limit: Int
    let offset: Int
}

struct AdminIngestionRun: Codable, Identifiable {
    let id: Int
    let pipeline: IngestionPipeline
    let source_name: String
    let status: IngestionRunStatus
    let started_at: String
    let finished_at: String?
    let error: String?
    let stats: JSONValue?
    let trigger_mode: String?
    let requested_by_email: String?
    let request_payload: JSONValue?
    let log_count: Int

    enum CodingKeys: String, CodingKey {
        case id
        case pipeline
        case source_name
        case status
        case started_at
        case finished_at
        case error
        case stats
        case trigger_mode
        case requested_by_email
        case request_payload
        case log_count
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleInt(forKey: .id)
        pipeline = try container.decode(IngestionPipeline.self, forKey: .pipeline)
        source_name = try container.decode(String.self, forKey: .source_name)
        status = try container.decode(IngestionRunStatus.self, forKey: .status)
        started_at = try container.decode(String.self, forKey: .started_at)
        finished_at = try container.decodeIfPresent(String.self, forKey: .finished_at)
        error = try container.decodeIfPresent(String.self, forKey: .error)
        stats = try container.decodeIfPresent(JSONValue.self, forKey: .stats)
        trigger_mode = try container.decodeIfPresent(String.self, forKey: .trigger_mode)
        requested_by_email = try container.decodeIfPresent(String.self, forKey: .requested_by_email)
        request_payload = try container.decodeIfPresent(JSONValue.self, forKey: .request_payload)
        log_count = (try? container.decodeFlexibleInt(forKey: .log_count)) ?? 0
    }
}

struct AdminIngestionLog: Codable, Identifiable {
    let id: Int
    let run_id: Int
    let logged_at: String
    let level: IngestionLogLevel
    let message: String
    let context: JSONValue?

    enum CodingKeys: String, CodingKey {
        case id
        case run_id
        case logged_at
        case level
        case message
        case context
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleInt(forKey: .id)
        run_id = try container.decodeFlexibleInt(forKey: .run_id)
        logged_at = try container.decode(String.self, forKey: .logged_at)
        level = try container.decode(IngestionLogLevel.self, forKey: .level)
        message = try container.decode(String.self, forKey: .message)
        context = try container.decodeIfPresent(JSONValue.self, forKey: .context)
    }
}

struct AdminIngestionRunDetail: Codable {
    let run: AdminIngestionRun
    let logs: [AdminIngestionLog]
}

struct AdminIngestionMetricsPoint: Codable, Identifiable {
    var id: String { "\(date)-\(pipeline.rawValue)" }
    let date: String
    let pipeline: IngestionPipeline
    let run_count: Int
    let success_count: Int
    let failed_count: Int
    let queued_count: Int
    let running_count: Int
    let inserted: Int
    let updated: Int
    let skipped: Int
    let http_failures: Int
    let db_errors: Int
}

struct AdminIngestionMetricsTotal: Codable, Identifiable {
    var id: String { pipeline.rawValue }
    let pipeline: IngestionPipeline
    let run_count: Int
    let success_count: Int
    let failed_count: Int
    let queued_count: Int
    let running_count: Int
    let inserted: Int
    let updated: Int
    let skipped: Int
    let http_failures: Int
    let db_errors: Int
}

struct AdminIngestionMetricsResponse: Codable {
    let days: Int
    let points: [AdminIngestionMetricsPoint]
    let totals: [AdminIngestionMetricsTotal]
}

// JSON dynamic value to capture `payload` flexibly
enum JSONValue: Codable {
    case string(String)
    case number(Double)
    case object([String: JSONValue])
    case array([JSONValue])
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        throw DecodingError.typeMismatch(JSONValue.self, .init(codingPath: decoder.codingPath, debugDescription: "Unsupported JSON value"))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        case .null: try c.encodeNil()
        }
    }

    var string: String? { if case .string(let s) = self { return s } else { return nil } }
    var object: [String: JSONValue]? { if case .object(let o) = self { return o } else { return nil } }
    var bool: Bool? { if case .bool(let b) = self { return b } else { return nil } }
}

enum APIDateParser {
    private static let withFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let withoutFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parse(_ value: String) -> Date? {
        if let d = withFractional.date(from: value) { return d }
        return withoutFractional.date(from: value)
    }
}

private extension KeyedDecodingContainer {
    func decodeFlexibleInt(forKey key: Key) throws -> Int {
        if let value = try? decode(Int.self, forKey: key) {
            return value
        }
        if let value64 = try? decode(Int64.self, forKey: key),
           let value = Int(exactly: value64) {
            return value
        }
        if let value = try? decode(Double.self, forKey: key),
           value.isFinite {
            let rounded = Int(value.rounded())
            if Double(rounded) == value {
                return rounded
            }
        }
        if let text = try? decode(String.self, forKey: key) {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if let value = Int(trimmed) {
                return value
            }
            if let value64 = Int64(trimmed),
               let value = Int(exactly: value64) {
                return value
            }
            if let value = Double(trimmed),
               value.isFinite {
                let rounded = Int(value.rounded())
                if Double(rounded) == value {
                    return rounded
                }
            }
        }
        throw DecodingError.dataCorruptedError(forKey: key, in: self, debugDescription: "Expected integer-compatible value.")
    }
}
