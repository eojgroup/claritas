import SwiftUI
import MapKit

struct DashboardView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var query: String = ""
    @State private var mapMode: ListMode = .news
    @State private var listMode: ListMode = .news
    @State private var minTemp: String = ""

    enum ListMode: String, CaseIterable { case news, weather }

    var body: some View {
        DashboardBackground {
            ScrollView {
                VStack(spacing: 18) {
                    DashboardHeaderView()

                    DashboardCard {
                        VStack(alignment: .leading, spacing: 12) {
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

                            ZStack {
                                InteractiveCountryBubbleMap(
                                    mode: mapMode,
                                    countryStats: model.countryStats,
                                    weather: model.weather,
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

                            if let selected = model.selectedCountry?.uppercased() {
                                HStack(spacing: 10) {
                                    Text("Selected country: \(selected)")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.secondary)
                                    Spacer()
                                    Button("Clear") {
                                        model.selectedCountry = nil
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }

                            HStack(spacing: 8) {
                                Image(systemName: "magnifyingglass")
                                    .foregroundStyle(.secondary)
                                TextField("Search news", text: $query)
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

                            if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                Text("Showing \(filteredNews().count) of \(model.news.count) news items")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
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
                                }
                                .pickerStyle(.segmented)
                                .frame(maxWidth: 220)
                            }

                            if listMode == .news {
                                NewsListView(items: filteredNews(), onSelectCountry: { iso in
                                    model.selectedCountry = iso
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
                        }
                    }

                    DashboardCard {
                        CountryProfileView(selectedCountry: model.selectedCountry)
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

    private var searchFieldBackground: Color {
        colorScheme == .dark
            ? Color(red: 0.07, green: 0.11, blue: 0.16)
            : Color.white
    }

    private var searchFieldStroke: Color {
        colorScheme == .dark
            ? Color.white.opacity(0.14)
            : Color.black.opacity(0.12)
    }
}

private struct DashboardHeaderView: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            ZStack {
                Circle()
                    .fill(Color(red: 0.05, green: 0.14, blue: 0.24))
                    .frame(width: 64, height: 64)
                    .offset(x: -8)
                Circle()
                    .fill(Color(red: 0.24, green: 0.32, blue: 0.4))
                    .frame(width: 64, height: 64)
                    .offset(x: 16)
                Text("CLARITAS")
                    .font(.system(size: 18, weight: .semibold, design: .serif))
                    .foregroundStyle(.white)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Signal desk overview")
                    .font(.headline)
                    .foregroundStyle(titleColor)
                Text("Global intelligence with trusted identity.")
                    .font(.subheadline)
                    .foregroundStyle(subtitleColor)
            }
            Spacer()
            HStack(spacing: 10) {
                Image(systemName: "gearshape")
                Image(systemName: "line.3.horizontal")
                Image(systemName: "person.crop.circle")
            }
            .foregroundStyle(iconColor)
            .font(.title3)
        }
        .padding(16)
        .background(cardBackground, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(cardStroke, lineWidth: 1))
    }

    private var cardBackground: Color {
        colorScheme == .dark
            ? Color(red: 0.08, green: 0.12, blue: 0.18).opacity(0.96)
            : Color.white.opacity(0.92)
    }

    private var cardStroke: Color {
        colorScheme == .dark
            ? Color.white.opacity(0.12)
            : Color.black.opacity(0.12)
    }

    private var titleColor: Color {
        colorScheme == .dark
            ? Color(red: 0.90, green: 0.94, blue: 0.97)
            : Color(red: 0.07, green: 0.14, blue: 0.2)
    }

    private var subtitleColor: Color {
        colorScheme == .dark
            ? Color(red: 0.70, green: 0.76, blue: 0.82)
            : Color.secondary
    }

    private var iconColor: Color {
        colorScheme == .dark
            ? Color(red: 0.72, green: 0.80, blue: 0.89)
            : Color(red: 0.05, green: 0.14, blue: 0.24)
    }
}

private struct DashboardBackground<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    @ViewBuilder var content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: colorScheme == .dark
                    ? [
                        Color(red: 0.06, green: 0.08, blue: 0.11),
                        Color(red: 0.03, green: 0.05, blue: 0.08)
                    ]
                    : [
                        Color(red: 0.89, green: 0.91, blue: 0.92),
                        Color(red: 0.93, green: 0.94, blue: 0.95)
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
    @Environment(\.colorScheme) private var colorScheme
    @ViewBuilder var content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            content
        }
        .padding(16)
        .background(cardBackground, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(cardStroke, lineWidth: 1))
        .shadow(color: Color.black.opacity(colorScheme == .dark ? 0.3 : 0.08), radius: 12, x: 0, y: 8)
    }

    private var cardBackground: Color {
        colorScheme == .dark
            ? Color(red: 0.08, green: 0.12, blue: 0.18).opacity(0.96)
            : Color.white.opacity(0.96)
    }

    private var cardStroke: Color {
        colorScheme == .dark
            ? Color.white.opacity(0.12)
            : Color.black.opacity(0.12)
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
                Text(mode == .news ? "No mapped news stats yet." : "No mapped weather stats yet.")
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
        let fillColor: Color = mode == .news
            ? (selected ? Color(red: 0.10, green: 0.58, blue: 0.50) : Color(red: 0.10, green: 0.45, blue: 0.69).opacity(0.9))
            : (selected ? Color(red: 0.92, green: 0.51, blue: 0.27) : Color(red: 0.78, green: 0.39, blue: 0.24).opacity(0.86))

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
    let coordinate: CLLocationCoordinate2D
    let valueLabel: String
    let detail: String
    let magnitude: Double
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
