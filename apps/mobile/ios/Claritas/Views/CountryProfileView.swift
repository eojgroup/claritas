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

    private var marketQuotes: [MarketQuote] {
        guard let iso else { return [] }
        return model.marketQuotes
            .filter { ($0.country ?? "").uppercased() == iso }
            .sorted { abs($0.percent_change ?? 0) > abs($1.percent_change ?? 0) }
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

                    HStack(spacing: 10) {
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
                    }

                    Text("Sources: \(topSourceLabels)")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if let latestHeadline = countryNews.first?.title {
                        Text("Latest headline: \(latestHeadline)")
                            .font(.subheadline)
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
