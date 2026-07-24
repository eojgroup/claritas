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

struct PodcastSignal: Codable, Identifiable {
    let id: Int
    let type: String
    let title: String
    let summary: String?
    let entities: [String]
    let topics: [String]
    let countries: [String]
    let risk_level: String?
    let confidence: Double?

    enum CodingKeys: String, CodingKey {
        case id
        case type
        case title
        case summary
        case entities
        case topics
        case countries
        case risk_level
        case confidence
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleInt(forKey: .id)
        type = try container.decode(String.self, forKey: .type)
        title = try container.decode(String.self, forKey: .title)
        summary = try container.decodeIfPresent(String.self, forKey: .summary)
        entities = (try? container.decode([String].self, forKey: .entities)) ?? []
        topics = (try? container.decode([String].self, forKey: .topics)) ?? []
        countries = (try? container.decode([String].self, forKey: .countries)) ?? []
        risk_level = try container.decodeIfPresent(String.self, forKey: .risk_level)
        if let value = try? container.decode(Double.self, forKey: .confidence) {
            confidence = value
        } else if let text = try? container.decode(String.self, forKey: .confidence) {
            confidence = Double(text)
        } else {
            confidence = nil
        }
    }
}

struct PodcastEvidence: Codable, Identifiable {
    let id: Int
    let segment_index: Int
    let start_ms: Int
    let end_ms: Int?
    let speaker: String?
    let text: String
    let timing_method: String
    let source_url: String?
    let signals: [PodcastSignal]?

    enum CodingKeys: String, CodingKey {
        case id
        case segment_index
        case start_ms
        case end_ms
        case speaker
        case text
        case timing_method
        case source_url
        case signals
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleInt(forKey: .id)
        segment_index = try container.decodeFlexibleInt(forKey: .segment_index)
        start_ms = try container.decodeFlexibleInt(forKey: .start_ms)
        end_ms = try? container.decodeFlexibleInt(forKey: .end_ms)
        speaker = try container.decodeIfPresent(String.self, forKey: .speaker)
        text = try container.decode(String.self, forKey: .text)
        timing_method = (try? container.decode(String.self, forKey: .timing_method)) ?? "unknown"
        source_url = try container.decodeIfPresent(String.self, forKey: .source_url)
        signals = try container.decodeIfPresent([PodcastSignal].self, forKey: .signals)
    }

    var timestampLabel: String {
        let totalSeconds = max(0, start_ms / 1000)
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        let seconds = totalSeconds % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        }
        return String(format: "%d:%02d", minutes, seconds)
    }
}

struct PodcastExternalLink: Codable, Identifiable {
    let platform: String
    let label: String
    let url: String

    var id: String { "\(platform)-\(url)" }
    var resolvedURL: URL? { URL(string: url) }
}

struct PodcastEpisode: Codable, Identifiable {
    let id: Int
    let episode_id: Int
    let podcast_index_id: Int
    let title: String
    let summary: String?
    let url: String?
    let event_time: String?
    let feed_id: Int
    let podcast_index_feed_id: Int
    let feed_title: String
    let feed_author: String?
    let feed_image_url: String?
    let feed_site_url: String?
    let duration_seconds: Int?
    let image_url: String?
    let transcript_status: String
    let external_links: [PodcastExternalLink]
    let signals: [PodcastSignal]
    let evidence: [PodcastEvidence]

    enum CodingKeys: String, CodingKey {
        case id
        case episode_id
        case podcast_index_id
        case title
        case summary
        case url
        case event_time
        case feed_id
        case podcast_index_feed_id
        case feed_title
        case feed_author
        case feed_image_url
        case feed_site_url
        case duration_seconds
        case image_url
        case transcript_status
        case external_links
        case signals
        case evidence
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleInt(forKey: .id)
        episode_id = try container.decodeFlexibleInt(forKey: .episode_id)
        podcast_index_id = try container.decodeFlexibleInt(forKey: .podcast_index_id)
        title = try container.decode(String.self, forKey: .title)
        summary = try container.decodeIfPresent(String.self, forKey: .summary)
        url = try container.decodeIfPresent(String.self, forKey: .url)
        event_time = try container.decodeIfPresent(String.self, forKey: .event_time)
        feed_id = try container.decodeFlexibleInt(forKey: .feed_id)
        podcast_index_feed_id = try container.decodeFlexibleInt(forKey: .podcast_index_feed_id)
        feed_title = try container.decode(String.self, forKey: .feed_title)
        feed_author = try container.decodeIfPresent(String.self, forKey: .feed_author)
        feed_image_url = try container.decodeIfPresent(String.self, forKey: .feed_image_url)
        feed_site_url = try container.decodeIfPresent(String.self, forKey: .feed_site_url)
        duration_seconds = try? container.decodeFlexibleInt(forKey: .duration_seconds)
        image_url = try container.decodeIfPresent(String.self, forKey: .image_url)
        transcript_status = try container.decode(String.self, forKey: .transcript_status)
        external_links = (try? container.decode([PodcastExternalLink].self, forKey: .external_links)) ?? []
        signals = (try? container.decode([PodcastSignal].self, forKey: .signals)) ?? []
        evidence = (try? container.decode([PodcastEvidence].self, forKey: .evidence)) ?? []
    }

    var eventDate: Date? {
        guard let event_time else { return nil }
        return APIDateParser.parse(event_time)
    }

    var durationLabel: String? {
        guard let duration_seconds, duration_seconds > 0 else { return nil }
        let hours = duration_seconds / 3600
        let minutes = (duration_seconds % 3600) / 60
        return hours > 0 ? "\(hours)h \(minutes)m" : "\(max(minutes, 1))m"
    }
}

struct PodcastSummaryItem: Identifiable {
    let name: String
    let count: Int

    var id: String { name.lowercased() }
}

struct PodcastIntelligenceSummary {
    let episodes: Int
    let transcripts: Int
    let signals: Int
    let evidence: Int
    let risks: Int
    let elevatedRisks: Int
    let averageConfidence: Double?
    let leadingTopics: [PodcastSummaryItem]
    let leadingEntities: [PodcastSummaryItem]
    let leadingCountries: [PodcastSummaryItem]
    let dominantSignalType: PodcastSummaryItem?
    let prioritySignal: PodcastSignal?
    let conclusions: String

    static func make(from episodes: [PodcastEpisode]) -> PodcastIntelligenceSummary {
        let signals = episodes.flatMap(\.signals)
        let risks = signals.filter { $0.type == "risk" || $0.risk_level != nil }
        let elevatedRisks = risks.filter {
            guard let level = $0.risk_level?.lowercased() else { return false }
            return level == "high" || level == "critical"
        }
        let confidences = signals.compactMap(\.confidence)
        let topics = rankedLabels(signals.flatMap(\.topics))
        let entities = rankedLabels(signals.flatMap(\.entities))
        let countries = rankedLabels(signals.flatMap(\.countries))
        let signalTypes = rankedLabels(signals.map(\.type))
        let riskRank = ["critical": 4, "high": 3, "medium": 2, "low": 1]
        let prioritySignal = signals.sorted { left, right in
            let leftRank = riskRank[left.risk_level?.lowercased() ?? ""] ?? 0
            let rightRank = riskRank[right.risk_level?.lowercased() ?? ""] ?? 0
            if leftRank != rightRank {
                return leftRank > rightRank
            }
            return (left.confidence ?? 0) > (right.confidence ?? 0)
        }.first
        let theme = topics.first ?? entities.first ?? signalTypes.first

        let conclusions: String
        if signals.isEmpty {
            conclusions = "No extracted signals are available in the current podcast scope, so there is not yet enough structured evidence for an overall conclusion."
        } else {
            var statements: [String] = []
            if let theme {
                statements.append(
                    "\(theme.name) is the leading recurring theme, appearing in \(theme.count) extracted \(theme.count == 1 ? "signal" : "signals")."
                )
            } else {
                statements.append("\(signals.count) extracted signals define the current evidence set.")
            }

            if !elevatedRisks.isEmpty {
                statements.append(
                    "\(elevatedRisks.count) high or critical risk \(elevatedRisks.count == 1 ? "signal requires" : "signals require") priority review."
                )
            } else if !risks.isEmpty {
                statements.append(
                    "\(risks.count) risk \(risks.count == 1 ? "signal is" : "signals are") present, with none currently rated high or critical."
                )
            } else {
                statements.append("No explicit risk signals are present in the current scope.")
            }

            if let country = countries.first {
                statements.append("\(country.name) has the strongest geographic linkage across the podcast evidence.")
            } else {
                statements.append("The extracted findings do not yet show a dominant geographic concentration.")
            }
            conclusions = statements.joined(separator: " ")
        }

        return PodcastIntelligenceSummary(
            episodes: episodes.count,
            transcripts: episodes.filter { $0.transcript_status == "available" }.count,
            signals: signals.count,
            evidence: episodes.reduce(0) { $0 + $1.evidence.count },
            risks: risks.count,
            elevatedRisks: elevatedRisks.count,
            averageConfidence: confidences.isEmpty
                ? nil
                : confidences.reduce(0, +) / Double(confidences.count),
            leadingTopics: Array(topics.prefix(4)),
            leadingEntities: Array(entities.prefix(4)),
            leadingCountries: Array(countries.prefix(4)),
            dominantSignalType: signalTypes.first,
            prioritySignal: prioritySignal,
            conclusions: conclusions
        )
    }

    private static func rankedLabels(_ values: [String]) -> [PodcastSummaryItem] {
        var counts: [String: Int] = [:]
        var labels: [String: String] = [:]
        for value in values {
            let label = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !label.isEmpty else { continue }
            let key = label.lowercased()
            counts[key, default: 0] += 1
            labels[key] = labels[key] ?? label
        }
        return counts
            .map { key, count in
                PodcastSummaryItem(name: labels[key] ?? key, count: count)
            }
            .sorted {
                $0.count == $1.count
                    ? $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
                    : $0.count > $1.count
            }
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

struct CountryLeadershipRole: Codable, Identifiable {
    let role_type: String
    let person_name: String
    let person_wikidata_id: String
    let started_at: String?
    let source_url: String

    var id: String { "\(role_type)-\(person_wikidata_id)" }
    var startedDate: Date? {
        guard let started_at else { return nil }
        return APIDateParser.parse(started_at)
    }

    var roleLabel: String {
        role_type == "head_of_state" ? "Head of state" : "Head of government"
    }
}

struct CountryLeadership: Codable, Identifiable {
    let country: String
    let country_name: String
    let wikidata_country_id: String
    let government_type: String?
    let summary: String
    let roles: [CountryLeadershipRole]
    let source_name: String
    let source_url: String
    let source_license: String
    let source_updated_at: String?
    let retrieved_at: String

    var id: String { country }
    var sourceUpdatedDate: Date? {
        guard let source_updated_at else { return nil }
        return APIDateParser.parse(source_updated_at)
    }
    var retrievedDate: Date? { APIDateParser.parse(retrieved_at) }
}

struct DailySignalBriefing: Codable, Identifiable {
    let id: Int
    let briefing_date: String
    let title: String
    let update_text: String
    let key_takeaways: [String]
    let status: String
    let source_window_start: String?
    let source_window_end: String?
    let generated_by: String?
    let metadata: JSONValue?
    let published_at: String?
    let created_at: String
    let updated_at: String

    var updatedDate: Date? { APIDateParser.parse(updated_at) }

    enum CodingKeys: String, CodingKey {
        case id
        case briefing_date
        case title
        case update_text
        case key_takeaways
        case status
        case source_window_start
        case source_window_end
        case generated_by
        case metadata
        case published_at
        case created_at
        case updated_at
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleInt(forKey: .id)
        briefing_date = try container.decode(String.self, forKey: .briefing_date)
        title = try container.decode(String.self, forKey: .title)
        update_text = try container.decode(String.self, forKey: .update_text)
        key_takeaways = try container.decodeIfPresent([String].self, forKey: .key_takeaways) ?? []
        status = try container.decode(String.self, forKey: .status)
        source_window_start = try container.decodeIfPresent(String.self, forKey: .source_window_start)
        source_window_end = try container.decodeIfPresent(String.self, forKey: .source_window_end)
        generated_by = try container.decodeIfPresent(String.self, forKey: .generated_by)
        metadata = try container.decodeIfPresent(JSONValue.self, forKey: .metadata)
        published_at = try container.decodeIfPresent(String.self, forKey: .published_at)
        created_at = try container.decode(String.self, forKey: .created_at)
        updated_at = try container.decode(String.self, forKey: .updated_at)
    }
}

struct PersonalDailyBriefing: Codable, Identifiable {
    let id: Int
    let briefing_date: String
    let title: String
    let update_text: String
    let key_takeaways: [String]
    let generated_by: String?
    let delivery_status: String?
    let sent_at: String?
    let created_at: String
    let updated_at: String

    var updatedDate: Date? { APIDateParser.parse(updated_at) }
    var sentDate: Date? { sent_at.flatMap(APIDateParser.parse) }

    enum CodingKeys: String, CodingKey {
        case id, briefing_date, title, update_text, key_takeaways, generated_by
        case delivery_status, sent_at, created_at, updated_at
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleInt(forKey: .id)
        briefing_date = try container.decode(String.self, forKey: .briefing_date)
        title = try container.decode(String.self, forKey: .title)
        update_text = try container.decode(String.self, forKey: .update_text)
        key_takeaways = try container.decodeIfPresent([String].self, forKey: .key_takeaways) ?? []
        generated_by = try container.decodeIfPresent(String.self, forKey: .generated_by)
        delivery_status = try container.decodeIfPresent(String.self, forKey: .delivery_status)
        sent_at = try container.decodeIfPresent(String.self, forKey: .sent_at)
        created_at = try container.decode(String.self, forKey: .created_at)
        updated_at = try container.decode(String.self, forKey: .updated_at)
    }
}

struct DailyBriefingSchedule: Codable, Identifiable {
    let user_id: Int
    let enabled: Bool
    let scheduled_time: String
    let timezone: String
    let last_scheduled_for: String?
    let last_triggered_at: String?
    let last_job_id: String?
    let created_at: String
    let updated_at: String

    var id: Int { user_id }
    var lastTriggeredDate: Date? {
        guard let last_triggered_at else { return nil }
        return APIDateParser.parse(last_triggered_at)
    }

    enum CodingKeys: String, CodingKey {
        case user_id
        case enabled
        case scheduled_time
        case timezone
        case last_scheduled_for
        case last_triggered_at
        case last_job_id
        case created_at
        case updated_at
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        user_id = try container.decodeFlexibleInt(forKey: .user_id)
        enabled = try container.decode(Bool.self, forKey: .enabled)
        scheduled_time = try container.decode(String.self, forKey: .scheduled_time)
        timezone = try container.decode(String.self, forKey: .timezone)
        last_scheduled_for = try container.decodeIfPresent(String.self, forKey: .last_scheduled_for)
        last_triggered_at = try container.decodeIfPresent(String.self, forKey: .last_triggered_at)
        last_job_id = try container.decodeIfPresent(String.self, forKey: .last_job_id)
        created_at = try container.decode(String.self, forKey: .created_at)
        updated_at = try container.decode(String.self, forKey: .updated_at)
    }
}

enum DailyBriefingScheduleOptions {
    static let timezones = [
        "UTC",
        "Africa/Tunis",
        "Africa/Cairo",
        "Africa/Johannesburg",
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "America/Toronto",
        "America/Mexico_City",
        "America/Sao_Paulo",
        "Europe/London",
        "Europe/Paris",
        "Europe/Berlin",
        "Europe/Madrid",
        "Europe/Rome",
        "Europe/Amsterdam",
        "Europe/Zurich",
        "Europe/Istanbul",
        "Asia/Dubai",
        "Asia/Kolkata",
        "Asia/Singapore",
        "Asia/Hong_Kong",
        "Asia/Tokyo",
        "Asia/Seoul",
        "Australia/Sydney",
        "Pacific/Auckland"
    ]

    static func timezoneOptions(including selected: String?) -> [String] {
        var seen = Set<String>()
        var options: [String] = []

        func append(_ timezone: String?) {
            guard let timezone = timezone?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !timezone.isEmpty,
                  TimeZone(identifier: timezone) != nil,
                  !seen.contains(timezone) else {
                return
            }
            seen.insert(timezone)
            options.append(timezone)
        }

        append(selected)
        append(TimeZone.current.identifier)
        timezones.forEach(append)
        return options
    }
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
    case podcasts
    case leadership

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
