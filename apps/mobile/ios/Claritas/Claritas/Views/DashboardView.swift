import SwiftUI
import MapKit

struct DashboardView: View {
    @EnvironmentObject private var model: AppModel
    @State private var query: String = ""
    @State private var mapMode: ListMode = .news
    @State private var listMode: ListMode = .news
    @State private var minTemp: String = ""

    enum ListMode: String, CaseIterable { case news, weather }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Map card
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Map: \(mapMode == .news ? "#News per country" : "Weather per country")")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Picker("Mode", selection: $mapMode) {
                            Text("News").tag(ListMode.news)
                            Text("Weather").tag(ListMode.weather)
                        }
                        .pickerStyle(.segmented)
                        .frame(maxWidth: 220)
                        .onChange(of: mapMode) { newValue in
                            listMode = newValue
                        }
                    }
                    .padding(.horizontal)

                    ZStack {
                        CountryMapPlaceholder()
                            .frame(height: 220)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
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

                    // AI Search bar (placeholder)
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(.secondary)
                        TextField("AI Search", text: $query)
                        Button("Search") {}
                            .buttonStyle(.borderedProminent)
                    }
                    .padding(10)
                    .background(.thickMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal)
                }

                // Lists and Country profile
                VStack(spacing: 12) {
                    HStack {
                        Text("List")
                            .font(.headline)
                        Spacer()
                        Picker("List Mode", selection: $listMode) {
                            Text("News").tag(ListMode.news)
                            Text("Weather").tag(ListMode.weather)
                        }
                        .pickerStyle(.segmented)
                        .frame(maxWidth: 220)
                    }
                    .padding(.horizontal)

                    if listMode == .news {
                        NewsListView(items: model.news, onSelectCountry: { iso in
                            model.selectedCountry = iso
                            Task { await model.reloadNewsForSelectedCountry() }
                        })
                    } else {
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

                    CountryProfileView(selectedCountry: model.selectedCountry)
                        .padding(.horizontal)
                }

                // Right column equivalents are placed in a separate tab (Analytics)
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
        .onChange(of: model.selectedCountry) { _ in
            Task { await model.reloadNewsForSelectedCountry() }
        }
    }

    private func filteredWeather() -> [CountryWeather] {
        let minVal: Double? = Double(minTemp)
        var list = model.weather
        if let minVal { list = list.filter { ($0.temp_c ?? -999) >= minVal } }
        if let iso = model.selectedCountry?.uppercased() { list = list.filter { $0.country.uppercased() == iso } }
        return list
    }
}

private struct CountryMapPlaceholder: View {
    @State private var region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 10, longitude: 20),
        span: MKCoordinateSpan(latitudeDelta: 110, longitudeDelta: 240)
    )
    var body: some View {
        ZStack {
            Map(coordinateRegion: $region)
                .allowsHitTesting(false)
            Text("Interactive country bubbles map coming soon")
                .font(.footnote)
                .padding(8)
                .background(.ultraThinMaterial, in: Capsule())
                .padding()
        }
    }
}
