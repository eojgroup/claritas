import Foundation
import SwiftUI

struct PadOverviewView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @Binding var destination: RootView.Tab?

    private var marketAverage: Double {
        let moves = scopedCountryMarkets.compactMap(\.composite_change_percent)
        guard !moves.isEmpty else { return 0 }
        return moves.reduce(0, +) / Double(moves.count)
    }

    private var trackedMarkets: Int {
        scopedCountryMarkets.count
    }

    private var topMarkets: [CountryMarketOverview] {
        scopedCountryMarkets
            .sorted { abs($0.composite_change_percent ?? 0) > abs($1.composite_change_percent ?? 0) }
            .prefix(7)
            .map { $0 }
    }

    private var topWeather: [CountryWeather] {
        scopedWeather
            .sorted { ($0.temp_c ?? -999) > ($1.temp_c ?? -999) }
            .prefix(6)
            .map { $0 }
    }

    private var scopedCountryMarkets: [CountryMarketOverview] {
        guard let selected = model.selectedCountry?.uppercased() else {
            return model.countryMarkets
        }
        return model.countryMarkets.filter { $0.country.uppercased() == selected }
    }

    private var scopedWeather: [CountryWeather] {
        guard let selected = model.selectedCountry?.uppercased() else {
            return model.weather
        }
        return model.weather.filter { $0.country.uppercased() == selected }
    }

    private var focusedNews: [NewsItem] {
        guard let selected = model.selectedCountry?.uppercased() else {
            return model.news
        }
        return model.news.filter { ($0.country_iso2 ?? "").uppercased() == selected }
    }

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    commandHeader
                    workspaceStrip

                    SignalMapPanel(
                        height: 470,
                        allowsComparison: true,
                        showsCountryProfile: true
                    )

                    OverviewSatelliteContextView(destination: $destination)

                    metrics

                    HStack(alignment: .top, spacing: 16) {
                        newsPanel
                            .frame(maxWidth: .infinity, alignment: .top)
                        VStack(spacing: 16) {
                            focusPanel
                            marketPanel
                            weatherPanel
                        }
                        .frame(minWidth: 290, idealWidth: 320, maxWidth: 360)
                    }
                }
                .padding(22)
            }
        }
    }

    private var commandHeader: some View {
        HStack(alignment: .center, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Text("LIVE INTELLIGENCE WORKSPACE")
                    .font(.caption.weight(.semibold))
                    .tracking(1.4)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                Text("Geospatial signal desk")
                    .font(.largeTitle.weight(.semibold))
                Text("Cross-source relevance, evidence, and operational context in a touch-first review surface.")
                    .font(.subheadline)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            }
            Spacer()
            if model.selectedCountry != nil || model.selectedSymbol != nil {
                Button {
                    model.clearSelection()
                } label: {
                    Label("Reset focus", systemImage: "arrow.counterclockwise")
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
            }
        }
        .padding(20)
        .brandGlass(cornerRadius: ClaritasLayout.panelRadius, elevated: true)
    }

    private var workspaceStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                workspaceButton(.overview, label: "Signals")
                workspaceButton(.news, label: "News")
                workspaceButton(.podcasts, label: "Podcasts")
                workspaceButton(.weather, label: "Weather")
                workspaceButton(.markets, label: "Markets")
                workspaceButton(.transport, label: "Transport")
            }
            .padding(.horizontal, 2)
        }
        .padding(8)
        .background(ClaritasPalette.shellBackgroundElevated(for: colorScheme), in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
        )
    }

    private func workspaceButton(_ item: RootView.Tab, label: String) -> some View {
        Button {
            destination = item
        } label: {
            Label(label, systemImage: item.icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(
                    item == .overview
                        ? ClaritasPalette.shellInk(for: colorScheme)
                        : ClaritasPalette.shellMuted(for: colorScheme)
                )
                .padding(.horizontal, 14)
                .frame(minHeight: ClaritasLayout.minimumTouchTarget)
                .background(
                    item == .overview
                        ? ClaritasPalette.shellHighlight(for: colorScheme)
                        : Color.clear,
                    in: RoundedRectangle(cornerRadius: 9)
                )
        }
        .buttonStyle(.plain)
    }

    private var metrics: some View {
        HStack(alignment: .top, spacing: 0) {
            metricCell(
                title: "News signals",
                value: "\(focusedNews.count)",
                detail: model.selectedCountry == nil ? "Recent intelligence items" : "In current country focus",
                tone: ClaritasPalette.dataBlue(for: colorScheme)
            )
            Divider()
            metricCell(
                title: "Countries",
                value: "\(model.countryStats.count)",
                detail: "With current coverage",
                tone: ClaritasPalette.positiveText(for: colorScheme)
            )
            Divider()
            metricCell(
                title: "Market pulse",
                value: String(format: "%+.2f%%", marketAverage),
                detail: "\(trackedMarkets) benchmark/ECB country regimes",
                tone: marketAverage >= 0
                    ? ClaritasPalette.positiveText(for: colorScheme)
                    : ClaritasPalette.negativeText(for: colorScheme)
            )
            Divider()
            metricCell(
                title: "Weather",
                value: "\(scopedWeather.count)",
                detail: model.selectedCountry == nil ? "Latest observations" : "In current country focus",
                tone: ClaritasPalette.shellAccent(for: colorScheme)
            )
        }
        .padding(.vertical, 14)
        .brandGlass(cornerRadius: ClaritasLayout.panelRadius, elevated: true)
    }

    private func metricCell(title: String, value: String, detail: String, tone: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(1.2)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            Text(value)
                .font(.title2.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(tone)
            Text(detail)
                .font(.caption)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
    }

    private var focusPanel: some View {
        BrandCard(title: "Current focus", icon: "scope") {
            VStack(alignment: .leading, spacing: 12) {
                focusRow(label: "Country", value: model.selectedCountry?.uppercased() ?? "Global")
                focusRow(label: "Market symbol", value: model.selectedSymbol ?? "All symbols")
                Divider()
                Button {
                    destination = .news
                } label: {
                    Label("Open related news", systemImage: "arrow.up.right")
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
                ForEach(focusedNews.prefix(7)) { item in
                    Button {
                        if let country = item.country_iso2 {
                            model.selectedCountry = country.uppercased()
                        }
                        destination = .news
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(item.presentationTitle)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                                    .lineLimit(2)
                                Text(item.source_name ?? "News")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                if let disclosure = item.translationDisclosure {
                                    Text(disclosure)
                                        .font(.caption2.weight(.semibold))
                                        .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                                }
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
                if focusedNews.isEmpty {
                    Text("No recent intelligence matches the current country focus.")
                        .font(.subheadline)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        .padding(.vertical, 18)
                }
            }
        }
    }

    private var marketPanel: some View {
        BrandCard(title: "Market movers", icon: "chart.line.uptrend.xyaxis") {
            VStack(spacing: 8) {
                ForEach(topMarkets) { market in
                    Button {
                        model.selectedCountry = market.country.uppercased()
                        destination = .markets
                    } label: {
                        HStack {
                            Text(market.country)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(market.composite_change_percent.map { String(format: "%+.2f%%", $0) } ?? "—")
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle((market.composite_change_percent ?? 0) >= 0 ? ClaritasPalette.positiveText(for: colorScheme) : ClaritasPalette.negativeText(for: colorScheme))
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

struct OverviewSatelliteContextView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @Binding var destination: RootView.Tab?
    @State private var selectedEvent: IntelligenceEvent?
    @State private var observation: EarthObservation?
    @State private var gibsContext: GibsEventContext?
    @State private var isLoading = false
    @State private var error: String?
    @State private var retryID = 0

    private var gibsLayer: GibsEventLayer? {
        gibsContext?.layers.first { $0.category == "true_color" } ?? gibsContext?.layers.first
    }

    var body: some View {
        BrandCard(title: "Satellite context", icon: "sensor.tag.radiowaves.forward") {
            if isLoading && selectedEvent == nil {
                ProgressView("Finding recent imagery")
                    .frame(maxWidth: .infinity, minHeight: 210)
            } else if let selectedEvent {
                VStack(alignment: .leading, spacing: 12) {
                    ZStack(alignment: .topLeading) {
                        if let asset = observation?.assets.first {
                            AuthenticatedEarthImage(path: asset.url)
                        } else if let layer = gibsLayer {
                            AuthenticatedRemoteImage(url: layer.preview_url, unavailableLabel: "Satellite context unavailable")
                        } else {
                            satellitePlaceholder
                        }
                        HStack(spacing: 6) {
                            Text(observation == nil ? "BROWSE CONTEXT · NOT PROOF" : "PROCESSED OBSERVATION")
                                .font(.caption2.weight(.bold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 5)
                                .background(.black.opacity(0.68), in: Capsule())
                                .foregroundStyle(.white)
                            Spacer()
                        }
                        .padding(12)
                    }
                    .frame(height: 270)
                    .background(.secondary.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 14))

                    HStack(alignment: .top, spacing: 14) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(selectedEvent.title)
                                .font(.headline)
                                .lineLimit(2)
                            Text(selectedEvent.location_name ?? selectedEvent.primary_country_iso2 ?? "Global")
                                .font(.caption)
                                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                            Text(observation?.attribution ?? gibsLayer?.provenance.attribution ?? "Satellite context")
                                .font(.caption2)
                                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        }
                        Spacer()
                        Button {
                            model.selectedIntelligenceEventID = selectedEvent.id
                            destination = .intelligence
                        } label: {
                            Label("Open evidence", systemImage: "arrow.up.right")
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    Text(gibsContext?.notice ?? "A processed observation is linked to this exact event and location. Open the evidence thread for provenance and interpretation.")
                        .font(.caption)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                }
            } else {
                VStack(spacing: 10) {
                    satellitePlaceholder.frame(height: 150)
                    Text(error ?? "No satellite context is available for the current focus yet.")
                        .font(.subheadline)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        .multilineTextAlignment(.center)
                    Button("Retry imagery") { retryID += 1 }
                        .buttonStyle(.bordered)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .task(id: "\(model.selectedCountry ?? "global")-\(retryID)") { await load() }
    }

    private var satellitePlaceholder: some View {
        VStack(spacing: 10) {
            Image(systemName: "globe.americas.fill")
                .font(.system(size: 36))
                .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
            Text("Satellite context is still being prepared")
                .font(.caption.weight(.semibold))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ClaritasPalette.shellBackgroundElevated(for: colorScheme))
    }

    @MainActor
    private func load() async {
        isLoading = true
        error = nil
        selectedEvent = nil
        observation = nil
        gibsContext = nil
        defer { isLoading = false }

        do {
            let events = try await model.api.fetchIntelligenceEvents(limit: 10, country: model.selectedCountry)
                .sorted {
                    if $0.earth_observation_available != $1.earth_observation_available {
                        return $0.earth_observation_available
                    }
                    if $0.relevance_score != $1.relevance_score { return $0.relevance_score > $1.relevance_score }
                    return $0.last_activity_time > $1.last_activity_time
                }

            for event in events.prefix(8) {
                var eventObservation: EarthObservation?
                if event.earth_observation_available,
                   let detail = try? await model.api.fetchIntelligenceEvent(id: event.id) {
                    eventObservation = detail.earth_observations.first { !$0.assets.isEmpty }
                }
                let eventGibs = try? await model.api.fetchEventGibsContext(id: event.id)
                if eventObservation != nil || !(eventGibs?.layers.isEmpty ?? true) {
                    selectedEvent = event
                    observation = eventObservation
                    gibsContext = eventGibs
                    return
                }
            }
            error = "No recent event has image-ready geography yet. The feed will update as new scenes are found."
        } catch {
            self.error = error.localizedDescription
        }
    }
}
