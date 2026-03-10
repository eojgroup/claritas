import SwiftUI
import MapKit

struct DashboardView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var query: String = ""
    @State private var mapMode: ListMode = .news
    @State private var listMode: ListMode = .news
    @State private var section: DashboardSection = .overview
    @State private var selectedSymbol: String? = nil
    @State private var minTemp: String = ""
    @State private var marketEarningsWindowDays: Int = 14

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
                                if let selectedSymbol {
                                    Text("Symbol: \(selectedSymbol)")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if model.selectedCountry != nil || selectedSymbol != nil {
                                    Button("Clear focus") {
                                        model.selectedCountry = nil
                                        selectedSymbol = nil
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                        }
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
                                            model.selectedCountry = model.selectedCountry?.uppercased() == normalized ? nil : normalized
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
                                        selectedSymbol: selectedSymbol,
                                        isRefreshing: model.isRefreshingMarketQuotes,
                                        onRefresh: { Task { await model.refreshMarketQuotes(forceRefresh: true) } },
                                        onSelectSymbol: { symbol in
                                            selectedSymbol = symbol
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
                                        model.selectedCountry = model.selectedCountry?.uppercased() == normalized ? nil : normalized
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
                                selectedSymbol: selectedSymbol,
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
                                    selectedSymbol = symbol
                                    if let country = model.marketQuotes.first(where: { $0.symbol.uppercased() == symbol.uppercased() })?.country {
                                        model.selectedCountry = country.uppercased()
                                    }
                                }
                            )
                        }

                        DashboardCard {
                            MarketQuoteListView(
                                quotes: filteredMarketQuotes(),
                                selectedSymbol: selectedSymbol,
                                isRefreshing: model.isRefreshingMarketQuotes,
                                onRefresh: { Task { await model.refreshMarketQuotes(forceRefresh: true) } },
                                onSelectSymbol: { symbol in
                                    selectedSymbol = symbol
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
                                                selectedSymbol = quote.symbol
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
        .onChange(of: model.selectedCountry) { _ in
            Task { await model.reloadNewsForSelectedCountry() }
        }
        .task {
            while !Task.isCancelled {
                await model.refreshMarketQuotes(forceRefresh: true)
                try? await Task.sleep(nanoseconds: 20_000_000_000)
            }
        }
        .task {
            while !Task.isCancelled {
                await model.refreshMarketStatus(forceRefresh: true)
                try? await Task.sleep(nanoseconds: 60_000_000_000)
            }
        }
        .task {
            await model.refreshMarketEarnings(windowDays: marketEarningsWindowDays)
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
            rows = rows.filter { $0.country_iso2?.uppercased() == iso }
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
                quote.currency ?? ""
            ].joined(separator: " ").lowercased()
            return haystack.contains(term)
        }
    }

    private var selectedSymbolQuote: MarketQuote? {
        guard let selectedSymbol else { return nil }
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
        if let symbol = selectedSymbol?.uppercased(), !symbol.isEmpty {
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
        if change > 0 { return ClaritasPalette.positive }
        if change < 0 { return ClaritasPalette.negative }
        return ClaritasPalette.grey
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

private struct MarketQuoteListView: View {
    let quotes: [MarketQuote]
    let selectedSymbol: String?
    let isRefreshing: Bool
    let onRefresh: () -> Void
    let onSelectSymbol: (String) -> Void

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
                                        .foregroundStyle(ClaritasPalette.darkBlue)
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
                                        .background(ClaritasPalette.offWhite, in: Capsule())
                                        .overlay(
                                            Capsule().stroke(ClaritasPalette.beige, lineWidth: 1)
                                        )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(
                            (selectedSymbol?.uppercased() == quote.symbol.uppercased()
                                ? ClaritasPalette.darkGreen.opacity(0.12)
                                : ClaritasPalette.offWhite.opacity(0.82)),
                            in: RoundedRectangle(cornerRadius: 10)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(ClaritasPalette.beige, lineWidth: 1)
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
        if change > 0 { return ClaritasPalette.positive }
        if change < 0 { return ClaritasPalette.negative }
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
                    HStack {
                        Text(row.exchange)
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(statusLabel(row))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(statusColor(row))
                    }
                    .padding(10)
                    .background(ClaritasPalette.offWhite.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(ClaritasPalette.beige, lineWidth: 1)
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
        if row.is_open == true { return ClaritasPalette.positive }
        if row.is_open == false { return ClaritasPalette.negative }
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
                                    .foregroundStyle(ClaritasPalette.darkBlue)
                            }
                            .buttonStyle(.plain)
                            Spacer()
                            Text(row.date ?? "—")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Text("EPS \(value(row.eps_actual)) / \(value(row.eps_estimate)) · Rev \(value(row.revenue_actual)) / \(value(row.revenue_estimate))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(10)
                    .background(ClaritasPalette.offWhite.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(ClaritasPalette.beige, lineWidth: 1)
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
            marketCode: nil,
            marketName: nil,
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
        marketCode: profile["market_code"]?.string,
        marketName: profile["market_name"]?.string,
        industry: profile["industry"]?.string,
        marketCap: profile["market_cap"]?.number,
        ipo: profile["ipo"]?.string,
        webURL: webURL
    )
}

private struct DashboardHeaderView: View {
    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            ZStack {
                Circle()
                    .fill(ClaritasPalette.darkBlue)
                    .frame(width: 64, height: 64)
                    .offset(x: -8)
                Circle()
                    .fill(ClaritasPalette.darkGreen.opacity(0.75))
                    .frame(width: 64, height: 64)
                    .offset(x: 16)
                Text("CLARITAS")
                    .font(.system(size: 18, weight: .semibold, design: .serif))
                    .foregroundStyle(ClaritasPalette.offWhite)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Signal desk overview")
                    .font(.headline)
                    .foregroundStyle(ClaritasPalette.text)
                Text("Global intelligence with trusted identity.")
                    .font(.subheadline)
                    .foregroundStyle(ClaritasPalette.grey)
            }
            Spacer()
            HStack(spacing: 10) {
                Image(systemName: "gearshape")
                Image(systemName: "line.3.horizontal")
                Image(systemName: "person.crop.circle")
            }
            .foregroundStyle(ClaritasPalette.darkBlue)
            .font(.title3)
        }
        .padding(16)
        .background(Color.white.opacity(0.92), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(ClaritasPalette.beige, lineWidth: 1))
        .shadow(color: Color.black.opacity(0.06), radius: 12, x: 0, y: 6)
    }
}

private struct DashboardBackground<Content: View>: View {
    @ViewBuilder var content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    ClaritasPalette.offWhite,
                    ClaritasPalette.beige.opacity(0.85)
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
        .background(Color.white.opacity(0.94), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(ClaritasPalette.beige, lineWidth: 1))
        .shadow(color: Color.black.opacity(0.06), radius: 12, x: 0, y: 8)
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

private struct LegalPolicy: Identifiable {
    let id: String
    let title: String
    let intro: String
    let items: [String]
    let note: String
}

private let legalPolicies: [LegalPolicy] = [
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

private struct PolicyDetailView: View {
    let policy: LegalPolicy

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
        .background(Color(.systemGroupedBackground))
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
            return countryStats.compactMap { stat in
                let iso = stat.country.uppercased()
                guard let coordinate = CountryCentroidLookup.coordinate(for: iso) else { return nil }
                return CountryBubblePoint(
                    id: "news-\(iso)",
                    iso: iso,
                    coordinate: coordinate,
                    valueLabel: "\(stat.count)",
                    detail: "\(stat.count) news",
                    magnitude: max(Double(stat.count), 1)
                )
            }
            .sorted { $0.magnitude > $1.magnitude }

        case .weather:
            return weather.compactMap { row in
                let iso = row.country.uppercased()
                guard let coordinate = CountryCentroidLookup.coordinate(for: iso) else { return nil }
                let label = row.temp_c.map { String(format: "%.0f°", $0) } ?? "—"
                let detail = row.weather_main ?? "Weather"
                return CountryBubblePoint(
                    id: "weather-\(iso)",
                    iso: iso,
                    coordinate: coordinate,
                    valueLabel: label,
                    detail: detail,
                    magnitude: max(abs(row.temp_c ?? 0), 1)
                )
            }
            .sorted { $0.magnitude > $1.magnitude }
        case .market:
            var grouped: [String: [MarketQuote]] = [:]
            for quote in marketQuotes {
                guard let country = quote.country?.uppercased(), !country.isEmpty else { continue }
                grouped[country, default: []].append(quote)
            }
            return grouped.compactMap { (country, quotes) in
                guard let coordinate = CountryCentroidLookup.coordinate(for: country) else { return nil }
                let changes = quotes.compactMap { $0.percent_change }
                let avgChange = changes.isEmpty ? 0 : changes.reduce(0, +) / Double(changes.count)
                let marketCodes = quotes
                    .compactMap { marketQuoteMetadata($0).marketCode }
                    .filter { !$0.isEmpty }
                let primaryMarketCode = marketCodes.first ?? "INDEX"
                return CountryBubblePoint(
                    id: "market-\(country)",
                    iso: country,
                    valueLabel: "\(Int(abs(avgChange).rounded()))%",
                    detail: "\(primaryMarketCode) · \(String(format: "%+.2f%%", avgChange))",
                    magnitude: max(abs(avgChange), 1),
                    coordinate: coordinate
                )
            }
            .sorted { $0.magnitude > $1.magnitude }
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
