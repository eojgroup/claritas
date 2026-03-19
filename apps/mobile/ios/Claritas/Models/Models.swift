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

struct BillingPlanRef: Codable {
    let id: Int
    let code: String
    let name: String
    let price_cents: Int
    let currency: String
    let interval_unit: String

    enum CodingKeys: String, CodingKey {
        case id
        case code
        case name
        case price_cents
        case currency
        case interval_unit
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleInt(forKey: .id)
        code = try container.decode(String.self, forKey: .code)
        name = try container.decode(String.self, forKey: .name)
        price_cents = try container.decodeFlexibleInt(forKey: .price_cents)
        currency = try container.decode(String.self, forKey: .currency)
        interval_unit = try container.decode(String.self, forKey: .interval_unit)
    }
}

struct BillingSubscription: Codable {
    let id: Int
    let status: String
    let provider: String
    let started_at: String
    let current_period_end: String?
    let canceled_at: String?
    let plan: BillingPlanRef

    enum CodingKeys: String, CodingKey {
        case id
        case status
        case provider
        case started_at
        case current_period_end
        case canceled_at
        case plan
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleInt(forKey: .id)
        status = try container.decode(String.self, forKey: .status)
        provider = try container.decode(String.self, forKey: .provider)
        started_at = try container.decode(String.self, forKey: .started_at)
        current_period_end = try container.decodeIfPresent(String.self, forKey: .current_period_end)
        canceled_at = try container.decodeIfPresent(String.self, forKey: .canceled_at)
        plan = try container.decode(BillingPlanRef.self, forKey: .plan)
    }
}

struct BillingAccessState: Codable {
    let paywall_enabled: Bool
    let has_access: Bool
    let reason: String
    let checkout_url: String?
    let portal_url: String?
    let subscription: BillingSubscription?
}

struct AuthUser: Codable {
    let id: Int
    let email: String?
    let display_name: String?
    let avatar_url: String?
    let roles: [String]?
    let billing: BillingAccessState?
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
    let weather_desc: String?
    let wind_speed: Double?
    let source_name: String?
    let icon_code: String?
    var id: String { country + observed_at }
    var observedDate: Date? { APIDateParser.parse(observed_at) }
}

struct MarketQuote: Codable, Identifiable {
    let symbol: String
    let company_name: String?
    let exchange: String?
    let country: String?
    let currency: String?
    let market_code: String?
    let market_name: String?
    let market_kind: String?
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
        case market_code
        case market_name
        case market_kind
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

struct MarketStatus: Codable, Identifiable {
    let exchange: String
    let is_open: Bool?
    let session: String?
    let holiday: String?
    let timezone: String?
    let observed_at: String?
    let error: String?
    let payload: JSONValue?

    var id: String { exchange }
    var observedDate: Date? {
        guard let observed_at else { return nil }
        return APIDateParser.parse(observed_at)
    }
}

struct EarningsEvent: Codable, Identifiable {
    let symbol: String
    let date: String?
    let hour: String?
    let quarter: Int?
    let year: Int?
    let eps_actual: Double?
    let eps_estimate: Double?
    let revenue_actual: Double?
    let revenue_estimate: Double?
    let country: String?
    let market_code: String?
    let market_name: String?
    let payload: JSONValue?

    var id: String { "\(symbol)-\(date ?? "na")-\(hour ?? "na")-\(year ?? 0)-\(quarter ?? 0)" }
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
    let subscription: AdminUserSubscription?

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
        case subscription
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
        subscription = try container.decodeIfPresent(AdminUserSubscription.self, forKey: .subscription)
    }
}

struct AdminUsersResponse: Codable {
    let users: [AdminUser]
    let total: Int
    let limit: Int
    let offset: Int
}

struct AdminBillingPlan: Codable, Identifiable {
    let id: Int
    let code: String
    let name: String
    let description: String?
    let price_cents: Int
    let currency: String
    let interval_unit: String
    let is_active: Bool
    let metadata: JSONValue?

    enum CodingKeys: String, CodingKey {
        case id
        case code
        case name
        case description
        case price_cents
        case currency
        case interval_unit
        case is_active
        case metadata
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleInt(forKey: .id)
        code = try container.decode(String.self, forKey: .code)
        name = try container.decode(String.self, forKey: .name)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        price_cents = try container.decodeFlexibleInt(forKey: .price_cents)
        currency = try container.decode(String.self, forKey: .currency)
        interval_unit = try container.decode(String.self, forKey: .interval_unit)
        is_active = try container.decode(Bool.self, forKey: .is_active)
        metadata = try container.decodeIfPresent(JSONValue.self, forKey: .metadata)
    }
}

struct AdminUserSubscriptionPlan: Codable {
    let code: String?
    let name: String?
}

struct AdminUserSubscription: Codable {
    let id: Int
    let status: String?
    let provider: String?
    let started_at: String?
    let current_period_end: String?
    let canceled_at: String?
    let plan: AdminUserSubscriptionPlan?

    enum CodingKeys: String, CodingKey {
        case id
        case status
        case provider
        case started_at
        case current_period_end
        case canceled_at
        case plan
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleInt(forKey: .id)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        provider = try container.decodeIfPresent(String.self, forKey: .provider)
        started_at = try container.decodeIfPresent(String.self, forKey: .started_at)
        current_period_end = try container.decodeIfPresent(String.self, forKey: .current_period_end)
        canceled_at = try container.decodeIfPresent(String.self, forKey: .canceled_at)
        plan = try container.decodeIfPresent(AdminUserSubscriptionPlan.self, forKey: .plan)
    }
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

struct AdminIngestionAutomationRule: Codable, Identifiable {
    var id: String { pipeline.rawValue }
    let pipeline: IngestionPipeline
    let enabled: Bool
    let schedule_enabled: Bool
    let schedule_interval_minutes: Int
    let intelligent_enabled: Bool
    let min_spacing_minutes: Int
    let freshness_sla_minutes: Int
    let demand_window_minutes: Int
    let demand_threshold: Int
    let failure_backoff_minutes: Int
    let next_scheduled_at: String?
    let last_evaluated_at: String?
    let last_triggered_at: String?
    let last_trigger_reason: String?
    let last_error: String?
    let default_payload: JSONValue?
    let created_at: String
    let updated_at: String
}

struct AdminIngestionAutomationStatus: Codable, Identifiable {
    var id: String { pipeline.rawValue }
    let pipeline: IngestionPipeline
    let last_run_at: String?
    let last_success_at: String?
    let last_failure_at: String?
    let latest_data_at: String?
    let data_age_minutes: Int?
    let demand_requests: Int
    let active_runs: Int
}

struct AdminIngestionAutomationResponse: Codable {
    let poll_seconds: Int
    let rules: [AdminIngestionAutomationRule]
    let status: [AdminIngestionAutomationStatus]
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
    var number: Double? { if case .number(let n) = self { return n } else { return nil } }
    var object: [String: JSONValue]? { if case .object(let o) = self { return o } else { return nil } }
    var bool: Bool? { if case .bool(let b) = self { return b } else { return nil } }
    var foundationObject: Any {
        switch self {
        case .string(let s):
            return s
        case .number(let n):
            return n
        case .object(let o):
            return o.mapValues { $0.foundationObject }
        case .array(let a):
            return a.map { $0.foundationObject }
        case .bool(let b):
            return b
        case .null:
            return NSNull()
        }
    }
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
