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

enum IngestionPipeline: String, Codable, CaseIterable, Identifiable {
    case news
    case weather

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
}

struct AdminIngestionLog: Codable, Identifiable {
    let id: Int
    let run_id: Int
    let logged_at: String
    let level: IngestionLogLevel
    let message: String
    let context: JSONValue?
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
