import SwiftUI

struct CountryProfileView: View {
    @EnvironmentObject private var model: AppModel
    let selectedCountry: String?

    private var iso: String? {
        selectedCountry?.uppercased()
    }

    private var countryName: String {
        guard let iso else { return "No country selected" }
        return Locale(identifier: "en_US").localizedString(forRegionCode: iso) ?? iso
    }

    private var countryNews: [NewsItem] {
        guard let iso else { return [] }
        return model.news
            .filter { ($0.country_iso2 ?? "").uppercased() == iso }
            .sorted { ($0.event_time ?? "") > ($1.event_time ?? "") }
    }

    private var latestWeather: CountryWeather? {
        guard let iso else { return nil }
        return model.weather
            .filter { $0.country.uppercased() == iso }
            .sorted { $0.observed_at > $1.observed_at }
            .first
    }

    private var leadership: CountryLeadership? {
        guard let iso else { return nil }
        return model.leadership.first { $0.country.uppercased() == iso }
    }

    private var marketQuotes: [MarketQuote] {
        guard let iso else { return [] }
        return model.marketQuotes
            .filter { ($0.country ?? "").uppercased() == iso }
            .sorted { abs($0.percent_change ?? 0) > abs($1.percent_change ?? 0) }
    }

    private var transportCountry: TransportCountryAggregate? {
        guard let iso else { return nil }
        return model.transportOverview?.countries.first {
            $0.country.uppercased() == iso
        }
    }

    private var topSourceLabels: String {
        let labels = countryNews
            .compactMap { item -> String? in
                if let source = item.source_name?.trimmingCharacters(in: .whitespacesAndNewlines), !source.isEmpty {
                    return source
                }
                return nil
            }
            .prefix(3)
        return labels.isEmpty ? "No source labels yet" : labels.joined(separator: ", ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Country profile")
                .font(.headline)

            if let iso {
                VStack(alignment: .leading, spacing: 10) {
                    Text("\(countryName) (\(iso))")
                        .font(.title3.weight(.semibold))

                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 120), spacing: 10)],
                        spacing: 10
                    ) {
                        CountryMetric(label: "News", value: "\(countryNews.count)", detail: "Loaded stories")
                        CountryMetric(
                            label: "Weather",
                            value: latestWeather.map { "\(format($0.temp_c))°C" } ?? "—",
                            detail: latestWeather?.weather_main ?? "No recent snapshot"
                        )
                        CountryMetric(
                            label: "Top mover",
                            value: marketQuotes.first.map { $0.symbol } ?? "—",
                            detail: marketQuotes.first.map { signedPercent($0.percent_change) } ?? "No market quote"
                        )
                        CountryMetric(
                            label: "Transport",
                            value: "\(transportCountry?.active_count ?? 0)",
                            detail: "Active country links"
                        )
                    }

                    if let trend = transportCountry?.trend {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Transport movement · 24h")
                                .font(.headline)
                            LazyVGrid(
                                columns: [GridItem(.adaptive(minimum: 120), spacing: 10)],
                                spacing: 10
                            ) {
                                CountryMetric(
                                    label: "Departures",
                                    value: "\(trend.ship_departures.current)",
                                    detail: trendLabel(trend.ship_departures)
                                )
                                CountryMetric(
                                    label: "Cargo vessels",
                                    value: "\(trend.cargo_vessel_departures.current)",
                                    detail: trendLabel(trend.cargo_vessel_departures)
                                )
                                CountryMetric(
                                    label: "Flights",
                                    value: "\(trend.tracked_flights.current)",
                                    detail: trendLabel(trend.tracked_flights)
                                )
                            }
                            Text("Cargo-vessel departures are an AIS movement proxy, not measured cargo tonnage.")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Text("Sources: \(topSourceLabels)")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if let latestHeadline = countryNews.first?.title {
                        Text("Latest headline: \(latestHeadline)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    Divider()

                    if let leadership {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("Leadership")
                                    .font(.headline)
                                Spacer()
                                Text("Wikidata · \(leadership.source_license)")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }

                            if let governmentType = leadership.government_type {
                                Text(governmentType)
                                    .font(.subheadline.weight(.semibold))
                            }

                            ForEach(leadership.roles) { role in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(role.roleLabel.uppercased())
                                        .font(.caption2.weight(.semibold))
                                        .tracking(1.5)
                                        .foregroundStyle(.secondary)
                                    Text(role.person_name)
                                        .font(.subheadline)
                                    if let startedDate = role.startedDate {
                                        Text("In office since \(startedDate.formatted(date: .abbreviated, time: .omitted))")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }

                            Text(leadership.summary)
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            Text(
                                "Wikidata updated \(formatDate(leadership.sourceUpdatedDate)) · Claritas retrieved \(formatDate(leadership.retrievedDate))"
                            )
                            .font(.caption2)
                            .foregroundStyle(.secondary)

                            if let sourceURL = URL(string: leadership.source_url) {
                                Link("View Wikidata record", destination: sourceURL)
                                    .font(.caption.weight(.semibold))
                            }
                        }
                    } else {
                        Text("Leadership data has not been ingested for this country yet.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                Text("Select a country from the map, a news tag, or a market symbol to see a live country profile.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func format(_ value: Double?) -> String {
        guard let value else { return "—" }
        return value.formatted(.number.precision(.fractionLength(1)))
    }

    private func signedPercent(_ value: Double?) -> String {
        guard let value else { return "—" }
        let text = value.formatted(.number.precision(.fractionLength(2)))
        return value >= 0 ? "+\(text)%" : "\(text)%"
    }

    private func trendLabel(_ metric: TransportTrendMetric) -> String {
        if metric.direction == "new" { return "New baseline" }
        guard let change = metric.change_pct else { return "No comparison" }
        return "\(signedPercent(change)) vs prior 24h"
    }

    private func formatDate(_ date: Date?) -> String {
        date?.formatted(date: .abbreviated, time: .shortened) ?? "not provided"
    }
}

private struct CountryMetric: View {
    let label: String
    let value: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline)
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .brandGlass(cornerRadius: 12)
    }
}
