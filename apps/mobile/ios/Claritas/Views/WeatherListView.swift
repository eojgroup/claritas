import SwiftUI

struct WeatherListView: View {
    let items: [CountryWeather]
    @Binding var minTemp: String
    var isRefreshing: Bool
    var onRefresh: () -> Void
    var onSelectCountry: (String) -> Void
    var showsControls: Bool = true

    var body: some View {
        VStack(spacing: 12) {
            if showsControls {
                HStack(spacing: 8) {
                    Text("Min temp (°C)")
                        .font(.subheadline)
                    TextField("Any", text: $minTemp)
                        .keyboardType(.numbersAndPunctuation)
                        .frame(width: 80)
                        .textFieldStyle(.roundedBorder)
                    Spacer()
                    Button(isRefreshing ? "Refreshing…" : "Refresh", action: onRefresh)
                        .buttonStyle(.bordered)
                        .disabled(isRefreshing)
                }
            }

            if items.isEmpty {
                Text("No weather rows.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .brandGlass(cornerRadius: 12)
            } else {
                VStack(spacing: 0) {
                    ForEach(items) { w in
                        WeatherRow(item: w, onSelectCountry: onSelectCountry)
                        Divider().opacity(0.2)
                    }
                }
                .brandGlass(cornerRadius: 12)
            }
        }
    }
}

private struct WeatherRow: View {
    let item: CountryWeather
    var onSelectCountry: (String) -> Void
    @Environment(\.colorScheme) private var colorScheme
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let iconURL = weatherIconURL {
                AsyncImage(url: iconURL) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFit()
                    default:
                        RoundedRectangle(cornerRadius: 10)
                            .fill(ClaritasPalette.darkBlue.opacity(0.1))
                    }
                }
                .frame(width: 42, height: 42)
                .background(ClaritasPalette.shellSurface(for: colorScheme), in: RoundedRectangle(cornerRadius: 10))
            }

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Button(action: { onSelectCountry(item.country.uppercased()) }) {
                        Text(item.country.uppercased())
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(ClaritasPalette.shellSurface(for: colorScheme), in: Capsule())
                    }
                    .buttonStyle(.plain)

                    if let source = item.source_name, !source.isEmpty {
                        Text(source)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 4)
                            .background(ClaritasPalette.darkGreen.opacity(0.14), in: Capsule())
                            .foregroundStyle(ClaritasPalette.positiveText(for: colorScheme))
                    }

                    if let d = item.observedDate {
                        Text(DateFormatter.localizedString(from: d, dateStyle: .short, timeStyle: .short))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Text(item.weather_desc ?? item.weather_main ?? "Current weather")
                    .font(.subheadline.weight(.semibold))

                HStack(spacing: 14) {
                    Text("🌡️ \(item.temp_c.map { String(format: "%.0f", $0) } ?? "—")°C")
                        .font(.caption)
                    Text("💧 \(item.humidity.map { String(format: "%.0f", $0) } ?? "—")%")
                        .font(.caption)
                    if let wind = item.wind_speed {
                        Text("💨 \(String(format: "%.1f", wind)) m/s")
                            .font(.caption)
                    }
                }
                .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.vertical, 10)
    }

    private var weatherIconURL: URL? {
        guard let iconCode = item.icon_code, !iconCode.isEmpty else { return nil }
        return URL(string: "https://openweathermap.org/img/wn/\(iconCode)@2x.png")
    }
}
