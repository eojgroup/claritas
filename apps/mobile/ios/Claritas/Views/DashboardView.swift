import SwiftUI
import Charts
import MapKit

struct DashboardView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage("DEFAULT_MAP_MODE") private var defaultMapModeRaw: String = "news"
    @AppStorage("DEFAULT_LIST_MODE") private var defaultListModeRaw: String = "news"
    @State private var query: String = ""
    @State private var mapMode: ListMode = .news
    @State private var listMode: ListMode = .news
    @State private var section: DashboardSection = .overview
    @State private var minTemp: String = ""
    @State private var marketEarningsWindowDays: Int = 14
    @State private var hasAppliedStoredModes: Bool = false

    enum ListMode: String, CaseIterable { case news, weather, market }
    enum DashboardSection: String, CaseIterable { case overview, news, weather, market }

    var body: some View {
        DashboardBackground {
            ScrollView {
                VStack(spacing: 18) {
                    DashboardHeaderView()

                    DashboardCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Workspace")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Picker("Workspace", selection: $section) {
                                Text("Overview").tag(DashboardSection.overview)
                                Text("News").tag(DashboardSection.news)
                                Text("Weather").tag(DashboardSection.weather)
                                Text("Markets").tag(DashboardSection.market)
                            }
                            .pickerStyle(.segmented)

                            HStack(spacing: 8) {
                                Image(systemName: "magnifyingglass")
                                    .foregroundStyle(.secondary)
                                TextField("Search news, weather, or markets", text: $query)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                    Button("Clear") { query = "" }
                                        .buttonStyle(.bordered)
                                }
                            }
                            .padding(10)
                            .background(searchFieldBackground, in: RoundedRectangle(cornerRadius: 10))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(searchFieldStroke, lineWidth: 1)
                            )

                            HStack(spacing: 10) {
                                if let selected = model.selectedCountry?.uppercased() {
                                    Text("Country: \(selected)")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.secondary)
                                }
                                if let selectedSymbol = model.selectedSymbol {
                                    Text("Symbol: \(selectedSymbol)")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if model.selectedCountry != nil || model.selectedSymbol != nil {
                                    Button("Clear focus") {
                                        model.clearSelection()
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                        }
                    }

                    if section == .overview {
                        overviewMetricsCard
                    }

                    if hasSearchQuery {
                        searchPreviewCard
                    }

                    if section == .overview {
                        DashboardCard {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    Text("Map: \(mapTitle)")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                    Spacer()
                                    Picker("Mode", selection: $mapMode) {
                                        Text("News").tag(ListMode.news)
                                        Text("Weather").tag(ListMode.weather)
                                        Text("Markets").tag(ListMode.market)
                                    }
                                    .pickerStyle(.segmented)
                                    .frame(maxWidth: 300)
                                    .onChange(of: mapMode) { newValue in
                                        listMode = newValue
                                    }
                                }

                                ZStack {
                                    InteractiveCountryBubbleMap(
                                        mode: mapMode,
                                        countryStats: model.countryStats,
                                        weather: model.weather,
                                        marketQuotes: model.marketQuotes,
                                        selectedCountry: model.selectedCountry,
                                        onSelectCountry: { iso in
                                            let normalized = iso.uppercased()
                                            model.selectedCountry = (model.selectedCountry ?? "").uppercased() == normalized ? nil : normalized
                                        }
                                    )
                                        .frame(height: 220)
                                        .clipShape(RoundedRectangle(cornerRadius: 12))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 12)
                                                .stroke(ClaritasPalette.beige, lineWidth: 1)
                                        )

                                    if mapMode == .weather && model.weather.isEmpty {
                                        HStack(spacing: 8) {
                                            Text("No weather stats yet.")
                                                .font(.caption)
                                            Button(action: { Task { await model.refreshWeatherNow() } }) {
                                                Text(model.isRefreshingWeather ? "Refreshing…" : "Refresh now")
                                            }
                                            .buttonStyle(.bordered)
                                            .disabled(model.isRefreshingWeather)
                                        }
                                        .padding(10)
                                        .background(.ultraThinMaterial, in: Capsule())
                                    }
                                }
                            }
                        }

                        DashboardCard {
                            VStack(spacing: 12) {
                                HStack {
                                    Text("List")
                                        .font(.headline)
                                    Spacer()
                                    Picker("List Mode", selection: $listMode) {
                                        Text("News").tag(ListMode.news)
                                        Text("Weather").tag(ListMode.weather)
                                        Text("Markets").tag(ListMode.market)
                                    }
                                    .pickerStyle(.segmented)
                                    .frame(maxWidth: 220)
                                }

                                if listMode == .news {
                                    NewsListView(items: filteredNews(), onSelectCountry: { iso in
                                        model.selectedCountry = iso
                                    })
                                } else if listMode == .weather {
                                    WeatherListView(
                                        items: filteredWeather(),
                                        minTemp: $minTemp,
                                        isRefreshing: model.isRefreshingWeather,
                                        onRefresh: { Task { await model.refreshWeatherNow() } },
                                        onSelectCountry: { iso in
                                            model.selectedCountry = iso
                                        }
                                    )
                                } else {
                                    MarketQuoteListView(
                                        quotes: filteredMarketQuotes(),
                                        selectedSymbol: model.selectedSymbol,
                                        isRefreshing: model.isRefreshingMarketQuotes,
                                        onRefresh: { Task { await model.refreshMarketQuotes(forceRefresh: true) } },
                                        onSelectSymbol: { symbol in
                                            model.selectedSymbol = symbol
                                            if let country = model.marketQuotes.first(where: { $0.symbol.uppercased() == symbol.uppercased() })?.country {
                                                model.selectedCountry = country.uppercased()
                                            }
                                        }
                                    )
                                }
                            }
                        }

                        DashboardCard {
                            CountryProfileView(selectedCountry: model.selectedCountry)
                        }
                    } else if section == .news {
                        DashboardCard {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("News stream")
                                    .font(.headline)
                                Text("Showing \(filteredNews().count) of \(model.news.count) items")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                NewsListView(items: filteredNews(), onSelectCountry: { iso in
                                    model.selectedCountry = iso
                                })
                            }
                        }
                    } else if section == .weather {
                        DashboardCard {
                            WeatherListView(
                                items: filteredWeather(),
                                minTemp: $minTemp,
                                isRefreshing: model.isRefreshingWeather,
                                onRefresh: { Task { await model.refreshWeatherNow() } },
                                onSelectCountry: { iso in
                                    model.selectedCountry = iso
                                }
                            )
                        }
                    } else {
                        DashboardCard {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Market index map")
                                    .font(.headline)
                                Text("Relative index volatility by country")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)

                                InteractiveCountryBubbleMap(
                                    mode: .market,
                                    countryStats: model.countryStats,
                                    weather: model.weather,
                                    marketQuotes: model.marketQuotes,
                                    selectedCountry: model.selectedCountry,
                                    onSelectCountry: { iso in
                                        let normalized = iso.uppercased()
                                        model.selectedCountry = (model.selectedCountry ?? "").uppercased() == normalized ? nil : normalized
                                    }
                                )
                                .frame(height: 220)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(ClaritasPalette.beige, lineWidth: 1)
                                )
                            }
                        }

                        DashboardCard {
                            MarketStatusPanel(
                                rows: marketStatusRows,
                                isRefreshing: model.isRefreshingMarketStatus,
                                onRefresh: { Task { await model.refreshMarketStatus(forceRefresh: true) } }
                            )
                        }

                        DashboardCard {
                            MarketEarningsPanel(
                                rows: marketEarningsRows,
                                selectedSymbol: model.selectedSymbol,
                                selectedWindowDays: marketEarningsWindowDays,
                                isRefreshing: model.isRefreshingMarketEarnings,
                                onSelectWindowDays: { days in
                                    marketEarningsWindowDays = days
                                    Task { await model.refreshMarketEarnings(windowDays: days) }
                                },
                                onRefresh: {
                                    Task { await model.refreshMarketEarnings(windowDays: marketEarningsWindowDays) }
                                },
                                onSelectSymbol: { symbol in
                                    model.selectedSymbol = symbol
                                    if let country = model.marketQuotes.first(where: { $0.symbol.uppercased() == symbol.uppercased() })?.country {
                                        model.selectedCountry = country.uppercased()
                                    }
                                }
                            )
                        }

                        DashboardCard {
                            MarketQuoteListView(
                                quotes: filteredMarketQuotes(),
                                selectedSymbol: model.selectedSymbol,
                                isRefreshing: model.isRefreshingMarketQuotes,
                                onRefresh: { Task { await model.refreshMarketQuotes(forceRefresh: true) } },
                                onSelectSymbol: { symbol in
                                    model.selectedSymbol = symbol
                                    if let country = model.marketQuotes.first(where: { $0.symbol.uppercased() == symbol.uppercased() })?.country {
                                        model.selectedCountry = country.uppercased()
                                    }
                                }
                            )
                        }
                    }

                    DashboardCard {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Cross-signal relation")
                                .font(.headline)
                            if let relationCountry {
                                Text("Country context: \(relationCountry)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                if let weather = relatedWeather {
                                    Text("Weather: \(valueOrDash(weather.temp_c))°C, \(valueOrDash(weather.humidity))% humidity, \(weather.weather_main ?? "—")")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                } else {
                                    Text("Weather: No recent snapshot")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                if !relatedMarkets.isEmpty {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("Related symbols")
                                            .font(.caption.weight(.semibold))
                                        ForEach(relatedMarkets.prefix(4)) { quote in
                                            Button(action: {
                                                model.selectedSymbol = quote.symbol
                                                section = .market
                                            }) {
                                                HStack {
                                                    Text(quote.symbol)
                                                    Spacer()
                                                    Text(changeLabel(quote))
                                                        .foregroundStyle(changeColor(quote))
                                                }
                                                .font(.caption)
                                            }
                                            .buttonStyle(.plain)
                                        }
                                    }
                                }

                                if !relatedNews.isEmpty {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("Related headlines")
                                            .font(.caption.weight(.semibold))
                                        ForEach(relatedNews.prefix(3)) { item in
                                            Text(item.title ?? item.url ?? "Untitled")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            } else {
                                Text("Select a country from news/weather or a market symbol to link signals.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    FooterLinksView()
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
        }
        .onAppear {
            guard !hasAppliedStoredModes else { return }
            mapMode = ListMode(rawValue: defaultMapModeRaw) ?? .news
            listMode = ListMode(rawValue: defaultListModeRaw) ?? mapMode
            hasAppliedStoredModes = true
        }
        .task {
            if model.marketEarnings.isEmpty {
                await model.refreshMarketEarnings(windowDays: marketEarningsWindowDays)
            }
        }
        .onChange(of: marketEarningsWindowDays) { next in
            Task { await model.refreshMarketEarnings(windowDays: next) }
        }
    }

    private func filteredWeather() -> [CountryWeather] {
        let minVal: Double? = Double(minTemp)
        var list = model.weather
        if let minVal { list = list.filter { ($0.temp_c ?? -999) >= minVal } }
        if let iso = model.selectedCountry?.uppercased() { list = list.filter { $0.country.uppercased() == iso } }
        return list
    }

    private func filteredNews() -> [NewsItem] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var rows = model.news
        if let iso = model.selectedCountry?.uppercased() {
            rows = rows.filter { ($0.country_iso2 ?? "").uppercased() == iso }
        }
        guard !term.isEmpty else { return rows }
        return rows.filter { item in
            let title = item.title?.lowercased() ?? ""
            let summary = item.summary?.lowercased() ?? ""
            let country = item.country_iso2?.lowercased() ?? ""
            return title.contains(term) || summary.contains(term) || country.contains(term)
        }
    }

    private func filteredMarketQuotes() -> [MarketQuote] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let baseRows: [MarketQuote] = {
            if let iso = model.selectedCountry?.uppercased(), !iso.isEmpty {
                return model.marketQuotes.filter { ($0.country ?? "").uppercased() == iso }
            }
            return model.marketQuotes
        }()

        guard !term.isEmpty else { return baseRows }
        return baseRows.filter { quote in
            let haystack = [
                quote.symbol,
                quote.company_name ?? "",
                quote.exchange ?? "",
                quote.country ?? "",
                quote.currency ?? "",
                quote.market_code ?? "",
                quote.market_name ?? ""
            ].joined(separator: " ").lowercased()
            return haystack.contains(term)
        }
    }

    private var hasSearchQuery: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var focusLabel: String {
        if let country = model.selectedCountry?.uppercased(), !country.isEmpty {
            return country
        }
        if let symbol = model.selectedSymbol?.uppercased(), !symbol.isEmpty {
            return symbol
        }
        return "Global"
    }

    private var uniqueCountryCount: Int {
        var countries = Set<String>()
        model.news.compactMap(\.country_iso2).forEach { countries.insert($0.uppercased()) }
        model.weather.map(\.country).forEach { countries.insert($0.uppercased()) }
        model.marketQuotes.compactMap(\.country).forEach { countries.insert($0.uppercased()) }
        return countries.count
    }

    private var latestSyncLabel: String {
        let allTimestamps =
            model.news.compactMap(\.event_time) +
            model.weather.map(\.observed_at) +
            model.marketQuotes.map(\.observed_at)
        let parsed = allTimestamps.compactMap(APIDateParser.parse)
        guard let latest = parsed.max() else { return "Awaiting sync" }
        return latest.formatted(date: .abbreviated, time: .shortened)
    }

    private var newsCoverageLabel: String {
        let dates = model.news.compactMap(\.eventDate).sorted()
        guard let start = dates.first, let end = dates.last else { return "No dated news" }
        return "\(start.formatted(date: .abbreviated, time: .omitted)) - \(end.formatted(date: .abbreviated, time: .omitted))"
    }

    private var overviewMetricsCard: some View {
        DashboardCard {
            VStack(alignment: .leading, spacing: 14) {
                BrandSectionHeader(
                    kicker: "Overview",
                    title: "Signal coverage",
                    detail: "A quick native snapshot of the same news, weather, and market feeds exposed on web."
                )

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                    BrandMetricCard(
                        title: "Focus",
                        value: focusLabel,
                        detail: model.selectedCountry != nil || model.selectedSymbol != nil ? "Current active selection" : "No pinned country or symbol",
                        tone: nil
                    )
                    BrandMetricCard(
                        title: "Countries",
                        value: "\(uniqueCountryCount)",
                        detail: "Countries represented across loaded signals",
                        tone: nil
                    )
                    BrandMetricCard(
                        title: "Market status",
                        value: "\(marketStatusRows.filter { $0.is_open == true }.count)/\(marketStatusRows.count)",
                        detail: "Tracked exchanges currently open",
                        tone: ClaritasPalette.darkGreen
                    )
                    BrandMetricCard(
                        title: "News window",
                        value: "\(model.news.count) items",
                        detail: newsCoverageLabel,
                        tone: nil
                    )
                    BrandMetricCard(
                        title: "Latest sync",
                        value: latestSyncLabel,
                        detail: "Most recent event loaded into the app",
                        tone: nil
                    )
                }
            }
        }
    }

    private var searchPreviewItems: [SearchPreviewItem] {
        let newsItems = filteredNews().prefix(2).map {
            SearchPreviewItem(
                id: "news-\($0.id)",
                kind: "News",
                title: $0.title ?? $0.url ?? "Untitled",
                detail: [($0.country_iso2 ?? "").uppercased(), shortDateTimeLabel($0.event_time)]
                    .filter { !$0.isEmpty }
                    .joined(separator: " • ")
            )
        }

        let weatherItems = filteredWeather().prefix(2).map {
            SearchPreviewItem(
                id: "weather-\($0.id)",
                kind: "Weather",
                title: "\($0.country.uppercased()) • \(valueOrDash($0.temp_c))°C",
                detail: [$0.weather_main ?? "Weather", shortDateTimeLabel($0.observed_at)]
                    .filter { !$0.isEmpty }
                    .joined(separator: " • ")
            )
        }

        let marketItems = filteredMarketQuotes().prefix(2).map {
            SearchPreviewItem(
                id: "market-\($0.id)",
                kind: "Market",
                title: "\($0.symbol) • \(valueOrDash($0.price)) \($0.currency ?? "")",
                detail: [$0.company_name ?? "Market quote", changeLabel($0)]
                    .filter { !$0.isEmpty }
                    .joined(separator: " • ")
            )
        }

        return Array(newsItems + weatherItems + marketItems)
    }

    private var searchPreviewCard: some View {
        DashboardCard {
            VStack(alignment: .leading, spacing: 12) {
                BrandSectionHeader(
                    kicker: "Search",
                    title: "Cross-signal preview",
                    detail: "Matching results across news, weather, and markets."
                )

                if searchPreviewItems.isEmpty {
                    Text("No results match the current query.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(searchPreviewItems) { item in
                        HStack(alignment: .top, spacing: 12) {
                            BrandPill(label: item.kind, tone: previewTone(for: item.kind))
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.title)
                                    .font(.subheadline.weight(.semibold))
                                Text(item.detail)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        .padding(12)
                        .background(
                            ClaritasPalette.shellRaised(for: colorScheme),
                            in: RoundedRectangle(cornerRadius: 14)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
                        )
                    }
                }
            }
        }
    }

    private var selectedSymbolQuote: MarketQuote? {
        guard let selectedSymbol = model.selectedSymbol else { return nil }
        return model.marketQuotes.first { $0.symbol.uppercased() == selectedSymbol.uppercased() }
    }

    private var relationCountry: String? {
        if let selected = model.selectedCountry?.uppercased(), !selected.isEmpty {
            return selected
        }
        if let country = selectedSymbolQuote?.country?.uppercased(), !country.isEmpty {
            return country
        }
        return nil
    }

    private var relatedWeather: CountryWeather? {
        guard let relationCountry else { return nil }
        return model.weather
            .filter { $0.country.uppercased() == relationCountry }
            .sorted { $0.observed_at > $1.observed_at }
            .first
    }

    private var relatedMarkets: [MarketQuote] {
        guard let relationCountry else { return [] }
        return model.marketQuotes
            .filter { ($0.country ?? "").uppercased() == relationCountry }
            .sorted { abs($0.percent_change ?? 0) > abs($1.percent_change ?? 0) }
    }

    private var relatedNews: [NewsItem] {
        guard let relationCountry else { return [] }
        return model.news
            .filter { ($0.country_iso2 ?? "").uppercased() == relationCountry }
            .sorted { ($0.event_time ?? "") > ($1.event_time ?? "") }
    }

    private var marketStatusRows: [MarketStatus] {
        model.marketStatus
            .sorted { lhs, rhs in
                let leftOpen = lhs.is_open == true ? 1 : 0
                let rightOpen = rhs.is_open == true ? 1 : 0
                if leftOpen != rightOpen { return leftOpen > rightOpen }
                return lhs.exchange < rhs.exchange
            }
    }

    private var marketEarningsRows: [EarningsEvent] {
        let baseRows: [EarningsEvent]
        if let symbol = model.selectedSymbol?.uppercased(), !symbol.isEmpty {
            baseRows = model.marketEarnings.filter { $0.symbol.uppercased() == symbol }
        } else {
            baseRows = model.marketEarnings
        }
        return baseRows.sorted { ($0.date ?? "") < ($1.date ?? "") }
    }

    private func valueOrDash(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.2f", value)
    }

    private func changeLabel(_ quote: MarketQuote) -> String {
        guard let change = quote.change else { return "—" }
        let pct = quote.percent_change.map { String(format: "%.2f%%", $0) } ?? "—"
        return String(format: "%+.2f", change) + " · " + pct
    }

    private func changeColor(_ quote: MarketQuote) -> Color {
        guard let change = quote.change else { return ClaritasPalette.grey }
        if change > 0 { return ClaritasPalette.positiveText(for: colorScheme) }
        if change < 0 { return ClaritasPalette.negativeText(for: colorScheme) }
        return ClaritasPalette.grey
    }

    private func previewTone(for kind: String) -> Color {
        switch kind.lowercased() {
        case "news":
            return ClaritasPalette.darkBlue
        case "weather":
            return ClaritasPalette.brown
        default:
            return ClaritasPalette.darkGreen
        }
    }

    private var searchFieldBackground: Color {
        colorScheme == .dark ? ClaritasPalette.darkBlue.opacity(0.95) : Color.white.opacity(0.95)
    }

    private var searchFieldStroke: Color {
        colorScheme == .dark ? ClaritasPalette.beige.opacity(0.35) : ClaritasPalette.beige
    }

    private var mapTitle: String {
        switch mapMode {
        case .news:
            return "#News per country"
        case .weather:
            return "Weather per country"
        case .market:
            return "Index volatility by country"
        }
    }
}

private struct SearchPreviewItem: Identifiable {
    let id: String
    let kind: String
    let title: String
    let detail: String
}

private struct ChartDateCount: Identifiable {
    let date: String
    let count: Int
    var id: String { date }
}

private struct LabeledCount: Identifiable {
    let label: String
    let count: Int
    var id: String { label }
}

private struct LabeledValue: Identifiable {
    let label: String
    let value: Double
    let detail: String
    var id: String { label }
}

private struct WeatherScatterPoint: Identifiable {
    let country: String
    let humidity: Double
    let temp: Double
    var id: String { country }
}

private struct CountryMarketSummary: Identifiable {
    let country: String
    let marketCode: String
    let marketName: String
    let symbolCount: Int
    let avgChange: Double
    let topSymbol: String
    let topMove: Double
    var id: String { country }
}

private struct MarketOption: Identifiable {
    let code: String
    let name: String
    var id: String { code }
}

struct NewsWorkspaceView: View {
    enum Sort: String, CaseIterable, Identifiable {
        case newest
        case oldest
        case source

        var id: String { rawValue }
        var title: String { rawValue.capitalized }
    }

    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var query: String = ""
    @State private var sourceFilter: String = "all"
    @State private var countryFilter: String = ""
    @State private var imagesOnly: Bool = false
    @State private var sort: Sort = .newest
    @State private var loadMode: AppModel.NewsLoadMode = .recent

    private var sourceOptions: [String] {
        let sources = Set(model.news.compactMap(newsSourceLabel))
        return Array(sources).sorted()
    }

    private var rows: [NewsItem] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var filtered = model.news

        if let selectedCountry = model.selectedCountry?.uppercased(), !selectedCountry.isEmpty {
            filtered = filtered.filter { ($0.country_iso2 ?? "").uppercased() == selectedCountry }
        }

        if sourceFilter != "all" {
            filtered = filtered.filter { (newsSourceLabel($0) ?? "").lowercased() == sourceFilter.lowercased() }
        }
        if imagesOnly {
            filtered = filtered.filter(newsHasImage)
        }

        let typedCountry = countryFilter.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if !typedCountry.isEmpty {
            filtered = filtered.filter { ($0.country_iso2 ?? "").uppercased().contains(typedCountry) }
        }

        if !term.isEmpty {
            filtered = filtered.filter { item in
                [
                    item.title ?? "",
                    item.summary ?? "",
                    item.country_iso2 ?? "",
                    newsSourceLabel(item) ?? ""
                ]
                .joined(separator: " ")
                .lowercased()
                .contains(term)
            }
        }

        switch sort {
        case .newest:
            return filtered.sorted { ($0.event_time ?? "") > ($1.event_time ?? "") }
        case .oldest:
            return filtered.sorted { ($0.event_time ?? "") < ($1.event_time ?? "") }
        case .source:
            return filtered.sorted {
                let lhs = newsSourceLabel($0) ?? ""
                let rhs = newsSourceLabel($1) ?? ""
                if lhs != rhs { return lhs < rhs }
                return ($0.event_time ?? "") > ($1.event_time ?? "")
            }
        }
    }

    private var timelineData: [ChartDateCount] {
        var counts: [String: Int] = [:]
        for item in rows {
            guard let key = dateOnlyLabel(item.event_time) else { continue }
            counts[key, default: 0] += 1
        }
        return counts
            .map { ChartDateCount(date: $0.key, count: $0.value) }
            .sorted { $0.date < $1.date }
    }

    private var sourceData: [LabeledCount] {
        var counts: [String: Int] = [:]
        for item in rows {
            counts[newsSourceLabel(item) ?? "Unknown", default: 0] += 1
        }
        return counts
            .map { LabeledCount(label: $0.key, count: $0.value) }
            .sorted { $0.count > $1.count }
            .prefix(8)
            .map { $0 }
    }

    private var coverageLabel: String {
        let dates = rows.compactMap(\.eventDate).sorted()
        guard let start = dates.first, let end = dates.last else { return "No dated articles" }
        return "\(start.formatted(date: .abbreviated, time: .omitted)) - \(end.formatted(date: .abbreviated, time: .omitted))"
    }

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(spacing: 18) {
                    BrandCard {
                        VStack(alignment: .leading, spacing: 14) {
                            BrandSectionHeader(
                                kicker: "News",
                                title: "Global signal stream",
                                detail: "Filter the same recent and archive news feeds available on web."
                            )

                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                                BrandMetricCard(title: "Loaded", value: "\(rows.count)", detail: "Filtered articles in view", tone: nil)
                                BrandMetricCard(title: "Sources", value: "\(sourceOptions.count)", detail: "Distinct publishers in current dataset", tone: nil)
                                BrandMetricCard(title: "Coverage", value: loadMode.rawValue.capitalized, detail: coverageLabel, tone: nil)
                            }

                            HStack(spacing: 8) {
                                Picker("Load mode", selection: $loadMode) {
                                    Text("Recent").tag(AppModel.NewsLoadMode.recent)
                                    Text("Archive").tag(AppModel.NewsLoadMode.archive)
                                }
                                .pickerStyle(.segmented)

                                Button(model.isRefreshingNews ? "Refreshing…" : "Refresh") {
                                    Task { await model.refreshNews(mode: loadMode) }
                                }
                                .buttonStyle(.bordered)
                                .disabled(model.isRefreshingNews)
                            }

                            if let error = model.newsLoadError, !error.isEmpty {
                                Text(error)
                                    .font(.footnote)
                                    .foregroundStyle(ClaritasPalette.negativeText(for: colorScheme))
                            }
                        }
                    }

                    BrandCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Filters")
                                .font(.headline)

                            HStack(spacing: 8) {
                                Image(systemName: "magnifyingglass")
                                    .foregroundStyle(.secondary)
                                TextField("Search headlines, summaries, or countries", text: $query)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                            }
                            .padding(10)
                            .background(ClaritasPalette.shellSurface(for: colorScheme), in: RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
                            )

                            HStack(spacing: 10) {
                                Picker("Source", selection: $sourceFilter) {
                                    Text("All sources").tag("all")
                                    ForEach(sourceOptions, id: \.self) { source in
                                        Text(source).tag(source)
                                    }
                                }
                                .pickerStyle(.menu)

                                TextField("Country", text: $countryFilter)
                                    .textInputAutocapitalization(.characters)
                                    .autocorrectionDisabled()
                                    .textFieldStyle(.roundedBorder)
                            }

                            Toggle("Only articles with images", isOn: $imagesOnly)

                            Picker("Sort", selection: $sort) {
                                ForEach(Sort.allCases) { sort in
                                    Text(sort.title).tag(sort)
                                }
                            }
                            .pickerStyle(.segmented)
                        }
                    }

                    if !timelineData.isEmpty || !sourceData.isEmpty {
                        VStack(spacing: 12) {
                            BrandCard {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text("Timeline")
                                        .font(.headline)
                                    Chart(timelineData) { item in
                                        LineMark(
                                            x: .value("Date", item.date),
                                            y: .value("Stories", item.count)
                                        )
                                        .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                                    }
                                    .frame(height: 180)
                                }
                            }

                            BrandCard {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text("Top sources")
                                        .font(.headline)
                                    Chart(sourceData) { item in
                                        BarMark(
                                            x: .value("Source", item.label),
                                            y: .value("Stories", item.count)
                                        )
                                        .foregroundStyle(ClaritasPalette.positiveText(for: colorScheme))
                                    }
                                    .frame(height: 180)
                                }
                            }
                        }
                    }

                    BrandCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Stories")
                                .font(.headline)
                            NewsListView(items: rows) { iso in
                                model.selectedCountry = iso
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
        }
        .task {
            loadMode = model.newsLoadMode
            if model.news.isEmpty {
                await model.refreshNews(mode: loadMode)
            }
        }
        .onChange(of: loadMode) { next in
            Task { await model.refreshNews(mode: next) }
        }
    }
}

struct WeatherWorkspaceView: View {
    enum Sort: String, CaseIterable, Identifiable {
        case latest
        case hottest
        case coldest
        case humidity

        var id: String { rawValue }
        var title: String { rawValue.capitalized }
    }

    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var query: String = ""
    @State private var conditionFilter: String = "all"
    @State private var countryFilter: String = ""
    @State private var minTempText: String = ""
    @State private var humidityFloorText: String = ""
    @State private var sort: Sort = .latest

    private var conditionOptions: [String] {
        let values = Set(model.weather.compactMap { $0.weather_main?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
        return Array(values).sorted()
    }

    private var rows: [CountryWeather] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let minTemp = Double(minTempText)
        let humidityFloor = Double(humidityFloorText)
        var filtered = model.weather

        if let selectedCountry = model.selectedCountry?.uppercased(), !selectedCountry.isEmpty {
            filtered = filtered.filter { $0.country.uppercased() == selectedCountry }
        }
        if conditionFilter != "all" {
            filtered = filtered.filter { ($0.weather_main ?? "").caseInsensitiveCompare(conditionFilter) == .orderedSame }
        }
        let typedCountry = countryFilter.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if !typedCountry.isEmpty {
            filtered = filtered.filter { $0.country.uppercased().contains(typedCountry) }
        }
        if let minTemp {
            filtered = filtered.filter { ($0.temp_c ?? -999) >= minTemp }
        }
        if let humidityFloor {
            filtered = filtered.filter { ($0.humidity ?? -1) >= humidityFloor }
        }
        if !term.isEmpty {
            filtered = filtered.filter { row in
                [
                    row.country,
                    row.weather_main ?? "",
                    row.weather_desc ?? "",
                    row.source_name ?? ""
                ]
                .joined(separator: " ")
                .lowercased()
                .contains(term)
            }
        }

        switch sort {
        case .latest:
            return filtered.sorted { $0.observed_at > $1.observed_at }
        case .hottest:
            return filtered.sorted { ($0.temp_c ?? -999) > ($1.temp_c ?? -999) }
        case .coldest:
            return filtered.sorted { ($0.temp_c ?? 999) < ($1.temp_c ?? 999) }
        case .humidity:
            return filtered.sorted { ($0.humidity ?? -1) > ($1.humidity ?? -1) }
        }
    }

    private var temperatureLeaders: [LabeledValue] {
        rows
            .filter { $0.temp_c != nil }
            .prefix(12)
            .map {
                LabeledValue(
                    label: $0.country.uppercased(),
                    value: $0.temp_c ?? 0,
                    detail: "\(($0.humidity ?? 0).formatted(.number.precision(.fractionLength(0))))% humidity"
                )
            }
    }

    private var scatterRows: [WeatherScatterPoint] {
        rows.compactMap { row in
            guard let humidity = row.humidity, let temp = row.temp_c else { return nil }
            return WeatherScatterPoint(country: row.country.uppercased(), humidity: humidity, temp: temp)
        }
    }

    private var hottestLabel: String {
        guard let hottest = rows.max(by: { ($0.temp_c ?? -999) < ($1.temp_c ?? -999) }) else { return "—" }
        return "\(hottest.country.uppercased()) • \(compactNumber(hottest.temp_c))°C"
    }

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(spacing: 18) {
                    BrandCard {
                        VStack(alignment: .leading, spacing: 14) {
                            BrandSectionHeader(
                                kicker: "Weather",
                                title: "Country weather operations",
                                detail: "Filter current-country snapshots and correlate temperature with humidity."
                            )

                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                                BrandMetricCard(title: "Rows", value: "\(rows.count)", detail: "Country snapshots in scope", tone: nil)
                                BrandMetricCard(title: "Hottest", value: hottestLabel, detail: "Highest observed temperature", tone: ClaritasPalette.brown)
                                BrandMetricCard(title: "Conditions", value: "\(conditionOptions.count)", detail: "Distinct weather conditions", tone: nil)
                            }

                            Button(model.isRefreshingWeather ? "Refreshing…" : "Refresh weather now") {
                                Task { await model.refreshWeatherNow() }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(ClaritasPalette.darkGreen)
                            .disabled(model.isRefreshingWeather)
                        }
                    }

                    BrandCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Filters")
                                .font(.headline)

                            HStack(spacing: 8) {
                                Image(systemName: "magnifyingglass")
                                    .foregroundStyle(.secondary)
                                TextField("Search country, condition, or source", text: $query)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                            }
                            .padding(10)
                            .background(ClaritasPalette.shellSurface(for: colorScheme), in: RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
                            )

                            HStack(spacing: 10) {
                                Picker("Condition", selection: $conditionFilter) {
                                    Text("All conditions").tag("all")
                                    ForEach(conditionOptions, id: \.self) { condition in
                                        Text(condition).tag(condition)
                                    }
                                }
                                .pickerStyle(.menu)

                                TextField("Country", text: $countryFilter)
                                    .textInputAutocapitalization(.characters)
                                    .autocorrectionDisabled()
                                    .textFieldStyle(.roundedBorder)
                            }

                            HStack(spacing: 10) {
                                TextField("Min temp °C", text: $minTempText)
                                    .keyboardType(.numbersAndPunctuation)
                                    .textFieldStyle(.roundedBorder)
                                TextField("Min humidity %", text: $humidityFloorText)
                                    .keyboardType(.numbersAndPunctuation)
                                    .textFieldStyle(.roundedBorder)
                            }

                            Picker("Sort", selection: $sort) {
                                ForEach(Sort.allCases) { sort in
                                    Text(sort.title).tag(sort)
                                }
                            }
                            .pickerStyle(.segmented)
                        }
                    }

                    if !temperatureLeaders.isEmpty || !scatterRows.isEmpty {
                        VStack(spacing: 12) {
                            BrandCard {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text("Temperature leaders")
                                        .font(.headline)
                                    Chart(temperatureLeaders) { item in
                                        BarMark(
                                            x: .value("Country", item.label),
                                            y: .value("Temp", item.value)
                                        )
                                        .foregroundStyle(ClaritasPalette.brown)
                                    }
                                    .frame(height: 180)
                                }
                            }

                            BrandCard {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text("Temp vs humidity")
                                        .font(.headline)
                                    Chart(scatterRows) { item in
                                        PointMark(
                                            x: .value("Humidity", item.humidity),
                                            y: .value("Temperature", item.temp)
                                        )
                                        .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                                    }
                                    .frame(height: 180)
                                }
                            }
                        }
                    }

                    BrandCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Snapshots")
                                .font(.headline)
                            WeatherListView(
                                items: rows,
                                minTemp: $minTempText,
                                isRefreshing: model.isRefreshingWeather,
                                onRefresh: { Task { await model.refreshWeatherNow() } },
                                onSelectCountry: { iso in model.selectedCountry = iso },
                                showsControls: false
                            )
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
        }
    }
}

struct MarketsWorkspaceView: View {
    enum Direction: String, CaseIterable, Identifiable {
        case all
        case gainers
        case losers

        var id: String { rawValue }
        var title: String { rawValue.capitalized }
    }

    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var query: String = ""
    @State private var exchangeFilter: String = "all"
    @State private var countryFilter: String = "all"
    @State private var marketFilter: String = "all"
    @State private var directionFilter: Direction = .all
    @State private var minMoveText: String = "0"
    @State private var earningsWindowDays: Int = 14

    private var exchangeOptions: [String] {
        Array(Set(model.marketQuotes.compactMap { $0.exchange?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })).sorted()
    }

    private var countryOptions: [String] {
        Array(Set(model.marketQuotes.compactMap { $0.country?.uppercased() }.filter { !$0.isEmpty })).sorted()
    }

    private var marketOptions: [MarketOption] {
        var mapped: [String: String] = [:]
        for quote in model.marketQuotes {
            let identity = marketIdentity(for: quote)
            guard let code = identity.code, !code.isEmpty else { continue }
            mapped[code] = identity.name ?? code
        }
        return mapped
            .map { MarketOption(code: $0.key, name: $0.value) }
            .sorted { $0.name < $1.name }
    }

    private var rows: [MarketQuote] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let minMove = Double(minMoveText) ?? 0
        var filtered = model.marketQuotes

        if let selectedCountry = model.selectedCountry?.uppercased(), !selectedCountry.isEmpty {
            filtered = filtered.filter { ($0.country ?? "").uppercased() == selectedCountry }
        }
        if exchangeFilter != "all" {
            filtered = filtered.filter { ($0.exchange ?? "").caseInsensitiveCompare(exchangeFilter) == .orderedSame }
        }
        if countryFilter != "all" {
            filtered = filtered.filter { ($0.country ?? "").uppercased() == countryFilter }
        }
        if marketFilter != "all" {
            filtered = filtered.filter { (marketIdentity(for: $0).code ?? "").uppercased() == marketFilter }
        }
        switch directionFilter {
        case .all:
            break
        case .gainers:
            filtered = filtered.filter { ($0.percent_change ?? 0) > 0 }
        case .losers:
            filtered = filtered.filter { ($0.percent_change ?? 0) < 0 }
        }
        if minMove > 0 {
            filtered = filtered.filter { abs($0.percent_change ?? 0) >= minMove }
        }
        if !term.isEmpty {
            filtered = filtered.filter { quote in
                [
                    quote.symbol,
                    quote.company_name ?? "",
                    quote.exchange ?? "",
                    quote.country ?? "",
                    quote.market_code ?? "",
                    quote.market_name ?? ""
                ]
                .joined(separator: " ")
                .lowercased()
                .contains(term)
            }
        }

        return filtered.sorted { abs($0.percent_change ?? 0) > abs($1.percent_change ?? 0) }
    }

    private var selectedQuote: MarketQuote? {
        guard let selectedSymbol = model.selectedSymbol?.uppercased(), !selectedSymbol.isEmpty else { return nil }
        return model.marketQuotes.first { $0.symbol.uppercased() == selectedSymbol }
    }

    private var relatedCountry: String? {
        if let selectedCountry = model.selectedCountry?.uppercased(), !selectedCountry.isEmpty {
            return selectedCountry
        }
        if let country = selectedQuote?.country?.uppercased(), !country.isEmpty {
            return country
        }
        return nil
    }

    private var relatedWeather: CountryWeather? {
        guard let relatedCountry else { return nil }
        return model.weather
            .filter { $0.country.uppercased() == relatedCountry }
            .sorted { $0.observed_at > $1.observed_at }
            .first
    }

    private var relatedNews: [NewsItem] {
        guard let relatedCountry else { return [] }
        return model.news
            .filter { ($0.country_iso2 ?? "").uppercased() == relatedCountry }
            .sorted { ($0.event_time ?? "") > ($1.event_time ?? "") }
            .prefix(4)
            .map { $0 }
    }

    private var peerQuotes: [MarketQuote] {
        guard let relatedCountry else { return [] }
        return model.marketQuotes
            .filter { ($0.country ?? "").uppercased() == relatedCountry && $0.symbol != selectedQuote?.symbol }
            .sorted { abs($0.percent_change ?? 0) > abs($1.percent_change ?? 0) }
            .prefix(5)
            .map { $0 }
    }

    private var moversData: [LabeledValue] {
        rows.prefix(12).map {
            LabeledValue(
                label: $0.symbol,
                value: $0.percent_change ?? 0,
                detail: $0.company_name ?? "Market quote"
            )
        }
    }

    private var marketAverages: [LabeledValue] {
        var grouped: [String: (name: String, total: Double, count: Int)] = [:]
        for quote in rows {
            let identity = marketIdentity(for: quote)
            let code = identity.code ?? "UNMAPPED"
            let current = grouped[code] ?? (identity.name ?? code, 0, 0)
            grouped[code] = (current.name, current.total + (quote.percent_change ?? 0), current.count + 1)
        }
        return grouped.map { key, value in
            LabeledValue(
                label: key,
                value: value.count == 0 ? 0 : value.total / Double(value.count),
                detail: value.name
            )
        }
        .sorted { abs($0.value) > abs($1.value) }
        .prefix(8)
        .map { $0 }
    }

    private var countrySummaryRows: [CountryMarketSummary] {
        var grouped: [String: [MarketQuote]] = [:]
        for quote in rows {
            guard let country = quote.country?.uppercased(), !country.isEmpty else { continue }
            grouped[country, default: []].append(quote)
        }

        return grouped.map { country, quotes in
            let identity = marketIdentity(for: quotes[0])
            let avg = quotes.map { $0.percent_change ?? 0 }.reduce(0, +) / Double(max(quotes.count, 1))
            let top = quotes.max { abs($0.percent_change ?? 0) < abs($1.percent_change ?? 0) }
            return CountryMarketSummary(
                country: country,
                marketCode: identity.code ?? "UNMAPPED",
                marketName: identity.name ?? (identity.code ?? "Unmapped"),
                symbolCount: quotes.count,
                avgChange: avg,
                topSymbol: top?.symbol ?? "—",
                topMove: top?.percent_change ?? 0
            )
        }
        .sorted { $0.country < $1.country }
    }

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(spacing: 18) {
                    BrandCard {
                        VStack(alignment: .leading, spacing: 14) {
                            BrandSectionHeader(
                                kicker: "Markets",
                                title: "Market watch and correlations",
                                detail: "Quotes, exchange status, earnings, and country-level correlation views."
                            )

                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                                BrandMetricCard(title: "Quotes", value: "\(rows.count)", detail: "Quotes after current filters", tone: nil)
                                BrandMetricCard(title: "Open exchanges", value: "\(model.marketStatus.filter { $0.is_open == true }.count)", detail: "Currently open", tone: ClaritasPalette.darkGreen)
                                BrandMetricCard(
                                    title: "Focus",
                                    value: model.selectedSymbol?.uppercased() ?? relatedCountry ?? "Global",
                                    detail: model.selectedSymbol != nil ? "Selected symbol" : "Country correlation focus",
                                    tone: nil
                                )
                            }

                            HStack(spacing: 8) {
                                Button(model.isRefreshingMarketQuotes ? "Refreshing quotes…" : "Refresh quotes") {
                                    Task { await model.refreshMarketQuotes(forceRefresh: true) }
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(ClaritasPalette.darkGreen)
                                .disabled(model.isRefreshingMarketQuotes)

                                Button(model.isRefreshingMarketStatus ? "Refreshing status…" : "Refresh status") {
                                    Task { await model.refreshMarketStatus(forceRefresh: true) }
                                }
                                .buttonStyle(.bordered)
                                .disabled(model.isRefreshingMarketStatus)

                                if model.selectedSymbol != nil {
                                    Button("Clear symbol") {
                                        model.selectedSymbol = nil
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                        }
                    }

                    BrandCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Filters")
                                .font(.headline)

                            HStack(spacing: 8) {
                                Image(systemName: "magnifyingglass")
                                    .foregroundStyle(.secondary)
                                TextField("Search symbol, company, exchange, or market", text: $query)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                            }
                            .padding(10)
                            .background(ClaritasPalette.shellSurface(for: colorScheme), in: RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
                            )

                            HStack(spacing: 10) {
                                Picker("Exchange", selection: $exchangeFilter) {
                                    Text("All exchanges").tag("all")
                                    ForEach(exchangeOptions, id: \.self) { exchange in
                                        Text(exchange).tag(exchange)
                                    }
                                }
                                .pickerStyle(.menu)

                                Picker("Country", selection: $countryFilter) {
                                    Text("All countries").tag("all")
                                    ForEach(countryOptions, id: \.self) { country in
                                        Text(country).tag(country)
                                    }
                                }
                                .pickerStyle(.menu)
                            }

                            HStack(spacing: 10) {
                                Picker("Market", selection: $marketFilter) {
                                    Text("All markets").tag("all")
                                    ForEach(marketOptions) { market in
                                        Text("\(market.code) · \(market.name)").tag(market.code)
                                    }
                                }
                                .pickerStyle(.menu)

                                Picker("Direction", selection: $directionFilter) {
                                    ForEach(Direction.allCases) { direction in
                                        Text(direction.title).tag(direction)
                                    }
                                }
                                .pickerStyle(.segmented)
                            }

                            TextField("Min absolute % move", text: $minMoveText)
                                .keyboardType(.numbersAndPunctuation)
                                .textFieldStyle(.roundedBorder)
                        }
                    }

                    BrandCard {
                        MarketStatusPanel(
                            rows: model.marketStatus.sorted {
                                let left = $0.is_open == true ? 1 : 0
                                let right = $1.is_open == true ? 1 : 0
                                if left != right { return left > right }
                                return $0.exchange < $1.exchange
                            },
                            isRefreshing: model.isRefreshingMarketStatus,
                            onRefresh: { Task { await model.refreshMarketStatus(forceRefresh: true) } }
                        )
                    }

                    BrandCard {
                        MarketEarningsPanel(
                            rows: model.marketEarnings
                                .filter { model.selectedSymbol == nil || $0.symbol.uppercased() == model.selectedSymbol?.uppercased() }
                                .sorted { ($0.date ?? "") < ($1.date ?? "") },
                            selectedSymbol: model.selectedSymbol,
                            selectedWindowDays: earningsWindowDays,
                            isRefreshing: model.isRefreshingMarketEarnings,
                            onSelectWindowDays: { days in
                                earningsWindowDays = days
                                Task { await model.refreshMarketEarnings(windowDays: days, symbol: model.selectedSymbol) }
                            },
                            onRefresh: { Task { await model.refreshMarketEarnings(windowDays: earningsWindowDays, symbol: model.selectedSymbol) } },
                            onSelectSymbol: { symbol in model.selectedSymbol = symbol }
                        )
                    }

                    BrandCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Watchlist")
                                .font(.headline)
                            MarketQuoteListView(
                                quotes: rows,
                                selectedSymbol: model.selectedSymbol,
                                isRefreshing: model.isRefreshingMarketQuotes,
                                onRefresh: { Task { await model.refreshMarketQuotes(forceRefresh: true) } },
                                onSelectSymbol: { symbol in
                                    model.selectedSymbol = symbol
                                    if let country = model.marketQuotes.first(where: { $0.symbol.uppercased() == symbol.uppercased() })?.country {
                                        model.selectedCountry = country.uppercased()
                                    }
                                }
                            )
                        }
                    }

                    BrandCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Symbol correlation")
                                .font(.headline)
                            if let selectedQuote {
                                let identity = marketIdentity(for: selectedQuote)
                                VStack(alignment: .leading, spacing: 10) {
                                    ProfileFactRow(label: "Primary market", value: "\(identity.name ?? "Unknown") (\(identity.code ?? "—"))")
                                    ProfileFactRow(label: "Country", value: selectedQuote.country?.uppercased() ?? "—")
                                    ProfileFactRow(label: "Weather", value: relatedWeather.map { "\(compactNumber($0.temp_c))°C • \(compactNumber($0.humidity))% • \($0.weather_main ?? "—")" } ?? "No recent snapshot")

                                    if !relatedNews.isEmpty {
                                        VStack(alignment: .leading, spacing: 6) {
                                            Text("Related stories")
                                                .font(.caption.weight(.semibold))
                                            ForEach(relatedNews) { item in
                                                Text(item.title ?? item.url ?? "Untitled")
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                            }
                                        }
                                    }

                                    if !peerQuotes.isEmpty {
                                        VStack(alignment: .leading, spacing: 6) {
                                            Text("Peer symbols")
                                                .font(.caption.weight(.semibold))
                                            ForEach(peerQuotes) { quote in
                                                Button(action: { model.selectedSymbol = quote.symbol }) {
                                                    HStack {
                                                        Text(quote.symbol)
                                                        Spacer()
                                                        Text(changeText(for: quote))
                                                            .foregroundStyle(changeColor(for: quote))
                                                    }
                                                    .font(.caption)
                                                }
                                                .buttonStyle(.plain)
                                            }
                                        }
                                    }
                                }
                            } else {
                                Text("Select a symbol to relate market movement with country weather and recent stories.")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    if !moversData.isEmpty || !marketAverages.isEmpty {
                        VStack(spacing: 12) {
                            BrandCard {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text("Top movers")
                                        .font(.headline)
                                    Chart(moversData) { item in
                                        BarMark(
                                            x: .value("Symbol", item.label),
                                            y: .value("% change", item.value)
                                        )
                                        .foregroundStyle(item.value >= 0 ? ClaritasPalette.positiveText(for: colorScheme) : ClaritasPalette.negativeText(for: colorScheme))
                                    }
                                    .frame(height: 180)
                                }
                            }

                            BrandCard {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text("Index regime")
                                        .font(.headline)
                                    Chart(marketAverages) { item in
                                        BarMark(
                                            x: .value("Market", item.label),
                                            y: .value("Average change", item.value)
                                        )
                                        .foregroundStyle(item.value >= 0 ? ClaritasPalette.dataBlue(for: colorScheme) : ClaritasPalette.negativeText(for: colorScheme))
                                    }
                                    .frame(height: 180)
                                }
                            }
                        }
                    }

                    BrandCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Country market map")
                                .font(.headline)
                            if countrySummaryRows.isEmpty {
                                Text("No country-level market groups match the current filters.")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            } else {
                                ForEach(countrySummaryRows) { row in
                                    HStack(alignment: .top) {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text("\(row.country) • \(row.marketCode)")
                                                .font(.subheadline.weight(.semibold))
                                            Text(row.marketName)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        VStack(alignment: .trailing, spacing: 4) {
                                            Text("\(row.symbolCount) symbols")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                            Text("\(row.avgChange >= 0 ? "+" : "")\(row.avgChange.formatted(.number.precision(.fractionLength(2))))%")
                                                .font(.caption.weight(.semibold))
                                                .foregroundStyle(row.avgChange >= 0 ? ClaritasPalette.positiveText(for: colorScheme) : ClaritasPalette.negativeText(for: colorScheme))
                                            Text("Top: \(row.topSymbol) • \(row.topMove >= 0 ? "+" : "")\(row.topMove.formatted(.number.precision(.fractionLength(2))))%")
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    .padding(10)
                                    .background(ClaritasPalette.shellSurface(for: colorScheme), in: RoundedRectangle(cornerRadius: 12))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 12)
                                            .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
                                    )
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
        }
        .task {
            if model.marketEarnings.isEmpty {
                await model.refreshMarketEarnings(windowDays: earningsWindowDays)
            }
        }
    }

    private func changeText(for quote: MarketQuote) -> String {
        let value = quote.percent_change ?? quote.change ?? 0
        return "\(value >= 0 ? "+" : "")\(value.formatted(.number.precision(.fractionLength(2))))%"
    }

    private func changeColor(for quote: MarketQuote) -> Color {
        (quote.percent_change ?? quote.change ?? 0) >= 0
            ? ClaritasPalette.positiveText(for: colorScheme)
            : ClaritasPalette.negativeText(for: colorScheme)
    }
}

struct PoliciesWorkspaceView: View {
    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(spacing: 18) {
                    BrandCard {
                        BrandSectionHeader(
                            kicker: "Policies",
                            title: "Policies and usage guidelines",
                            detail: "Review the same policy summaries and brand palette guidance available on web."
                        )
                    }

                    ForEach(legalPolicies) { policy in
                        BrandCard {
                            VStack(alignment: .leading, spacing: 12) {
                                Text(policy.title)
                                    .font(.title3.weight(.semibold))
                                Text(policy.intro)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)

                                VStack(alignment: .leading, spacing: 10) {
                                    ForEach(policy.items, id: \.self) { item in
                                        HStack(alignment: .top, spacing: 10) {
                                            Circle()
                                                .fill(ClaritasPalette.darkBlue.opacity(0.75))
                                                .frame(width: 7, height: 7)
                                                .padding(.top, 5)
                                            Text(item)
                                                .font(.footnote)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }

                                Text(policy.note)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    BrandCard {
                        VStack(alignment: .leading, spacing: 14) {
                            BrandSectionHeader(
                                kicker: "Palette",
                                title: "Claritas colour reference",
                                detail: "The native app now uses the same shell colours and accents as the web product."
                            )

                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
                                BrandSwatch(name: "Command Navy", hex: "#173342", color: ClaritasPalette.darkBlue)
                                BrandSwatch(name: "Deep Forest", hex: "#1E493B", color: ClaritasPalette.darkGreen)
                                BrandSwatch(name: "Strategic Sage", hex: "#8BB99A", color: ClaritasPalette.sage)
                                BrandSwatch(name: "Signal Orange", hex: "#D97932", color: ClaritasPalette.orange)
                                BrandSwatch(name: "Warm Surface", hex: "#FFFDF8", color: Color(hex: "#FFFDF8"))
                                BrandSwatch(name: "Primary Ink", hex: "#132833", color: ClaritasPalette.text)
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
        }
    }
}

private struct BrandSwatch: View {
    let name: String
    let hex: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            RoundedRectangle(cornerRadius: 14)
                .fill(color)
                .frame(height: 68)
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(Color.black.opacity(0.06), lineWidth: 1)
                )
            Text(name)
                .font(.subheadline.weight(.semibold))
            Text(hex)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct ProfileFactRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline.weight(.semibold))
                .multilineTextAlignment(.trailing)
        }
    }
}

private func shortDateTimeLabel(_ value: String?) -> String {
    guard let value, let date = APIDateParser.parse(value) else { return "" }
    return date.formatted(date: .abbreviated, time: .shortened)
}

private func dateOnlyLabel(_ value: String?) -> String? {
    guard let value, let date = APIDateParser.parse(value) else { return nil }
    return date.formatted(.dateTime.year().month(.abbreviated).day())
}

private func compactNumber(_ value: Double?) -> String {
    guard let value else { return "—" }
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.maximumFractionDigits = abs(value) >= 100 ? 0 : 1
    return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.1f", value)
}

private func trimmed(_ value: String?) -> String? {
    guard let value else { return nil }
    let next = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return next.isEmpty ? nil : next
}

private func normalizedProviderName(_ value: String?) -> String? {
    guard let value = trimmed(value) else { return nil }
    switch value.lowercased() {
    case "newsapi":
        return "NewsAPI"
    case "thenewsapi":
        return "TheNewsAPI"
    case "openweather":
        return "OpenWeather"
    case "finnhub":
        return "Finnhub"
    default:
        return value
    }
}

private func newsImageURLString(_ item: NewsItem) -> String? {
    guard let payload = item.payload?.object else { return nil }
    if let image = trimmed(payload["image"]?.string) { return image }
    if let image = trimmed(payload["urlToImage"]?.string) { return image }
    if let image = trimmed(payload["image_url"]?.string) { return image }
    if let raw = payload["raw"]?.object {
        if let image = trimmed(raw["image"]?.string) { return image }
        if let image = trimmed(raw["urlToImage"]?.string) { return image }
        if let image = trimmed(raw["image_url"]?.string) { return image }
    }
    return nil
}

private func newsHasImage(_ item: NewsItem) -> Bool {
    newsImageURLString(item) != nil
}

private func newsSourceLabel(_ item: NewsItem) -> String? {
    if let source = normalizedProviderName(item.source_name) {
        return source
    }
    guard let payload = item.payload?.object else { return nil }
    if let source = normalizedProviderName(payload["provider"]?.string) {
        return source
    }
    if let source = normalizedProviderName(payload["source"]?.string) {
        return source
    }
    if let raw = payload["raw"]?.object {
        if let source = normalizedProviderName(raw["source"]?.string) {
            return source
        }
        if let source = normalizedProviderName(raw["publisher"]?.string) {
            return source
        }
    }
    return nil
}

private func marketIdentity(for quote: MarketQuote) -> (code: String?, name: String?, kind: String?) {
    let payload = quote.payload?.object
    let market = payload?["market"]?.object
    let profile = payload?["profile"]?.object
    return (
        trimmed(quote.market_code)
            ?? trimmed(market?["code"]?.string)
            ?? trimmed(profile?["market_code"]?.string),
        trimmed(quote.market_name)
            ?? trimmed(market?["name"]?.string)
            ?? trimmed(profile?["market_name"]?.string),
        trimmed(quote.market_kind)
            ?? trimmed(market?["kind"]?.string)
    )
}

private struct MarketQuoteListView: View {
    let quotes: [MarketQuote]
    let selectedSymbol: String?
    let isRefreshing: Bool
    let onRefresh: () -> Void
    let onSelectSymbol: (String) -> Void
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                Text("Finnhub real-time quotes")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button(action: onRefresh) {
                    Text(isRefreshing ? "Refreshing…" : "Refresh")
                }
                .buttonStyle(.bordered)
                .disabled(isRefreshing)
            }

            if quotes.isEmpty {
                Text("No market rows.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(quotes) { quote in
                    let metadata = marketQuoteMetadata(quote)
                    Button(action: { onSelectSymbol(quote.symbol) }) {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(quote.symbol)
                                    .font(.subheadline.weight(.semibold))
                                if let exchange = quote.exchange, !exchange.isEmpty {
                                    Text(exchange)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(priceLabel(quote))
                                    .font(.subheadline.weight(.semibold))
                            }
                            Text(quote.company_name ?? "—")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            HStack(spacing: 8) {
                                if let marketCode = metadata.marketCode, !marketCode.isEmpty {
                                    Text(marketCode)
                                        .font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 7)
                                        .padding(.vertical, 3)
                                        .background(ClaritasPalette.darkBlue.opacity(0.12), in: Capsule())
                                        .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                                }
                                if let industry = metadata.industry, !industry.isEmpty {
                                    Text(industry)
                                        .font(.caption2)
                                        .lineLimit(1)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            HStack(spacing: 12) {
                                Text(changeLabel(quote))
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(changeColor(quote))
                                Text("Open \(valueOrDash(quote.open_price))")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                Text("High \(valueOrDash(quote.high_price))")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                Text("Low \(valueOrDash(quote.low_price))")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            if let marketCap = metadata.marketCap {
                                Text("Market cap \(formatCompactNumber(marketCap))")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Text(
                                "Observed " +
                                (quote.observedDate?.formatted(date: .abbreviated, time: .shortened) ?? quote.observed_at)
                            )
                                .font(.caption2)
                                .foregroundStyle(.secondary)

                            if let profileURL = metadata.webURL ?? quoteURL(quote.symbol) {
                                Link(destination: profileURL) {
                                    Text("Company profile")
                                        .font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 5)
                                        .background(ClaritasPalette.shellSurface(for: colorScheme), in: Capsule())
                                        .overlay(
                                            Capsule().stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
                                        )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(
                            ((selectedSymbol ?? "").uppercased() == quote.symbol.uppercased()
                                ? ClaritasPalette.darkGreen.opacity(0.12)
                                : ClaritasPalette.shellSurface(for: colorScheme)),
                            in: RoundedRectangle(cornerRadius: 10)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func priceLabel(_ quote: MarketQuote) -> String {
        let price = valueOrDash(quote.price)
        if let currency = quote.currency, !currency.isEmpty {
            return "\(price) \(currency)"
        }
        return price
    }

    private func changeLabel(_ quote: MarketQuote) -> String {
        guard let change = quote.change else { return "—" }
        let pct = quote.percent_change.map { String(format: "%.2f%%", $0) } ?? "—"
        return String(format: "%+.2f", change) + " · " + pct
    }

    private func changeColor(_ quote: MarketQuote) -> Color {
        guard let change = quote.change else { return ClaritasPalette.grey }
        if change > 0 { return ClaritasPalette.positiveText(for: colorScheme) }
        if change < 0 { return ClaritasPalette.negativeText(for: colorScheme) }
        return ClaritasPalette.grey
    }

    private func valueOrDash(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.2f", value)
    }

    private func formatCompactNumber(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = value >= 1_000_000_000 ? 1 : 0
        let suffix: String
        let scaled: Double
        if value >= 1_000_000_000_000 {
            scaled = value / 1_000_000_000_000
            suffix = "T"
        } else if value >= 1_000_000_000 {
            scaled = value / 1_000_000_000
            suffix = "B"
        } else if value >= 1_000_000 {
            scaled = value / 1_000_000
            suffix = "M"
        } else if value >= 1_000 {
            scaled = value / 1_000
            suffix = "K"
        } else {
            scaled = value
            suffix = ""
        }
        let number = formatter.string(from: NSNumber(value: scaled)) ?? String(format: "%.1f", scaled)
        return number + suffix
    }

    private func quoteURL(_ symbol: String) -> URL? {
        URL(string: "https://finance.yahoo.com/quote/\(symbol.uppercased())")
    }
}

private struct MarketStatusPanel: View {
    let rows: [MarketStatus]
    let isRefreshing: Bool
    let onRefresh: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    private var openCount: Int {
        rows.filter { $0.is_open == true }.count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Market status")
                        .font(.headline)
                    Text("\(openCount)/\(rows.count) tracked exchanges open")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: onRefresh) {
                    Text(isRefreshing ? "Refreshing…" : "Refresh")
                }
                .buttonStyle(.bordered)
                .disabled(isRefreshing)
            }

            if rows.isEmpty {
                Text("No exchange status rows available.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(rows.prefix(20)) { row in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(row.exchange)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(statusLabel(row))
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(statusColor(row))
                        }
                        Text(
                            [
                                row.session,
                                row.timezone,
                                row.holiday,
                                trimmed(shortDateTimeLabel(row.observed_at))
                            ]
                            .compactMap { $0 }
                            .filter { !$0.isEmpty }
                            .joined(separator: " • ")
                        )
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }
                    .padding(10)
                    .background(ClaritasPalette.shellSurface(for: colorScheme), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
                    )
                }
            }
        }
    }

    private func statusLabel(_ row: MarketStatus) -> String {
        if row.is_open == true { return "Open" }
        if row.is_open == false { return "Closed" }
        return "Unknown"
    }

    private func statusColor(_ row: MarketStatus) -> Color {
        if row.is_open == true { return ClaritasPalette.positiveText(for: colorScheme) }
        if row.is_open == false { return ClaritasPalette.negativeText(for: colorScheme) }
        return ClaritasPalette.grey
    }
}

private struct MarketEarningsPanel: View {
    let rows: [EarningsEvent]
    let selectedSymbol: String?
    let selectedWindowDays: Int
    let isRefreshing: Bool
    let onSelectWindowDays: (Int) -> Void
    let onRefresh: () -> Void
    let onSelectSymbol: (String) -> Void
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Earnings calendar")
                        .font(.headline)
                    Text(selectedSymbol.map { "Upcoming events for \($0)" } ?? "Upcoming events (watch scope)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                HStack(spacing: 4) {
                    ForEach([7, 14, 30], id: \.self) { window in
                        Button(action: { onSelectWindowDays(window) }) {
                            Text("\(window)d")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 6)
                                .background(
                                    selectedWindowDays == window
                                        ? ClaritasPalette.darkBlue
                                        : ClaritasPalette.offWhite,
                                    in: Capsule()
                                )
                                .foregroundStyle(
                                    selectedWindowDays == window
                                        ? ClaritasPalette.offWhite
                                        : ClaritasPalette.grey
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(4)
                .background(ClaritasPalette.beige.opacity(0.55), in: Capsule())
            }

            HStack {
                Spacer()
                Button(action: onRefresh) {
                    Text(isRefreshing ? "Refreshing…" : "Refresh earnings")
                }
                .buttonStyle(.bordered)
                .disabled(isRefreshing)
            }

            if rows.isEmpty {
                Text("No earnings events in the selected window.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(rows.prefix(24)) { row in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Button(action: { onSelectSymbol(row.symbol) }) {
                                Text(row.symbol)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                            }
                            .buttonStyle(.plain)
                            Spacer()
                            Text(row.date ?? "—")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Text(
                            [
                                row.market_code,
                                row.market_name,
                                row.country?.uppercased(),
                                row.hour
                            ]
                            .compactMap { $0 }
                            .filter { !$0.isEmpty }
                            .joined(separator: " • ")
                        )
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        Text("EPS \(value(row.eps_actual)) / \(value(row.eps_estimate)) · Rev \(value(row.revenue_actual)) / \(value(row.revenue_estimate))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(10)
                    .background(ClaritasPalette.shellSurface(for: colorScheme), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
                    )
                }
            }
        }
    }

    private func value(_ number: Double?) -> String {
        guard let number else { return "—" }
        if abs(number) >= 1_000_000_000 {
            return String(format: "%.2fB", number / 1_000_000_000)
        }
        if abs(number) >= 1_000_000 {
            return String(format: "%.2fM", number / 1_000_000)
        }
        if abs(number) >= 1_000 {
            return String(format: "%.1fK", number / 1_000)
        }
        return String(format: "%.2f", number)
    }
}

private struct MarketQuoteMetadata {
    let marketCode: String?
    let marketName: String?
    let industry: String?
    let marketCap: Double?
    let ipo: String?
    let webURL: URL?
}

private func marketQuoteMetadata(_ quote: MarketQuote) -> MarketQuoteMetadata {
    guard let payload = quote.payload?.object else {
        return MarketQuoteMetadata(
            marketCode: quote.market_code,
            marketName: quote.market_name,
            industry: nil,
            marketCap: nil,
            ipo: nil,
            webURL: nil
        )
    }
    let profile = payload["profile"]?.object ?? [:]
    let webURL: URL?
    if let web = profile["web_url"]?.string?.trimmingCharacters(in: .whitespacesAndNewlines), !web.isEmpty {
        webURL = URL(string: web)
    } else {
        webURL = nil
    }

    return MarketQuoteMetadata(
        marketCode: trimmed(quote.market_code) ?? profile["market_code"]?.string,
        marketName: trimmed(quote.market_name) ?? profile["market_name"]?.string,
        industry: profile["industry"]?.string,
        marketCap: profile["market_cap"]?.number,
        ipo: profile["ipo"]?.string,
        webURL: webURL
    )
}

private struct DashboardHeaderView: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(ClaritasPalette.darkBlue)
                    .frame(width: 58, height: 58)
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color.white.opacity(0.24), lineWidth: 1)
                    .frame(width: 58, height: 58)
                Text("C")
                    .font(.system(size: 24, weight: .semibold, design: .serif))
                    .foregroundStyle(ClaritasPalette.offWhite)
                Circle()
                    .fill(ClaritasPalette.orange)
                    .frame(width: 9, height: 9)
                    .offset(x: 20, y: -20)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Signal desk overview")
                    .font(.headline)
                    .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                Text("Global intelligence with trusted identity.")
                    .font(.subheadline)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            }
            Spacer()
            HStack(spacing: 10) {
                Image(systemName: "gearshape")
                Image(systemName: "line.3.horizontal")
                Image(systemName: "person.crop.circle")
            }
            .foregroundStyle(ClaritasPalette.shellSidebar(for: colorScheme))
            .font(.title3)
        }
        .padding(16)
        .brandGlass(cornerRadius: 18, elevated: true)
    }
}

private struct DashboardBackground<Content: View>: View {
    @ViewBuilder var content: Content
    @Environment(\.colorScheme) private var colorScheme

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    ClaritasPalette.shellBackground(for: colorScheme),
                    colorScheme == .dark
                        ? Color(hex: "#102426")
                        : Color(hex: "#E8E1D5"),
                    ClaritasPalette.shellBackground(for: colorScheme)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            LinearGradient(
                colors: [
                    ClaritasPalette.darkGreen.opacity(colorScheme == .dark ? 0.14 : 0.08),
                    Color.clear,
                    ClaritasPalette.orange.opacity(colorScheme == .dark ? 0.1 : 0.06)
                ],
                startPoint: .topTrailing,
                endPoint: .bottomLeading
            )
            .ignoresSafeArea()

            content
        }
    }
}

private struct DashboardCard<Content: View>: View {
    @ViewBuilder var content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            content
        }
        .padding(16)
        .brandGlass(cornerRadius: 18, elevated: true)
    }
}

private struct FooterLinksView: View {
    var body: some View {
        DashboardCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("Claritas")
                    .font(.caption2.weight(.semibold))
                    .tracking(3)
                    .foregroundStyle(.secondary)

                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 140), alignment: .leading)],
                    alignment: .leading,
                    spacing: 10
                ) {
                    ForEach(legalPolicies) { policy in
                        NavigationLink {
                            PolicyDetailView(policy: policy)
                        } label: {
                            Text(policy.title)
                                .font(.footnote)
                                .foregroundStyle(.primary)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct LegalPolicy: Identifiable {
    let id: String
    let title: String
    let intro: String
    let items: [String]
    let note: String
}

let legalPolicies: [LegalPolicy] = [
    LegalPolicy(
        id: "cookie-policy",
        title: "Cookie Policy",
        intro: "We use cookies and similar technologies to keep Claritas secure, remember preferences, and understand usage.",
        items: [
            "Strictly necessary cookies keep sessions active and prevent unauthorized access.",
            "Preference cookies remember language, layout, and theme choices.",
            "Analytics cookies help measure performance and improve dashboards.",
            "Marketing cookies are only used when enabled to surface relevant updates."
        ],
        note: "You can manage cookie settings in your browser and clear stored data at any time."
    ),
    LegalPolicy(
        id: "privacy-statement",
        title: "Privacy Statement",
        intro: "Claritas collects only the data needed to provide secure access and operational insights.",
        items: [
            "Authentication data verifies identity and enforces access controls.",
            "Operational metrics keep the platform reliable and monitor anomalies.",
            "We do not sell personal data; sharing is limited to trusted providers.",
            "Retention follows security, compliance, and support requirements."
        ],
        note: "You can request access, correction, or deletion of your data through your administrator."
    ),
    LegalPolicy(
        id: "terms-of-use",
        title: "Terms of Use",
        intro: "By using Claritas you agree to use the platform responsibly for authorized purposes.",
        items: [
            "Do not bypass security controls or access data without permission.",
            "Respect rate limits and avoid actions that degrade service.",
            "Claritas content and reports remain the property of Claritas and its licensors.",
            "We may update these terms to reflect product or regulatory changes."
        ],
        note: "Violations may result in suspended access or termination of accounts."
    ),
    LegalPolicy(
        id: "copyright",
        title: "Copyright",
        intro: "Claritas content, visualizations, and branding are protected by intellectual property laws.",
        items: [
            "Use Claritas outputs for internal analysis within your organization.",
            "Do not reproduce or distribute Claritas materials without permission.",
            "Third-party sources remain subject to their own licensing terms.",
            "Trademarks and logos must not be altered or used misleadingly."
        ],
        note: "Contact your Claritas representative for licensing questions or permissions."
    )
]

struct PolicyDetailView: View {
    let policy: LegalPolicy
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(policy.title)
                    .font(.title2.weight(.semibold))
                Text(policy.intro)
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 10) {
                    ForEach(policy.items, id: \.self) { item in
                        HStack(alignment: .top, spacing: 10) {
                            Circle()
                                .fill(Color.secondary.opacity(0.6))
                                .frame(width: 6, height: 6)
                                .padding(.top, 6)
                            Text(item)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Text(policy.note)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle(policy.title)
        .background(ClaritasPalette.shellBackground(for: colorScheme))
    }
}

private struct InteractiveCountryBubbleMap: View {
    let mode: DashboardView.ListMode
    let countryStats: [CountryStat]
    let weather: [CountryWeather]
    let marketQuotes: [MarketQuote]
    let selectedCountry: String?
    let onSelectCountry: (String) -> Void

    @State private var region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 15, longitude: 10),
        span: MKCoordinateSpan(latitudeDelta: 140, longitudeDelta: 260)
    )

    private var points: [CountryBubblePoint] {
        switch mode {
        case .news:
            var mapped: [CountryBubblePoint] = []
            for stat in countryStats {
                let iso = stat.country.uppercased()
                guard let coordinate = CountryCentroidLookup.coordinate(for: iso) else { continue }
                mapped.append(
                    CountryBubblePoint(
                        id: "news-\(iso)",
                        iso: iso,
                        valueLabel: "\(stat.count)",
                        detail: "\(stat.count) news",
                        magnitude: max(Double(stat.count), 1),
                        coordinate: coordinate
                    )
                )
            }
            return mapped.sorted { $0.magnitude > $1.magnitude }

        case .weather:
            var mapped: [CountryBubblePoint] = []
            for row in weather {
                let iso = row.country.uppercased()
                guard let coordinate = CountryCentroidLookup.coordinate(for: iso) else { continue }
                let label = row.temp_c.map { String(format: "%.0f°", $0) } ?? "—"
                let detail = row.weather_main ?? "Weather"
                mapped.append(
                    CountryBubblePoint(
                        id: "weather-\(iso)",
                        iso: iso,
                        valueLabel: label,
                        detail: detail,
                        magnitude: max(abs(row.temp_c ?? 0), 1),
                        coordinate: coordinate
                    )
                )
            }
            return mapped.sorted { $0.magnitude > $1.magnitude }
        case .market:
            var grouped: [String: [MarketQuote]] = [:]
            for quote in marketQuotes {
                guard let country = quote.country?.uppercased(), !country.isEmpty else { continue }
                grouped[country, default: []].append(quote)
            }
            var mapped: [CountryBubblePoint] = []
            for (country, quotes) in grouped {
                guard let coordinate = CountryCentroidLookup.coordinate(for: country) else { continue }
                let changes = quotes.compactMap { $0.percent_change }
                let avgChange = changes.isEmpty ? 0 : changes.reduce(0, +) / Double(changes.count)
                let marketCodes = quotes
                    .compactMap { marketQuoteMetadata($0).marketCode }
                    .filter { !$0.isEmpty }
                let primaryMarketCode = marketCodes.first ?? "INDEX"
                mapped.append(
                    CountryBubblePoint(
                        id: "market-\(country)",
                        iso: country,
                        valueLabel: "\(Int(abs(avgChange).rounded()))%",
                        detail: "\(primaryMarketCode) · \(String(format: "%+.2f%%", avgChange))",
                        magnitude: max(abs(avgChange), 1),
                        coordinate: coordinate
                    )
                )
            }
            return mapped.sorted { $0.magnitude > $1.magnitude }
        }
    }

    private var pointsSignature: String {
        points.map(\.id).joined(separator: "|")
    }

    var body: some View {
        ZStack {
            Map(coordinateRegion: $region, interactionModes: [.pan, .zoom], annotationItems: points) { point in
                MapAnnotation(coordinate: point.coordinate) {
                    bubbleView(for: point)
                }
            }

            if points.isEmpty {
                Text(
                    mode == .news
                        ? "No mapped news stats yet."
                        : mode == .weather
                            ? "No mapped weather stats yet."
                            : "No mapped market stats yet."
                )
                    .font(.footnote)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding()
            }
        }
        .onAppear {
            fitRegion(animated: false)
        }
        .onChange(of: mode) { _ in
            fitRegion(animated: true)
        }
        .onChange(of: pointsSignature) { _ in
            fitRegion(animated: true)
        }
        .onChange(of: selectedCountry) { next in
            centerOnCountry(next)
        }
    }

    private func bubbleView(for point: CountryBubblePoint) -> some View {
        let selected = point.iso == selectedCountry?.uppercased()
        let size = bubbleSize(for: point)
        let fillColor: Color
        switch mode {
        case .news:
            fillColor = selected
                ? ClaritasPalette.darkGreen
                : ClaritasPalette.darkBlue.opacity(0.86)
        case .weather:
            fillColor = selected
                ? ClaritasPalette.brown
                : ClaritasPalette.brown.opacity(0.78)
        case .market:
            fillColor = selected
                ? ClaritasPalette.darkBlue
                : ClaritasPalette.darkBlue.opacity(0.72)
        }

        return Button(action: { onSelectCountry(point.iso) }) {
            VStack(spacing: 4) {
                ZStack {
                    Circle()
                        .fill(fillColor)
                    Circle()
                        .stroke(Color.white.opacity(selected ? 0.95 : 0.6), lineWidth: selected ? 2 : 1)
                    Text(point.valueLabel)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white)
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                        .padding(.horizontal, 4)
                }
                .frame(width: size, height: size)

                Text(point.iso)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Color.black.opacity(0.62), in: Capsule())
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(point.iso), \(point.detail)")
    }

    private func bubbleSize(for point: CountryBubblePoint) -> CGFloat {
        let magnitudes = points.map(\.magnitude)
        guard let minimum = magnitudes.min(), let maximum = magnitudes.max(), maximum > minimum else {
            return 32
        }
        let normalized = (point.magnitude - minimum) / (maximum - minimum)
        return 28 + CGFloat(normalized * 18)
    }

    private func fitRegion(animated: Bool) {
        guard !points.isEmpty else {
            let world = MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: 15, longitude: 10),
                span: MKCoordinateSpan(latitudeDelta: 140, longitudeDelta: 260)
            )
            setRegion(world, animated: animated)
            return
        }

        let latitudes = points.map { $0.coordinate.latitude }
        let longitudes = points.map { $0.coordinate.longitude }
        guard let minLat = latitudes.min(),
              let maxLat = latitudes.max(),
              let minLon = longitudes.min(),
              let maxLon = longitudes.max() else {
            return
        }

        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2)
        let latitudeDelta = min(max((maxLat - minLat) + 26, 36), 170)
        let longitudeDelta = min(max((maxLon - minLon) + 40, 60), 300)
        let fitted = MKCoordinateRegion(
            center: center,
            span: MKCoordinateSpan(latitudeDelta: latitudeDelta, longitudeDelta: longitudeDelta)
        )
        setRegion(fitted, animated: animated)
    }

    private func centerOnCountry(_ iso: String?) {
        guard let iso = iso?.uppercased(),
              let point = points.first(where: { $0.iso == iso }) else {
            return
        }
        let focused = MKCoordinateRegion(
            center: point.coordinate,
            span: MKCoordinateSpan(latitudeDelta: 30, longitudeDelta: 42)
        )
        setRegion(focused, animated: true)
    }

    private func setRegion(_ next: MKCoordinateRegion, animated: Bool) {
        if animated {
            withAnimation(.easeInOut(duration: 0.28)) {
                region = next
            }
        } else {
            region = next
        }
    }
}

private struct CountryBubblePoint: Identifiable {
    let id: String
    let iso: String
    let valueLabel: String
    let detail: String
    let magnitude: Double
    let coordinate: CLLocationCoordinate2D
}

private enum CountryCentroidLookup {
    private static let values: [String: CLLocationCoordinate2D] = [
        "US": CLLocationCoordinate2D(latitude: 37.0902, longitude: -95.7129),
        "CA": CLLocationCoordinate2D(latitude: 56.1304, longitude: -106.3468),
        "MX": CLLocationCoordinate2D(latitude: 23.6345, longitude: -102.5528),
        "BR": CLLocationCoordinate2D(latitude: -14.235, longitude: -51.9253),
        "AR": CLLocationCoordinate2D(latitude: -38.4161, longitude: -63.6167),
        "CL": CLLocationCoordinate2D(latitude: -35.6751, longitude: -71.543),
        "CO": CLLocationCoordinate2D(latitude: 4.5709, longitude: -74.2973),
        "PE": CLLocationCoordinate2D(latitude: -9.19, longitude: -75.0152),
        "GB": CLLocationCoordinate2D(latitude: 55.3781, longitude: -3.436),
        "IE": CLLocationCoordinate2D(latitude: 53.1424, longitude: -7.6921),
        "FR": CLLocationCoordinate2D(latitude: 46.2276, longitude: 2.2137),
        "DE": CLLocationCoordinate2D(latitude: 51.1657, longitude: 10.4515),
        "ES": CLLocationCoordinate2D(latitude: 40.4637, longitude: -3.7492),
        "IT": CLLocationCoordinate2D(latitude: 41.8719, longitude: 12.5674),
        "PT": CLLocationCoordinate2D(latitude: 39.3999, longitude: -8.2245),
        "NL": CLLocationCoordinate2D(latitude: 52.1326, longitude: 5.2913),
        "BE": CLLocationCoordinate2D(latitude: 50.5039, longitude: 4.4699),
        "CH": CLLocationCoordinate2D(latitude: 46.8182, longitude: 8.2275),
        "AT": CLLocationCoordinate2D(latitude: 47.5162, longitude: 14.5501),
        "SE": CLLocationCoordinate2D(latitude: 60.1282, longitude: 18.6435),
        "NO": CLLocationCoordinate2D(latitude: 60.472, longitude: 8.4689),
        "DK": CLLocationCoordinate2D(latitude: 56.2639, longitude: 9.5018),
        "FI": CLLocationCoordinate2D(latitude: 61.9241, longitude: 25.7482),
        "PL": CLLocationCoordinate2D(latitude: 51.9194, longitude: 19.1451),
        "UA": CLLocationCoordinate2D(latitude: 48.3794, longitude: 31.1656),
        "RO": CLLocationCoordinate2D(latitude: 45.9432, longitude: 24.9668),
        "CZ": CLLocationCoordinate2D(latitude: 49.8175, longitude: 15.473),
        "HU": CLLocationCoordinate2D(latitude: 47.1625, longitude: 19.5033),
        "GR": CLLocationCoordinate2D(latitude: 39.0742, longitude: 21.8243),
        "TR": CLLocationCoordinate2D(latitude: 38.9637, longitude: 35.2433),
        "RU": CLLocationCoordinate2D(latitude: 61.524, longitude: 105.3188),
        "EG": CLLocationCoordinate2D(latitude: 26.8206, longitude: 30.8025),
        "NG": CLLocationCoordinate2D(latitude: 9.082, longitude: 8.6753),
        "ZA": CLLocationCoordinate2D(latitude: -30.5595, longitude: 22.9375),
        "KE": CLLocationCoordinate2D(latitude: -0.0236, longitude: 37.9062),
        "AE": CLLocationCoordinate2D(latitude: 23.4241, longitude: 53.8478),
        "SA": CLLocationCoordinate2D(latitude: 23.8859, longitude: 45.0792),
        "IL": CLLocationCoordinate2D(latitude: 31.0461, longitude: 34.8516),
        "IN": CLLocationCoordinate2D(latitude: 20.5937, longitude: 78.9629),
        "PK": CLLocationCoordinate2D(latitude: 30.3753, longitude: 69.3451),
        "CN": CLLocationCoordinate2D(latitude: 35.8617, longitude: 104.1954),
        "JP": CLLocationCoordinate2D(latitude: 36.2048, longitude: 138.2529),
        "KR": CLLocationCoordinate2D(latitude: 35.9078, longitude: 127.7669),
        "VN": CLLocationCoordinate2D(latitude: 14.0583, longitude: 108.2772),
        "TH": CLLocationCoordinate2D(latitude: 15.87, longitude: 100.9925),
        "MY": CLLocationCoordinate2D(latitude: 4.2105, longitude: 101.9758),
        "SG": CLLocationCoordinate2D(latitude: 1.3521, longitude: 103.8198),
        "ID": CLLocationCoordinate2D(latitude: -0.7893, longitude: 113.9213),
        "PH": CLLocationCoordinate2D(latitude: 12.8797, longitude: 121.774),
        "AU": CLLocationCoordinate2D(latitude: -25.2744, longitude: 133.7751),
        "NZ": CLLocationCoordinate2D(latitude: -40.9006, longitude: 174.886),
    ]

    static func coordinate(for iso2: String) -> CLLocationCoordinate2D? {
        values[iso2.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()]
    }
}
