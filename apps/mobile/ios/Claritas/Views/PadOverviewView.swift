import Foundation
import SwiftUI

struct PadOverviewView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @Binding var destination: RootView.Tab?

    private var marketAverage: Double {
        let moves = model.marketQuotes.compactMap(\.percent_change)
        guard !moves.isEmpty else { return 0 }
        return moves.reduce(0, +) / Double(moves.count)
    }

    private var activeMarkets: Int {
        model.marketStatus.filter { $0.is_open == true }.count
    }

    private var topMarkets: [MarketQuote] {
        model.marketQuotes
            .sorted { abs($0.percent_change ?? 0) > abs($1.percent_change ?? 0) }
            .prefix(7)
            .map { $0 }
    }

    private var topWeather: [CountryWeather] {
        model.weather
            .sorted { ($0.temp_c ?? -999) > ($1.temp_c ?? -999) }
            .prefix(6)
            .map { $0 }
    }

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    commandHeader
                    metrics

                    Grid(horizontalSpacing: 16, verticalSpacing: 16) {
                        GridRow {
                            briefingPanel
                                .gridCellColumns(2)
                            focusPanel
                        }
                        GridRow {
                            newsPanel
                                .gridCellColumns(2)
                            VStack(spacing: 16) {
                                marketPanel
                                weatherPanel
                            }
                        }
                    }
                }
                .padding(22)
            }
        }
    }

    private var commandHeader: some View {
        HStack(alignment: .center, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Text("STRATEGIC INTELLIGENCE")
                    .font(.caption2.weight(.semibold))
                    .tracking(3)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                Text("Global signal desk")
                    .font(.largeTitle.weight(.semibold))
                Text("A tablet command center for briefings, live intelligence, markets, and weather.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            HStack(spacing: 10) {
                Button {
                    destination = .news
                } label: {
                    Label("News", systemImage: "newspaper")
                }
                .buttonStyle(.bordered)

                Button {
                    destination = .dashboard
                } label: {
                    Label("Open globe", systemImage: "globe.europe.africa")
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .brandGlass(cornerRadius: 18, elevated: true)
    }

    private var metrics: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 12) {
            BrandMetricCard(title: "News signals", value: "\(model.news.count)", detail: "Recent intelligence items", tone: ClaritasPalette.dataBlue(for: colorScheme))
            BrandMetricCard(title: "Countries", value: "\(model.countryStats.count)", detail: "Countries with current coverage", tone: ClaritasPalette.positiveText(for: colorScheme))
            BrandMetricCard(title: "Market pulse", value: String(format: "%+.2f%%", marketAverage), detail: "\(activeMarkets) tracked markets open", tone: marketAverage >= 0 ? ClaritasPalette.positiveText(for: colorScheme) : ClaritasPalette.negativeText(for: colorScheme))
            BrandMetricCard(title: "Weather stations", value: "\(model.weather.count)", detail: "Latest country observations", tone: ClaritasPalette.shellAccent(for: colorScheme))
        }
    }

    private var briefingPanel: some View {
        BrandCard(title: "Daily briefing", icon: "sparkles") {
            if let briefing = model.dailyBriefing {
                VStack(alignment: .leading, spacing: 12) {
                    Text(briefing.title)
                        .font(.title2.weight(.semibold))
                    Text(briefing.update_text)
                        .font(.body)
                        .foregroundStyle(.secondary)
                    Divider()
                    ForEach(Array(briefing.key_takeaways.prefix(5).enumerated()), id: \.offset) { _, takeaway in
                        HStack(alignment: .top, spacing: 8) {
                            Circle()
                                .fill(ClaritasPalette.shellAccent(for: colorScheme))
                                .frame(width: 6, height: 6)
                                .padding(.top, 6)
                            Text(takeaway)
                                .font(.subheadline)
                        }
                    }
                    Text("Updated \(briefing.updatedDate?.formatted(date: .abbreviated, time: .shortened) ?? briefing.briefing_date)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "doc.text.magnifyingglass")
                        .font(.largeTitle)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    Text("No published briefing")
                        .font(.headline)
                    Text("Publish a daily briefing from the admin workspace.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 180)
            }
        }
    }

    private var focusPanel: some View {
        BrandCard(title: "Current focus", icon: "scope") {
            VStack(alignment: .leading, spacing: 12) {
                focusRow(label: "Country", value: model.selectedCountry?.uppercased() ?? "Global")
                focusRow(label: "Market symbol", value: model.selectedSymbol ?? "All symbols")
                Divider()
                Button {
                    destination = .dashboard
                } label: {
                    Label("Explore cross-signals", systemImage: "arrow.up.right")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                if model.selectedCountry != nil || model.selectedSymbol != nil {
                    Button("Clear focus") {
                        model.clearSelection()
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }

    private func focusRow(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline)
        }
    }

    private var newsPanel: some View {
        BrandCard(title: "Latest intelligence", icon: "newspaper") {
            VStack(spacing: 0) {
                ForEach(model.news.prefix(7)) { item in
                    Button {
                        if let country = item.country_iso2 {
                            model.selectedCountry = country.uppercased()
                        }
                        destination = .news
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(item.title ?? "Untitled")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                                    .lineLimit(2)
                                Text(item.source_name ?? "News")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(item.country_iso2?.uppercased() ?? "GL")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(ClaritasPalette.positiveText(for: colorScheme))
                        }
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(.plain)
                    Divider()
                }
            }
        }
    }

    private var marketPanel: some View {
        BrandCard(title: "Market movers", icon: "chart.line.uptrend.xyaxis") {
            VStack(spacing: 8) {
                ForEach(topMarkets) { quote in
                    Button {
                        model.selectedSymbol = quote.symbol
                        model.selectedCountry = quote.country?.uppercased()
                        destination = .markets
                    } label: {
                        HStack {
                            Text(quote.symbol)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(quote.percent_change.map { String(format: "%+.2f%%", $0) } ?? "—")
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle((quote.percent_change ?? 0) >= 0 ? ClaritasPalette.positiveText(for: colorScheme) : ClaritasPalette.negativeText(for: colorScheme))
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var weatherPanel: some View {
        BrandCard(title: "Weather extremes", icon: "cloud.sun") {
            VStack(spacing: 8) {
                ForEach(topWeather) { item in
                    Button {
                        model.selectedCountry = item.country.uppercased()
                        destination = .weather
                    } label: {
                        HStack {
                            Text(item.country.uppercased())
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(item.temp_c.map { String(format: "%.0f°C", $0) } ?? "—")
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}
