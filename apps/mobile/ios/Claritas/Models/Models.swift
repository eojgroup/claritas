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

enum ClaritasInterfaceLanguage {
    // Keep the presentation language in one place so adding another supported
    // interface language does not change the source-news data model.
    static let current = "en"
}

struct NewsTranslation: Codable {
    let target_language_code: String
    let headline_kind: String?
    let summary_kind: String?
    let summary_status: String
    let provider: String
    let model: String?
    let title_generated_at: String?
    let summary_generated_at: String?
    let source_content_preserved: Bool?
    let article_body_used: Bool?
}

struct NewsLinkedEvent: Codable, Identifiable {
    let id: String
    let title: String
    let event_type: String
    let status: String
    let severity: String
    let confidence: Double
    let relevance_score: Double
    let domain_count: Int
    let evidence_count: Int
    let domains: [String]
    let correlation_score: Double?
    // The API keeps the governed correlation components alongside the link.
    // Preserve them so the UI can explain the link without turning a score
    // into an unsupported causal claim.
    let correlation_factors: JSONValue?
    let earth_observation_state: String
    let best_thumbnail_url: String?
}

struct NewsCategoryOption: Identifiable, Hashable {
    let code: String
    let label: String
    let count: Int?
    var id: String { code }

    init(code: String, label: String, count: Int? = nil) {
        self.code = code
        self.label = label
        self.count = count
    }

    var isKnownEmpty: Bool {
        count == 0
    }
}

enum NewsCategoryCatalog {
    static let allCode = "all"
    static let options: [NewsCategoryOption] = [
        .init(code: allCode, label: "All categories"),
        .init(code: "markets", label: "Markets"),
        .init(code: "economy", label: "Economy"),
        .init(code: "companies", label: "Companies"),
        .init(code: "geopolitics", label: "Geopolitics"),
        .init(code: "policy", label: "Policy"),
        .init(code: "energy", label: "Energy"),
        .init(code: "technology", label: "Technology"),
        .init(code: "climate_disasters", label: "Climate & disasters"),
        .init(code: "health", label: "Health"),
        .init(code: "transport", label: "Transport"),
        .init(code: "other", label: "Other")
    ]

    static func normalized(_ value: String?) -> String {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              options.contains(where: { $0.code == value }) else {
            return allCode
        }
        return value
    }

    static func label(for code: String?) -> String {
        let normalized = code?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return options.first(where: { $0.code == normalized })?.label
            ?? normalized?.replacingOccurrences(of: "_", with: " ").capitalized
            ?? "Other"
    }

    static func options(
        facets: [NewsCategoryFacet],
        allCount: Int?,
        metadataIncluded: Bool
    ) -> [NewsCategoryOption] {
        guard metadataIncluded else { return options }
        let counts = Dictionary(
            facets.map { ($0.category, max(0, $0.count)) },
            uniquingKeysWith: { _, latest in latest }
        )
        return options.map { option in
            NewsCategoryOption(
                code: option.code,
                label: option.label,
                count: option.code == allCode ? allCount : (counts[option.code] ?? 0)
            )
        }
    }
}

struct NewsCategoryFacet: Codable, Hashable, Identifiable {
    let category: String
    let count: Int
    var id: String { category }

    enum CodingKeys: String, CodingKey {
        case category, count
    }

    init(category: String, count: Int) {
        self.category = category.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        self.count = max(0, count)
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        category = try container.decode(String.self, forKey: .category)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        count = max(0, try container.decodeFlexibleInt(forKey: .count))
    }
}

struct NewsFacets: Codable {
    let categories: [NewsCategoryFacet]

    enum CodingKeys: String, CodingKey {
        case categories
    }

    init(categories: [NewsCategoryFacet] = []) {
        self.categories = categories
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        categories = try container.decodeIfPresent([NewsCategoryFacet].self, forKey: .categories) ?? []
    }
}

struct NewsRankingMetadata: Codable {
    let methodology: String?
    let sort: String?
    let category: String?
    let archive: Bool?
    let assessed_at: String?
    let unassessed_count: Int?
    let selected_unassessed_count: Int?
    let diversification: String?

    enum CodingKeys: String, CodingKey {
        case methodology, sort, category, archive, assessed_at, unassessed_count, selected_unassessed_count, diversification
    }

    init(
        methodology: String? = nil,
        sort: String? = nil,
        category: String? = nil,
        archive: Bool? = nil,
        assessedAt: String? = nil,
        unassessedCount: Int? = nil,
        selectedUnassessedCount: Int? = nil,
        diversification: String? = nil
    ) {
        self.methodology = methodology
        self.sort = sort
        self.category = category
        self.archive = archive
        self.assessed_at = assessedAt
        self.unassessed_count = unassessedCount
        self.selected_unassessed_count = selectedUnassessedCount
        self.diversification = diversification
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        methodology = try container.decodeIfPresent(String.self, forKey: .methodology)
        sort = try container.decodeIfPresent(String.self, forKey: .sort)
        category = try container.decodeIfPresent(String.self, forKey: .category)
        archive = try container.decodeIfPresent(Bool.self, forKey: .archive)
        assessed_at = try container.decodeIfPresent(String.self, forKey: .assessed_at)
        unassessed_count = try container.decodeFlexibleIntIfPresent(forKey: .unassessed_count)
        selected_unassessed_count = try container.decodeFlexibleIntIfPresent(forKey: .selected_unassessed_count)
        diversification = try container.decodeIfPresent(String.self, forKey: .diversification)
    }
}

struct NewsPageMetadata: Codable {
    let limit: Int?
    let offset: Int?
    let total: Int?
    let metadata_included: Bool?

    enum CodingKeys: String, CodingKey {
        case limit, offset, total, metadata_included
    }

    init(limit: Int? = nil, offset: Int? = nil, total: Int? = nil, metadataIncluded: Bool? = nil) {
        self.limit = limit
        self.offset = offset
        self.total = total
        self.metadata_included = metadataIncluded
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        limit = try container.decodeFlexibleIntIfPresent(forKey: .limit)
        offset = try container.decodeFlexibleIntIfPresent(forKey: .offset)
        total = try container.decodeFlexibleIntIfPresent(forKey: .total)
        metadata_included = try container.decodeIfPresent(Bool.self, forKey: .metadata_included)
    }
}

struct NewsTag: Codable, Hashable, Identifiable {
    let code: String
    let label: String
    let kind: String
    var id: String { "\(kind):\(code)" }

    enum CodingKeys: String, CodingKey {
        case code, label, kind
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedLabel = try container.decodeIfPresent(String.self, forKey: .label)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let decodedCode = try container.decodeIfPresent(String.self, forKey: .code)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        label = decodedLabel.flatMap { $0.isEmpty ? nil : $0 }
            ?? decodedCode.flatMap { $0.isEmpty ? nil : $0 }
            ?? "Tag"
        code = decodedCode.flatMap { $0.isEmpty ? nil : $0 }
            ?? label.lowercased().replacingOccurrences(of: " ", with: "_")
        kind = (try container.decodeIfPresent(String.self, forKey: .kind)) ?? "topic"
    }
}

struct NewsImportanceReason: Codable, Hashable, Identifiable {
    let code: String
    let label: String
    var id: String { code }

    enum CodingKeys: String, CodingKey {
        case code, label
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedLabel = try container.decodeIfPresent(String.self, forKey: .label)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let decodedCode = try container.decodeIfPresent(String.self, forKey: .code)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        label = decodedLabel.flatMap { $0.isEmpty ? nil : $0 }
            ?? decodedCode.flatMap { $0.isEmpty ? nil : $0 }
            ?? "Priority context"
        code = decodedCode.flatMap { $0.isEmpty ? nil : $0 }
            ?? label.lowercased().replacingOccurrences(of: " ", with: "_")
    }
}

struct NewsImportance: Codable, Hashable {
    let score: Double?
    let tier: String?
    let confidence: Double?
    let reasons: [NewsImportanceReason]
    let methodology: String?
    let calculated_at: String?
    let is_fallback: Bool?

    enum CodingKeys: String, CodingKey {
        case score, tier, confidence, reasons, methodology, calculated_at, is_fallback
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        score = try container.decodeIfPresent(Double.self, forKey: .score)
        tier = try container.decodeIfPresent(String.self, forKey: .tier)
        confidence = try container.decodeIfPresent(Double.self, forKey: .confidence)
        reasons = try container.decodeIfPresent([NewsImportanceReason].self, forKey: .reasons) ?? []
        methodology = try container.decodeIfPresent(String.self, forKey: .methodology)
        calculated_at = try container.decodeIfPresent(String.self, forKey: .calculated_at)
        is_fallback = try container.decodeIfPresent(Bool.self, forKey: .is_fallback)
    }
}

enum IntelligenceLinkagePresentation {
    private static func number(_ value: JSONValue?) -> Double? {
        if let number = value?.number { return number }
        guard let text = value?.string else { return nil }
        return Double(text.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private static func factor(_ key: String, in factors: JSONValue?) -> Double {
        number(factors?.object?[key]) ?? 0
    }

    private static func text(_ key: String, in factors: JSONValue?) -> String? {
        guard let value = factors?.object?[key]?.string?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else { return nil }
        return value
    }

    static func decision(in factors: JSONValue?) -> String? {
        factors?.object?["decision"]?.string?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Returns only correlation inputs that were actually recorded by the
    /// service. Country and time are normally supporting context; the one
    /// exception is the governed news fallback for exactly one major
    /// same-family event in that country and time window.
    static func reasons(for factors: JSONValue?) -> [String] {
        guard factors?.object != nil else { return [] }
        var anchorReasons: [String] = []
        var supportingReasons: [String] = []
        if factor("location", in: factors) >= 1 { anchorReasons.append("the same mapped location") }
        if factor("spatial", in: factors) >= 0.45 { anchorReasons.append("a nearby mapped area") }
        if factor("entity", in: factors) >= 0.5 { anchorReasons.append("shared named entities") }
        if factors?.object?["unique_country_candidate"]?.bool == true,
           factor("country", in: factors) >= 1,
           factor("event_type", in: factors) >= 1 {
            anchorReasons.append("the only major same-family event in the country and time window")
        }
        if factor("country", in: factors) >= 1 { supportingReasons.append("the same country as supporting context") }
        if factor("temporal", in: factors) >= 0.5 { supportingReasons.append("nearby timing") }
        // A shared country or clock alone is useful context but never a
        // reader-facing justification for calling a record likely linked.
        return anchorReasons.isEmpty ? [] : anchorReasons + supportingReasons
    }

    static func label(for factors: JSONValue?) -> String {
        switch decision(in: factors) {
        case "attached": return "LIKELY LINKED EVENT"
        case "created": return "EVENT SOURCE"
        default: return reasons(for: factors).isEmpty ? "LINKED EVENT" : "LIKELY LINKED EVENT"
        }
    }

    static func explanation(for factors: JSONValue?) -> String {
        switch decision(in: factors) {
        case "created":
            return "This source record starts the evidence thread for this investigation."
        case "attached":
            let reasons = reasons(for: factors)
            if let rationale = text("rationale", in: factors) { return rationale }
            if !reasons.isEmpty {
                return "Likely linked because it shares \(readableList(reasons))."
            }
            return "This source record met the investigation’s governed linkage threshold."
        default:
            let reasons = reasons(for: factors)
            if !reasons.isEmpty {
                return "Linked through \(readableList(reasons))."
            }
            return "This source record is attached to this investigation; it does not establish causation."
        }
    }

    private static func readableList(_ values: [String]) -> String {
        switch values.count {
        case 0: return "recorded evidence"
        case 1: return values[0]
        case 2: return "\(values[0]) and \(values[1])"
        default: return "\(values.dropLast().joined(separator: ", ")), and \(values.last ?? "recorded evidence")"
        }
    }
}

struct NewsItem: Codable, Identifiable {
    let id: Int
    let kind: String?
    let source_name: String?
    let title: String?
    let summary: String?
    let url: String?
    let country_iso2: String?
    let countries: [String]
    let language_code: String?
    let source_country_iso2: String?
    let tone: Double?
    let event_time: String?
    let time: NewsTimeEvidence?
    let payload: JSONValue?
    let translated_title: String?
    let ai_summary: String?
    let translation: NewsTranslation?
    let linked_events: [NewsLinkedEvent]
    let publisher: String?
    let primary_category: String?
    let categories: [String]
    let tags: [NewsTag]
    let importance: NewsImportance?

    var presentationTitle: String {
        nonBlank(translated_title) ?? nonBlank(title) ?? nonBlank(url) ?? "Untitled"
    }

    var presentationSummary: String? {
        if let generated = nonBlank(ai_summary) { return generated }
        return requiresTranslation ? nil : nonBlank(summary)
    }

    var requiresTranslation: Bool {
        guard let source = normalizedLanguage(language_code) else { return false }
        guard let target = normalizedLanguage(ClaritasInterfaceLanguage.current) else { return false }
        return source.split(separator: "-").first != target.split(separator: "-").first
    }

    var hasAITranslatedHeadline: Bool {
        requiresTranslation && nonBlank(translated_title) != nil && translation != nil
    }

    var translationDisclosure: String? {
        guard hasAITranslatedHeadline, let translation else { return nil }
        let source = language_code?.uppercased() ?? "SOURCE"
        let target = translation.target_language_code.uppercased()
        return "AI translation · \(source)→\(target)"
    }

    var eventDate: Date? {
        guard let s = event_time else { return nil }
        return APIDateParser.parse(s)
    }

    var subjectCountries: [String] {
        let decoded = countries.compactMap { value -> String? in
            let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            return normalized.range(of: "^[A-Z]{2}$", options: .regularExpression) != nil ? normalized : nil
        }
        if !decoded.isEmpty { return Array(Set(decoded)).sorted() }
        guard let primary = country_iso2?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
              primary.range(of: "^[A-Z]{2}$", options: .regularExpression) != nil else { return [] }
        return [primary]
    }

    func hasSubjectCountry(_ iso2: String?) -> Bool {
        guard let iso2 else { return false }
        return subjectCountries.contains(iso2.trimmingCharacters(in: .whitespacesAndNewlines).uppercased())
    }

    var timeBasis: String? {
        if let basis = time?.basis.trimmingCharacters(in: .whitespacesAndNewlines), !basis.isEmpty {
            return basis
        }
        return payload?.object?["time_basis"]?.string
    }

    var primaryCategoryLabel: String {
        if importance?.is_fallback == true { return "Category pending" }
        return NewsCategoryCatalog.label(for: primary_category ?? categories.first)
    }

    var importanceTierLabel: String? {
        if importance?.is_fallback == true { return "Unranked" }
        guard let tier = importance?.tier?.trimmingCharacters(in: .whitespacesAndNewlines), !tier.isEmpty else {
            return nil
        }
        return tier.replacingOccurrences(of: "_", with: " ").capitalized
    }

    var primaryImportanceReason: String? {
        if importance?.is_fallback == true {
            return importance?.reasons.first?.label ?? "Automated assessment pending"
        }
        return importance?.reasons.first?.label
    }

    /// Keeps the most decision-useful tags visible when category tags arrive first.
    /// Duplicate codes retain their first payload occurrence, matching the web client.
    var presentationTags: [NewsTag] {
        let priorities = [
            "event": 0,
            "evidence": 1,
            "topic": 2,
            "category": 3
        ]
        var seenCodes = Set<String>()
        var ranked: [(tag: NewsTag, index: Int, priority: Int)] = []

        for (index, tag) in tags.enumerated() {
            let code = tag.code.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let label = tag.label.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !code.isEmpty, !label.isEmpty, seenCodes.insert(code).inserted else { continue }
            let kind = tag.kind.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            ranked.append((tag, index, priorities[kind] ?? Int.max))
        }

        return ranked
            .sorted { left, right in
                left.priority == right.priority
                    ? left.index < right.index
                    : left.priority < right.priority
            }
            .prefix(3)
            .map { $0.tag }
    }

    var priorityAccessibilitySummary: String {
        let values: [String?] = [importanceTierLabel, primaryCategoryLabel, primaryImportanceReason]
        return values
            .compactMap { value in
                guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
                    return nil
                }
                return value
            }
            .joined(separator: ", ")
    }

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case source_name
        case title
        case summary
        case url
        case country_iso2
        case countries
        case language_code
        case source_country_iso2
        case tone
        case event_time
        case time
        case payload
        case translated_title
        case ai_summary
        case translation
        case linked_events
        case publisher
        case primary_category
        case categories
        case tags
        case importance
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
        countries = try container.decodeIfPresent([String].self, forKey: .countries) ?? []
        language_code = try container.decodeIfPresent(String.self, forKey: .language_code)
        source_country_iso2 = try container.decodeIfPresent(String.self, forKey: .source_country_iso2)
        tone = try container.decodeIfPresent(Double.self, forKey: .tone)
        event_time = try container.decodeIfPresent(String.self, forKey: .event_time)
        time = try container.decodeIfPresent(NewsTimeEvidence.self, forKey: .time)
        payload = try container.decodeIfPresent(JSONValue.self, forKey: .payload)
        translated_title = try container.decodeIfPresent(String.self, forKey: .translated_title)
        ai_summary = try container.decodeIfPresent(String.self, forKey: .ai_summary)
        translation = try container.decodeIfPresent(NewsTranslation.self, forKey: .translation)
        linked_events = try container.decodeIfPresent([NewsLinkedEvent].self, forKey: .linked_events) ?? []
        publisher = try container.decodeIfPresent(String.self, forKey: .publisher)
        primary_category = try container.decodeIfPresent(String.self, forKey: .primary_category)
        categories = try container.decodeIfPresent([String].self, forKey: .categories) ?? []
        tags = try container.decodeIfPresent([NewsTag].self, forKey: .tags) ?? []
        importance = try container.decodeIfPresent(NewsImportance.self, forKey: .importance)
    }

    private func nonBlank(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private func normalizedLanguage(_ value: String?) -> String? {
        guard let value = nonBlank(value)?.lowercased().replacingOccurrences(of: "_", with: "-") else {
            return nil
        }
        return value
    }
}

struct NewsTimeEvidence: Codable {
    let basis: String
    let is_publisher_verified: Bool
    let published_at: String?
    let discovered_at: String?
}

struct NewsPage: Codable {
    let items: [NewsItem]
    let facets: NewsFacets
    let ranking: NewsRankingMetadata
    let page: NewsPageMetadata

    enum CodingKeys: String, CodingKey {
        case items, facets, ranking, page
    }

    init(
        items: [NewsItem],
        facets: NewsFacets = NewsFacets(),
        ranking: NewsRankingMetadata = NewsRankingMetadata(),
        page: NewsPageMetadata = NewsPageMetadata()
    ) {
        self.items = items
        self.facets = facets
        self.ranking = ranking
        self.page = page
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        items = try container.decodeIfPresent([NewsItem].self, forKey: .items) ?? []
        facets = try container.decodeIfPresent(NewsFacets.self, forKey: .facets) ?? NewsFacets()
        ranking = try container.decodeIfPresent(NewsRankingMetadata.self, forKey: .ranking) ?? NewsRankingMetadata()
        page = try container.decodeIfPresent(NewsPageMetadata.self, forKey: .page) ?? NewsPageMetadata()
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
    let verified_count: Int?
    let latest_at: String?
    let provider_count: Int?
    var id: String { country }
    var latestDate: Date? { latest_at.flatMap(APIDateParser.parse) }
}

struct CountryWeather: Codable, Identifiable {
    let country: String
    let temp_c: Double?
    let humidity: Double?
    let apparent_temp_c: Double?
    let pressure_hpa: Double?
    let visibility_m: Double?
    let location_name: String?
    let precipitation_mm: Double?
    let observed_at: String
    let weather_main: String?
    let weather_desc: String?
    let cloud_cover: Double?
    let wind_speed: Double?
    let wind_direction: Double?
    let wind_gust: Double?
    let is_day: Bool?
    let source_name: String?
    let source_kind: String?
    let icon_code: String?
    let attribution: String?
    let forecast: [DailyWeatherForecast]?
    let air_quality: AirQuality?
    let alert_count: Int?
    var id: String { country + observed_at }
    var observedDate: Date? { APIDateParser.parse(observed_at) }
}

struct DailyWeatherForecast: Codable, Identifiable {
    let forecast_time: String
    let temp_min_c: Double?
    let temp_max_c: Double?
    let apparent_temp_min_c: Double?
    let apparent_temp_max_c: Double?
    let precipitation_probability: Double?
    let precipitation_mm: Double?
    let weather_main: String?
    let wind_speed: Double?
    let wind_gust: Double?
    let uv_index: Double?
    var id: String { forecast_time }
}

struct AirQuality: Codable {
    let observed_at: String
    let european_aqi: Double?
    let us_aqi: Double?
    let provider_aqi: Double?
    let aqi_scale: String?
    let pm10: Double?
    let pm2_5: Double?
    let label: String
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
    let instrument_id: Int?
    let source_name: String?
    let source_url: String?
    let symbol: String
    let canonical_symbol: String?
    let company_name: String?
    let instrument_type: String?
    let asset_class: String?
    let scope: String?
    let exchange: String?
    let country: String?
    let currency: String?
    let market_code: String?
    let market_name: String?
    let market_kind: String?
    let unit: String?
    let frequency: String?
    let value_semantics: String?
    let attribution: String?
    let license: String?
    let original_publisher: String?
    let price: Double?
    let change: Double?
    let percent_change: Double?
    let high_price: Double?
    let low_price: Double?
    let open_price: Double?
    let previous_close: Double?
    let volume: Double?
    let period_end: String?
    let observed_at: String
    let history: [MarketInstrumentHistoryPoint]?
    let payload: JSONValue?

    var id: String { "\(symbol)-\(observed_at)" }
    var observedDate: Date? { APIDateParser.parse(observed_at) }

    enum CodingKeys: String, CodingKey {
        case instrument_id
        case source_name
        case source_url
        case symbol
        case canonical_symbol
        case company_name
        case instrument_type
        case asset_class
        case scope
        case exchange
        case country
        case currency
        case market_code
        case market_name
        case market_kind
        case unit
        case frequency
        case value_semantics
        case attribution
        case license
        case original_publisher
        case price
        case change
        case percent_change
        case high_price
        case low_price
        case open_price
        case previous_close
        case volume
        case period_end
        case observed_at
        case history
        case payload
    }
}

struct MarketInstrumentHistoryPoint: Codable, Identifiable {
    let period_end: String
    let value: Double
    var id: String { period_end }
}

struct CountryMarketOverview: Codable, Identifiable {
    let country: String
    let country_name: String
    let region: String?
    let currency: String?
    let index_symbol: String?
    let index_name: String?
    let index_value: Double?
    let index_previous_value: Double?
    let index_change_percent: Double?
    let index_period_end: String?
    let index_source: String?
    let index_frequency: String?
    let index_scope: String?
    let fx_symbol: String?
    let fx_rate: Double?
    let fx_previous_rate: Double?
    let fx_change_percent: Double?
    let fx_period_end: String?
    let filing_count_7d: Int
    let gdp_growth: Double?
    let gdp_year: Int?
    let inflation: Double?
    let inflation_year: Int?
    let unemployment: Double?
    let unemployment_year: Int?
    let current_account: Double?
    let current_account_year: Int?
    let macro_latest_year: Int?
    let macro_source: String?
    let composite_change_percent: Double?
    let composite_basis: [String]
    let freshness: String

    var id: String { country }
}

struct CountryMarketCoverage: Codable {
    let countries: Int
    let with_index: Int
    let with_fx: Int
    let with_filings: Int
    let with_macro: Int?
    let current: Int
    let stale: Int
    let instrument_countries: Int?
}

struct CountryMarketMethodology: Codable {
    let index: String
    let fx: String
    let composite: String
    let filings: String
    let macro: String?
}

struct CountryMarketOverviewResponse: Codable {
    let generated_at: String
    let countries: [CountryMarketOverview]
    let coverage: CountryMarketCoverage
    let methodology: CountryMarketMethodology
    let sources: [String]
}

struct CountryRelevanceScore {
    let country: String
    let relevance: Double
    let domainCount: Int
}

enum CountryRelevanceResolver {
    static func ranked(
        countryStats: [CountryStat],
        podcasts: [PodcastEpisode],
        weather: [CountryWeather],
        countryMarkets: [CountryMarketOverview]
    ) -> [CountryRelevanceScore] {
        var newsCounts: [String: Int] = [:]
        countryStats.forEach { row in
            guard let country = iso2(row.country) else { return }
            newsCounts[country, default: 0] += row.count
        }
        var marketMoves: [String: Double] = [:]
        countryMarkets.forEach { row in
            guard let country = iso2(row.country) else { return }
            marketMoves[country] = abs(
                row.composite_change_percent ?? row.index_change_percent ?? row.fx_change_percent ?? 0
            )
        }
        return ranked(
            newsCounts: newsCounts,
            podcastSignals: podcastSignals(podcasts),
            weather: weather,
            marketMoves: marketMoves
        )
    }

    static func ranked(
        news: [NewsItem],
        podcasts: [PodcastEpisode],
        weather: [CountryWeather],
        marketQuotes: [MarketQuote]
    ) -> [CountryRelevanceScore] {
        var newsCounts: [String: Int] = [:]
        news.forEach { row in
            row.subjectCountries.forEach { country in
                newsCounts[country, default: 0] += 1
            }
        }
        var marketMoves: [String: Double] = [:]
        marketQuotes.forEach { row in
            guard let country = iso2(row.country) else { return }
            marketMoves[country] = max(
                marketMoves[country] ?? 0,
                abs(row.percent_change ?? row.change ?? 0)
            )
        }
        return ranked(
            newsCounts: newsCounts,
            podcastSignals: podcastSignals(podcasts),
            weather: weather,
            marketMoves: marketMoves
        )
    }

    private static func ranked(
        newsCounts: [String: Int],
        podcastSignals: [String: (count: Int, score: Double)],
        weather: [CountryWeather],
        marketMoves: [String: Double]
    ) -> [CountryRelevanceScore] {
        var latestWeather: [String: CountryWeather] = [:]
        weather.forEach { row in
            guard let country = iso2(row.country) else { return }
            if let current = latestWeather[country],
               (current.observedDate ?? .distantPast) >= (row.observedDate ?? .distantPast) {
                return
            }
            latestWeather[country] = row
        }

        let countries = Set(newsCounts.keys)
            .union(latestWeather.keys)
            .union(marketMoves.keys)
            .union(podcastSignals.keys)
        let maxNews = Double(max(newsCounts.values.max() ?? 1, 1))
        let maxMarket = max(marketMoves.values.max() ?? 1, 1)

        return countries.compactMap { country -> CountryRelevanceScore? in
            let newsCount = newsCounts[country] ?? 0
            let newsRelevance = newsCount > 0
                ? log1p(Double(newsCount)) / log1p(maxNews)
                : 0
            let weatherRow = latestWeather[country]
            let temperatureSeverity = weatherRow?.temp_c.map {
                min(1, max(0, (abs($0 - 20) - 8) / 24))
            } ?? 0
            let humiditySeverity = weatherRow?.humidity.map {
                min(1, max(0, ($0 - 75) / 25))
            } ?? 0
            let windSeverity = weatherRow?.wind_speed.map { min(1, $0 / 25) } ?? 0
            let weatherRelevance = max(temperatureSeverity, max(humiditySeverity, windSeverity))
            let marketRelevance = marketMoves[country].map { $0 / maxMarket } ?? 0
            let podcast = podcastSignals[country]
            let podcastRelevance = podcast.map {
                min(1, ($0.score + min(18, Double($0.count * 3))) / 100)
            } ?? 0
            let domainCount = [
                newsCount > 0,
                weatherRelevance > 0,
                marketMoves[country] != nil,
                podcast != nil,
            ].filter { $0 }.count
            let breadthBonus = Double(max(0, domainCount - 1) * 2)
            let relevance = min(
                100,
                round(
                    newsRelevance * 40 +
                    podcastRelevance * 25 +
                    weatherRelevance * 15 +
                    marketRelevance * 15 +
                    breadthBonus
                )
            )
            guard relevance > 0 else { return nil }
            return CountryRelevanceScore(
                country: country,
                relevance: relevance,
                domainCount: domainCount
            )
        }
        .sorted {
            $0.relevance == $1.relevance
                ? $0.country < $1.country
                : $0.relevance > $1.relevance
        }
    }

    private static func podcastSignals(
        _ podcasts: [PodcastEpisode]
    ) -> [String: (count: Int, score: Double)] {
        var signals: [String: (count: Int, score: Double)] = [:]
        podcasts.forEach { episode in
            episode.signals.forEach { signal in
                let riskBase: Double
                switch signal.risk_level?.lowercased() {
                case "critical": riskBase = 100
                case "high": riskBase = 82
                case "medium": riskBase = 60
                case "low": riskBase = 38
                default: riskBase = 32
                }
                let score = riskBase * (0.65 + (signal.confidence ?? 0.55) * 0.35)
                signal.countries.forEach { value in
                    guard let country = iso2(value) else { return }
                    let current = signals[country] ?? (count: 0, score: 0)
                    signals[country] = (current.count + 1, max(current.score, score))
                }
            }
        }
        return signals
    }

    private static func iso2(_ value: String?) -> String? {
        guard let country = value?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
              country.range(of: "^[A-Z]{2}$", options: .regularExpression) != nil else {
            return nil
        }
        return country
    }
}

enum TransportMode: String, Codable, CaseIterable, Identifiable {
    case maritime
    case aviation

    var id: String { rawValue }
}

struct TransportModeAggregate: Codable {
    let active: Int
    let routed: Int
    let alerts: Int
    let latest_observed_at: String?

    var latestObservedDate: Date? {
        latest_observed_at.flatMap(APIDateParser.parse)
    }
}

struct TransportModeAggregates: Codable {
    let maritime: TransportModeAggregate
    let aviation: TransportModeAggregate
}

struct TransportTrendMetric: Codable {
    let current: Int
    let previous: Int
    let change_pct: Double?
    let direction: String
}

struct TransportCountryTrend: Codable {
    let ship_departures: TransportTrendMetric
    let cargo_vessel_departures: TransportTrendMetric
    let ship_arrivals: TransportTrendMetric
    let tracked_flights: TransportTrendMetric
}

struct TransportTrends: Codable {
    struct Maritime: Codable {
        let ship_departures: TransportTrendMetric
        let cargo_vessel_departures: TransportTrendMetric
        let ship_arrivals: TransportTrendMetric
    }

    struct Aviation: Codable {
        let tracked_flights: TransportTrendMetric
    }

    let window_hours: Int
    let comparison: String
    let maritime: Maritime
    let aviation: Aviation
}

struct TransportSummary: Codable {
    let active: Int
    let routed: Int
    let alerts: Int
    let linked_countries: Int
    let modes: TransportModeAggregates
}

struct TransportMaritimeCountryAggregate: Codable {
    let active: Int
    let current: Int
    let origins: Int
    let destinations: Int
    let flagged: Int
}

struct TransportAviationCountryAggregate: Codable {
    let active: Int
    let current: Int
    let origins: Int
    let destinations: Int
    let registered: Int
}

struct TransportCountryAggregate: Codable, Identifiable {
    let country: String
    let country_name: String
    let active_count: Int
    let maritime: TransportMaritimeCountryAggregate
    let aviation: TransportAviationCountryAggregate
    let trend: TransportCountryTrend?

    var id: String { country }
}

struct TransportRouteAggregate: Codable, Identifiable {
    let mode: TransportMode
    let origin_country: String
    let origin_name: String
    let destination_country: String
    let destination_name: String
    let active_count: Int
    let examples: [String]

    var id: String { "\(mode.rawValue)-\(origin_country)-\(destination_country)" }
}

struct TransportActivityPoint: Codable, Identifiable {
    let bucket: String
    let mode: TransportMode
    let active_count: Int

    var id: String { "\(bucket)-\(mode.rawValue)" }
    var bucketDate: Date? { APIDateParser.parse(bucket) }
}

struct TransportCountryLink: Codable, Identifiable {
    let role: String
    let country: String

    var id: String { "\(role)-\(country)" }
}

struct TransportEntity: Codable, Identifiable {
    let id: String
    let mode: TransportMode
    let entity_id: String
    let display_name: String?
    let callsign: String?
    let flight_number: String?
    let registration: String?
    let vehicle_type: String?
    let vehicle_category: String?
    let latitude: Double?
    let longitude: Double?
    let heading: Double?
    let speed: Double?
    let altitude: Double?
    let vertical_rate: Double?
    let current_country_iso2: String?
    let origin_country_iso2: String?
    let destination_country_iso2: String?
    let registration_country_iso2: String?
    let origin_name: String?
    let destination_name: String?
    let origin_latitude: Double?
    let origin_longitude: Double?
    let destination_latitude: Double?
    let destination_longitude: Double?
    let current_location_name: String?
    let route_label: String?
    let linkage_basis: [String]
    let linkage_confidence: String
    let status: String?
    let is_alert: Bool
    let source_name: String
    let observed_at: String
    let country_links: [TransportCountryLink]

    var observedDate: Date? { APIDateParser.parse(observed_at) }
}

struct TransportTrackPoint: Codable, Identifiable {
    let latitude: Double
    let longitude: Double
    let heading: Double?
    let speed: Double?
    let altitude: Double?
    let current_country_iso2: String?
    let current_location_name: String?
    let vehicle_category: String?
    let observed_at: String

    var id: String { "\(observed_at)-\(latitude)-\(longitude)" }
}

struct RegionalMaritimeCoverageSource: Codable, Identifiable {
    let source_name: String
    let provider: String
    let transport: String?
    let coverage: String?
    let configured: Bool
    let last_refresh_at: String?
    let last_snapshot_at: String?
    let last_stored_at: String?
    let error: Bool?
    let snapshots_accepted: Int?
    let snapshots_stored: Int?
    let license: String?
    let global: Bool?
    let source_url: String?
    let terms_url: String?
    let attribution: String?

    var id: String { source_name }
}

struct MaritimeTransportCoverage: Codable {
    let source: String
    let transport: String
    let configured: Bool
    let primary_configured: Bool?
    let primary_status: String?
    let primary_coverage: String?
    let primary_global: Bool?
    let primary_subscription_mode: String?
    let connected: Bool?
    let status: String?
    let last_message_at: String?
    let last_snapshot_at: String?
    let last_stored_at: String?
    let last_flush_at: String?
    let last_error: String?
    let persistence_error: Bool?
    let queue_depth: Int?
    let messages_received: Int?
    let snapshots_accepted: Int?
    let snapshots_stored: Int?
    let snapshots_dropped: Int?
    let malformed_messages: Int?
    let subscription_batch: Int?
    let subscription_batches: Int?
    let subscription_boxes: Int?
    let fallback_source: String?
    let fallback_configured: Bool?
    let fallback_last_snapshot_at: String?
    let fallback_last_stored_at: String?
    let fallback_error: Bool?
    let fallback_snapshots_accepted: Int?
    let fallback_snapshots_stored: Int?
    let fallback_license: String?
    let regional_sources: [RegionalMaritimeCoverageSource]?
    let freshness_minutes: Int
    let movement_method: String?
    let cargo_method: String?
}

struct AviationTransportCoverage: Codable {
    let source: String
    let transport: String
    let configured: Bool
    let freshness_minutes: Int
    let license: String
    let poll_areas: Int
}

struct TransportCoverage: Codable {
    let maritime: MaritimeTransportCoverage
    let aviation: AviationTransportCoverage
}

struct TransportOverview: Codable {
    let generated_at: String
    let detail: String
    let summary: TransportSummary
    let countries: [TransportCountryAggregate]
    let routes: [TransportRouteAggregate]
    let trends: TransportTrends?
    let takeaways: [TransportTakeaway]?
    let ports: [TransportPortAggregate]?
    let activity: [TransportActivityPoint]
    let entities: [TransportEntity]
    let coverage: TransportCoverage

    var generatedDate: Date? { APIDateParser.parse(generated_at) }
}

struct TransportTakeaway: Codable, Identifiable {
    let id: String
    let mode: TransportMode
    let title: String
    let summary: String
    let current_value: Int
    let previous_value: Int
    let change_pct: Double?
    let direction: String
    let qualifier: String
}

struct TransportPortAggregate: Codable, Identifiable {
    let country: String
    let country_name: String
    let location_name: String
    let departures: Int
    let arrivals: Int
    let cargo_vessel_departures: Int

    var id: String { "\(country)-\(location_name)" }
}

struct TransportEntityDetail: Codable {
    let entity: TransportEntity
    let track: [TransportTrackPoint]
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
    func decodeFlexibleIntIfPresent(forKey key: Key) throws -> Int? {
        guard contains(key), try !decodeNil(forKey: key) else { return nil }
        return try decodeFlexibleInt(forKey: key)
    }

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

    func decodeFlexibleDouble(forKey key: Key) throws -> Double {
        if let value = try? decode(Double.self, forKey: key), value.isFinite {
            return value
        }
        if let value = try? decode(Int.self, forKey: key) {
            return Double(value)
        }
        if let text = try? decode(String.self, forKey: key),
           let value = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)),
           value.isFinite {
            return value
        }
        throw DecodingError.dataCorruptedError(forKey: key, in: self, debugDescription: "Expected number-compatible value.")
    }
}

enum IntelligenceSeverity: String, Codable, CaseIterable {
    case low
    case medium
    case high
    case critical
}

struct IntelligenceEvent: Codable, Identifiable, Hashable {
    let id: String
    let event_type: String
    let title: String
    let summary: String
    let status: String
    let severity: IntelligenceSeverity
    let confidence: Double
    let start_time: Date
    let last_activity_time: Date
    let expires_at: Date?
    let freshness_state: String?
    let primary_location_id: String?
    let primary_country_iso2: String?
    let source_diversity: Int
    let domain_count: Int
    let relevance_score: Double
    let urgency_score: Double
    let materiality_score: Double
    let location_name: String?
    let location_type: String?
    let latitude: Double?
    let longitude: Double?
    let monitoring_tier: Int?
    let evidence_count: Int
    let earth_observation_available: Bool
}

struct IntelligenceEvidence: Codable, Identifiable {
    let id: String
    let domain: String
    let evidence_type: String
    let source_record_type: String
    let source_record_id: String
    let observed_at: Date
    let published_at: Date?
    let confidence: Double
    let relationship: String
    let source_name: String?
    let location_name: String?
    let attribution: String?
    let license: String?
    let source_title: String?
    let source_summary: String?
    let source_url: String?
    let correlation_score: Double?
    let correlation_factors: JSONValue?
    let provenance: JSONValue?
    let metadata: JSONValue?
}

struct PushDeviceRegistration: Codable, Identifiable {
    let id: String
    let platform: String
    let installation_id: String
    let app_bundle_id: String
    let environment: String
    let active: Bool
    let last_registered_at: Date
    let created_at: Date
    let updated_at: Date
}

struct EarthObservationAsset: Codable, Identifiable {
    let id: String
    let asset_type: String
    let mime_type: String
    let width: Int
    let height: Int
    let size_bytes: Int
    let generated_at: Date
    let expires_at: Date?
    let url: String
}

struct EarthObservationModelInterpretation: Codable {
    let summary: String?
    let findings: [String]?
    let possible_changes: [String]?
    let limitations: [String]?
    let confidence: Double?
    let provider: String?
    let model: String?
    let requested_model: String?
    let prompt_version: String?
    let generated_at: Date?
    let epistemic_class: String
    let notice: String
}

struct EarthObservation: Codable, Identifiable {
    let id: String
    let event_id: String?
    let location_id: String?
    let scene_id: String
    let product_type: String
    let status: String
    let captured_at: Date
    let provider: String
    let mission: String
    let collection: String
    let provider_scene_id: String
    let capture_start: Date
    let capture_end: Date?
    let cloud_cover: Double?
    let resolution_m: Double?
    let orbit_direction: String?
    let source_url: String
    let location_name: String?
    let analysis_summary: String?
    let analysis_summary_role: String?
    let model_interpretation: EarthObservationModelInterpretation?
    let attribution: String?
    let license: String?
    let assets: [EarthObservationAsset]
}

struct EarthComparisonScene: Codable {
    let id: String?
}

struct EarthComparisonResponse: Codable {
    let status: String
    let before: EarthComparisonScene?
    let after: EarthComparisonScene?
    let notice: String?
    let reason: String?
}

extension EarthObservation {
    var preferredDisplayAsset: EarthObservationAsset? {
        assets.first { $0.asset_type == "preview" } ?? assets.first
    }

    var displayProductName: String {
        switch product_type {
        case "true_color": return "Natural color"
        case "false_color": return "False-color composite"
        case "sar": return "Radar observation"
        case "ndvi": return "Vegetation index"
        case "ndwi": return "Water index"
        case "burn_index": return "Burn-sensitive index"
        case "gibs_layer": return "Browse context"
        default: return product_type.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    var isAnalyticalLayer: Bool {
        ["ndvi", "ndwi", "burn_index"].contains(product_type)
    }

    fileprivate var displayRank: Int {
        switch product_type {
        case "true_color": return 0
        case "false_color": return 1
        case "sar": return 2
        case "ndvi": return 3
        case "ndwi": return 4
        case "burn_index": return 5
        default: return 99
        }
    }
}

extension Array where Element == EarthObservation {
    var sortedForDisplay: [EarthObservation] {
        sorted {
            if $0.displayRank != $1.displayRank { return $0.displayRank < $1.displayRank }
            return $0.capture_start > $1.capture_start
        }
    }
}

struct IntelligenceEventLocation: Codable, Identifiable {
    let id: String
    let canonical_name: String
    let location_type: String
    let country_iso2: String?
    let relationship: String
    let confidence: Double
    let attribution: String?
    let license: String?

    enum CodingKeys: String, CodingKey {
        case id, canonical_name, location_type, country_iso2, relationship, confidence, attribution, license
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        canonical_name = try container.decode(String.self, forKey: .canonical_name)
        location_type = try container.decode(String.self, forKey: .location_type)
        country_iso2 = try container.decodeIfPresent(String.self, forKey: .country_iso2)
        relationship = try container.decode(String.self, forKey: .relationship)
        confidence = try container.decodeFlexibleDouble(forKey: .confidence)
        attribution = try container.decodeIfPresent(String.self, forKey: .attribution)
        license = try container.decodeIfPresent(String.self, forKey: .license)
    }
}

struct IntelligenceRelatedEvent: Codable, Identifiable {
    let id: String
    let event_type: String
    let title: String
    let status: String
    let severity: IntelligenceSeverity
    let last_activity_time: Date
    let relevance_score: Double
    let relationship: String
    let confidence: Double
    let rationale: String?

    enum CodingKeys: String, CodingKey {
        case id, event_type, title, status, severity, last_activity_time, relevance_score, relationship, confidence, rationale
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        event_type = try container.decode(String.self, forKey: .event_type)
        title = try container.decode(String.self, forKey: .title)
        status = try container.decode(String.self, forKey: .status)
        severity = try container.decode(IntelligenceSeverity.self, forKey: .severity)
        last_activity_time = try container.decode(Date.self, forKey: .last_activity_time)
        relevance_score = try container.decodeFlexibleDouble(forKey: .relevance_score)
        relationship = try container.decode(String.self, forKey: .relationship)
        confidence = try container.decodeFlexibleDouble(forKey: .confidence)
        rationale = try container.decodeIfPresent(String.self, forKey: .rationale)
    }
}

struct GibsEventProvenance: Codable {
    let provider: String
    let service: String?
    let layer_id: String?
    let observation_date: String?
    let source_url: String
    let attribution: String
    let acknowledgement: String?
    let license: String?
}

struct GibsEventLayer: Codable, Identifiable {
    var id: String { "\(layer_id)-\(date)" }
    let layer_id: String
    let title: String
    let category: String
    let date: String
    let bbox: [Double]
    let tile_url: String
    let preview_url: String
    let format: String?
    let matrix_set: String?
    let temporal: Bool?
    let provenance: GibsEventProvenance
}

struct GibsEventContext: Codable {
    let provider: String?
    let event_id: String?
    let event_type: String?
    let event_title: String?
    let location_id: String?
    let location_name: String?
    let observation_date: String?
    let bbox: [Double]?
    let aoi_source: String?
    let context_scope: String?
    let layers: [GibsEventLayer]
    let notice: String
}

struct IntelligenceEventUnderstanding: Codable {
    let what_happened: String
    let location: String
    let why_interesting: String
    let linked_news_count: Int
    let physical_observation_count: Int

    enum CodingKeys: String, CodingKey {
        case what_happened
        case location = "where"
        case why_interesting, linked_news_count, physical_observation_count
    }
}

struct IntelligenceLinkedNews: Codable, Identifiable {
    let id: String
    let evidence_type: String
    let relationship: String
    let title: String?
    let summary: String?
    let url: String?
    let publisher: String?
    let observed_at: Date
    let confidence: Double

    enum CodingKeys: String, CodingKey {
        case id, evidence_type, relationship, title, summary, url, publisher, observed_at, confidence
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        evidence_type = try container.decode(String.self, forKey: .evidence_type)
        relationship = try container.decode(String.self, forKey: .relationship)
        title = try container.decodeIfPresent(String.self, forKey: .title)
        summary = try container.decodeIfPresent(String.self, forKey: .summary)
        url = try container.decodeIfPresent(String.self, forKey: .url)
        publisher = try container.decodeIfPresent(String.self, forKey: .publisher)
        observed_at = try container.decode(Date.self, forKey: .observed_at)
        confidence = try container.decodeFlexibleDouble(forKey: .confidence)
    }
}

struct IntelligenceEventDetail: Codable {
    let event: IntelligenceEvent
    let understanding: IntelligenceEventUnderstanding?
    let evidence: [IntelligenceEvidence]
    let linked_news: [IntelligenceLinkedNews]
    let locations: [IntelligenceEventLocation]
    let earth_observations: [EarthObservation]
    let related_events: [IntelligenceRelatedEvent]
    let epistemic_notice: String

    enum CodingKeys: String, CodingKey {
        case event, understanding, evidence, linked_news, locations, earth_observations, related_events, epistemic_notice
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        event = try container.decode(IntelligenceEvent.self, forKey: .event)
        understanding = try container.decodeIfPresent(IntelligenceEventUnderstanding.self, forKey: .understanding)
        evidence = try container.decodeIfPresent([IntelligenceEvidence].self, forKey: .evidence) ?? []
        linked_news = try container.decodeIfPresent([IntelligenceLinkedNews].self, forKey: .linked_news) ?? []
        locations = try container.decodeIfPresent([IntelligenceEventLocation].self, forKey: .locations) ?? []
        earth_observations = try container.decodeIfPresent([EarthObservation].self, forKey: .earth_observations) ?? []
        related_events = try container.decodeIfPresent([IntelligenceRelatedEvent].self, forKey: .related_events) ?? []
        epistemic_notice = try container.decodeIfPresent(String.self, forKey: .epistemic_notice)
            ?? "Evidence relationships are qualified. Correlation does not establish causation."
    }
}

struct IntelligenceWatchMetadata: Codable {
    let email_enabled: Bool?
}

struct IntelligenceWatch: Codable, Identifiable {
    let id: String
    let watch_type: String
    let watch_key: String
    let minimum_severity: IntelligenceSeverity
    let alerts_enabled: Bool
    let metadata: IntelligenceWatchMetadata?
    let created_at: Date
    let updated_at: Date
}

struct IntelligenceAlert: Codable, Identifiable {
    let id: String
    let event_id: String
    let severity: IntelligenceSeverity
    let title: String
    let body: String
    let event_type: String
    let primary_country_iso2: String?
    let location_name: String?
    let eligibility_status: String
    let acknowledged_at: Date?
    let created_at: Date
    let updated_at: Date
}

struct EarthProviderStatus: Codable, Identifiable {
    var id: String { provider }
    let provider: String
    let enabled: Bool
    let configured: Bool
    let state: String
    let reason: String?
    let attribution: String
    let last_success_at: Date?
    let consecutive_failures: Int?
    let last_error: String?
}

struct EarthObservationListResponse: Codable {
    let observations: [EarthObservation]
    let providers: [EarthProviderStatus]
}

struct AdminIntelligenceStatus: Codable {
    struct AlertCandidate: Codable, Identifiable {
        let id: String
        let event_id: String
        let severity: IntelligenceSeverity
        let status: String
        let title: String
    }

    struct Backbone: Codable {
        struct Count: Codable, Identifiable {
            var id: String { status }
            let status: String
            let count: Int
        }
        let outbox: [Count]
        let unresolved_dead_letters: Int
    }

    struct Earth: Codable {
        struct QueueCount: Codable, Identifiable {
            var id: String { status }
            let status: String
            let count: Int
        }
        struct Assets: Codable {
            let count: Int
            let size_bytes: Int
        }
        struct Job: Codable, Identifiable {
            let id: String
            let job_type: String
            let provider: String
            let status: String
            let attempts: Int
            let max_attempts: Int
            let location_name: String?
            let last_error: String?
            let updated_at: Date
        }
        let providers: [EarthProviderStatus]
        let queue: [QueueCount]
        let assets: Assets
        let recent_jobs: [Job]
        let budgets: [String: Double]
    }

    let backbone: Backbone
    let earth_observation: Earth
    let rapid_sources: [EarthProviderStatus]
    let alert_candidates: [AlertCandidate]
    let generated_at: Date
}
