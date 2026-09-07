import AppIntents
import Foundation
import SwiftUI
import WidgetKit

private let claritasOverviewWidgetKind = "ClaritasBriefingWidget"
private let claritasScopedWidgetKind = "ClaritasScopedWidget"
private let claritasSnapshotKey = "claritas.widget.snapshot"

private enum ClaritasWidgetPalette {
    static let backgroundTop = Color(red: 8.0 / 255.0, green: 25.0 / 255.0, blue: 38.0 / 255.0)
    static let backgroundBottom = Color(red: 4.0 / 255.0, green: 14.0 / 255.0, blue: 23.0 / 255.0)
    static let primary = Color(red: 243.0 / 255.0, green: 247.0 / 255.0, blue: 250.0 / 255.0)
    static let secondary = Color(red: 178.0 / 255.0, green: 194.0 / 255.0, blue: 207.0 / 255.0)
    static let gold = Color(red: 224.0 / 255.0, green: 203.0 / 255.0, blue: 161.0 / 255.0)
    static let cyan = Color(red: 102.0 / 255.0, green: 211.0 / 255.0, blue: 222.0 / 255.0)
    static let green = Color(red: 113.0 / 255.0, green: 218.0 / 255.0, blue: 175.0 / 255.0)
    static let orange = Color(red: 249.0 / 255.0, green: 178.0 / 255.0, blue: 101.0 / 255.0)
    static let card = Color.white.opacity(0.075)

    static var background: LinearGradient {
        LinearGradient(
            colors: [backgroundTop, backgroundBottom],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

enum ClaritasWidgetDomain: String, CaseIterable, AppEnum {
    case overview
    case news
    case markets
    case weather
    case transport

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Signal domain"
    static var caseDisplayRepresentations: [ClaritasWidgetDomain: DisplayRepresentation] = [
        .overview: "Overview",
        .news: "News",
        .markets: "Markets",
        .weather: "Weather",
        .transport: "Transport"
    ]

    var title: String {
        switch self {
        case .overview: return "Intelligence overview"
        case .news: return "Latest reporting"
        case .markets: return "Market pulse"
        case .weather: return "Weather conditions"
        case .transport: return "Transport activity"
        }
    }

    var compactTitle: String {
        switch self {
        case .overview: return "Overview"
        case .news: return "News"
        case .markets: return "Markets"
        case .weather: return "Weather"
        case .transport: return "Transport"
        }
    }

    var symbol: String {
        switch self {
        case .overview: return "scope"
        case .news: return "newspaper.fill"
        case .markets: return "chart.line.uptrend.xyaxis"
        case .weather: return "cloud.sun.fill"
        case .transport: return "airplane.departure"
        }
    }

    var accent: Color {
        switch self {
        case .overview: return ClaritasWidgetPalette.gold
        case .news: return ClaritasWidgetPalette.cyan
        case .markets: return ClaritasWidgetPalette.green
        case .weather: return ClaritasWidgetPalette.gold
        case .transport: return ClaritasWidgetPalette.orange
        }
    }
}

private struct ClaritasWidgetFreshness {
    let overview: Date?
    let news: Date?
    let markets: Date?
    let weather: Date?
    let transport: Date?

    func date(for domain: ClaritasWidgetDomain) -> Date? {
        switch domain {
        case .overview: return overview
        case .news: return news
        case .markets: return markets
        case .weather: return weather
        case .transport: return transport
        }
    }

    var latestSignalDate: Date? {
        [news, markets, weather, transport].compactMap { $0 }.max()
    }

    static func all(_ date: Date?) -> ClaritasWidgetFreshness {
        ClaritasWidgetFreshness(
            overview: date,
            news: date,
            markets: date,
            weather: date,
            transport: date
        )
    }

    static let empty = ClaritasWidgetFreshness.all(nil)
}

struct ClaritasWidgetCountry: AppEntity, Hashable {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Country scope"
    static var defaultQuery = ClaritasWidgetCountryQuery()

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: id == "GLOBAL" ? "All available signals" : "Country · \(id)")
    }
}

struct ClaritasWidgetCountryQuery: EntityStringQuery {
    func entities(for identifiers: [ClaritasWidgetCountry.ID]) async throws -> [ClaritasWidgetCountry] {
        let identifiers = Set(identifiers.map { $0.uppercased() })
        return ClaritasWidgetSnapshotLoader.countryOptions().filter { identifiers.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [ClaritasWidgetCountry] {
        let term = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !term.isEmpty else { return ClaritasWidgetSnapshotLoader.countryOptions() }
        return ClaritasWidgetSnapshotLoader.countryOptions().filter {
            $0.id.lowercased().contains(term) || $0.name.lowercased().contains(term)
        }
    }

    func suggestedEntities() async throws -> [ClaritasWidgetCountry] {
        ClaritasWidgetSnapshotLoader.countryOptions()
    }

    func defaultResult() async -> ClaritasWidgetCountry? {
        ClaritasWidgetSnapshotLoader.defaultCountryOption()
    }
}

@available(iOS 17.0, *)
struct ClaritasWidgetIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Claritas overview"
    static var description = IntentDescription("Choose a country and the signal domain that is most useful at a glance.")

    @Parameter(title: "Domain", default: .overview)
    var domain: ClaritasWidgetDomain

    @Parameter(title: "Country")
    var country: ClaritasWidgetCountry?
}

private struct ClaritasScopeSnapshot: Identifiable {
    let code: String
    let name: String
    let newsCount: Int
    let newsMetricLabel: String
    let headline: String?
    let headlineBasis: String?
    let headlineAt: Date?
    let marketMove: Double?
    let marketCoverage: Int
    let weatherTemp: Double?
    let weatherCondition: String?
    let weatherObservedAt: Date?
    let transportActive: Int
    let transportAlerts: Int

    var id: String { code }

    static let placeholder = ClaritasScopeSnapshot(
        code: "GLOBAL",
        name: "Global",
        newsCount: 24,
        newsMetricLabel: "reports",
        headline: "Cross-source reporting is ready for analyst review",
        headlineBasis: "Published",
        headlineAt: .now.addingTimeInterval(-18 * 60),
        marketMove: 0.8,
        marketCoverage: 16,
        weatherTemp: 28,
        weatherCondition: "Partly cloudy",
        weatherObservedAt: .now.addingTimeInterval(-12 * 60),
        transportActive: 1_842,
        transportAlerts: 3
    )

    static func empty(code: String, name: String) -> ClaritasScopeSnapshot {
        ClaritasScopeSnapshot(
            code: code,
            name: name,
            newsCount: 0,
            newsMetricLabel: "reports",
            headline: nil,
            headlineBasis: nil,
            headlineAt: nil,
            marketMove: nil,
            marketCoverage: 0,
            weatherTemp: nil,
            weatherCondition: nil,
            weatherObservedAt: nil,
            transportActive: 0,
            transportAlerts: 0
        )
    }
}

private struct ClaritasWidgetSnapshot {
    let briefingTitle: String
    let briefingText: String
    let defaultCountry: String
    let global: ClaritasScopeSnapshot
    let countries: [ClaritasScopeSnapshot]
    let freshness: ClaritasWidgetFreshness

    static let placeholder = ClaritasWidgetSnapshot(
        briefingTitle: "Global intelligence overview",
        briefingText: "News, markets, weather and transport signals ready for review.",
        defaultCountry: "GLOBAL",
        global: .placeholder,
        countries: [
            ClaritasScopeSnapshot(
                code: "US",
                name: "United States",
                newsCount: 8,
                newsMetricLabel: "reports",
                headline: "Latest United States reporting",
                headlineBasis: "Published",
                headlineAt: .now.addingTimeInterval(-18 * 60),
                marketMove: 0.6,
                marketCoverage: 1,
                weatherTemp: 22,
                weatherCondition: "Clear",
                weatherObservedAt: .now.addingTimeInterval(-12 * 60),
                transportActive: 548,
                transportAlerts: 1
            )
        ],
        freshness: .all(.now.addingTimeInterval(-8 * 60))
    )

    static let empty = ClaritasWidgetSnapshot(
        briefingTitle: "Open Claritas to load intelligence",
        briefingText: "No saved snapshot is available on this device.",
        defaultCountry: "GLOBAL",
        global: .empty(code: "GLOBAL", name: "Global"),
        countries: [],
        freshness: .empty
    )

    func scope(countryID: String?, countryName: String? = nil) -> ClaritasScopeSnapshot {
        let requested = (countryID ?? defaultCountry).uppercased()
        if requested == "GLOBAL" { return global }
        return countries.first(where: { $0.code == requested })
            ?? .empty(
                code: requested,
                name: countryName
                    ?? Locale.current.localizedString(forRegionCode: requested)
                    ?? requested
            )
    }
}

private enum ClaritasWidgetSnapshotLoader {
    private static var suiteName: String? {
        Bundle.main.object(forInfoDictionaryKey: "CLARITAS_WIDGET_APP_GROUP") as? String
    }

    static func load() -> ClaritasWidgetSnapshot {
        guard let values = suiteName
            .flatMap(UserDefaults.init(suiteName:))?
            .dictionary(forKey: claritasSnapshotKey), !values.isEmpty else {
            return .empty
        }

        let schemaVersion = number(values["schemaVersion"])?.intValue ?? 0
        if schemaVersion >= 2,
           let globalValues = dictionary(values["global"]) {
            let global = parseScope(globalValues, fallbackCode: "GLOBAL", fallbackName: "Global")
            let countryValues = arrayOfDictionaries(values["countries"])
            let countries = countryValues.map {
                parseScope($0, fallbackCode: "—", fallbackName: "Country")
            }.filter { $0.code != "—" }
            let legacyUpdatedAt = date(values["updatedAt"])
            let freshness: ClaritasWidgetFreshness
            if schemaVersion >= 3, let freshnessValues = dictionary(values["freshness"]) {
                freshness = ClaritasWidgetFreshness(
                    overview: date(freshnessValues["overview"]),
                    news: date(freshnessValues["news"]),
                    markets: date(freshnessValues["markets"]),
                    weather: date(freshnessValues["weather"]),
                    transport: date(freshnessValues["transport"])
                )
            } else {
                freshness = .all(legacyUpdatedAt)
            }
            return ClaritasWidgetSnapshot(
                briefingTitle: string(values["briefingTitle"]) ?? "Global intelligence overview",
                briefingText: string(values["briefingText"])
                    ?? "Signals are ready for review in Claritas.",
                defaultCountry: string(values["defaultCountry"])?.uppercased() ?? "GLOBAL",
                global: global,
                countries: countries,
                freshness: freshness
            )
        }

        // Keeps widgets useful while an installed app upgrades its version-one
        // snapshot the next time it refreshes.
        let legacyScope = ClaritasScopeSnapshot(
            code: "GLOBAL",
            name: "Global",
            newsCount: integer(values["newsCount"]) ?? 0,
            newsMetricLabel: "reports",
            headline: nil,
            headlineBasis: nil,
            headlineAt: nil,
            marketMove: decimal(values["marketMove"]),
            marketCoverage: decimal(values["marketMove"]) == nil ? 0 : 1,
            weatherTemp: decimal(values["weatherTemp"]),
            weatherCondition: nil,
            weatherObservedAt: nil,
            transportActive: 0,
            transportAlerts: 0
        )
        return ClaritasWidgetSnapshot(
            briefingTitle: string(values["dailyTitle"]) ?? "Global intelligence overview",
            briefingText: string(values["dailyText"]) ?? "Open Claritas to refresh this overview.",
            defaultCountry: "GLOBAL",
            global: legacyScope,
            countries: [],
            freshness: .all(date(values["updatedAt"]))
        )
    }

    static func countryOptions() -> [ClaritasWidgetCountry] {
        let snapshot = load()
        var options = [ClaritasWidgetCountry(id: "GLOBAL", name: "Global")]
        options.append(contentsOf: snapshot.countries.map {
            ClaritasWidgetCountry(id: $0.code, name: $0.name)
        })
        return options.reduce(into: [ClaritasWidgetCountry]()) { result, option in
            guard !result.contains(where: { $0.id == option.id }) else { return }
            result.append(option)
        }
    }

    static func defaultCountryOption() -> ClaritasWidgetCountry? {
        let snapshot = load()
        return countryOptions().first(where: { $0.id == snapshot.defaultCountry })
            ?? countryOptions().first
    }

    private static func parseScope(
        _ values: [String: Any],
        fallbackCode: String,
        fallbackName: String
    ) -> ClaritasScopeSnapshot {
        ClaritasScopeSnapshot(
            code: string(values["code"])?.uppercased() ?? fallbackCode,
            name: string(values["name"]) ?? fallbackName,
            newsCount: integer(values["newsCount"]) ?? 0,
            newsMetricLabel: string(values["newsMetricLabel"]) ?? "reports",
            headline: string(values["headline"]),
            headlineBasis: string(values["headlineBasis"]),
            headlineAt: date(values["headlineAt"]),
            marketMove: decimal(values["marketMove"]),
            marketCoverage: integer(values["marketCoverage"]) ?? 0,
            weatherTemp: decimal(values["weatherTemp"]),
            weatherCondition: string(values["weatherCondition"]),
            weatherObservedAt: date(values["weatherObservedAt"]),
            transportActive: integer(values["transportActive"]) ?? 0,
            transportAlerts: integer(values["transportAlerts"]) ?? 0
        )
    }

    private static func dictionary(_ value: Any?) -> [String: Any]? {
        value as? [String: Any]
    }

    private static func arrayOfDictionaries(_ value: Any?) -> [[String: Any]] {
        value as? [[String: Any]] ?? []
    }

    private static func string(_ value: Any?) -> String? {
        guard let string = value as? String,
              !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return string
    }

    private static func number(_ value: Any?) -> NSNumber? {
        value as? NSNumber
    }

    private static func integer(_ value: Any?) -> Int? {
        number(value)?.intValue
    }

    private static func decimal(_ value: Any?) -> Double? {
        number(value)?.doubleValue
    }

    private static func date(_ value: Any?) -> Date? {
        decimal(value).map(Date.init(timeIntervalSince1970:))
    }
}

private struct ClaritasWidgetEntry: TimelineEntry {
    let date: Date
    let domain: ClaritasWidgetDomain
    let scope: ClaritasScopeSnapshot
    let snapshot: ClaritasWidgetSnapshot
    let usesSystemMargins: Bool

    var updatedAt: Date? {
        if domain == .overview {
            return [snapshot.freshness.overview, snapshot.freshness.latestSignalDate]
                .compactMap { $0 }
                .max()
        }
        return snapshot.freshness.date(for: domain)
    }

    var isStale: Bool {
        guard let updatedAt else { return true }
        return date.timeIntervalSince(updatedAt) > 2 * 60 * 60
    }

    var destination: URL? {
        var components = URLComponents()
        components.scheme = "claritas"
        components.host = "widget"
        components.queryItems = [
            URLQueryItem(name: "domain", value: domain.rawValue),
            URLQueryItem(name: "country", value: scope.code)
        ]
        return components.url
    }
}

private struct ClaritasLegacyWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> ClaritasWidgetEntry {
        entry(snapshot: .placeholder, domain: .overview, countryID: "GLOBAL", countryName: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (ClaritasWidgetEntry) -> Void) {
        let snapshot = context.isPreview ? ClaritasWidgetSnapshot.placeholder : ClaritasWidgetSnapshotLoader.load()
        completion(entry(snapshot: snapshot, domain: .overview, countryID: "GLOBAL", countryName: nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ClaritasWidgetEntry>) -> Void) {
        let snapshot = ClaritasWidgetSnapshotLoader.load()
        let value = entry(snapshot: snapshot, domain: .overview, countryID: "GLOBAL", countryName: nil)
        completion(Timeline(entries: [value], policy: .after(.now.addingTimeInterval(30 * 60))))
    }

    private func entry(
        snapshot: ClaritasWidgetSnapshot,
        domain: ClaritasWidgetDomain,
        countryID: String?,
        countryName: String?
    ) -> ClaritasWidgetEntry {
        ClaritasWidgetEntry(
            date: .now,
            domain: domain,
            scope: snapshot.scope(countryID: countryID, countryName: countryName),
            snapshot: snapshot,
            usesSystemMargins: {
                if #available(iOS 17.0, *) { return true }
                return false
            }()
        )
    }
}

@available(iOS 17.0, *)
private struct ClaritasIntentWidgetProvider: AppIntentTimelineProvider {
    func recommendations() -> [AppIntentRecommendation<ClaritasWidgetIntent>] {
        []
    }

    func placeholder(in context: Context) -> ClaritasWidgetEntry {
        ClaritasWidgetEntry(
            date: .now,
            domain: .overview,
            scope: ClaritasWidgetSnapshot.placeholder.global,
            snapshot: .placeholder,
            usesSystemMargins: false
        )
    }

    func snapshot(for configuration: ClaritasWidgetIntent, in context: Context) async -> ClaritasWidgetEntry {
        makeEntry(
            snapshot: context.isPreview ? .placeholder : ClaritasWidgetSnapshotLoader.load(),
            configuration: configuration
        )
    }

    func timeline(for configuration: ClaritasWidgetIntent, in context: Context) async -> Timeline<ClaritasWidgetEntry> {
        let entry = makeEntry(snapshot: ClaritasWidgetSnapshotLoader.load(), configuration: configuration)
        return Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(30 * 60)))
    }

    private func makeEntry(
        snapshot: ClaritasWidgetSnapshot,
        configuration: ClaritasWidgetIntent
    ) -> ClaritasWidgetEntry {
        ClaritasWidgetEntry(
            date: .now,
            domain: configuration.domain,
            scope: snapshot.scope(
                countryID: configuration.country?.id,
                countryName: configuration.country?.name
            ),
            snapshot: snapshot,
            usesSystemMargins: false
        )
    }
}

@available(iOS 17.0, *)
private struct ClaritasConfigurableBriefingWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: claritasScopedWidgetKind,
            intent: ClaritasWidgetIntent.self,
            provider: ClaritasIntentWidgetProvider()
        ) { entry in
            ClaritasWidgetView(entry: entry)
        }
        .configurationDisplayName("Claritas scoped intelligence")
        .description("A country-scoped overview of news, markets, weather or transport signals.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

private struct ClaritasLegacyBriefingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: claritasOverviewWidgetKind, provider: ClaritasLegacyWidgetProvider()) { entry in
            ClaritasWidgetView(entry: entry)
        }
        .configurationDisplayName("Claritas global overview")
        .description("A concise overview of current cross-domain signals.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

private struct ClaritasWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ClaritasWidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: family == .systemSmall ? 8 : 10) {
            header
            if family == .systemSmall {
                compactContent
            } else if family == .systemMedium {
                mediumContent
            } else {
                largeContent
            }
            freshnessFooter
        }
        .padding(entry.usesSystemMargins ? 0 : (family == .systemSmall ? 13 : 16))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .foregroundStyle(ClaritasWidgetPalette.primary)
        .claritasWidgetBackground()
        .widgetURL(entry.destination)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Claritas \(entry.domain.compactTitle), \(entry.scope.name)")
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "globe.europe.africa.fill")
                .foregroundStyle(ClaritasWidgetPalette.gold)
            Text("CLARITAS")
                .font(.caption2.weight(.heavy))
                .tracking(0.8)
            Spacer(minLength: 4)
            Text(entry.scope.code)
                .font(.caption2.monospaced().weight(.bold))
                .foregroundStyle(ClaritasWidgetPalette.secondary)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(ClaritasWidgetPalette.card, in: Capsule())
        }
    }

    @ViewBuilder
    private var compactContent: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(entry.domain.compactTitle, systemImage: entry.domain.symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(entry.domain.accent)
                .lineLimit(1)
            compactPrimary
            compactContext
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private var compactPrimary: some View {
        switch entry.domain {
        case .overview, .news:
            metricValue("\(entry.scope.newsCount)", label: entry.scope.newsMetricLabel)
        case .markets:
            metricValue(marketText, label: entry.scope.marketCoverage > 0 ? "composite move" : "no market data")
        case .weather:
            metricValue(temperatureText, label: entry.scope.weatherCondition ?? "no weather data")
        case .transport:
            metricValue(compactNumber(entry.scope.transportActive), label: "active movements")
        }
    }

    @ViewBuilder
    private var compactContext: some View {
        switch entry.domain {
        case .overview:
            HStack(spacing: 9) {
                Label(marketText, systemImage: "chart.line.uptrend.xyaxis")
                Label(temperatureText, systemImage: "cloud.sun.fill")
            }
            .font(.caption2.monospacedDigit())
            .foregroundStyle(ClaritasWidgetPalette.secondary)
        case .news:
            Text(entry.scope.headline ?? "Open Claritas to refresh reporting.")
                .font(.caption2.weight(.medium))
                .foregroundStyle(ClaritasWidgetPalette.secondary)
                .lineLimit(2)
        case .markets:
            Text(entry.scope.marketCoverage > 0 ? "Across \(entry.scope.marketCoverage) market scope\(entry.scope.marketCoverage == 1 ? "" : "s")" : "Open Claritas to refresh coverage.")
                .font(.caption2)
                .foregroundStyle(ClaritasWidgetPalette.secondary)
                .lineLimit(2)
        case .weather:
            Text(entry.scope.weatherCondition ?? "Open Claritas to refresh conditions.")
                .font(.caption2)
                .foregroundStyle(ClaritasWidgetPalette.secondary)
                .lineLimit(2)
        case .transport:
            Text("\(entry.scope.transportAlerts) alert\(entry.scope.transportAlerts == 1 ? "" : "s") in the current overview")
                .font(.caption2)
                .foregroundStyle(ClaritasWidgetPalette.secondary)
                .lineLimit(2)
        }
    }

    private var mediumContent: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Label(entry.domain.title, systemImage: entry.domain.symbol)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(entry.domain.accent)
                    .lineLimit(1)
                domainPrimary
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Divider().overlay(Color.white.opacity(0.16))
            VStack(alignment: .leading, spacing: 7) {
                contextHeading
                contextDetail(lineLimit: 2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var largeContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(entry.domain.title, systemImage: entry.domain.symbol)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(entry.domain.accent)
                Spacer()
                Text(entry.scope.name)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(ClaritasWidgetPalette.secondary)
                    .lineLimit(1)
            }
            HStack(spacing: 8) {
                overviewTile("REPORTS", value: "\(entry.scope.newsCount)", symbol: "newspaper.fill")
                overviewTile("MARKETS", value: marketText, symbol: "chart.line.uptrend.xyaxis")
            }
            HStack(spacing: 8) {
                overviewTile("WEATHER", value: temperatureText, symbol: "cloud.sun.fill")
                overviewTile("TRANSPORT", value: compactNumber(entry.scope.transportActive), symbol: "airplane.departure")
            }
            VStack(alignment: .leading, spacing: 6) {
                contextHeading
                contextDetail(lineLimit: entry.domain == .overview ? 4 : 5)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(ClaritasWidgetPalette.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder
    private var domainPrimary: some View {
        switch entry.domain {
        case .overview:
            Text(overviewTitle)
                .font(.title3.weight(.bold))
                .lineLimit(2)
        case .news:
            metricValue("\(entry.scope.newsCount)", label: entry.scope.newsMetricLabel)
        case .markets:
            metricValue(marketText, label: entry.scope.marketCoverage > 0 ? "composite move" : "no market data")
        case .weather:
            metricValue(temperatureText, label: entry.scope.weatherCondition ?? "no weather data")
        case .transport:
            metricValue(compactNumber(entry.scope.transportActive), label: "active movements")
        }
    }

    private var contextHeading: some View {
        Text(contextHeadingText.uppercased())
            .font(.caption2.weight(.heavy))
            .tracking(0.7)
            .foregroundStyle(ClaritasWidgetPalette.secondary)
    }

    private var contextHeadingText: String {
        switch entry.domain {
        case .overview: return entry.scope.code == "GLOBAL" ? "Analyst briefing" : "Country overview"
        case .news: return entry.scope.headlineBasis ?? "Latest reporting"
        case .markets: return "Coverage"
        case .weather: return "Observed condition"
        case .transport: return "Operational overview"
        }
    }

    @ViewBuilder
    private func contextDetail(lineLimit: Int) -> some View {
        switch entry.domain {
        case .overview:
            Text(overviewDetail)
                .font(.caption)
                .foregroundStyle(ClaritasWidgetPalette.primary)
                .lineLimit(lineLimit)
        case .news:
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.scope.headline ?? "No current reporting in this scope.")
                    .font(.caption.weight(.semibold))
                    .lineLimit(lineLimit)
                if let headlineAt = entry.scope.headlineAt {
                    HStack(spacing: 4) {
                        Text(entry.scope.headlineBasis ?? "Reported")
                        Text(headlineAt, style: .relative)
                    }
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(ClaritasWidgetPalette.secondary)
                }
                Text("Reporting is an attributed signal, not a verified fact.")
                    .font(.caption2)
                    .foregroundStyle(ClaritasWidgetPalette.secondary)
                    .lineLimit(2)
            }
        case .markets:
            Text(entry.scope.marketCoverage > 0
                 ? "Composite movement from \(entry.scope.marketCoverage) available market scope\(entry.scope.marketCoverage == 1 ? "" : "s")."
                 : "No current market coverage for this country scope.")
                .font(.caption)
                .lineLimit(lineLimit)
        case .weather:
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.scope.weatherCondition.map { "\($0). Current observed temperature: \(temperatureText)." }
                     ?? "No current weather observation for this country scope.")
                    .font(.caption)
                    .lineLimit(lineLimit)
                if let observedAt = entry.scope.weatherObservedAt {
                    HStack(spacing: 4) {
                        Text("Observed")
                        Text(observedAt, style: .relative)
                    }
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(ClaritasWidgetPalette.secondary)
                }
            }
        case .transport:
            Text("\(entry.scope.transportActive) active movement\(entry.scope.transportActive == 1 ? "" : "s") and \(entry.scope.transportAlerts) alert\(entry.scope.transportAlerts == 1 ? "" : "s") in the current overview.")
                .font(.caption)
                .lineLimit(lineLimit)
        }
    }

    private func metricValue(_ value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value)
                .font(.title2.monospacedDigit().weight(.bold))
                .foregroundStyle(ClaritasWidgetPalette.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(label)
                .font(.caption2.weight(.medium))
                .foregroundStyle(ClaritasWidgetPalette.secondary)
                .lineLimit(1)
        }
    }

    private func overviewTile(_ label: String, value: String, symbol: String) -> some View {
        HStack(spacing: 7) {
            Image(systemName: symbol)
                .font(.caption.weight(.bold))
                .foregroundStyle(entry.domain.accent)
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(.system(size: 9, weight: .heavy))
                    .tracking(0.5)
                    .foregroundStyle(ClaritasWidgetPalette.secondary)
                Text(value)
                    .font(.subheadline.monospacedDigit().weight(.bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            Spacer(minLength: 0)
        }
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ClaritasWidgetPalette.card, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
    }

    private var freshnessFooter: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(
                    entry.updatedAt == nil
                        ? ClaritasWidgetPalette.secondary
                        : entry.isStale
                            ? ClaritasWidgetPalette.orange
                            : ClaritasWidgetPalette.green
                )
                .frame(width: 5, height: 5)
            if let updatedAt = entry.updatedAt {
                Text(entry.isStale ? "Snapshot may be stale" : "Updated")
                Text(updatedAt, style: .relative)
            } else {
                Text("Open Claritas to refresh")
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right")
        }
        .font(.system(size: 9, weight: .medium))
        .foregroundStyle(ClaritasWidgetPalette.secondary)
        .lineLimit(1)
    }

    private var marketText: String {
        entry.scope.marketMove.map { String(format: "%+.1f%%", $0) } ?? "—"
    }

    private var temperatureText: String {
        entry.scope.weatherTemp.map { String(format: "%.0f°", $0) } ?? "—"
    }

    private var overviewTitle: String {
        guard entry.scope.code != "GLOBAL" else { return entry.snapshot.briefingTitle }
        return entry.scope.headline ?? "\(entry.scope.name) intelligence overview"
    }

    private var overviewDetail: String {
        guard entry.scope.code != "GLOBAL" else { return entry.snapshot.briefingText }
        let reports = "\(entry.scope.newsCount) \(entry.scope.newsMetricLabel)"
        let markets = entry.scope.marketCoverage > 0 ? "markets \(marketText)" : "no market coverage"
        let weather = entry.scope.weatherTemp == nil ? "no weather observation" : "weather \(temperatureText)"
        let transport = "\(entry.scope.transportActive) active movements"
        return [reports, markets, weather, transport].joined(separator: " · ")
    }

    private func compactNumber(_ value: Int) -> String {
        if value >= 1_000_000 { return String(format: "%.1fM", Double(value) / 1_000_000) }
        if value >= 1_000 { return String(format: "%.1fK", Double(value) / 1_000) }
        return "\(value)"
    }
}

private struct ClaritasWidgetBackgroundModifier: ViewModifier {
    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.containerBackground(for: .widget) {
                ClaritasWidgetPalette.background
            }
        } else {
            content.background(ClaritasWidgetPalette.background)
        }
    }
}

private extension View {
    func claritasWidgetBackground() -> some View {
        modifier(ClaritasWidgetBackgroundModifier())
    }
}

@main
struct ClaritasWidgets: WidgetBundle {
    @WidgetBundleBuilder
    var body: some Widget {
        ClaritasLegacyBriefingWidget()
        if #available(iOS 17.0, *) {
            ClaritasConfigurableBriefingWidget()
        }
    }
}
