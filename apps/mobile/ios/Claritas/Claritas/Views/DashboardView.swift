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

                            HStack(spacing: 8) {
                                Image(systemName: "magnifyingglass")
                                    .foregroundStyle(.secondary)
                                TextField("AI Search", text: $query)
                                Button("Search") {}
                                    .buttonStyle(.borderedProminent)
                            }
                            .padding(10)
                            .background(Color.white, in: RoundedRectangle(cornerRadius: 10))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(Color.black.opacity(0.12), lineWidth: 1)
                            )
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
}

private struct DashboardHeaderView: View {
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
                    .foregroundStyle(Color(red: 0.07, green: 0.14, blue: 0.2))
                Text("Global intelligence with trusted identity.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            HStack(spacing: 10) {
                Image(systemName: "gearshape")
                Image(systemName: "line.3.horizontal")
                Image(systemName: "person.crop.circle")
            }
            .foregroundStyle(Color(red: 0.05, green: 0.14, blue: 0.24))
            .font(.title3)
        }
        .padding(16)
        .background(Color.white.opacity(0.9), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.black.opacity(0.12)))
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
    @ViewBuilder var content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            content
        }
        .padding(16)
        .background(Color.white.opacity(0.96), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.black.opacity(0.12)))
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
