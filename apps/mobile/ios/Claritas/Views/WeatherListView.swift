import SwiftUI

struct WeatherListView: View {
    let items: [CountryWeather]
    @Binding var minTemp: String
    var isRefreshing: Bool
    var onRefresh: () -> Void
    var onSelectCountry: (String) -> Void

    var body: some View {
        VStack(spacing: 12) {
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

            if items.isEmpty {
                Text("No weather rows.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(ClaritasPalette.offWhite.opacity(0.9), in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(ClaritasPalette.beige, lineWidth: 1))
            } else {
                VStack(spacing: 0) {
                    ForEach(items) { w in
                        WeatherRow(item: w, onSelectCountry: onSelectCountry)
                        Divider().opacity(0.2)
                    }
                }
                .background(Color.white.opacity(0.94), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(ClaritasPalette.beige, lineWidth: 1))
            }
        }
    }
}

private struct WeatherRow: View {
    let item: CountryWeather
    var onSelectCountry: (String) -> Void
    var body: some View {
        HStack {
            HStack(spacing: 8) {
                Button(action: { onSelectCountry(item.country.uppercased()) }) {
                    Text(item.country.uppercased())
                        .font(.caption)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(ClaritasPalette.offWhite, in: Capsule())
                }
                .buttonStyle(.plain)
                if let d = item.observedDate {
                    Text(DateFormatter.localizedString(from: d, dateStyle: .short, timeStyle: .short))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            HStack(spacing: 16) {
                Text("🌡️ \(item.temp_c.map { String(format: "%.0f", $0) } ?? "—")°C")
                    .font(.subheadline)
                Text("💧 \(item.humidity.map { String(format: "%.0f", $0) } ?? "—")%")
                    .font(.subheadline)
                if let w = item.weather_main { Text(w).foregroundStyle(.secondary) }
            }
        }
        .padding(.vertical, 10)
    }
}
