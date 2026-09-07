import AppIntents
import Foundation
import SwiftUI
import WidgetKit

private let claritasLegacyWatchWidgetKind = "ClaritasWatchWidget"
private let claritasScopedWatchWidgetKind = "ClaritasWatchScopedWidget"

enum ClaritasWatchWidgetDomain: String, CaseIterable, AppEnum {
    case overview
    case news
    case markets
    case weather
    case transport

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Signal domain"
    static var caseDisplayRepresentations: [ClaritasWatchWidgetDomain: DisplayRepresentation] = [
        .overview: "Overview",
        .news: "News",
        .markets: "Markets",
        .weather: "Weather",
        .transport: "Transport"
    ]

    var label: String {
        switch self {
        case .overview: return "Overview"
        case .news: return "News"
        case .markets: return "Markets"
        case .weather: return "Weather"
        case .transport: return "Transport"
        }
    }

    var systemImage: String {
        switch self {
        case .overview: return "scope"
        case .news: return "newspaper.fill"
        case .markets: return "chart.line.uptrend.xyaxis"
        case .weather: return "cloud.sun.fill"
        case .transport: return "airplane.departure"
        }
    }
}

struct ClaritasWatchWidgetCountry: AppEntity, Hashable {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Country scope"
    static var defaultQuery = ClaritasWatchWidgetCountryQuery()

    let id: String
    let isoCode: String
    let name: String

    var displayRepresentation: DisplayRepresentation {
        if isoCode.isEmpty {
            return DisplayRepresentation(title: "Global", subtitle: "All countries")
        }
        return DisplayRepresentation(title: "\(name)", subtitle: "\(isoCode)")
    }

    static let global = ClaritasWatchWidgetCountry(id: "global", isoCode: "", name: "Global")
}

struct ClaritasWatchWidgetCountryQuery: EntityStringQuery {
    func entities(for identifiers: [ClaritasWatchWidgetCountry.ID]) async throws -> [ClaritasWatchWidgetCountry] {
        identifiers.compactMap(Self.country(for:))
    }

    func suggestedEntities() async throws -> [ClaritasWatchWidgetCountry] {
        [.global] + Self.availableCountries()
    }

    func defaultResult() async -> ClaritasWatchWidgetCountry? {
        guard let selectedCountry = ClaritasWatchSnapshotLoader.load()?.selectedCountry else {
            return .global
        }
        return Self.country(for: selectedCountry) ?? .global
    }

    func entities(matching string: String) async throws -> [ClaritasWatchWidgetCountry] {
        let term = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else { return try await suggestedEntities() }
        let available = Self.availableCountries()
        if "global".localizedCaseInsensitiveContains(term) ||
            "all countries".localizedCaseInsensitiveContains(term) {
            return [.global] + available.filter { Self.matches($0, term: term) }
        }
        return available.filter { Self.matches($0, term: term) }
    }

    private static func availableCountries() -> [ClaritasWatchWidgetCountry] {
        let available = Set(ClaritasWatchSnapshotLoader.load()?.availableCountries ?? [])
        return allCountries
            .filter { available.contains($0.isoCode) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private static let allCountries: [ClaritasWatchWidgetCountry] = Locale.isoRegionCodes
        .compactMap { rawCode -> ClaritasWatchWidgetCountry? in
            guard let code = normalizedISO2(rawCode) else { return nil }
            let name = Locale.current.localizedString(forRegionCode: code) ?? code
            return ClaritasWatchWidgetCountry(id: code, isoCode: code, name: name)
        }
        .reduce(into: [String: ClaritasWatchWidgetCountry]()) { result, country in
            result[country.isoCode] = country
        }
        .values
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }

    private static func country(for identifier: String) -> ClaritasWatchWidgetCountry? {
        if identifier.lowercased() == ClaritasWatchWidgetCountry.global.id {
            return .global
        }
        guard let code = normalizedISO2(identifier) else { return nil }
        let name = Locale.current.localizedString(forRegionCode: code) ?? code
        return ClaritasWatchWidgetCountry(id: code, isoCode: code, name: name)
    }

    private static func matches(_ country: ClaritasWatchWidgetCountry, term: String) -> Bool {
        country.isoCode.localizedCaseInsensitiveContains(term) ||
            country.name.localizedCaseInsensitiveContains(term)
    }
}

struct ClaritasWatchWidgetIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Claritas intelligence"
    static var description = IntentDescription("Choose a signal domain and country scope.")

    @Parameter(title: "Domain", default: .overview)
    var domain: ClaritasWatchWidgetDomain

    @Parameter(title: "Country")
    var country: ClaritasWatchWidgetCountry?
}

private struct ClaritasWatchFreshness: Codable {
    let overview: Date?
    let news: Date?
    let markets: Date?
    let weather: Date?
    let transport: Date?

    func date(for domain: ClaritasWatchWidgetDomain) -> Date? {
        switch domain {
        case .overview: return overview
        case .news: return news
        case .markets: return markets
        case .weather: return weather
        case .transport: return transport
        }
    }

    static func all(_ date: Date?) -> ClaritasWatchFreshness {
        ClaritasWatchFreshness(
            overview: date,
            news: date,
            markets: date,
            weather: date,
            transport: date
        )
    }
}

private struct ClaritasWatchEntry: TimelineEntry {
    let date: Date
    let updatedAt: Date?
    let domain: ClaritasWatchWidgetDomain
    let country: String
    let signal: ClaritasWatchDomainValue

    var scopeLabel: String { country.isEmpty ? "Global" : country }

    var isStale: Bool {
        guard let updatedAt else { return true }
        return date.timeIntervalSince(updatedAt) >= ClaritasWatchSnapshotLoader.staleInterval
    }

    var freshnessLabel: String {
        guard let updatedAt else { return "OPEN" }
        let seconds = max(0, date.timeIntervalSince(updatedAt))
        if isStale { return "STALE" }
        if seconds < 60 { return "NOW" }
        if seconds < 60 * 60 { return "\(Int(seconds / 60))m" }
        return "\(Int(seconds / 3_600))h"
    }

    var compactMetric: String {
        signal.metric.split(separator: " ").first.map(String.init) ?? signal.metric
    }

    var deepLink: URL? {
        var components = URLComponents()
        components.scheme = "claritas"
        components.host = "widget"
        components.queryItems = [
            URLQueryItem(name: "domain", value: domain.rawValue),
            URLQueryItem(name: "country", value: country.isEmpty ? "GLOBAL" : country)
        ]
        return components.url
    }

    var accessibilitySummary: String {
        let freshness: String
        if updatedAt == nil {
            freshness = "No saved data"
        } else if isStale {
            freshness = "Stale data"
        } else if freshnessLabel == "NOW" {
            freshness = "Updated just now"
        } else {
            freshness = "Updated \(freshnessLabel.lowercased()) ago"
        }
        return "Claritas \(domain.label), \(scopeLabel). \(signal.metric). \(signal.title). \(signal.detail). \(freshness)."
    }
}

private struct ClaritasWatchProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ClaritasWatchEntry {
        makeEntry(
            configuration: ClaritasWatchWidgetIntent(),
            payload: .placeholder,
            date: .now
        )
    }

    func snapshot(
        for configuration: ClaritasWatchWidgetIntent,
        in context: Context
    ) async -> ClaritasWatchEntry {
        makeEntry(
            configuration: configuration,
            payload: context.isPreview ? .placeholder : ClaritasWatchSnapshotLoader.load() ?? .empty,
            date: .now
        )
    }

    func timeline(
        for configuration: ClaritasWatchWidgetIntent,
        in context: Context
    ) async -> Timeline<ClaritasWatchEntry> {
        let now = Date()
        let payload = ClaritasWatchSnapshotLoader.load() ?? .empty
        let entry = makeEntry(configuration: configuration, payload: payload, date: now)
        let regularRefresh = now.addingTimeInterval(30 * 60)
        let staleTransition = entry.updatedAt?.addingTimeInterval(ClaritasWatchSnapshotLoader.staleInterval)
        let nextRefresh = staleTransition.map { $0 > now ? min(regularRefresh, $0) : regularRefresh }
            ?? regularRefresh
        return Timeline(entries: [entry], policy: .after(nextRefresh))
    }

    private func makeEntry(
        configuration: ClaritasWatchWidgetIntent,
        payload: ClaritasWatchSnapshot,
        date: Date
    ) -> ClaritasWatchEntry {
        let country = normalizedISO2(configuration.country?.isoCode) ?? ""
        let scope = payload.scope(for: country)
        return .init(
            date: date,
            updatedAt: scope.freshness?.date(for: configuration.domain)
                ?? (scope.updatedAt > 0 ? Date(timeIntervalSince1970: scope.updatedAt) : nil),
            domain: configuration.domain,
            country: country,
            signal: scope.value(for: configuration.domain)
        )
    }
}

/// Keeps already-installed static complications valid while the configurable
/// AppIntent widget uses a distinct kind. Reusing a kind across configuration
/// types can leave WidgetKit unable to restore an existing complication.
private struct ClaritasLegacyWatchProvider: TimelineProvider {
    func placeholder(in context: Context) -> ClaritasWatchEntry {
        makeEntry(payload: .placeholder, date: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (ClaritasWatchEntry) -> Void) {
        completion(makeEntry(
            payload: context.isPreview ? .placeholder : ClaritasWatchSnapshotLoader.load() ?? .empty,
            date: .now
        ))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ClaritasWatchEntry>) -> Void) {
        let now = Date()
        let entry = makeEntry(
            payload: ClaritasWatchSnapshotLoader.load() ?? .empty,
            date: now
        )
        completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(30 * 60))))
    }

    private func makeEntry(payload: ClaritasWatchSnapshot, date: Date) -> ClaritasWatchEntry {
        let country = normalizedISO2(payload.selectedCountry) ?? ""
        let scope = payload.scope(for: country)
        return ClaritasWatchEntry(
            date: date,
            updatedAt: scope.freshness?.date(for: .overview)
                ?? (scope.updatedAt > 0 ? Date(timeIntervalSince1970: scope.updatedAt) : nil),
            domain: .overview,
            country: country,
            signal: scope.overview
        )
    }
}

struct ClaritasWatchWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: claritasScopedWatchWidgetKind,
            intent: ClaritasWatchWidgetIntent.self,
            provider: ClaritasWatchProvider()
        ) { entry in
            ClaritasWatchWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    ClaritasWatchWidgetPalette.background
                }
                .widgetURL(entry.deepLink)
        }
        .configurationDisplayName("Claritas intelligence")
        .description("A configurable overview of news, markets, weather, and transport.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

private struct ClaritasLegacyWatchWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: claritasLegacyWatchWidgetKind,
            provider: ClaritasLegacyWatchProvider()
        ) { entry in
            ClaritasWatchWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    ClaritasWatchWidgetPalette.background
                }
                .widgetURL(entry.deepLink)
        }
        .configurationDisplayName("Claritas overview")
        .description("The current cross-domain signal overview from Claritas.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

private struct ClaritasWatchWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ClaritasWatchEntry

    @ViewBuilder
    var body: some View {
        switch family {
        case .accessoryInline:
            inlineView
        case .accessoryCircular:
            circularView
        default:
            rectangularView
        }
    }

    private var inlineView: some View {
        Label {
            Text("\(entry.scopeLabel) \(entry.domain.label): \(entry.signal.metric)\(inlineFreshnessSuffix)")
                .lineLimit(1)
        } icon: {
            Image(systemName: entry.domain.systemImage)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(.white)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(entry.accessibilitySummary)
        .accessibilityHint("Opens this signal in Claritas")
    }

    private var circularView: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 1) {
                HStack(spacing: 3) {
                    Image(systemName: entry.domain.systemImage)
                    Circle()
                        .fill(statusColor)
                        .frame(width: 5, height: 5)
                }
                .font(.caption2.weight(.bold))
                .foregroundStyle(ClaritasWatchWidgetPalette.cream)
                Text(entry.compactMetric)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.65)
                    .lineLimit(1)
                    .foregroundStyle(.white)
                Text(entry.scopeLabel)
                    .font(.system(size: 8, weight: .bold, design: .rounded))
                    .lineLimit(1)
                    .foregroundStyle(.white.opacity(0.82))
            }
            .padding(4)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(entry.accessibilitySummary)
        .accessibilityHint("Opens this signal in Claritas")
    }

    private var rectangularView: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: entry.domain.systemImage)
                    .foregroundStyle(ClaritasWatchWidgetPalette.cream)
                Text("\(entry.domain.label.uppercased()) · \(entry.scopeLabel)")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .lineLimit(1)
                Spacer(minLength: 2)
                Circle()
                    .fill(statusColor)
                    .frame(width: 5, height: 5)
                Text(entry.freshnessLabel)
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                    .foregroundStyle(
                        entry.updatedAt == nil
                            ? ClaritasWatchWidgetPalette.muted
                            : entry.isStale
                                ? ClaritasWatchWidgetPalette.warning
                                : .white.opacity(0.82)
                    )
            }

            Text(entry.signal.title)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .foregroundStyle(.white)

            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(entry.signal.detail)
                    .font(.system(size: 9))
                    .lineLimit(1)
                    .foregroundStyle(.white.opacity(0.78))
                Spacer(minLength: 2)
                Text(entry.signal.metric)
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .lineLimit(1)
                    .foregroundStyle(statusColor)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(entry.accessibilitySummary)
        .accessibilityHint("Opens this signal in Claritas")
    }

    private var statusColor: Color {
        if entry.updatedAt == nil || !entry.signal.available { return ClaritasWatchWidgetPalette.muted }
        if entry.isStale { return ClaritasWatchWidgetPalette.warning }
        switch entry.signal.level {
        case "caution": return ClaritasWatchWidgetPalette.warning
        case "positive": return ClaritasWatchWidgetPalette.positive
        default: return ClaritasWatchWidgetPalette.sage
        }
    }

    private var inlineFreshnessSuffix: String {
        if entry.updatedAt == nil { return " · open app" }
        return entry.isStale ? " · stale" : ""
    }
}

private enum ClaritasWatchWidgetPalette {
    static let background = Color(red: 5.0 / 255.0, green: 16.0 / 255.0, blue: 25.0 / 255.0)
    static let cream = Color(red: 244.0 / 255.0, green: 226.0 / 255.0, blue: 190.0 / 255.0)
    static let sage = Color(red: 126.0 / 255.0, green: 224.0 / 255.0, blue: 196.0 / 255.0)
    static let positive = Color(red: 104.0 / 255.0, green: 222.0 / 255.0, blue: 138.0 / 255.0)
    static let warning = Color(red: 255.0 / 255.0, green: 187.0 / 255.0, blue: 92.0 / 255.0)
    static let muted = Color.white.opacity(0.55)
}

private enum ClaritasWatchSnapshotLoader {
    static let staleInterval: TimeInterval = 2 * 60 * 60
    private static let snapshotKey = "claritas.watch.widget.snapshot"

    static func load() -> ClaritasWatchSnapshot? {
        let suiteName = Bundle.main.object(
            forInfoDictionaryKey: "CLARITAS_WATCH_WIDGET_APP_GROUP"
        ) as? String
        guard let defaults = suiteName.flatMap(UserDefaults.init(suiteName:)) else { return nil }

        if let data = defaults.data(forKey: snapshotKey),
           let snapshot = try? JSONDecoder().decode(ClaritasWatchSnapshot.self, from: data) {
            return snapshot
        }

        // One-release compatibility for snapshots written by the former
        // aggregate-only complication.
        guard let values = defaults.dictionary(forKey: snapshotKey), !values.isEmpty else { return nil }
        let newsCount = values["newsCount"] as? Int ?? 0
        let marketMove = values["marketDirection"] as? Double ?? 0
        let updatedAt = values["updatedAt"] as? TimeInterval ?? 0
        return .legacy(newsCount: newsCount, marketMove: marketMove, updatedAt: updatedAt)
    }
}

private struct ClaritasWatchSnapshot: Codable {
    let version: Int
    let updatedAt: TimeInterval
    let selectedCountry: String?
    let freshness: ClaritasWatchFreshness?
    let availableCountries: [String]
    let scopes: [ClaritasWatchScope]

    func scope(for country: String) -> ClaritasWatchScope {
        scopes.first { $0.country == country } ?? .empty(country: country, updatedAt: updatedAt)
    }

    static let placeholder = ClaritasWatchSnapshot(
        version: 3,
        updatedAt: Date().timeIntervalSince1970,
        selectedCountry: nil,
        freshness: .all(.now),
        availableCountries: ["DE", "GB", "US"],
        scopes: [.placeholder]
    )

    static let empty = ClaritasWatchSnapshot(
        version: 3,
        updatedAt: 0,
        selectedCountry: nil,
        freshness: .all(nil),
        availableCountries: [],
        scopes: [.empty(country: "", updatedAt: 0)]
    )

    static func legacy(newsCount: Int, marketMove: Double, updatedAt: TimeInterval) -> ClaritasWatchSnapshot {
        let scope = ClaritasWatchScope(
            country: "",
            updatedAt: updatedAt,
            freshness: .all(updatedAt > 0 ? Date(timeIntervalSince1970: updatedAt) : nil),
            overview: ClaritasWatchDomainValue(
                title: "Global intelligence pulse",
                detail: "\(newsCount) reports · markets \(String(format: "%+.1f%%", marketMove))",
                metric: "\(newsCount) reports",
                level: "normal",
                available: newsCount > 0
            ),
            news: ClaritasWatchDomainValue(
                title: "Open Claritas for recent reporting",
                detail: "Legacy snapshot",
                metric: "\(newsCount) reports",
                level: "normal",
                available: newsCount > 0
            ),
            markets: ClaritasWatchDomainValue(
                title: "Average market direction",
                detail: "Legacy snapshot",
                metric: String(format: "%+.1f%%", marketMove),
                level: abs(marketMove) >= 2 ? "caution" : "normal",
                available: true
            ),
            weather: .unavailable(title: "No weather snapshot"),
            transport: .unavailable(title: "No transport snapshot")
        )
        return ClaritasWatchSnapshot(
            version: 1,
            updatedAt: updatedAt,
            selectedCountry: nil,
            freshness: .all(updatedAt > 0 ? Date(timeIntervalSince1970: updatedAt) : nil),
            availableCountries: [],
            scopes: [scope]
        )
    }
}

private struct ClaritasWatchScope: Codable {
    let country: String
    let updatedAt: TimeInterval
    let freshness: ClaritasWatchFreshness?
    let overview: ClaritasWatchDomainValue
    let news: ClaritasWatchDomainValue
    let markets: ClaritasWatchDomainValue
    let weather: ClaritasWatchDomainValue
    let transport: ClaritasWatchDomainValue

    func value(for domain: ClaritasWatchWidgetDomain) -> ClaritasWatchDomainValue {
        switch domain {
        case .overview: return overview
        case .news: return news
        case .markets: return markets
        case .weather: return weather
        case .transport: return transport
        }
    }

    static let placeholder = ClaritasWatchScope(
        country: "",
        updatedAt: Date().timeIntervalSince1970,
        freshness: .all(.now),
        overview: ClaritasWatchDomainValue(
            title: "Regional disruption under review",
            detail: "8 reports · 6 markets · 2 weather alerts · 42 movements",
            metric: "2 priority",
            level: "caution",
            available: true
        ),
        news: ClaritasWatchDomainValue(
            title: "Latest reporting in chronological order",
            detail: "Reported by trusted sources",
            metric: "8 reports",
            level: "normal",
            available: true
        ),
        markets: ClaritasWatchDomainValue(
            title: "Market pulse",
            detail: "Leading instrument · +0.8%",
            metric: "+0.8%",
            level: "positive",
            available: true
        ),
        weather: ClaritasWatchDomainValue(
            title: "Clear skies",
            detail: "Berlin · No threshold alerts",
            metric: "22°",
            level: "normal",
            available: true
        ),
        transport: ClaritasWatchDomainValue(
            title: "42 active movements",
            detail: "30 flights · 12 vessels",
            metric: "42 active",
            level: "normal",
            available: true
        )
    )

    static func empty(country: String, updatedAt: TimeInterval) -> ClaritasWatchScope {
        let scope = country.isEmpty ? "global scope" : country
        return ClaritasWatchScope(
            country: country,
            updatedAt: updatedAt,
            freshness: .all(nil),
            overview: .unavailable(title: "No signals for \(scope)"),
            news: .unavailable(title: "No recent reporting"),
            markets: .unavailable(title: "No market quotes"),
            weather: .unavailable(title: "No weather observation"),
            transport: .unavailable(title: "No active movements")
        )
    }
}

private struct ClaritasWatchDomainValue: Codable {
    let title: String
    let detail: String
    let metric: String
    let level: String
    let available: Bool

    static func unavailable(title: String) -> ClaritasWatchDomainValue {
        ClaritasWatchDomainValue(
            title: title,
            detail: "Open Claritas to refresh this scope",
            metric: "—",
            level: "normal",
            available: false
        )
    }
}

private func normalizedISO2(_ raw: String?) -> String? {
    let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    guard let value, value.range(of: "^[A-Z]{2}$", options: .regularExpression) != nil else {
        return nil
    }
    return value == "UK" ? "GB" : value
}

@main
struct ClaritasWatchWidgets: WidgetBundle {
    @WidgetBundleBuilder
    var body: some Widget {
        ClaritasLegacyWatchWidget()
        ClaritasWatchWidget()
    }
}
