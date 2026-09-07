import Foundation
import WidgetKit

struct WidgetSnapshotFreshness {
    var overview: Date?
    var news: Date?
    var markets: Date?
    var weather: Date?
    var transport: Date?

    static let empty = WidgetSnapshotFreshness(
        overview: nil,
        news: nil,
        markets: nil,
        weather: nil,
        transport: nil
    )

    var latest: Date? {
        [overview, news, markets, weather, transport].compactMap { $0 }.max()
    }

    var propertyList: [String: TimeInterval] {
        var values: [String: TimeInterval] = [:]
        if let overview { values["overview"] = overview.timeIntervalSince1970 }
        if let news { values["news"] = news.timeIntervalSince1970 }
        if let markets { values["markets"] = markets.timeIntervalSince1970 }
        if let weather { values["weather"] = weather.timeIntervalSince1970 }
        if let transport { values["transport"] = transport.timeIntervalSince1970 }
        return values
    }
}

/// Persists a bounded, non-sensitive presentation snapshot for WidgetKit.
/// Widgets never make authenticated network requests; they render the most
/// recent cross-domain data the containing app has already loaded.
enum WidgetSnapshotStore {
    private static let suiteName = Bundle.main.object(forInfoDictionaryKey: "CLARITAS_WIDGET_APP_GROUP") as? String
    private static let snapshotKey = "claritas.widget.snapshot"

    static func save(
        news: [NewsItem],
        newsTotal: Int?,
        newsScopeCountry: String?,
        countryStats: [CountryStat],
        countryMarkets: [CountryMarketOverview],
        weather: [CountryWeather],
        transport: TransportOverview?,
        transportDetail: TransportOverview?,
        briefing: DailySignalBriefing?,
        selectedCountry: String?,
        freshness: WidgetSnapshotFreshness
    ) {
        guard let defaults = suiteName.flatMap(UserDefaults.init(suiteName:)) else { return }

        let sortedNews = NewsChronology.sorted(news, order: .newestFirst)
        let normalizedNewsScope = normalizeCountry(newsScopeCountry)
        let normalizedSelection = normalizeCountry(selectedCountry)
        var statsByCountry: [String: CountryStat] = [:]
        countryStats.forEach { row in
            if let country = normalizeCountry(row.country) { statsByCountry[country] = row }
        }
        var marketsByCountry: [String: CountryMarketOverview] = [:]
        countryMarkets.forEach { row in
            if let country = normalizeCountry(row.country) { marketsByCountry[country] = row }
        }
        var transportByCountry: [String: TransportCountryAggregate] = [:]
        (transport?.countries ?? []).forEach { row in
            if let country = normalizeCountry(row.country) { transportByCountry[country] = row }
        }
        var transportAlertsByCountry: [String: Int] = [:]
        for entity in transportDetail?.entities ?? transport?.entities ?? [] where entity.is_alert {
            for country in entityCountries(entity) {
                transportAlertsByCountry[country, default: 0] += 1
            }
        }
        if let normalizedSelection,
           transportDetail?.countries.count == 1,
           normalizeCountry(transportDetail?.countries.first?.country) == normalizedSelection {
            transportAlertsByCountry[normalizedSelection] = max(
                transportAlertsByCountry[normalizedSelection] ?? 0,
                transportDetail?.summary.alerts ?? 0
            )
        }
        var latestWeatherByCountry: [String: CountryWeather] = [:]
        for row in weather {
            guard let country = normalizeCountry(row.country) else { continue }
            guard let current = latestWeatherByCountry[country] else {
                latestWeatherByCountry[country] = row
                continue
            }
            if (row.observedDate ?? .distantPast) > (current.observedDate ?? .distantPast) {
                latestWeatherByCountry[country] = row
            }
        }

        var countryCodes = Set(statsByCountry.keys)
        countryCodes.formUnion(marketsByCountry.keys)
        countryCodes.formUnion(latestWeatherByCountry.keys)
        countryCodes.formUnion(transportByCountry.keys)
        sortedNews.flatMap(\.subjectCountries).forEach { country in
            if let country = normalizeCountry(country) { countryCodes.insert(country) }
        }
        if let normalizedSelection { countryCodes.insert(normalizedSelection) }

        let countryRows = countryCodes.map { country -> [String: Any] in
            let countryNews = sortedNews.filter { item in
                item.subjectCountries.contains { normalizeCountry($0) == country }
            }
            return snapshotRow(
                country: country,
                newsCount: statsByCountry[country]?.count ?? countryNews.count,
                newsMetricLabel: "reports",
                headline: countryNews.first,
                market: marketsByCountry[country],
                weather: latestWeatherByCountry[country],
                transport: transportByCountry[country],
                transportAlerts: transportAlertsByCountry[country] ?? 0
            )
        }.sorted { left, right in
            let leftCode = left["code"] as? String ?? ""
            let rightCode = right["code"] as? String ?? ""
            let leftIsSelected = leftCode == normalizedSelection
            let rightIsSelected = rightCode == normalizedSelection
            if leftIsSelected != rightIsSelected { return leftIsSelected }
            let leftCount = left["newsCount"] as? Int ?? 0
            let rightCount = right["newsCount"] as? Int ?? 0
            if leftCount != rightCount { return leftCount > rightCount }
            return leftCode < rightCode
        }

        let marketMoves = countryMarkets.compactMap(\.composite_change_percent)
        let averageMove = marketMoves.isEmpty ? nil : marketMoves.reduce(0, +) / Double(marketMoves.count)
        let globalWeather = weather.max { weatherSeverity($0) < weatherSeverity($1) }
        let globalNewsCount: Int = normalizedNewsScope == nil
            ? max(newsTotal ?? 0, news.count)
            : countryStats.reduce(0) { $0 + max(0, $1.count) }
        var globalRow = snapshotRow(
            country: nil,
            newsCount: globalNewsCount,
            newsMetricLabel: normalizedNewsScope == nil ? "reports" : "country links",
            headline: normalizedNewsScope == nil ? sortedNews.first : nil,
            market: nil,
            weather: globalWeather,
            transport: nil,
            transportAlerts: transport?.summary.alerts ?? 0
        )
        globalRow["marketMove"] = averageMove
        globalRow["marketCoverage"] = marketMoves.count
        globalRow["transportActive"] = transport?.summary.active ?? 0
        globalRow["transportAlerts"] = transport?.summary.alerts ?? 0
        if let globalWeather {
            let condition = nonBlank(globalWeather.weather_main ?? globalWeather.weather_desc) ?? "Weather"
            globalRow["weatherCondition"] = "\(globalWeather.country.uppercased()) · \(condition)"
        }

        let snapshot: [String: Any] = [
            "schemaVersion": 3,
            "briefingTitle": bounded(briefing?.title, fallback: "Global intelligence overview", limit: 100),
            "briefingText": bounded(
                briefing?.key_takeaways.first ?? briefing?.update_text,
                fallback: "News, markets, weather and transport signals ready for review.",
                limit: 220
            ),
            "defaultCountry": normalizedSelection ?? "GLOBAL",
            "global": globalRow,
            "countries": countryRows,
            "freshness": freshness.propertyList,
            "updatedAt": freshness.latest?.timeIntervalSince1970 ?? 0
        ]
        defaults.set(snapshot, forKey: snapshotKey)
        WidgetCenter.shared.reloadTimelines(ofKind: "ClaritasBriefingWidget")
        WidgetCenter.shared.reloadTimelines(ofKind: "ClaritasScopedWidget")
    }

    static func clear() {
        guard let defaults = suiteName.flatMap(UserDefaults.init(suiteName:)) else { return }
        defaults.removeObject(forKey: snapshotKey)
        WidgetCenter.shared.reloadTimelines(ofKind: "ClaritasBriefingWidget")
        WidgetCenter.shared.reloadTimelines(ofKind: "ClaritasScopedWidget")
    }

    private static func snapshotRow(
        country: String?,
        newsCount: Int,
        newsMetricLabel: String,
        headline: NewsItem?,
        market: CountryMarketOverview?,
        weather: CountryWeather?,
        transport: TransportCountryAggregate?,
        transportAlerts: Int
    ) -> [String: Any] {
        var row: [String: Any] = [
            "code": country ?? "GLOBAL",
            "name": country.flatMap(countryName) ?? "Global",
            "newsCount": max(0, newsCount),
            "newsMetricLabel": newsMetricLabel,
            "marketCoverage": market == nil ? 0 : 1,
            "transportActive": transport?.active_count ?? 0,
            "transportAlerts": max(0, transportAlerts)
        ]
        if let headline {
            row["headline"] = bounded(headline.presentationTitle, fallback: "Latest report", limit: 180)
            row["headlineBasis"] = headline.chronologyLabel
            if let headlineAt = headline.chronologyDate?.timeIntervalSince1970 {
                row["headlineAt"] = headlineAt
            }
        }
        if let move = market?.composite_change_percent { row["marketMove"] = move }
        if let temperature = weather?.temp_c { row["weatherTemp"] = temperature }
        if let condition = nonBlank(weather?.weather_main ?? weather?.weather_desc) {
            row["weatherCondition"] = bounded(condition, fallback: "Weather", limit: 60)
        }
        if let observedAt = weather?.observedDate?.timeIntervalSince1970 {
            row["weatherObservedAt"] = observedAt
        }
        return row
    }

    private static func weatherSeverity(_ weather: CountryWeather) -> Double {
        let alert = Double(weather.alert_count ?? 0) * 100
        let temperature = weather.temp_c.map { abs($0 - 20) } ?? 0
        let wind = (weather.wind_gust ?? weather.wind_speed ?? 0) * 2
        let precipitation = (weather.precipitation_mm ?? 0) * 4
        return alert + temperature + wind + precipitation
    }

    private static func entityCountries(_ entity: TransportEntity) -> Set<String> {
        var countries = Set([
            entity.current_country_iso2,
            entity.origin_country_iso2,
            entity.destination_country_iso2,
            entity.registration_country_iso2
        ].compactMap { normalizeCountry($0) })
        entity.country_links.compactMap { normalizeCountry($0.country) }.forEach {
            countries.insert($0)
        }
        return countries
    }

    private static func normalizeCountry(_ value: String?) -> String? {
        guard let value = nonBlank(value)?.uppercased(),
              value.range(of: "^[A-Z]{2}$", options: .regularExpression) != nil else { return nil }
        return value == "UK" ? "GB" : value
    }

    private static func countryName(_ code: String) -> String? {
        Locale.current.localizedString(forRegionCode: code)
    }

    private static func nonBlank(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private static func bounded(_ value: String?, fallback: String, limit: Int) -> String {
        let resolved = nonBlank(value) ?? fallback
        return String(resolved.prefix(limit))
    }
}
