import Foundation
import SwiftUI

struct WatchRootView: View {
    @EnvironmentObject private var model: WatchAppModel

    var body: some View {
        Group {
            if !model.hasSession {
                WatchPairingView()
            } else {
                TabView {
                    WatchSignalGlanceView()
                    WatchBriefingView()
                    WatchPulseView()
                }
                .tabViewStyle(.verticalPage)
            }
        }
        .tint(WatchPalette.orange)
        .task {
            await model.bootstrap()
        }
    }
}

private struct WatchSignalGlanceView: View {
    @EnvironmentObject private var model: WatchAppModel
    @State private var layer: WatchMapLayer = .signals
    @State private var region: WatchMapRegion = .global
    @State private var selectedCountry: String?

    private var points: [WatchMapPoint] {
        WatchMapData.points(
            layer: layer,
            region: region,
            news: model.news,
            podcasts: model.podcasts,
            weather: model.weather,
            markets: model.markets,
            leadership: model.leadership
        )
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        WatchSectionLabel(title: "Geospatial pulse", icon: "globe.europe.africa.fill")
                        Spacer()
                        WatchRefreshStatus()
                    }

                    HStack(spacing: 6) {
                        NavigationLink {
                            WatchMapLayerSelection(
                                selection: $layer,
                                onSelect: { selectedCountry = nil }
                            )
                        } label: {
                            Label(layer.label, systemImage: "square.3.layers.3d")
                                .font(.caption2.weight(.semibold))
                        }

                        NavigationLink {
                            WatchMapRegionSelection(
                                selection: $region,
                                onSelect: { selectedCountry = nil }
                            )
                        } label: {
                            Label(region.label, systemImage: "scope")
                                .font(.caption2.weight(.semibold))
                        }
                    }
                    .buttonStyle(.bordered)

                    WatchSignalMap(
                        points: points,
                        region: region,
                        selectedCountry: $selectedCountry
                    )
                    .frame(height: 118)

                    if let selected = points.first(where: { $0.iso == selectedCountry }) ?? points.first {
                        WatchCard {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(selectedCountry == nil ? "HIGHEST RELEVANCE" : "SELECTED")
                                        .font(.system(size: 8, weight: .bold))
                                        .tracking(1)
                                        .foregroundStyle(WatchPalette.orange)
                                    Spacer()
                                    Text("#\(selected.rank)")
                                        .font(.caption2.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                                HStack(alignment: .firstTextBaseline) {
                                    Text(selected.iso)
                                        .font(.headline)
                                    Spacer()
                                    Text(selected.valueLabel)
                                        .font(.headline.monospacedDigit())
                                        .foregroundStyle(WatchPalette.orange)
                                }
                                Text(selected.detail)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                    }

                    WatchCard {
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text("\(points.count) mapped")
                                Spacer()
                                Text("\(model.criticalSignalCount) thresholds")
                            }
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                            Text("News 40% · podcast 25% · weather 15% · markets 15%")
                                .font(.system(size: 8))
                                .foregroundStyle(.secondary)
                        }
                    }

                    HStack {
                        Button {
                            model.openOnPhone(
                                "dashboard",
                                country: selectedCountry ?? points.first?.iso
                            )
                        } label: {
                            Label("iPhone", systemImage: "iphone")
                        }

                        Button {
                            Task { await model.refresh() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .accessibilityLabel("Refresh signals")

                        Button {
                            selectedCountry = nil
                            region = .global
                        } label: {
                            Image(systemName: "arrow.counterclockwise")
                        }
                        .accessibilityLabel("Reset map")
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.horizontal, 3)
            }
            .navigationTitle("Claritas")
            .containerBackground(WatchPalette.navy.gradient, for: .navigation)
        }
    }
}

private struct WatchMapLayerSelection: View {
    @Binding var selection: WatchMapLayer
    let onSelect: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            ForEach(WatchMapLayer.allCases) { item in
                Button {
                    selection = item
                    onSelect()
                    dismiss()
                } label: {
                    HStack {
                        Text(item.label)
                        Spacer()
                        if selection == item {
                            Image(systemName: "checkmark")
                                .foregroundStyle(WatchPalette.orange)
                        }
                    }
                }
            }
        }
        .navigationTitle("Layer")
    }
}

private struct WatchMapRegionSelection: View {
    @Binding var selection: WatchMapRegion
    let onSelect: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            ForEach(WatchMapRegion.allCases) { item in
                Button {
                    selection = item
                    onSelect()
                    dismiss()
                } label: {
                    HStack {
                        Text(item.label)
                        Spacer()
                        if selection == item {
                            Image(systemName: "checkmark")
                                .foregroundStyle(WatchPalette.orange)
                        }
                    }
                }
            }
        }
        .navigationTitle("Region")
    }
}

private enum WatchMapLayer: String, CaseIterable, Identifiable {
    case signals
    case news
    case weather
    case leadership

    var id: String { rawValue }
    var label: String {
        switch self {
        case .signals: return "Signals"
        case .news: return "News"
        case .weather: return "Weather"
        case .leadership: return "Leaders"
        }
    }
}

private enum WatchMapRegion: String, CaseIterable, Identifiable {
    case global
    case americas
    case europe
    case africa
    case asia
    case apac
    case oceania

    var id: String { rawValue }
    var label: String {
        switch self {
        case .global: return "Global"
        case .americas: return "Americas"
        case .europe: return "Europe"
        case .africa: return "Africa"
        case .asia: return "Asia"
        case .apac: return "APAC"
        case .oceania: return "Oceania"
        }
    }

    var bounds: (minLon: Double, maxLon: Double, minLat: Double, maxLat: Double) {
        switch self {
        case .global: return (-180, 180, -60, 82)
        case .americas: return (-170, -30, -58, 75)
        case .europe: return (-25, 50, 32, 72)
        case .africa: return (-22, 58, -38, 40)
        case .asia: return (35, 180, -12, 80)
        case .apac: return (65, 180, -52, 60)
        case .oceania: return (105, 180, -52, 8)
        }
    }

    func contains(longitude: Double, latitude: Double) -> Bool {
        let b = bounds
        return longitude >= b.minLon && longitude <= b.maxLon &&
            latitude >= b.minLat && latitude <= b.maxLat
    }
}

private struct WatchMapPoint: Identifiable {
    let iso: String
    let valueLabel: String
    let detail: String
    let magnitude: Double
    let longitude: Double
    let latitude: Double
    let rank: Int
    var id: String { iso }
}

private enum WatchMapData {
    static func points(
        layer: WatchMapLayer,
        region: WatchMapRegion,
        news: [NewsItem],
        podcasts: [PodcastEpisode],
        weather: [CountryWeather],
        markets: [MarketQuote],
        leadership: [CountryLeadership]
    ) -> [WatchMapPoint] {
        var values: [(iso: String, label: String, detail: String, magnitude: Double)] = []
        let newsCounts = Dictionary(grouping: news.compactMap { item in
            item.country_iso2?.uppercased()
        }, by: { $0 }).mapValues(\.count)

        switch layer {
        case .news:
            values = newsCounts.map { iso, count in
                (iso, "\(count)", "\(count) mapped \(count == 1 ? "story" : "stories")", Double(count))
            }
        case .weather:
            values = weather.map { row in
                let severity = max(abs((row.temp_c ?? 20) - 20), 1)
                return (
                    row.country.uppercased(),
                    row.temp_c.map { String(format: "%.0f°", $0) } ?? "—",
                    row.weather_main ?? "Current conditions",
                    severity
                )
            }
        case .leadership:
            values = leadership.map { row in
                (
                    row.country.uppercased(),
                    "\(max(row.roles.count, 1))",
                    row.roles.first?.person_name ?? "Leadership record",
                    Double(max(row.roles.count, 1))
                )
            }
        case .signals:
            var weatherByCountry: [String: CountryWeather] = [:]
            for row in weather {
                let iso = row.country.uppercased()
                if let current = weatherByCountry[iso],
                   (current.observedDate ?? .distantPast) >= (row.observedDate ?? .distantPast) {
                    continue
                }
                weatherByCountry[iso] = row
            }
            var marketByCountry: [String: MarketQuote] = [:]
            for quote in markets {
                guard let iso = quote.country?.uppercased() else { continue }
                let current = marketByCountry[iso]
                if current == nil ||
                    abs(quote.percent_change ?? quote.change ?? 0) >
                    abs(current?.percent_change ?? current?.change ?? 0) {
                    marketByCountry[iso] = quote
                }
            }
            var podcastCounts: [String: Int] = [:]
            for episode in podcasts {
                for signal in episode.signals {
                    for iso in signal.countries where iso.count == 2 {
                        podcastCounts[iso.uppercased(), default: 0] += 1
                    }
                }
            }
            let countries = Set(newsCounts.keys)
                .union(weatherByCountry.keys)
                .union(marketByCountry.keys)
                .union(podcastCounts.keys)
            let maxNews = Double(max(newsCounts.values.max() ?? 1, 1))
            let maxMarket = max(
                marketByCountry.values.map { abs($0.percent_change ?? $0.change ?? 0) }.max() ?? 1,
                1
            )

            values = countries.map { iso in
                let count = newsCounts[iso] ?? 0
                let newsScore = count > 0 ? log1p(Double(count)) / log1p(maxNews) : 0
                let weatherRow = weatherByCountry[iso]
                let weatherScore = weatherRow?.temp_c.map {
                    min(1, max(0, (abs($0 - 20) - 8) / 24))
                } ?? 0
                let market = marketByCountry[iso]
                let marketScore = market == nil
                    ? 0
                    : abs(market?.percent_change ?? market?.change ?? 0) / maxMarket
                let podcastCount = podcastCounts[iso] ?? 0
                let podcastScore = min(1, Double(podcastCount) / 4)
                let domainCount = [count > 0, weatherScore > 0, market != nil, podcastCount > 0]
                    .filter { $0 }.count
                let relevance = min(
                    100,
                    round(
                        newsScore * 40 +
                        podcastScore * 25 +
                        weatherScore * 15 +
                        marketScore * 15 +
                        Double(max(0, domainCount - 1) * 2)
                    )
                )
                return (
                    iso,
                    "\(Int(relevance))/100",
                    "\(domainCount) linked \(domainCount == 1 ? "domain" : "domains")",
                    relevance
                )
            }
        }

        return values.compactMap { item -> WatchMapPoint? in
            guard item.magnitude > 0,
                  let coordinate = WatchCountryCentroids.values[item.iso],
                  region.contains(longitude: coordinate.longitude, latitude: coordinate.latitude) else {
                return nil
            }
            return WatchMapPoint(
                iso: item.iso,
                valueLabel: item.label,
                detail: item.detail,
                magnitude: item.magnitude,
                longitude: coordinate.longitude,
                latitude: coordinate.latitude,
                rank: 0
            )
        }
        .sorted { $0.magnitude > $1.magnitude }
        .enumerated()
        .map { index, item in
            WatchMapPoint(
                iso: item.iso,
                valueLabel: item.valueLabel,
                detail: item.detail,
                magnitude: item.magnitude,
                longitude: item.longitude,
                latitude: item.latitude,
                rank: index + 1
            )
        }
    }
}

private struct WatchSignalMap: View {
    let points: [WatchMapPoint]
    let region: WatchMapRegion
    @Binding var selectedCountry: String?

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.black.opacity(0.34))

                Canvas { context, size in
                    for polygon in WatchWorldGeometry.land {
                        let visiblePolygon = clipped(polygon)
                        guard visiblePolygon.count >= 3 else { continue }
                        var path = Path()
                        for (index, coordinate) in visiblePolygon.enumerated() {
                            let point = project(
                                longitude: coordinate.0,
                                latitude: coordinate.1,
                                size: size
                            )
                            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
                        }
                        path.closeSubpath()
                        context.fill(path, with: .color(WatchPalette.sage.opacity(0.42)))
                        context.stroke(path, with: .color(WatchPalette.sage.opacity(0.7)), lineWidth: 0.45)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 10))

                ForEach(points.prefix(12)) { point in
                    Button {
                        selectedCountry = selectedCountry == point.iso ? nil : point.iso
                    } label: {
                        let selected = selectedCountry == point.iso
                        ZStack {
                            Circle()
                                .fill(WatchPalette.orange.opacity(0.28))
                                .frame(width: bubbleSize(point) + 6, height: bubbleSize(point) + 6)
                            Circle()
                                .fill(WatchPalette.orange)
                                .overlay(
                                    Circle().stroke(Color.white, lineWidth: selected ? 2 : 0.8)
                                )
                                .frame(width: bubbleSize(point), height: bubbleSize(point))
                        }
                        .frame(width: 28, height: 28)
                        .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .position(
                        project(
                            longitude: point.longitude,
                            latitude: point.latitude,
                            size: proxy.size
                        )
                    )
                    .accessibilityLabel("\(point.iso), rank \(point.rank), \(point.detail)")
                }
            }
        }
    }

    private func project(longitude: Double, latitude: Double, size: CGSize) -> CGPoint {
        let bounds = region.bounds
        let x = (longitude - bounds.minLon) / (bounds.maxLon - bounds.minLon)
        let y = (bounds.maxLat - latitude) / (bounds.maxLat - bounds.minLat)
        return CGPoint(
            x: max(4, min(size.width - 4, x * size.width)),
            y: max(4, min(size.height - 4, y * size.height))
        )
    }

    private func bubbleSize(_ point: WatchMapPoint) -> CGFloat {
        let maximum = max(points.map(\.magnitude).max() ?? 1, 1)
        return 7 + CGFloat(sqrt(point.magnitude / maximum) * 8)
    }

    private func clipped(_ polygon: [(Double, Double)]) -> [(Double, Double)] {
        let bounds = region.bounds
        let minLon = CGFloat(bounds.minLon)
        let maxLon = CGFloat(bounds.maxLon)
        let minLat = CGFloat(bounds.minLat)
        let maxLat = CGFloat(bounds.maxLat)
        var points = polygon.map { CGPoint(x: CGFloat($0.0), y: CGFloat($0.1)) }
        points = clip(
            points,
            inside: { $0.x >= minLon },
            intersection: { start, end in
                let ratio = (minLon - start.x) / (end.x - start.x)
                return CGPoint(x: minLon, y: start.y + ratio * (end.y - start.y))
            }
        )
        points = clip(
            points,
            inside: { $0.x <= maxLon },
            intersection: { start, end in
                let ratio = (maxLon - start.x) / (end.x - start.x)
                return CGPoint(x: maxLon, y: start.y + ratio * (end.y - start.y))
            }
        )
        points = clip(
            points,
            inside: { $0.y >= minLat },
            intersection: { start, end in
                let ratio = (minLat - start.y) / (end.y - start.y)
                return CGPoint(x: start.x + ratio * (end.x - start.x), y: minLat)
            }
        )
        points = clip(
            points,
            inside: { $0.y <= maxLat },
            intersection: { start, end in
                let ratio = (maxLat - start.y) / (end.y - start.y)
                return CGPoint(x: start.x + ratio * (end.x - start.x), y: maxLat)
            }
        )
        return points.map { (Double($0.x), Double($0.y)) }
    }

    private func clip(
        _ input: [CGPoint],
        inside: (CGPoint) -> Bool,
        intersection: (CGPoint, CGPoint) -> CGPoint
    ) -> [CGPoint] {
        guard var start = input.last else { return [] }
        var output: [CGPoint] = []
        for end in input {
            if inside(end) {
                if !inside(start) { output.append(intersection(start, end)) }
                output.append(end)
            } else if inside(start) {
                output.append(intersection(start, end))
            }
            start = end
        }
        return output
    }
}

private enum WatchWorldGeometry {
    static let land: [[(Double, Double)]] = [
        [(-168, 70), (-145, 62), (-130, 52), (-124, 35), (-105, 22), (-82, 8), (-70, 18), (-52, 48), (-62, 68), (-100, 78), (-140, 74)],
        [(-82, 10), (-68, 8), (-50, -5), (-38, -24), (-54, -55), (-73, -48), (-80, -12)],
        [(-18, 36), (5, 58), (30, 70), (58, 62), (88, 74), (145, 68), (178, 52), (154, 28), (118, 4), (101, 18), (72, 20), (54, 8), (42, 30), (24, 34), (10, 42)],
        [(-18, 35), (10, 37), (34, 30), (51, 12), (40, -35), (18, -35), (0, -18), (-12, 8)],
        [(112, -12), (153, -10), (156, -38), (132, -45), (113, -32)],
        [(166, -35), (179, -38), (174, -48), (166, -44)]
    ]
}

private enum WatchCountryCentroids {
    struct Coordinate {
        let latitude: Double
        let longitude: Double
    }

    static let values: [String: Coordinate] = [
        "US": .init(latitude: 37.1, longitude: -95.7), "CA": .init(latitude: 56.1, longitude: -106.3),
        "MX": .init(latitude: 23.6, longitude: -102.5), "BR": .init(latitude: -14.2, longitude: -51.9),
        "AR": .init(latitude: -38.4, longitude: -63.6), "CL": .init(latitude: -35.7, longitude: -71.5),
        "CO": .init(latitude: 4.6, longitude: -74.3), "PE": .init(latitude: -9.2, longitude: -75.0),
        "GB": .init(latitude: 55.4, longitude: -3.4), "FR": .init(latitude: 46.2, longitude: 2.2),
        "DE": .init(latitude: 51.2, longitude: 10.5), "ES": .init(latitude: 40.5, longitude: -3.7),
        "IT": .init(latitude: 41.9, longitude: 12.6), "SE": .init(latitude: 60.1, longitude: 18.6),
        "NO": .init(latitude: 60.5, longitude: 8.5), "PL": .init(latitude: 51.9, longitude: 19.1),
        "UA": .init(latitude: 48.4, longitude: 31.2), "TR": .init(latitude: 39.0, longitude: 35.2),
        "RU": .init(latitude: 61.5, longitude: 105.3), "EG": .init(latitude: 26.8, longitude: 30.8),
        "NG": .init(latitude: 9.1, longitude: 8.7), "ZA": .init(latitude: -30.6, longitude: 22.9),
        "KE": .init(latitude: 0.0, longitude: 37.9), "AE": .init(latitude: 23.4, longitude: 53.8),
        "SA": .init(latitude: 23.9, longitude: 45.1), "IL": .init(latitude: 31.0, longitude: 34.9),
        "IN": .init(latitude: 20.6, longitude: 79.0), "PK": .init(latitude: 30.4, longitude: 69.3),
        "CN": .init(latitude: 35.9, longitude: 104.2), "JP": .init(latitude: 36.2, longitude: 138.3),
        "KR": .init(latitude: 35.9, longitude: 127.8), "VN": .init(latitude: 14.1, longitude: 108.3),
        "TH": .init(latitude: 15.9, longitude: 101.0), "MY": .init(latitude: 4.2, longitude: 102.0),
        "SG": .init(latitude: 1.4, longitude: 103.8), "ID": .init(latitude: -0.8, longitude: 113.9),
        "PH": .init(latitude: 12.9, longitude: 121.8), "AU": .init(latitude: -25.3, longitude: 133.8),
        "NZ": .init(latitude: -40.9, longitude: 174.9)
    ]
}

private struct WatchPairingView: View {
    @EnvironmentObject private var model: WatchAppModel

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                Image(systemName: "globe.europe.africa.fill")
                    .font(.system(size: 34))
                    .foregroundStyle(WatchPalette.orange)
                Text("Claritas")
                    .font(.headline)
                Text("Open Claritas on your paired iPhone and sign in to connect this watch.")
                    .font(.caption)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                Button {
                    model.requestPhoneSync()
                } label: {
                    Label("Connect", systemImage: "iphone.and.arrow.forward")
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(.horizontal, 8)
        }
    }
}

private struct WatchBriefingView: View {
    @EnvironmentObject private var model: WatchAppModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        WatchSectionLabel(title: "Daily brief", icon: "sparkles")
                        Spacer()
                        WatchRefreshStatus()
                    }

                    if let briefing = model.briefing {
                        WatchCard {
                            VStack(alignment: .leading, spacing: 5) {
                                HStack {
                                    Text(briefing.status.uppercased())
                                        .font(.system(size: 8, weight: .bold))
                                        .tracking(1)
                                        .foregroundStyle(WatchPalette.orange)
                                    Spacer()
                                    Text(briefing.updatedDate?.formatted(date: .omitted, time: .shortened) ?? briefing.briefing_date)
                                        .font(.system(size: 8))
                                        .foregroundStyle(.secondary)
                                }
                                Text(briefing.title)
                                    .font(.headline)
                                    .foregroundStyle(WatchPalette.cream)
                                    .lineLimit(2)
                                Text(briefing.update_text)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(4)
                            }
                        }

                        ForEach(Array(briefing.key_takeaways.prefix(2).enumerated()), id: \.offset) { _, takeaway in
                            HStack(alignment: .top, spacing: 6) {
                                Circle()
                                    .fill(WatchPalette.orange)
                                    .frame(width: 5, height: 5)
                                    .padding(.top, 5)
                                Text(takeaway)
                                    .font(.caption2)
                            }
                        }
                    }

                    if model.briefing == nil {
                        WatchCard {
                            Text("No published briefing yet.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    WatchCard {
                        HStack {
                            metric(value: "\(model.news.count)", label: "News")
                            Divider()
                            metric(value: "\(model.weather.count)", label: "Weather")
                            Divider()
                            metric(
                                value: String(format: "%+.1f%%", model.marketDirection),
                                label: "Markets"
                            )
                        }
                    }

                    Button {
                        model.openOnPhone("briefing")
                    } label: {
                        Label("Open on iPhone", systemImage: "iphone")
                    }
                }
                .padding(.horizontal, 3)
            }
            .navigationTitle("Briefing")
            .containerBackground(WatchPalette.navy.gradient, for: .navigation)
        }
    }

    private var scheduleCard: some View {
        WatchCard {
            VStack(alignment: .leading, spacing: 8) {
                WatchSectionLabel(title: "Schedule", icon: "clock")
                Text(scheduleSummary)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(WatchPalette.cream)
                Text(lastRunSummary)
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                NavigationLink {
                    WatchBriefingScheduleContent()
                } label: {
                    Label("Edit schedule", systemImage: "clock.badge.checkmark")
                        .font(.caption.weight(.semibold))
                }
            }
        }
    }

    private var scheduleSummary: String {
        guard let schedule = model.briefingSchedule else { return "Schedule not loaded" }
        guard schedule.enabled else { return "Paused" }
        return "\(schedule.scheduled_time) \(schedule.timezone)"
    }

    private var lastRunSummary: String {
        guard let schedule = model.briefingSchedule else { return "Refresh to load schedule" }
        return schedule.last_triggered_at.map { "Last run \($0)" } ?? "Not run yet"
    }

    private var isRefreshing: Bool {
        if case .refreshing = model.connectionState { return true }
        return false
    }

    private func metric(value: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.caption.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label)
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct WatchPulseView: View {
    @EnvironmentObject private var model: WatchAppModel

    private var topMover: MarketQuote? {
        model.markets.max {
            abs($0.percent_change ?? 0) < abs($1.percent_change ?? 0)
        }
    }

    private var priorityWeather: CountryWeather? {
        (model.weatherAlerts.isEmpty ? model.weather : model.weatherAlerts)
            .max { weatherSeverity($0) < weatherSeverity($1) }
    }

    private func weatherSeverity(_ row: CountryWeather) -> Double {
        let temperature = row.temp_c.map { abs($0 - 20) } ?? 0
        let humidity = max(0, (row.humidity ?? 0) - 70) / 2
        let wind = max(0, (row.wind_speed ?? 0) - 8)
        return temperature + humidity + wind
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        WatchSectionLabel(title: "Urgent pulse", icon: "waveform.path.ecg")
                        Spacer()
                        WatchRefreshStatus()
                    }

                    WatchCard {
                        HStack {
                            Text("\(model.criticalSignalCount)")
                                .font(.title2.weight(.bold))
                                .monospacedDigit()
                                .foregroundStyle(
                                    model.criticalSignalCount > 0
                                        ? WatchPalette.negative
                                        : WatchPalette.sage
                                )
                            VStack(alignment: .leading, spacing: 1) {
                                Text("threshold signals")
                                    .font(.caption.weight(.semibold))
                                Text("Weather + markets")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    if let headline = model.news.first {
                        pulseCard(
                            label: "Headline",
                            icon: "newspaper",
                            title: headline.title ?? "Untitled",
                            detail: [
                                headline.country_iso2?.uppercased(),
                                headline.source_name
                            ].compactMap { $0 }.joined(separator: " · "),
                            tone: WatchPalette.orange
                        )
                    }

                    if let weather = priorityWeather {
                        pulseCard(
                            label: "Weather",
                            icon: "cloud.sun",
                            title: "\(weather.country.uppercased()) · \(weather.temp_c.map { String(format: "%.0f°", $0) } ?? "—")",
                            detail: weather.weather_desc ?? weather.weather_main ?? "Current conditions",
                            tone: WatchPalette.sage
                        )
                    }

                    if let mover = topMover {
                        pulseCard(
                            label: "Market",
                            icon: "chart.line.uptrend.xyaxis",
                            title: "\(mover.symbol) · \(mover.percent_change.map { String(format: "%+.1f%%", $0) } ?? "—")",
                            detail: mover.company_name ?? mover.exchange ?? "Tracked instrument",
                            tone: (mover.percent_change ?? 0) >= 0
                                ? WatchPalette.sage
                                : WatchPalette.negative
                        )
                    }

                    Button {
                        model.openOnPhone("dashboard")
                    } label: {
                        Label("Continue on iPhone", systemImage: "iphone")
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.horizontal, 3)
            }
            .navigationTitle("Pulse")
            .containerBackground(WatchPalette.navy.gradient, for: .navigation)
        }
    }

    private func pulseCard(
        label: String,
        icon: String,
        title: String,
        detail: String,
        tone: Color
    ) -> some View {
        WatchCard {
            VStack(alignment: .leading, spacing: 4) {
                Label(label.uppercased(), systemImage: icon)
                    .font(.system(size: 8, weight: .bold))
                    .tracking(0.8)
                    .foregroundStyle(tone)
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(WatchPalette.cream)
                    .lineLimit(2)
                if !detail.isEmpty {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }
}

private struct WatchBriefingScheduleView: View {
    var body: some View {
        NavigationStack {
            WatchBriefingScheduleContent()
        }
    }
}

private struct WatchBriefingScheduleContent: View {
    @EnvironmentObject private var model: WatchAppModel
    @State private var enabled = true
    @State private var scheduledTime = WatchBriefingScheduleContent.dateFromScheduleTime("07:00")
    @State private var timezone = TimeZone.current.identifier

    var body: some View {
        List {
            Section {
                Toggle("Enabled", isOn: $enabled)

                DatePicker(
                    "Time",
                    selection: $scheduledTime,
                    displayedComponents: .hourAndMinute
                )

                Picker("Timezone", selection: $timezone) {
                    ForEach(DailyBriefingScheduleOptions.timezoneOptions(including: timezone), id: \.self) { timezone in
                        Text(timezone).tag(timezone)
                    }
                }

                if let schedule = model.briefingSchedule {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Current")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text("\(schedule.scheduled_time) \(schedule.timezone)")
                            .font(.caption.weight(.semibold))
                        Text(schedule.last_triggered_at.map { "Last run \($0)" } ?? "Not run yet")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                if let error = model.briefingScheduleError {
                    Text(error)
                        .font(.caption2)
                        .foregroundStyle(WatchPalette.negative)
                }

                Button {
                    save()
                } label: {
                    Label(
                        model.isSavingBriefingSchedule ? "Saving" : "Save",
                        systemImage: "clock.badge.checkmark"
                    )
                }
                .disabled(model.isSavingBriefingSchedule)
            } header: {
                WatchSectionLabel(title: "Briefing time", icon: "clock")
            }
        }
        .navigationTitle("Schedule")
        .containerBackground(WatchPalette.navy.gradient, for: .navigation)
        .task {
            apply(model.briefingSchedule)
        }
        .onChange(of: model.briefingSchedule?.updated_at) {
            apply(model.briefingSchedule)
        }
    }

    private func apply(_ schedule: DailyBriefingSchedule?) {
        guard let schedule else { return }
        enabled = schedule.enabled
        scheduledTime = Self.dateFromScheduleTime(schedule.scheduled_time)
        timezone = schedule.timezone.isEmpty ? TimeZone.current.identifier : schedule.timezone
    }

    private func save() {
        let cleanTimezone = timezone.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTimezone.isEmpty else { return }
        Task {
            await model.updateDailyBriefingSchedule(
                enabled: enabled,
                scheduledTime: Self.scheduleTimeString(from: scheduledTime),
                timezone: cleanTimezone
            )
        }
    }

    private static func dateFromScheduleTime(_ value: String) -> Date {
        let parts = value.split(separator: ":")
        let hour = parts.first.flatMap { Int($0) } ?? 7
        let minute = parts.dropFirst().first.flatMap { Int($0) } ?? 0
        var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        components.hour = max(0, min(hour, 23))
        components.minute = max(0, min(minute, 59))
        components.second = 0
        return Calendar.current.date(from: components) ?? Date()
    }

    private static func scheduleTimeString(from date: Date) -> String {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", components.hour ?? 7, components.minute ?? 0)
    }
}

private struct WatchNewsView: View {
    @EnvironmentObject private var model: WatchAppModel

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(model.news.prefix(6)) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title ?? "Untitled")
                                .font(.caption.weight(.semibold))
                                .lineLimit(3)
                            HStack {
                                Text(item.source_name ?? "News")
                                Spacer()
                                if let country = item.country_iso2 {
                                    Text(country.uppercased())
                                }
                            }
                            .font(.caption2)
                            .foregroundStyle(WatchPalette.sage)
                        }
                    }
                } header: {
                    WatchSectionLabel(title: "Headline alerts", icon: "newspaper")
                }
            }
            .navigationTitle("News")
            .containerBackground(WatchPalette.navy.gradient, for: .navigation)
        }
    }
}

private struct WatchPodcastsView: View {
    @EnvironmentObject private var model: WatchAppModel
    private var podcastSummary: PodcastIntelligenceSummary {
        PodcastIntelligenceSummary.make(from: model.podcasts)
    }

    var body: some View {
        NavigationStack {
            List {
                if !model.podcasts.isEmpty {
                    Section {
                        VStack(alignment: .leading, spacing: 7) {
                            Text(podcastSummary.conclusions)
                                .font(.caption2)
                                .foregroundStyle(WatchPalette.cream)
                                .lineLimit(7)
                            HStack {
                                Label("\(podcastSummary.signals)", systemImage: "waveform")
                                Spacer()
                                Label("\(podcastSummary.elevatedRisks)", systemImage: "exclamationmark.triangle")
                            }
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(
                                podcastSummary.elevatedRisks > 0
                                    ? WatchPalette.negative
                                    : WatchPalette.sage
                            )
                        }
                    } header: {
                        WatchSectionLabel(title: "Conclusions", icon: "lightbulb.max")
                    }
                }

                Section {
                    if model.podcasts.isEmpty {
                        Text("No podcast intelligence")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(model.podcasts.prefix(8)) { episode in
                        NavigationLink {
                            WatchPodcastDetailView(episode: episode)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(episode.title)
                                    .font(.caption.weight(.semibold))
                                    .lineLimit(3)
                                HStack {
                                    Text(episode.feed_title)
                                        .lineLimit(1)
                                    Spacer()
                                    Text("\(episode.signals.count)")
                                }
                                .font(.caption2)
                                .foregroundStyle(WatchPalette.sage)
                            }
                        }
                    }
                } header: {
                    WatchSectionLabel(title: "Episode evidence", icon: "mic.fill")
                }
            }
            .navigationTitle("Podcasts")
            .containerBackground(WatchPalette.navy.gradient, for: .navigation)
        }
    }
}

private struct WatchPodcastDetailView: View {
    let episode: PodcastEpisode

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(episode.feed_title)
                    .font(.caption2)
                    .foregroundStyle(WatchPalette.sage)
                Text(episode.title)
                    .font(.headline)
                    .foregroundStyle(WatchPalette.cream)

                if let summary = episode.summary {
                    Text(summary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(6)
                }

                ForEach(episode.signals.prefix(3)) { signal in
                    WatchCard {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(signal.type.uppercased())
                                .font(.system(size: 8, weight: .semibold))
                                .foregroundStyle(signal.type == "risk" ? WatchPalette.negative : WatchPalette.orange)
                            Text(signal.title)
                                .font(.caption.weight(.semibold))
                            if let summary = signal.summary {
                                Text(summary)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(4)
                            }
                        }
                    }
                }

                ForEach(episode.evidence.prefix(2)) { evidence in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(
                            [evidence.timestampLabel, evidence.speaker]
                                .compactMap { $0 }
                                .joined(separator: " · ")
                        )
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(WatchPalette.sage)
                        Text(evidence.text)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(5)
                    }
                }

                ForEach(episode.external_links.prefix(2)) { link in
                    if let url = link.resolvedURL {
                        Link(destination: url) {
                            Label(link.label, systemImage: "arrow.up.right")
                                .font(.caption.weight(.semibold))
                        }
                    }
                }
            }
            .padding(.horizontal, 3)
        }
        .navigationTitle("Evidence")
        .containerBackground(WatchPalette.navy.gradient, for: .navigation)
    }
}

private struct WatchMarketsView: View {
    @EnvironmentObject private var model: WatchAppModel

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(
                        model.markets
                            .sorted { abs($0.percent_change ?? 0) > abs($1.percent_change ?? 0) }
                            .prefix(6)
                    ) { quote in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(quote.symbol)
                                    .font(.caption.weight(.bold))
                                Text(quote.company_name ?? quote.exchange ?? "Market")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(quote.price.map { String(format: "%.2f", $0) } ?? "—")
                                    .font(.caption.monospacedDigit())
                                Text(quote.percent_change.map { String(format: "%+.2f%%", $0) } ?? "—")
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(changeColor(quote.percent_change))
                            }
                        }
                    }
                } header: {
                    WatchSectionLabel(title: "Movers & breaches", icon: "chart.line.uptrend.xyaxis")
                }
            }
            .navigationTitle("Markets")
            .containerBackground(WatchPalette.navy.gradient, for: .navigation)
        }
    }

    private func changeColor(_ change: Double?) -> Color {
        guard let change else { return .secondary }
        return change >= 0 ? WatchPalette.sage : WatchPalette.negative
    }
}

private struct WatchWeatherView: View {
    @EnvironmentObject private var model: WatchAppModel

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach((model.weatherAlerts.isEmpty ? model.weather : model.weatherAlerts).prefix(6)) { item in
                        HStack(spacing: 8) {
                            Image(systemName: weatherIcon(item.weather_main))
                                .foregroundStyle(WatchPalette.orange)
                                .frame(width: 18)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.country.uppercased())
                                    .font(.caption.weight(.bold))
                                Text(item.weather_desc ?? item.weather_main ?? "Current")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            Text(item.temp_c.map { String(format: "%.0f°", $0) } ?? "—")
                                .font(.headline.monospacedDigit())
                        }
                    }
                } header: {
                    WatchSectionLabel(title: "Affected scope", icon: "cloud.sun")
                }
            }
            .navigationTitle("Weather")
            .containerBackground(WatchPalette.navy.gradient, for: .navigation)
        }
    }

    private func weatherIcon(_ condition: String?) -> String {
        switch condition?.lowercased() {
        case let value? where value.contains("rain"): return "cloud.rain.fill"
        case let value? where value.contains("snow"): return "cloud.snow.fill"
        case let value? where value.contains("cloud"): return "cloud.fill"
        case let value? where value.contains("storm"): return "cloud.bolt.rain.fill"
        default: return "sun.max.fill"
        }
    }
}

private struct WatchLeadershipView: View {
    @EnvironmentObject private var model: WatchAppModel

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(model.leadership.prefix(20)) { country in
                        NavigationLink {
                            List {
                                if let governmentType = country.government_type {
                                    Text(governmentType)
                                        .font(.caption)
                                }
                                ForEach(country.roles) { role in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(role.roleLabel)
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                        Text(role.person_name)
                                            .font(.caption.weight(.semibold))
                                    }
                                }
                                Text("Wikidata updated \(freshness(country.sourceUpdatedDate))")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                Text("Retrieved \(freshness(country.retrievedDate))")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            .navigationTitle(country.country)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(country.country_name)
                                    .font(.caption.weight(.bold))
                                    .lineLimit(1)
                                Text(country.roles.map(\.person_name).joined(separator: ", "))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                    }
                } header: {
                    WatchSectionLabel(title: "Leadership", icon: "person.2")
                }
            }
            .navigationTitle("Leaders")
            .containerBackground(WatchPalette.navy.gradient, for: .navigation)
        }
    }

    private func freshness(_ date: Date?) -> String {
        date?.formatted(date: .abbreviated, time: .omitted) ?? "not provided"
    }
}
