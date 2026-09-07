import Foundation
import WidgetKit

struct WatchWidgetFreshness: Codable {
    var overview: Date?
    var news: Date?
    var markets: Date?
    var weather: Date?
    var transport: Date?

    static let empty = WatchWidgetFreshness(
        overview: nil,
        news: nil,
        markets: nil,
        weather: nil,
        transport: nil
    )

    var latest: Date? {
        [overview, news, markets, weather, transport].compactMap { $0 }.max()
    }

    var withDerivedOverview: WatchWidgetFreshness {
        var value = self
        value.overview = latest
        return value
    }
}

/// Writes a compact, presentation-ready snapshot for the watch complication.
///
/// Widget extensions should not depend on the app's model graph. Keeping this
/// payload deliberately small also makes reads from the shared app-group
/// defaults fast enough for complication timeline generation.
enum WatchWidgetSnapshotStore {
    private static let suiteName = Bundle.main.object(
        forInfoDictionaryKey: "CLARITAS_WATCH_WIDGET_APP_GROUP"
    ) as? String
    private static let snapshotKey = "claritas.watch.widget.snapshot"
    private static let schemaVersion = 3
    private static let retainedScopeLifetime: TimeInterval = 7 * 24 * 60 * 60

    static func save(
        news: [NewsItem],
        markets: [MarketQuote],
        weather: [CountryWeather],
        transport: TransportOverview?,
        intelligenceEvents: [IntelligenceEvent],
        selectedCountry: String?,
        freshness: WatchWidgetFreshness
    ) {
        guard let defaults = suiteName.flatMap(UserDefaults.init(suiteName:)) else { return }

        let timestamp = freshness.latest?.timeIntervalSince1970 ?? 0
        let retentionTimestamp = Date().timeIntervalSince1970
        let normalizedSelection = normalizedISO2(selectedCountry)
        let chronologicalNews = NewsChronology.sorted(news, order: .newestFirst)
        let currentCountries = normalizedSelection.map { [$0] } ?? discoveredCountries(
            news: chronologicalNews,
            markets: markets,
            weather: weather,
            transport: transport,
            intelligenceEvents: intelligenceEvents,
            selectedCountry: nil
        )

        var scopes: [Scope] = []
        if normalizedSelection == nil {
            scopes.append(makeScope(
                country: nil,
                news: chronologicalNews,
                markets: markets,
                weather: weather,
                transport: transport,
                intelligenceEvents: intelligenceEvents,
                updatedAt: timestamp,
                freshness: freshness
            ))
        }
        scopes.append(contentsOf: currentCountries.map {
            makeScope(
                country: $0,
                news: chronologicalNews,
                markets: markets,
                weather: weather,
                transport: transport,
                intelligenceEvents: intelligenceEvents,
                updatedAt: timestamp,
                freshness: freshness
            )
        })

        // Preserve recently visited country scopes. The watch only downloads
        // one news/transport country scope per refresh, so replacing every
        // record would make another configured complication go blank.
        if let previousData = defaults.data(forKey: snapshotKey),
           let previous = try? JSONDecoder().decode(Payload.self, from: previousData) {
            let freshCountries = Set(scopes.map(\.country))
            scopes.append(contentsOf: previous.scopes.filter {
                !freshCountries.contains($0.country) &&
                    $0.updatedAt > 0 &&
                    retentionTimestamp - $0.updatedAt <= retainedScopeLifetime
            })
        }

        let payload = Payload(
            version: schemaVersion,
            updatedAt: timestamp,
            selectedCountry: normalizedSelection,
            freshness: freshness,
            availableCountries: scopes
                .map(\.country)
                .filter { !$0.isEmpty }
                .sorted(),
            scopes: scopes
        )
        guard let data = try? JSONEncoder().encode(payload) else { return }
        defaults.set(data, forKey: snapshotKey)
        WidgetCenter.shared.reloadTimelines(ofKind: "ClaritasWatchWidget")
        WidgetCenter.shared.reloadTimelines(ofKind: "ClaritasWatchScopedWidget")
    }

    static func clear() {
        guard let defaults = suiteName.flatMap(UserDefaults.init(suiteName:)) else { return }
        defaults.removeObject(forKey: snapshotKey)
        WidgetCenter.shared.reloadTimelines(ofKind: "ClaritasWatchWidget")
        WidgetCenter.shared.reloadTimelines(ofKind: "ClaritasWatchScopedWidget")
    }

    private static func discoveredCountries(
        news: [NewsItem],
        markets: [MarketQuote],
        weather: [CountryWeather],
        transport: TransportOverview?,
        intelligenceEvents: [IntelligenceEvent],
        selectedCountry: String?
    ) -> [String] {
        var countries = Set<String>()
        news.flatMap(\.subjectCountries).compactMap { normalizedISO2($0) }.forEach { countries.insert($0) }
        markets.compactMap { normalizedISO2($0.country) }.forEach { countries.insert($0) }
        weather.compactMap { normalizedISO2($0.country) }.forEach { countries.insert($0) }
        transport?.countries.compactMap { normalizedISO2($0.country) }.forEach { countries.insert($0) }
        intelligenceEvents.compactMap { normalizedISO2($0.primary_country_iso2) }.forEach { countries.insert($0) }
        if let selectedCountry { countries.insert(selectedCountry) }
        return countries.sorted()
    }

    private static func makeScope(
        country: String?,
        news: [NewsItem],
        markets: [MarketQuote],
        weather: [CountryWeather],
        transport: TransportOverview?,
        intelligenceEvents: [IntelligenceEvent],
        updatedAt: TimeInterval,
        freshness: WatchWidgetFreshness
    ) -> Scope {
        let scopedNews = country.map { iso in news.filter { $0.hasSubjectCountry(iso) } } ?? news
        let scopedMarkets = country.map { iso in
            markets.filter { normalizedISO2($0.country) == iso }
        } ?? markets
        let scopedWeather = country.map { iso in
            weather.filter { normalizedISO2($0.country) == iso }
        } ?? weather
        let scopedEvents = country.map { iso in
            intelligenceEvents.filter { normalizedISO2($0.primary_country_iso2) == iso }
        } ?? intelligenceEvents
        let countryTransport = country.flatMap { iso in
            transport?.countries.first { normalizedISO2($0.country) == iso }
        }

        let weatherAlertCount = scopedWeather.filter(isWeatherAlert).count
        let marketBreachCount = scopedMarkets.filter { abs($0.percent_change ?? 0) >= 2 }.count
        let priorityEventCount = scopedEvents.filter {
            $0.severity == .critical || $0.severity == .high
        }.count
        let transportAlertCount: Int
        if let country {
            let linkedAlerts = transport?.entities.filter {
                $0.is_alert && entity($0, isLinkedTo: country)
            }.count ?? 0
            let responseIsCountryScoped = transport?.countries.count == 1
                && normalizedISO2(transport?.countries.first?.country) == country
            transportAlertCount = linkedAlerts > 0 || !responseIsCountryScoped
                ? linkedAlerts
                : transport?.summary.alerts ?? 0
        } else {
            transportAlertCount = transport?.summary.alerts ?? 0
        }
        let priorityCount = priorityEventCount + weatherAlertCount + marketBreachCount + transportAlertCount

        let movementCount = countryTransport?.active_count ?? (country == nil ? transport?.summary.active : nil) ?? 0
        let flightCount = countryTransport?.aviation.active ?? (country == nil ? transport?.summary.modes.aviation.active : nil) ?? 0
        let vesselCount = countryTransport?.maritime.active ?? (country == nil ? transport?.summary.modes.maritime.active : nil) ?? 0

        let leadingEvent = scopedEvents.max {
            if severityRank($0.severity) == severityRank($1.severity) {
                return $0.last_activity_time < $1.last_activity_time
            }
            return severityRank($0.severity) < severityRank($1.severity)
        }
        let overviewTitle = leadingEvent?.title ?? scopedNews.first?.presentationTitle ?? "No current priority signals"
        let overviewDetail = [
            "\(scopedNews.count) reports",
            "\(scopedMarkets.count) markets",
            "\(weatherAlertCount) weather alerts",
            "\(movementCount) movements"
        ].joined(separator: " · ")

        let leadingNews = scopedNews.first
        let newsPublisher = firstNonBlank(leadingNews?.publisher, leadingNews?.source_name) ?? "Source pending"

        let averageMove = average(scopedMarkets.compactMap(\.percent_change))
        let leadingMarket = scopedMarkets.max {
            abs($0.percent_change ?? 0) < abs($1.percent_change ?? 0)
        }
        let marketTitle = leadingMarket.map {
            firstNonBlank($0.company_name, $0.canonical_symbol, $0.symbol) ?? $0.symbol
        } ?? "No market quotes"
        let marketDetail = leadingMarket.map {
            let symbol = firstNonBlank($0.canonical_symbol, $0.symbol) ?? $0.symbol
            return "\(symbol) · \(formatPercent($0.percent_change ?? 0))"
        } ?? "No quote available for this scope"

        let leadingWeather = scopedWeather.first(where: isWeatherAlert) ?? scopedWeather.first
        let weatherMetric = leadingWeather?.temp_c.map { "\(Int($0.rounded()))°" } ?? "—"
        let weatherTitle = firstNonBlank(
            leadingWeather?.weather_desc?.capitalized,
            leadingWeather?.weather_main,
            leadingWeather?.location_name
        ) ?? "No weather observation"
        let weatherDetail: String
        if let leadingWeather {
            let location = firstNonBlank(leadingWeather.location_name, normalizedISO2(leadingWeather.country)) ?? "Selected scope"
            weatherDetail = weatherAlertCount > 0
                ? "\(location) · \(weatherAlertCount) threshold alert\(weatherAlertCount == 1 ? "" : "s")"
                : "\(location) · No threshold alerts"
        } else {
            weatherDetail = "No observation available for this scope"
        }

        return Scope(
            country: country ?? "",
            updatedAt: updatedAt,
            freshness: freshness,
            overview: DomainValue(
                title: overviewTitle,
                detail: overviewDetail,
                metric: priorityCount > 0 ? "\(priorityCount) priority" : "Clear",
                level: priorityCount > 0 ? "caution" : "normal",
                available: !scopedNews.isEmpty ||
                    !scopedMarkets.isEmpty ||
                    !scopedWeather.isEmpty ||
                    movementCount > 0 ||
                    !scopedEvents.isEmpty
            ),
            news: DomainValue(
                title: leadingNews?.presentationTitle ?? "No recent reporting",
                detail: leadingNews == nil ? "No report available for this scope" : "Reported by \(newsPublisher)",
                metric: "\(scopedNews.count) report\(scopedNews.count == 1 ? "" : "s")",
                level: "normal",
                available: leadingNews != nil
            ),
            markets: DomainValue(
                title: marketTitle,
                detail: marketDetail,
                metric: scopedMarkets.isEmpty ? "—" : formatPercent(averageMove),
                level: abs(averageMove) >= 2 ? "caution" : (averageMove > 0 ? "positive" : "normal"),
                available: !scopedMarkets.isEmpty
            ),
            weather: DomainValue(
                title: weatherTitle,
                detail: weatherDetail,
                metric: weatherMetric,
                level: weatherAlertCount > 0 ? "caution" : "normal",
                available: leadingWeather != nil
            ),
            transport: DomainValue(
                title: movementCount > 0 ? "\(movementCount) active movements" : "No active movements",
                detail: "\(flightCount) flights · \(vesselCount) vessels",
                metric: transportAlertCount > 0
                    ? "\(transportAlertCount) alert\(transportAlertCount == 1 ? "" : "s")"
                    : "\(movementCount) active",
                level: transportAlertCount > 0 ? "caution" : "normal",
                available: countryTransport != nil || (country == nil && transport != nil)
            )
        )
    }

    private static func entity(_ entity: TransportEntity, isLinkedTo country: String) -> Bool {
        [
            entity.current_country_iso2,
            entity.origin_country_iso2,
            entity.destination_country_iso2,
            entity.registration_country_iso2
        ].compactMap { normalizedISO2($0) }.contains(country) ||
            entity.country_links.contains { normalizedISO2($0.country) == country }
    }

    private static func isWeatherAlert(_ item: CountryWeather) -> Bool {
        (item.temp_c.map { $0 >= 35 || $0 <= 0 } ?? false) ||
            (item.humidity.map { $0 >= 85 } ?? false) ||
            (item.wind_speed.map { $0 >= 15 } ?? false) ||
            (item.alert_count ?? 0) > 0
    }

    private static func severityRank(_ severity: IntelligenceSeverity) -> Int {
        switch severity {
        case .low: return 0
        case .medium: return 1
        case .high: return 2
        case .critical: return 3
        }
    }

    private static func average(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        return values.reduce(0, +) / Double(values.count)
    }

    private static func formatPercent(_ value: Double) -> String {
        String(format: "%+.1f%%", value)
    }

    private static func firstNonBlank(_ values: String?...) -> String? {
        values.lazy.compactMap {
            let value = $0?.trimmingCharacters(in: .whitespacesAndNewlines)
            return value?.isEmpty == false ? value : nil
        }.first
    }

    private static func normalizedISO2(_ raw: String?) -> String? {
        let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard let value, value.range(of: "^[A-Z]{2}$", options: .regularExpression) != nil else {
            return nil
        }
        return value == "UK" ? "GB" : value
    }
}

private struct Payload: Codable {
    let version: Int
    let updatedAt: TimeInterval
    let selectedCountry: String?
    let freshness: WatchWidgetFreshness?
    let availableCountries: [String]
    let scopes: [Scope]
}

private struct Scope: Codable {
    let country: String
    let updatedAt: TimeInterval
    let freshness: WatchWidgetFreshness?
    let overview: DomainValue
    let news: DomainValue
    let markets: DomainValue
    let weather: DomainValue
    let transport: DomainValue
}

private struct DomainValue: Codable {
    let title: String
    let detail: String
    let metric: String
    let level: String
    let available: Bool
}
