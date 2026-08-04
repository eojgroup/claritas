import SwiftUI
import Charts
import MapKit

struct DashboardView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage("DEFAULT_LIST_MODE") private var defaultListModeRaw: String = "news"
    @State private var query: String = ""
    @State private var listMode: ListMode = .news
    @State private var section: DashboardSection = .overview
    @State private var minTemp: String = ""
    @State private var hasAppliedStoredModes: Bool = false

    enum ListMode: String, CaseIterable { case news, weather, market }
    enum DashboardSection: String, CaseIterable { case overview, news, weather, market }

    var body: some View {
        DashboardBackground {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    mobileCommandHeader

                    SignalMapPanel(
                        height: 310,
                        allowsComparison: false,
                        showsCountryProfile: false
                    )

                    mobilePostureStrip

                    if model.selectedCountry != nil {
                        mobileFocusCard
                    }

                    mobilePriorityCard
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 16)
            }
            .refreshable {
                await model.loadInitial()
            }
        }
    }

    private var legacyDashboard: some View {
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
                        SignalMapPanel(
                            height: 350,
                            allowsComparison: true,
                            showsCountryProfile: false
                        )
                        overviewMetricsCard
                    }

                    if hasSearchQuery {
                        searchPreviewCard
                    }

                    if section == .overview {
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
            listMode = ListMode(rawValue: defaultListModeRaw) ?? .news
            hasAppliedStoredModes = true
        }
    }

    private var mobileCommandHeader: some View {
        HStack(alignment: .top, spacing: 12) {
            BrandSectionHeader(
                kicker: "GLOBAL SIGNAL DESK",
                title: "Decision pulse",
                detail: "Map first. Only the signals that need attention now."
            )
            Spacer(minLength: 4)
            HStack(spacing: 6) {
                Circle()
                    .fill(ClaritasPalette.positiveText(for: colorScheme))
                    .frame(width: 7, height: 7)
                Text("Live")
                    .font(.caption.weight(.semibold))
            }
            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            .padding(.horizontal, 10)
            .frame(minHeight: ClaritasLayout.minimumTouchTarget)
            .background(
                ClaritasPalette.shellSurfaceMuted(for: colorScheme),
                in: Capsule()
            )
        }
        .padding(16)
        .brandGlass(cornerRadius: ClaritasLayout.panelRadius, elevated: true)
    }

    private var mobilePostureStrip: some View {
        HStack(alignment: .top, spacing: 0) {
            mobileMetric(
                label: "Coverage",
                value: "\(model.countryStats.count)",
                detail: "countries",
                tone: ClaritasPalette.shellAccentSecondary(for: colorScheme)
            )
            Divider()
            mobileMetric(
                label: "Thresholds",
                value: "\(mobileThresholdCount)",
                detail: "need review",
                tone: mobileThresholdCount > 0
                    ? ClaritasPalette.negativeText(for: colorScheme)
                    : ClaritasPalette.positiveText(for: colorScheme)
            )
            Divider()
            mobileMetric(
                label: "Markets",
                value: String(format: "%+.1f%%", mobileMarketAverage),
                detail: "tracked avg.",
                tone: mobileMarketAverage >= 0
                    ? ClaritasPalette.positiveText(for: colorScheme)
                    : ClaritasPalette.negativeText(for: colorScheme)
            )
        }
        .padding(.vertical, 12)
        .brandGlass(cornerRadius: ClaritasLayout.panelRadius, elevated: true)
    }

    private func mobileMetric(label: String, value: String, detail: String, tone: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .tracking(1)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            Text(value)
                .font(.headline.monospacedDigit())
                .foregroundStyle(tone)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(detail)
                .font(.caption2)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
    }

    private var mobileFocusCard: some View {
        BrandCard(title: "Active country profile", icon: "scope") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(mobileCountryName)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                        Text(model.selectedCountry?.uppercased() ?? "")
                            .font(.caption.weight(.semibold))
                            .tracking(1.4)
                            .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                    }
                    Spacer()
                    Button("Clear") {
                        model.clearSelection()
                    }
                    .buttonStyle(.bordered)
                }

                HStack(alignment: .top, spacing: 10) {
                    mobileFocusMetric(
                        label: "News",
                        value: "\(mobileCountryNews.count)",
                        detail: "stories"
                    )
                    mobileFocusMetric(
                        label: "Weather",
                        value: mobileCountryWeather?.temp_c.map { String(format: "%.0f°C", $0) } ?? "—",
                        detail: mobileCountryWeather?.weather_main ?? "No update"
                    )
                    mobileFocusMetric(
                        label: "Mover",
                        value: mobileCountryMarkets.first?.symbol ?? "—",
                        detail: mobileCountryMarkets.first?.percent_change.map { String(format: "%+.1f%%", $0) } ?? "No quote"
                    )
                }

                if let leader = mobileCountryLeadership?.roles.first {
                    Divider()
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "person.crop.rectangle.stack")
                            .foregroundStyle(ClaritasPalette.shellAccentSecondary(for: colorScheme))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(leader.roleLabel)
                                .font(.caption)
                                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                            Text(leader.person_name)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                        }
                    }
                }
            }
        }
    }

    private func mobileFocusMetric(label: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .tracking(1)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            Text(value)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(detail)
                .font(.caption2)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(
            ClaritasPalette.shellSurfaceMuted(for: colorScheme),
            in: RoundedRectangle(cornerRadius: 10)
        )
    }

    private var mobilePriorityCard: some View {
        BrandCard(title: "Needs attention", icon: "scope") {
            VStack(spacing: 0) {
                if let headline = mobilePriorityHeadline {
                    Button {
                        model.selectedCountry = headline.country_iso2?.uppercased()
                    } label: {
                        mobileSignalRow(
                            icon: "newspaper",
                            eyebrow: "Headline",
                            value: headline.title ?? "Untitled",
                            detail: [
                                headline.country_iso2?.uppercased(),
                                headline.source_name
                            ].compactMap { $0 }.joined(separator: " · "),
                            tone: ClaritasPalette.shellAccent(for: colorScheme)
                        )
                    }
                    .buttonStyle(.plain)
                    Divider()
                }

                if let weather = mobilePriorityWeather {
                    Button {
                        model.selectedCountry = weather.country.uppercased()
                    } label: {
                        mobileSignalRow(
                            icon: "cloud.sun",
                            eyebrow: "Weather exception",
                            value: "\(weather.country.uppercased()) · \(weather.temp_c.map { String(format: "%.0f°C", $0) } ?? "—")",
                            detail: weather.weather_desc ?? weather.weather_main ?? "Current conditions",
                            tone: ClaritasPalette.shellAccentSecondary(for: colorScheme)
                        )
                    }
                    .buttonStyle(.plain)
                    Divider()
                }

                if let quote = mobilePriorityMarket {
                    Button {
                        model.selectedSymbol = quote.symbol
                        model.selectedCountry = quote.country?.uppercased()
                    } label: {
                        mobileSignalRow(
                            icon: "chart.line.uptrend.xyaxis",
                            eyebrow: "Market mover",
                            value: "\(quote.symbol) · \(quote.percent_change.map { String(format: "%+.2f%%", $0) } ?? "—")",
                            detail: quote.company_name ?? quote.exchange ?? "Tracked instrument",
                            tone: (quote.percent_change ?? 0) >= 0
                                ? ClaritasPalette.positiveText(for: colorScheme)
                                : ClaritasPalette.negativeText(for: colorScheme)
                        )
                    }
                    .buttonStyle(.plain)
                }

                if mobilePriorityHeadline == nil &&
                    mobilePriorityWeather == nil &&
                    mobilePriorityMarket == nil {
                    Text("Current sources have not produced an actionable signal yet.")
                        .font(.subheadline)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        .padding(.vertical, 16)
                }
            }
        }
    }

    private func mobileSignalRow(
        icon: String,
        eyebrow: String,
        value: String,
        detail: String,
        tone: Color
    ) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tone)
                .frame(width: 28, height: 28)
                .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                Text(eyebrow.uppercased())
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(1)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                Text(value)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                    .lineLimit(2)
                if !detail.isEmpty {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        .lineLimit(1)
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
        }
        .frame(minHeight: 64)
        .contentShape(Rectangle())
    }

    private var mobileMarketAverage: Double {
        let changes = model.marketQuotes.compactMap(\.percent_change)
        guard !changes.isEmpty else { return 0 }
        return changes.reduce(0, +) / Double(changes.count)
    }

    private var mobileThresholdCount: Int {
        let weatherCount = model.weather.filter {
            ($0.temp_c.map { $0 >= 35 || $0 <= 0 } ?? false) ||
                ($0.humidity.map { $0 >= 85 } ?? false) ||
                ($0.wind_speed.map { $0 >= 15 } ?? false)
        }.count
        let marketCount = model.marketQuotes.filter {
            abs($0.percent_change ?? 0) >= 2
        }.count
        return weatherCount + marketCount
    }

    private var mobilePriorityHeadline: NewsItem? {
        guard let selected = model.selectedCountry?.uppercased() else {
            return model.news.first
        }
        return model.news.first { ($0.country_iso2 ?? "").uppercased() == selected }
    }

    private var mobilePriorityWeather: CountryWeather? {
        let rows: [CountryWeather]
        if let selected = model.selectedCountry?.uppercased() {
            rows = model.weather.filter { $0.country.uppercased() == selected }
        } else {
            rows = model.weather
        }
        return rows.max { mobileWeatherSeverity($0) < mobileWeatherSeverity($1) }
    }

    private func mobileWeatherSeverity(_ row: CountryWeather) -> Double {
        let temperature = row.temp_c.map { abs($0 - 20) } ?? 0
        let humidity = max(0, (row.humidity ?? 0) - 70) / 2
        let wind = max(0, (row.wind_speed ?? 0) - 8)
        return temperature + humidity + wind
    }

    private var mobilePriorityMarket: MarketQuote? {
        let rows: [MarketQuote]
        if let selected = model.selectedCountry?.uppercased() {
            rows = model.marketQuotes.filter { ($0.country ?? "").uppercased() == selected }
        } else {
            rows = model.marketQuotes
        }
        return rows.max { abs($0.percent_change ?? 0) < abs($1.percent_change ?? 0) }
    }

    private var mobileCountryName: String {
        guard let selected = model.selectedCountry?.uppercased() else { return "Global" }
        return Locale(identifier: "en_US").localizedString(forRegionCode: selected) ?? selected
    }

    private var mobileCountryNews: [NewsItem] {
        guard let selected = model.selectedCountry?.uppercased() else { return [] }
        return model.news.filter { ($0.country_iso2 ?? "").uppercased() == selected }
    }

    private var mobileCountryWeather: CountryWeather? {
        guard let selected = model.selectedCountry?.uppercased() else { return nil }
        return model.weather
            .filter { $0.country.uppercased() == selected }
            .max { ($0.observedDate ?? .distantPast) < ($1.observedDate ?? .distantPast) }
    }

    private var mobileCountryMarkets: [MarketQuote] {
        guard let selected = model.selectedCountry?.uppercased() else { return [] }
        return model.marketQuotes
            .filter { ($0.country ?? "").uppercased() == selected }
            .sorted { abs($0.percent_change ?? 0) > abs($1.percent_change ?? 0) }
    }

    private var mobileCountryLeadership: CountryLeadership? {
        guard let selected = model.selectedCountry?.uppercased() else { return nil }
        return model.leadership.first { $0.country.uppercased() == selected }
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
                        title: "Market coverage",
                        value: "\(model.marketQuotes.count) quotes",
                        detail: "Loaded watchlist observations",
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
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
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

                    if horizontalSizeClass == .compact {
                        storyPanel
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

                    if horizontalSizeClass != .compact {
                        storyPanel
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

    private var storyPanel: some View {
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
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
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

                    if horizontalSizeClass == .compact {
                        snapshotsPanel
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

                    if horizontalSizeClass != .compact {
                        snapshotsPanel
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
        }
    }

    private var snapshotsPanel: some View {
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
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var query: String = ""
    @State private var exchangeFilter: String = "all"
    @State private var countryFilter: String = "all"
    @State private var marketFilter: String = "all"
    @State private var directionFilter: Direction = .all
    @State private var minMoveText: String = "0"

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
                                detail: "Watchlist quotes and country-level correlation views."
                            )

                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                                BrandMetricCard(title: "Quotes", value: "\(rows.count)", detail: "Quotes after current filters", tone: nil)
                                BrandMetricCard(
                                    title: "Countries",
                                    value: "\(Set(rows.compactMap { $0.country?.uppercased() }).count)",
                                    detail: "Represented in the current quote set",
                                    tone: ClaritasPalette.darkGreen
                                )
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

                                if model.selectedSymbol != nil {
                                    Button("Clear symbol") {
                                        model.selectedSymbol = nil
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                        }
                    }

                    if horizontalSizeClass == .compact {
                        marketTriagePanel
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

                    if horizontalSizeClass != .compact {
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
    }

    private var marketTriagePanel: some View {
        BrandCard {
            VStack(alignment: .leading, spacing: 12) {
                Text(model.selectedSymbol == nil ? "Watchlist" : "Selected symbol")
                    .font(.headline)

                if let selectedQuote {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(selectedQuote.symbol)
                                .font(.title2.weight(.semibold))
                            Text(selectedQuote.company_name ?? selectedQuote.exchange ?? "Market")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 3) {
                            Text(selectedQuote.price.map { String(format: "%.2f", $0) } ?? "—")
                                .font(.title3.weight(.semibold))
                                .monospacedDigit()
                            Text(changeText(for: selectedQuote))
                                .font(.subheadline.weight(.semibold))
                                .monospacedDigit()
                                .foregroundStyle(changeColor(for: selectedQuote))
                        }
                    }

                    ProfileFactRow(
                        label: "Context",
                        value: "\(selectedQuote.country?.uppercased() ?? "—") · \(relatedWeather.map { "\(compactNumber($0.temp_c))°C \($0.weather_main ?? "")" } ?? "No weather")"
                    )

                    if let headline = relatedNews.first?.title {
                        Text(headline)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }

                    Divider()
                }

                MarketQuoteListView(
                    quotes: Array(rows.prefix(8)),
                    selectedSymbol: model.selectedSymbol,
                    isRefreshing: model.isRefreshingMarketQuotes,
                    onRefresh: { Task { await model.refreshMarketQuotes(forceRefresh: true) } },
                    onSelectSymbol: { symbol in
                        model.selectedSymbol = symbol
                        if let country = model.marketQuotes.first(where: {
                            $0.symbol.uppercased() == symbol.uppercased()
                        })?.country {
                            model.selectedCountry = country.uppercased()
                        }
                    }
                )
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
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    BrandSectionHeader(
                        kicker: "Reference",
                        title: "Policies and usage guidelines",
                        detail: "Privacy, terms, data handling, and product governance in a reading-first format."
                    )
                    .padding(.bottom, 20)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(legalPolicies) { policy in
                                NavigationLink {
                                    PolicyDetailView(policy: policy)
                                } label: {
                                    Text(policy.title)
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 12)
                                        .frame(minHeight: ClaritasLayout.minimumTouchTarget)
                                        .background(
                                            ClaritasPalette.shellSurface(for: colorScheme),
                                            in: Capsule()
                                        )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.bottom, 20)

                    ForEach(Array(legalPolicies.enumerated()), id: \.element.id) { index, policy in
                        VStack(alignment: .leading, spacing: 14) {
                            Text(String(format: "%02d", index + 1))
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(ClaritasPalette.shellAccentSecondary(for: colorScheme))
                            Text(policy.title)
                                .font(.title2.weight(.semibold))
                            Text(policy.intro)
                                .font(.body)
                                .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))

                            ForEach(policy.items, id: \.self) { item in
                                HStack(alignment: .top, spacing: 10) {
                                    Circle()
                                        .fill(ClaritasPalette.shellAccentSecondary(for: colorScheme))
                                        .frame(width: 6, height: 6)
                                        .padding(.top, 7)
                                    Text(item)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }

                            Text(policy.note)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(
                                    ClaritasPalette.shellAccent(for: colorScheme).opacity(0.08),
                                    in: RoundedRectangle(cornerRadius: ClaritasLayout.controlRadius)
                                )
                        }
                        .padding(.vertical, 24)
                        .overlay(alignment: .top) {
                            Divider()
                        }
                    }

                    DisclosureGroup("Claritas colour reference") {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
                            BrandSwatch(
                                name: "Command Navy",
                                hex: colorScheme == .dark ? "#315F72" : "#172F42",
                                color: colorScheme == .dark ? Color(hex: "#315F72") : ClaritasPalette.darkBlue
                            )
                            BrandSwatch(
                                name: "Signal Blue",
                                hex: colorScheme == .dark ? "#77A8BA" : "#3E6A80",
                                color: ClaritasPalette.dataBlue(for: colorScheme)
                            )
                            BrandSwatch(
                                name: "Signal Orange",
                                hex: colorScheme == .dark ? "#EDA36A" : "#E6A06A",
                                color: ClaritasPalette.shellAccent(for: colorScheme)
                            )
                            BrandSwatch(
                                name: "Working Surface",
                                hex: colorScheme == .dark ? "#11222E" : "#FFFAF1",
                                color: ClaritasPalette.shellSurface(for: colorScheme)
                            )
                            BrandSwatch(
                                name: "Muted Text",
                                hex: colorScheme == .dark ? "#A9B5BA" : "#53616A",
                                color: ClaritasPalette.shellMuted(for: colorScheme)
                            )
                            BrandSwatch(
                                name: "Primary Ink",
                                hex: colorScheme == .dark ? "#F2EEE6" : "#172F42",
                                color: ClaritasPalette.shellInk(for: colorScheme)
                            )
                        }
                        .padding(.top, 14)
                    }
                    .font(.headline)
                    .padding(.vertical, 20)
                }
                .frame(maxWidth: 760, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity)
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
    case "gdelt":
        return "GDELT"
    case "institutional_rss":
        return "Institutional RSS"
    case "openweather":
        return "OpenWeather"
    case "nws":
        return "NOAA/NWS"
    case "sec_edgar":
        return "SEC EDGAR"
    case "ecb":
        return "ECB"
    case "oecd":
        return "OECD"
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
    if item.source_name?.lowercased() == "gdelt",
       let payload = item.payload?.object,
       let publisher = trimmed(payload["source"]?.string) {
        return "\(publisher) · via GDELT"
    }
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
                Text("Licensed market snapshots (when configured)")
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
                    ClaritasPalette.shellBackgroundElevated(for: colorScheme),
                    ClaritasPalette.shellBackground(for: colorScheme),
                    colorScheme == .dark
                        ? Color(hex: "#081119")
                        : Color(hex: "#EFE1CF")
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            LinearGradient(
                colors: [
                    ClaritasPalette.shellAccentSecondary(for: colorScheme).opacity(colorScheme == .dark ? 0.08 : 0.07),
                    Color.clear,
                    ClaritasPalette.shellAccent(for: colorScheme).opacity(colorScheme == .dark ? 0.1 : 0.05)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
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

enum SignalMapMode: String, CaseIterable, Identifiable {
    case signals
    case news
    case weather
    case leadership

    var id: String { rawValue }

    var label: String {
        switch self {
        case .signals: return "Signals"
        case .news: return "News"
        case .weather: return "Weather"
        case .leadership: return "Leaders"
        }
    }

    var title: String {
        switch self {
        case .signals: return "Cross-source signal relevance"
        case .news: return "Story concentration"
        case .weather: return "Latest weather conditions"
        case .leadership: return "Country leadership"
        }
    }

    var legend: String {
        switch self {
        case .signals: return "Signal relevance"
        case .news: return "Mapped stories"
        case .weather: return "Temperature severity"
        case .leadership: return "Leadership records"
        }
    }
}

enum SignalMapRegion: String, CaseIterable, Identifiable {
    case global
    case americas
    case europe
    case africa
    case asia
    case apac
    case oceania

    var id: String { rawValue }
    var label: String { rawValue.capitalized }

    var geographicBounds: (minLon: Double, maxLon: Double, minLat: Double, maxLat: Double) {
        switch self {
        case .global: return (-180, 180, -60, 82)
        case .americas: return (-170, -30, -58, 75)
        case .europe: return (-25, 50, 32, 72)
        case .africa: return (-22, 58, -38, 40)
        case .asia: return (35, 180, -12, 80)
        case .apac: return (65, 180, -52, 60)
        case .oceania: return (105, 180, -52, 8)
        }
    }

    var coordinateRegion: MKCoordinateRegion {
        switch self {
        case .global:
            return MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: 15, longitude: 10),
                span: MKCoordinateSpan(latitudeDelta: 145, longitudeDelta: 300)
            )
        case .americas:
            return MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: 13, longitude: -82),
                span: MKCoordinateSpan(latitudeDelta: 132, longitudeDelta: 112)
            )
        case .europe:
            return MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: 52, longitude: 15),
                span: MKCoordinateSpan(latitudeDelta: 42, longitudeDelta: 64)
            )
        case .africa:
            return MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: 2, longitude: 20),
                span: MKCoordinateSpan(latitudeDelta: 76, longitudeDelta: 84)
            )
        case .asia:
            return MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: 34, longitude: 88),
                span: MKCoordinateSpan(latitudeDelta: 92, longitudeDelta: 132)
            )
        case .apac:
            return MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: 10, longitude: 120),
                span: MKCoordinateSpan(latitudeDelta: 105, longitudeDelta: 132)
            )
        case .oceania:
            return MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: -24, longitude: 145),
                span: MKCoordinateSpan(latitudeDelta: 65, longitudeDelta: 82)
            )
        }
    }

    func contains(_ iso: String) -> Bool {
        let normalized = iso.uppercased()
        switch self {
        case .global:
            return true
        case .americas:
            return Self.americasCountries.contains(normalized)
        case .europe:
            return Self.europeCountries.contains(normalized)
        case .africa:
            return Self.africaCountries.contains(normalized)
        case .asia:
            return Self.asiaCountries.contains(normalized)
        case .apac:
            return Self.apacCountries.contains(normalized)
        case .oceania:
            return Self.oceaniaCountries.contains(normalized)
        }
    }

    private static let americasCountries: Set<String> = [
        "AR", "BO", "BR", "CA", "CL", "CO", "CR", "CU", "DO", "EC", "GT", "HN",
        "JM", "MX", "NI", "PA", "PE", "PR", "PY", "SV", "TT", "US", "UY", "VE"
    ]
    private static let europeCountries: Set<String> = [
        "AL", "AT", "BA", "BE", "BG", "CH", "CZ", "DE", "DK", "EE", "ES", "FI",
        "FR", "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LT", "LU", "LV", "NL",
        "NO", "PL", "PT", "RO", "RS", "SE", "SI", "SK", "UA"
    ]
    private static let africaCountries: Set<String> = [
        "AO", "BF", "BI", "BJ", "BW", "CD", "CG", "CI", "CM", "DZ", "EG", "ET",
        "GA", "GH", "KE", "LY", "MA", "MG", "ML", "MZ", "NA", "NE", "NG", "RW",
        "SD", "SN", "SO", "TZ", "UG", "ZA", "ZM", "ZW"
    ]
    private static let asiaCountries: Set<String> = [
        "AE", "AF", "BD", "BH", "CN", "HK", "ID", "IL", "IN", "IQ", "IR", "JO",
        "JP", "KH", "KP", "KR", "KW", "KZ", "LA", "LB", "LK", "MM", "MN", "MY",
        "NP", "OM", "PH", "PK", "QA", "RU", "SA", "SG", "SY", "TH", "TR", "TW",
        "UZ", "VN", "YE"
    ]
    private static let apacCountries: Set<String> = [
        "AU", "BD", "BN", "CN", "FJ", "HK", "ID", "IN", "JP", "KH", "KR", "LA",
        "LK", "MM", "MN", "MY", "NP", "NZ", "PG", "PH", "PK", "SG", "TH", "TW", "VN"
    ]
    private static let oceaniaCountries: Set<String> = [
        "AU", "FJ", "FM", "KI", "MH", "NR", "NZ", "PG", "PW", "SB", "TO", "TV", "VU", "WS"
    ]
}

struct SignalMapPanel: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @AppStorage("DEFAULT_MAP_MODE") private var storedMode: String = SignalMapMode.signals.rawValue
    @State private var mode: SignalMapMode = .signals
    @State private var region: SignalMapRegion = .global
    @State private var compareMode = false
    @State private var comparisonCountry: String?
    @State private var pinnedCountry: String?
    @State private var resetToken = 0

    let height: CGFloat
    let allowsComparison: Bool
    let showsCountryProfile: Bool

    private var points: [CountryBubblePoint] {
        SignalMapDataBuilder.points(
            for: mode,
            region: region,
            countryStats: model.countryStats,
            podcasts: model.podcasts,
            weather: model.weather,
            marketQuotes: model.marketQuotes,
            leadership: model.leadership
        )
    }

    private var highest: CountryBubblePoint? { points.first }

    var body: some View {
        DashboardCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 12) {
                    BrandSectionHeader(
                        kicker: "Geospatial pulse",
                        title: "Map: \(mode.title)",
                        detail: "Select a country to inspect the drivers behind its rank."
                    )
                    Spacer(minLength: 0)
                }

                Picker("Map layer", selection: $mode) {
                    ForEach(SignalMapMode.allCases) { item in
                        Text(item.label).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                .onChange(of: mode) { next in
                    storedMode = next.rawValue
                    clearComparison()
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(SignalMapRegion.allCases) { item in
                            Button(item.label) {
                                region = item
                                clearComparison()
                                resetToken += 1
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.regular)
                            .frame(minHeight: ClaritasLayout.minimumTouchTarget)
                            .tint(region == item ? ClaritasPalette.shellAccentSecondary(for: colorScheme) : nil)
                        }
                    }
                }

                HStack(spacing: 8) {
                    if allowsComparison, horizontalSizeClass == .regular {
                        Button {
                            compareMode.toggle()
                            if !compareMode { comparisonCountry = nil }
                        } label: {
                            Label(compareMode ? "Comparing" : "Compare", systemImage: "square.split.2x1")
                        }
                        .buttonStyle(.bordered)
                        .tint(compareMode ? ClaritasPalette.shellAccentSecondary(for: colorScheme) : nil)
                    }

                    if horizontalSizeClass == .regular {
                        Button {
                            pinnedCountry = model.selectedCountry?.uppercased()
                        } label: {
                            Label(
                                pinnedCountry == nil ? "Pin selection" : "Pinned \(pinnedCountry!)",
                                systemImage: pinnedCountry == nil ? "pin" : "pin.fill"
                            )
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.selectedCountry == nil)
                    }

                    Spacer()

                    Button {
                        model.selectedCountry = nil
                        comparisonCountry = nil
                        pinnedCountry = nil
                        compareMode = false
                        resetToken += 1
                    } label: {
                        Label("Reset", systemImage: "arrow.counterclockwise")
                    }
                    .buttonStyle(.bordered)
                }
                .font(.caption)

                ZStack(alignment: .topLeading) {
                    InteractiveCountryBubbleMap(
                        points: points,
                        mapRegion: region,
                        selectedCountry: model.selectedCountry,
                        comparisonCountry: comparisonCountry,
                        pinnedCountry: pinnedCountry,
                        featuredCountry: mode == .signals ? highest?.iso : nil,
                        resetToken: resetToken,
                        onSelectCountry: selectCountry
                    )
                    .frame(height: height)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(ClaritasPalette.shellBorderStrong(for: colorScheme), lineWidth: 1)
                    )

                    if mode == .signals, let highest {
                        Button {
                            selectCountry(highest.iso)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("HIGHEST SIGNAL RELEVANCE")
                                    .font(.caption2.weight(.bold))
                                    .tracking(1.4)
                                    .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                                Text("\(highest.iso) · \(highest.valueLabel)")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                                Text(highest.detail)
                                    .font(.caption2)
                                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                    .lineLimit(2)
                            }
                            .frame(maxWidth: height >= 440 ? 240 : 178, alignment: .leading)
                            .padding(10)
                            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
                            .overlay(alignment: .leading) {
                                Rectangle()
                                    .fill(ClaritasPalette.shellAccent(for: colorScheme))
                                    .frame(width: 3)
                            }
                        }
                        .buttonStyle(.plain)
                        .padding(10)
                    }
                }

                HStack(spacing: 10) {
                    HStack(spacing: 4) {
                        Circle().fill(ClaritasPalette.shellAccent(for: colorScheme)).frame(width: 10, height: 10)
                        Circle().fill(ClaritasPalette.shellAccent(for: colorScheme)).frame(width: 14, height: 14)
                        Circle().fill(ClaritasPalette.shellAccent(for: colorScheme)).frame(width: 18, height: 18)
                    }
                    Text("\(mode.legend) · log-scaled")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("\(points.count) mapped")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                if mode == .signals {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("Relevance model")
                            .font(.caption.weight(.semibold))
                        Text("News 40% · podcast evidence 25% · weather 15% · markets 15% · confirmation bonus")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                        Spacer(minLength: 0)
                    }
                }

                if let selected = selectedPoint {
                    Divider()
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(comparisonCountry == selected.iso ? "Comparison" : "Selected country")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Text("\(selected.iso) · \(selected.valueLabel)")
                                .font(.headline.monospacedDigit())
                            Text(selected.detail)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if pinnedCountry == selected.iso {
                            Label("Pinned", systemImage: "pin.fill")
                                .font(.caption)
                                .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                        }
                    }
                }

                if showsCountryProfile, model.selectedCountry != nil {
                    Divider()
                    CountryProfileView(selectedCountry: model.selectedCountry)
                }
            }
        }
        .onAppear {
            let resolved = SignalMapMode(rawValue: storedMode) ?? .signals
            mode = resolved
            storedMode = resolved.rawValue
        }
    }

    private var selectedPoint: CountryBubblePoint? {
        let iso = (comparisonCountry ?? model.selectedCountry)?.uppercased()
        return points.first { $0.iso == iso }
    }

    private func selectCountry(_ iso: String) {
        let normalized = iso.uppercased()
        if compareMode,
           let primary = model.selectedCountry?.uppercased(),
           primary != normalized {
            comparisonCountry = normalized
            return
        }
        model.selectedCountry = model.selectedCountry?.uppercased() == normalized ? nil : normalized
        comparisonCountry = nil
    }

    private func clearComparison() {
        comparisonCountry = nil
        compareMode = false
    }
}

private enum SignalMapDataBuilder {
    static func points(
        for mode: SignalMapMode,
        region: SignalMapRegion,
        countryStats: [CountryStat],
        podcasts: [PodcastEpisode],
        weather: [CountryWeather],
        marketQuotes: [MarketQuote],
        leadership: [CountryLeadership]
    ) -> [CountryBubblePoint] {
        let raw: [CountryBubblePoint]
        switch mode {
        case .signals:
            raw = signalPoints(
                countryStats: countryStats,
                podcasts: podcasts,
                weather: weather,
                marketQuotes: marketQuotes
            )
        case .news:
            raw = countryStats.map { stat in
                point(
                    id: "news-\(stat.country)",
                    iso: stat.country,
                    valueLabel: "\(stat.count)",
                    detail: "\(stat.count) mapped \(stat.count == 1 ? "story" : "stories")",
                    magnitude: Double(max(stat.count, 1))
                )
            }
        case .weather:
            raw = weather.map { row in
                let temperature = row.temp_c ?? 0
                let severity = max(abs(temperature - 20), 1)
                return point(
                    id: "weather-\(row.country)",
                    iso: row.country,
                    valueLabel: row.temp_c.map { String(format: "%.0f°C", $0) } ?? "—",
                    detail: "\(row.weather_main ?? "Current conditions") · \(Int(row.humidity ?? 0))% humidity",
                    magnitude: severity
                )
            }
        case .leadership:
            raw = leadership.map { row in
                let names = row.roles.map(\.person_name).filter { !$0.isEmpty }
                return point(
                    id: "leadership-\(row.country)",
                    iso: row.country,
                    valueLabel: "\(max(row.roles.count, 1))",
                    detail: names.isEmpty ? "Leadership record" : names.joined(separator: " · "),
                    magnitude: Double(max(row.roles.count, 1))
                )
            }
        }

        return raw
            .filter { region.contains($0.iso) && CountryCentroidLookup.coordinate(for: $0.iso) != nil }
            .sorted { $0.magnitude > $1.magnitude }
            .enumerated()
            .map { index, item in
                CountryBubblePoint(
                    id: item.id,
                    iso: item.iso,
                    valueLabel: item.valueLabel,
                    detail: item.detail,
                    magnitude: item.magnitude,
                    rank: index + 1,
                    coordinate: item.coordinate
                )
            }
    }

    private static func signalPoints(
        countryStats: [CountryStat],
        podcasts: [PodcastEpisode],
        weather: [CountryWeather],
        marketQuotes: [MarketQuote]
    ) -> [CountryBubblePoint] {
        let newsByCountry = Dictionary(
            uniqueKeysWithValues: countryStats.map { ($0.country.uppercased(), $0.count) }
        )
        var weatherByCountry: [String: CountryWeather] = [:]
        for row in weather {
            let iso = row.country.uppercased()
            if let current = weatherByCountry[iso],
               (current.observedDate ?? .distantPast) >= (row.observedDate ?? .distantPast) {
                continue
            }
            weatherByCountry[iso] = row
        }
        var marketByCountry: [String: MarketQuote] = [:]
        for quote in marketQuotes {
            guard let iso = quote.country?.uppercased(), !iso.isEmpty else { continue }
            let current = marketByCountry[iso]
            if current == nil ||
                abs(quote.percent_change ?? quote.change ?? 0) >
                abs(current?.percent_change ?? current?.change ?? 0) {
                marketByCountry[iso] = quote
            }
        }

        var podcastByCountry: [String: (count: Int, score: Double)] = [:]
        for episode in podcasts {
            for signal in episode.signals {
                let riskBase: Double
                switch signal.risk_level?.lowercased() {
                case "critical": riskBase = 100
                case "high": riskBase = 82
                case "medium": riskBase = 60
                case "low": riskBase = 38
                default: riskBase = 32
                }
                let score = riskBase * (0.65 + (signal.confidence ?? 0.55) * 0.35)
                for country in signal.countries {
                    let iso = country.uppercased()
                    guard iso.count == 2 else { continue }
                    let current = podcastByCountry[iso] ?? (0, 0)
                    podcastByCountry[iso] = (current.count + 1, max(current.score, score))
                }
            }
        }

        let countries = Set(newsByCountry.keys)
            .union(weatherByCountry.keys)
            .union(marketByCountry.keys)
            .union(podcastByCountry.keys)
        let maxNews = Double(max(newsByCountry.values.max() ?? 1, 1))
        let maxMarket = max(
            marketByCountry.values.map { abs($0.percent_change ?? $0.change ?? 0) }.max() ?? 1,
            1
        )

        return countries.compactMap { iso in
            var domains: [String] = []
            let newsCount = newsByCountry[iso] ?? 0
            let newsRelevance = newsCount > 0
                ? log1p(Double(newsCount)) / log1p(maxNews)
                : 0
            if newsCount > 0 { domains.append("news") }

            let currentWeather = weatherByCountry[iso]
            let temperatureSeverity = currentWeather?.temp_c.map {
                min(1, max(0, (abs($0 - 20) - 8) / 24))
            } ?? 0
            let humiditySeverity = currentWeather?.humidity.map {
                min(1, max(0, ($0 - 75) / 25))
            } ?? 0
            let windSeverity = currentWeather?.wind_speed.map { min(1, $0 / 25) } ?? 0
            let weatherRelevance = max(temperatureSeverity, max(humiditySeverity, windSeverity))
            if weatherRelevance > 0 { domains.append("weather") }

            let market = marketByCountry[iso]
            let marketMove = abs(market?.percent_change ?? market?.change ?? 0)
            let marketRelevance = market == nil ? 0 : marketMove / maxMarket
            if market != nil { domains.append("markets") }

            let podcast = podcastByCountry[iso]
            let podcastRelevance = podcast.map {
                min(1, ($0.score + min(18, Double($0.count * 3))) / 100)
            } ?? 0
            if podcast != nil { domains.append("podcast") }

            let breadthBonus = Double(max(0, domains.count - 1) * 2)
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

            var drivers: [String] = []
            if newsCount > 0 { drivers.append("\(newsCount) stories") }
            if let podcast { drivers.append("\(podcast.count) podcast signals") }
            if let currentWeather, weatherRelevance > 0 {
                drivers.append(currentWeather.temp_c.map { String(format: "%.0f°C", $0) } ?? "weather")
            }
            if let market {
                drivers.append("\(market.symbol) \(String(format: "%+.1f%%", market.percent_change ?? market.change ?? 0))")
            }
            return point(
                id: "signals-\(iso)",
                iso: iso,
                valueLabel: "\(Int(relevance))/100",
                detail: "\(domains.count) linked \(domains.count == 1 ? "domain" : "domains") · \(drivers.prefix(2).joined(separator: " · "))",
                magnitude: relevance
            )
        }
    }

    private static func point(
        id: String,
        iso: String,
        valueLabel: String,
        detail: String,
        magnitude: Double
    ) -> CountryBubblePoint {
        let normalized = iso.uppercased()
        return CountryBubblePoint(
            id: id,
            iso: normalized,
            valueLabel: valueLabel,
            detail: detail,
            magnitude: magnitude,
            rank: 0,
            coordinate: CountryCentroidLookup.coordinate(for: normalized) ??
                CLLocationCoordinate2D(latitude: 0, longitude: 0)
        )
    }
}

private struct InteractiveCountryBubbleMap: View {
    let points: [CountryBubblePoint]
    let mapRegion: SignalMapRegion
    let selectedCountry: String?
    let comparisonCountry: String?
    let pinnedCountry: String?
    let featuredCountry: String?
    let resetToken: Int
    let onSelectCountry: (String) -> Void

    @State private var committedScale: CGFloat = 1
    @GestureState private var gestureScale: CGFloat = 1
    @State private var committedOffset: CGSize = .zero
    @GestureState private var gestureOffset: CGSize = .zero

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topTrailing) {
                ZStack {
                    LinearGradient(
                        colors: [
                            Color(hex: "#0C1C27"),
                            ClaritasPalette.shellSidebar(for: .dark),
                            Color(hex: "#071018")
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )

                    Canvas { context, size in
                        drawGrid(context: context, size: size)
                        drawLand(context: context, size: size)
                    }

                    ForEach(points.prefix(64)) { point in
                        bubbleView(for: point)
                            .position(project(point.coordinate, size: proxy.size))
                    }
                }
                .scaleEffect(committedScale * gestureScale)
                .offset(
                    x: committedOffset.width + gestureOffset.width,
                    y: committedOffset.height + gestureOffset.height
                )
                .contentShape(Rectangle())
                .simultaneousGesture(magnificationGesture)
                .simultaneousGesture(dragGesture)

                viewportControls

                if points.isEmpty {
                    Text("No mapped \(mapRegion.label.lowercased()) data for this layer.")
                        .font(.footnote)
                        .foregroundStyle(Color(hex: "#F2EEE6"))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color(hex: "#11222E").opacity(0.94), in: Capsule())
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .clipped()
            .onAppear { resetViewport() }
            .onChange(of: mapRegion) { _ in resetViewport() }
            .onChange(of: resetToken) { _ in resetViewport() }
            .onChange(of: selectedCountry) { next in
                focus(on: next, size: proxy.size)
            }
        }
    }

    private func bubbleView(for point: CountryBubblePoint) -> some View {
        let selected = point.iso == selectedCountry?.uppercased()
        let compared = point.iso == comparisonCountry?.uppercased()
        let pinned = point.iso == pinnedCountry?.uppercased()
        let featured = point.iso == featuredCountry?.uppercased()
        let size = bubbleSize(for: point)

        return Button(action: { onSelectCountry(point.iso) }) {
            VStack(spacing: 2) {
                ZStack {
                    if featured || pinned {
                        Circle()
                            .stroke(
                                featured
                                    ? ClaritasPalette.shellAccent(for: .dark)
                                    : ClaritasPalette.shellAccentSecondary(for: .dark),
                                style: StrokeStyle(lineWidth: 1.5, dash: [3, 3])
                            )
                            .frame(width: size + 12, height: size + 12)
                    }
                    Circle()
                        .fill(ClaritasPalette.shellAccent(for: .dark).opacity(0.26))
                        .frame(width: size + 8, height: size + 8)
                    Circle()
                        .fill(ClaritasPalette.shellAccent(for: .dark))
                        .overlay(
                            Circle().stroke(
                                compared
                                    ? ClaritasPalette.shellAccentSecondary(for: .dark)
                                    : Color.white.opacity(selected ? 1 : 0.72),
                                lineWidth: selected || compared ? 3 : 1.5
                            )
                        )
                        .frame(width: size, height: size)
                }

                Text(point.iso)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white)
                    .shadow(color: .black, radius: 2)
                    .overlay(alignment: .trailing) {
                        if featured {
                            Text("#1")
                                .font(.system(size: 7, weight: .bold))
                                .offset(x: 14, y: 0)
                        }
                    }
            }
            .frame(minWidth: ClaritasLayout.minimumTouchTarget, minHeight: ClaritasLayout.minimumTouchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(point.iso), rank \(point.rank), \(point.detail)")
        .accessibilityHint("Select country")
    }

    private func bubbleSize(for point: CountryBubblePoint) -> CGFloat {
        let magnitudes = points.map { log1p(max($0.magnitude, 0)) }
        guard let minimum = magnitudes.min(), let maximum = magnitudes.max(), maximum > minimum else {
            return 24
        }
        let normalized = (log1p(max(point.magnitude, 0)) - minimum) / (maximum - minimum)
        return 18 + CGFloat(normalized * 18)
    }

    private var viewportControls: some View {
        VStack(spacing: 0) {
            viewportButton(icon: "plus", label: "Zoom in") {
                withAnimation(.easeInOut(duration: 0.2)) {
                    committedScale = min(3, committedScale + 0.35)
                }
            }
            Divider().overlay(Color.white.opacity(0.12))
            viewportButton(icon: "minus", label: "Zoom out") {
                withAnimation(.easeInOut(duration: 0.2)) {
                    committedScale = max(1, committedScale - 0.35)
                    if committedScale == 1 {
                        committedOffset = .zero
                    }
                }
            }
            Divider().overlay(Color.white.opacity(0.12))
            viewportButton(icon: "scope", label: "Reset map") {
                resetViewport()
            }
        }
        .background(Color(hex: "#11222E").opacity(0.94), in: RoundedRectangle(cornerRadius: 9))
        .overlay(
            RoundedRectangle(cornerRadius: 9)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
        .padding(10)
    }

    private func viewportButton(
        icon: String,
        label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color(hex: "#F2EEE6"))
                .frame(width: ClaritasLayout.minimumTouchTarget, height: ClaritasLayout.minimumTouchTarget)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var magnificationGesture: some Gesture {
        MagnificationGesture()
            .updating($gestureScale) { value, state, _ in
                state = value
            }
            .onEnded { value in
                committedScale = min(3, max(1, committedScale * value))
                if committedScale == 1 {
                    committedOffset = .zero
                }
            }
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 8)
            .updating($gestureOffset) { value, state, _ in
                state = value.translation
            }
            .onEnded { value in
                guard committedScale > 1 else {
                    committedOffset = .zero
                    return
                }
                committedOffset = CGSize(
                    width: max(-220, min(220, committedOffset.width + value.translation.width)),
                    height: max(-160, min(160, committedOffset.height + value.translation.height))
                )
            }
    }

    private func resetViewport() {
        withAnimation(.easeInOut(duration: 0.22)) {
            committedScale = 1
            committedOffset = .zero
        }
    }

    private func focus(on iso: String?, size: CGSize) {
        guard let iso = iso?.uppercased(),
              let point = points.first(where: { $0.iso == iso }) else {
            return
        }
        let projected = project(point.coordinate, size: size)
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let nextScale = max(committedScale, 1.35)
        withAnimation(.easeInOut(duration: 0.24)) {
            committedScale = nextScale
            committedOffset = CGSize(
                width: max(-220, min(220, -nextScale * (projected.x - center.x))),
                height: max(-160, min(160, -nextScale * (projected.y - center.y)))
            )
        }
    }

    private func drawGrid(context: GraphicsContext, size: CGSize) {
        var grid = Path()
        for index in 1..<6 {
            let x = size.width * CGFloat(index) / 6
            grid.move(to: CGPoint(x: x, y: 0))
            grid.addLine(to: CGPoint(x: x, y: size.height))
        }
        for index in 1..<4 {
            let y = size.height * CGFloat(index) / 4
            grid.move(to: CGPoint(x: 0, y: y))
            grid.addLine(to: CGPoint(x: size.width, y: y))
        }
        context.stroke(grid, with: .color(Color.white.opacity(0.055)), lineWidth: 0.7)
    }

    private func drawLand(context: GraphicsContext, size: CGSize) {
        for polygon in ClaritasWorldGeometry.land {
            let visiblePolygon = clipped(polygon)
            guard visiblePolygon.count >= 3 else { continue }
            var path = Path()
            for (index, coordinate) in visiblePolygon.enumerated() {
                let point = project(
                    CLLocationCoordinate2D(latitude: coordinate.1, longitude: coordinate.0),
                    size: size
                )
                if index == 0 {
                    path.move(to: point)
                } else {
                    path.addLine(to: point)
                }
            }
            path.closeSubpath()
            context.fill(path, with: .color(Color(hex: "#254453").opacity(0.82)))
            context.stroke(path, with: .color(Color(hex: "#77A8BA").opacity(0.5)), lineWidth: 0.8)
        }
    }

    private func project(_ coordinate: CLLocationCoordinate2D, size: CGSize) -> CGPoint {
        let bounds = mapRegion.geographicBounds
        let x = (coordinate.longitude - bounds.minLon) / (bounds.maxLon - bounds.minLon)
        let y = (bounds.maxLat - coordinate.latitude) / (bounds.maxLat - bounds.minLat)
        return CGPoint(
            x: max(5, min(size.width - 5, x * size.width)),
            y: max(5, min(size.height - 5, y * size.height))
        )
    }

    private func clipped(_ polygon: [(Double, Double)]) -> [(Double, Double)] {
        let bounds = mapRegion.geographicBounds
        let minLon = CGFloat(bounds.minLon)
        let maxLon = CGFloat(bounds.maxLon)
        let minLat = CGFloat(bounds.minLat)
        let maxLat = CGFloat(bounds.maxLat)
        var polygonPoints = polygon.map { CGPoint(x: CGFloat($0.0), y: CGFloat($0.1)) }
        polygonPoints = clip(
            polygonPoints,
            inside: { $0.x >= minLon },
            intersection: { start, end in
                let ratio = (minLon - start.x) / (end.x - start.x)
                return CGPoint(x: minLon, y: start.y + ratio * (end.y - start.y))
            }
        )
        polygonPoints = clip(
            polygonPoints,
            inside: { $0.x <= maxLon },
            intersection: { start, end in
                let ratio = (maxLon - start.x) / (end.x - start.x)
                return CGPoint(x: maxLon, y: start.y + ratio * (end.y - start.y))
            }
        )
        polygonPoints = clip(
            polygonPoints,
            inside: { $0.y >= minLat },
            intersection: { start, end in
                let ratio = (minLat - start.y) / (end.y - start.y)
                return CGPoint(x: start.x + ratio * (end.x - start.x), y: minLat)
            }
        )
        polygonPoints = clip(
            polygonPoints,
            inside: { $0.y <= maxLat },
            intersection: { start, end in
                let ratio = (maxLat - start.y) / (end.y - start.y)
                return CGPoint(x: start.x + ratio * (end.x - start.x), y: maxLat)
            }
        )
        return polygonPoints.map { (Double($0.x), Double($0.y)) }
    }

    private func clip(
        _ input: [CGPoint],
        inside: (CGPoint) -> Bool,
        intersection: (CGPoint, CGPoint) -> CGPoint
    ) -> [CGPoint] {
        guard var start = input.last else { return [] }
        var output: [CGPoint] = []
        for end in input {
            if inside(end) {
                if !inside(start) {
                    output.append(intersection(start, end))
                }
                output.append(end)
            } else if inside(start) {
                output.append(intersection(start, end))
            }
            start = end
        }
        return output
    }
}

private enum ClaritasWorldGeometry {
    static let land: [[(Double, Double)]] = [
        [
            (-168, 70), (-150, 67), (-140, 59), (-130, 54), (-124, 48), (-123, 37),
            (-116, 28), (-105, 22), (-96, 19), (-84, 9), (-77, 8), (-70, 18),
            (-64, 31), (-52, 48), (-58, 61), (-73, 72), (-100, 78), (-140, 74)
        ],
        [
            (-82, 10), (-72, 11), (-62, 5), (-50, -5), (-38, -24), (-51, -36),
            (-54, -55), (-69, -52), (-73, -48), (-78, -25), (-80, -12)
        ],
        [
            (-18, 36), (-9, 44), (5, 58), (20, 65), (30, 70), (58, 62),
            (88, 74), (120, 70), (145, 68), (178, 52), (160, 39), (154, 28),
            (136, 20), (118, 4), (105, 4), (101, 18), (90, 22), (72, 20),
            (54, 8), (42, 30), (28, 34), (18, 42), (10, 42)
        ],
        [
            (-18, 35), (0, 37), (10, 37), (24, 32), (34, 30), (51, 12),
            (45, -15), (40, -35), (25, -35), (18, -35), (8, -28), (0, -18),
            (-9, 5), (-12, 8)
        ],
        [(112, -12), (128, -10), (153, -10), (156, -27), (153, -38), (132, -45), (113, -32)],
        [(166, -35), (179, -38), (178, -43), (174, -48), (166, -44)]
    ]
}

private struct CountryBubblePoint: Identifiable {
    let id: String
    let iso: String
    let valueLabel: String
    let detail: String
    let magnitude: Double
    let rank: Int
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
        "BO": CLLocationCoordinate2D(latitude: -16.2902, longitude: -63.5887),
        "EC": CLLocationCoordinate2D(latitude: -1.8312, longitude: -78.1834),
        "VE": CLLocationCoordinate2D(latitude: 6.4238, longitude: -66.5897),
        "UY": CLLocationCoordinate2D(latitude: -32.5228, longitude: -55.7658),
        "PY": CLLocationCoordinate2D(latitude: -23.4425, longitude: -58.4438),
        "CR": CLLocationCoordinate2D(latitude: 9.7489, longitude: -83.7534),
        "PA": CLLocationCoordinate2D(latitude: 8.538, longitude: -80.7821),
        "GT": CLLocationCoordinate2D(latitude: 15.7835, longitude: -90.2308),
        "DO": CLLocationCoordinate2D(latitude: 18.7357, longitude: -70.1627),
        "CU": CLLocationCoordinate2D(latitude: 21.5218, longitude: -77.7812),
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
        "IS": CLLocationCoordinate2D(latitude: 64.9631, longitude: -19.0208),
        "EE": CLLocationCoordinate2D(latitude: 58.5953, longitude: 25.0136),
        "LV": CLLocationCoordinate2D(latitude: 56.8796, longitude: 24.6032),
        "LT": CLLocationCoordinate2D(latitude: 55.1694, longitude: 23.8813),
        "BG": CLLocationCoordinate2D(latitude: 42.7339, longitude: 25.4858),
        "HR": CLLocationCoordinate2D(latitude: 45.1, longitude: 15.2),
        "RS": CLLocationCoordinate2D(latitude: 44.0165, longitude: 21.0059),
        "SK": CLLocationCoordinate2D(latitude: 48.669, longitude: 19.699),
        "SI": CLLocationCoordinate2D(latitude: 46.1512, longitude: 14.9955),
        "RU": CLLocationCoordinate2D(latitude: 61.524, longitude: 105.3188),
        "EG": CLLocationCoordinate2D(latitude: 26.8206, longitude: 30.8025),
        "NG": CLLocationCoordinate2D(latitude: 9.082, longitude: 8.6753),
        "ZA": CLLocationCoordinate2D(latitude: -30.5595, longitude: 22.9375),
        "KE": CLLocationCoordinate2D(latitude: -0.0236, longitude: 37.9062),
        "DZ": CLLocationCoordinate2D(latitude: 28.0339, longitude: 1.6596),
        "MA": CLLocationCoordinate2D(latitude: 31.7917, longitude: -7.0926),
        "GH": CLLocationCoordinate2D(latitude: 7.9465, longitude: -1.0232),
        "ET": CLLocationCoordinate2D(latitude: 9.145, longitude: 40.4897),
        "TZ": CLLocationCoordinate2D(latitude: -6.369, longitude: 34.8888),
        "UG": CLLocationCoordinate2D(latitude: 1.3733, longitude: 32.2903),
        "AO": CLLocationCoordinate2D(latitude: -11.2027, longitude: 17.8739),
        "ZM": CLLocationCoordinate2D(latitude: -13.1339, longitude: 27.8493),
        "ZW": CLLocationCoordinate2D(latitude: -19.0154, longitude: 29.1549),
        "MZ": CLLocationCoordinate2D(latitude: -18.6657, longitude: 35.5296),
        "SD": CLLocationCoordinate2D(latitude: 12.8628, longitude: 30.2176),
        "SN": CLLocationCoordinate2D(latitude: 14.4974, longitude: -14.4524),
        "AE": CLLocationCoordinate2D(latitude: 23.4241, longitude: 53.8478),
        "SA": CLLocationCoordinate2D(latitude: 23.8859, longitude: 45.0792),
        "IL": CLLocationCoordinate2D(latitude: 31.0461, longitude: 34.8516),
        "IQ": CLLocationCoordinate2D(latitude: 33.2232, longitude: 43.6793),
        "JO": CLLocationCoordinate2D(latitude: 30.5852, longitude: 36.2384),
        "QA": CLLocationCoordinate2D(latitude: 25.3548, longitude: 51.1839),
        "KW": CLLocationCoordinate2D(latitude: 29.3117, longitude: 47.4818),
        "OM": CLLocationCoordinate2D(latitude: 21.4735, longitude: 55.9754),
        "IN": CLLocationCoordinate2D(latitude: 20.5937, longitude: 78.9629),
        "PK": CLLocationCoordinate2D(latitude: 30.3753, longitude: 69.3451),
        "BD": CLLocationCoordinate2D(latitude: 23.685, longitude: 90.3563),
        "LK": CLLocationCoordinate2D(latitude: 7.8731, longitude: 80.7718),
        "CN": CLLocationCoordinate2D(latitude: 35.8617, longitude: 104.1954),
        "JP": CLLocationCoordinate2D(latitude: 36.2048, longitude: 138.2529),
        "KR": CLLocationCoordinate2D(latitude: 35.9078, longitude: 127.7669),
        "VN": CLLocationCoordinate2D(latitude: 14.0583, longitude: 108.2772),
        "TH": CLLocationCoordinate2D(latitude: 15.87, longitude: 100.9925),
        "MM": CLLocationCoordinate2D(latitude: 21.9162, longitude: 95.956),
        "KH": CLLocationCoordinate2D(latitude: 12.5657, longitude: 104.991),
        "TW": CLLocationCoordinate2D(latitude: 23.6978, longitude: 120.9605),
        "HK": CLLocationCoordinate2D(latitude: 22.3193, longitude: 114.1694),
        "KZ": CLLocationCoordinate2D(latitude: 48.0196, longitude: 66.9237),
        "MY": CLLocationCoordinate2D(latitude: 4.2105, longitude: 101.9758),
        "SG": CLLocationCoordinate2D(latitude: 1.3521, longitude: 103.8198),
        "ID": CLLocationCoordinate2D(latitude: -0.7893, longitude: 113.9213),
        "PH": CLLocationCoordinate2D(latitude: 12.8797, longitude: 121.774),
        "AU": CLLocationCoordinate2D(latitude: -25.2744, longitude: 133.7751),
        "NZ": CLLocationCoordinate2D(latitude: -40.9006, longitude: 174.886),
        "PG": CLLocationCoordinate2D(latitude: -6.315, longitude: 143.9555),
        "FJ": CLLocationCoordinate2D(latitude: -17.7134, longitude: 178.065)
    ]

    static func coordinate(for iso2: String) -> CLLocationCoordinate2D? {
        values[iso2.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()]
    }
}
