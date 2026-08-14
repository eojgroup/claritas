import Charts
import Foundation
import MapKit
import SwiftUI
import UIKit

struct TransportWorkspaceView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var detailedOverview: TransportOverview?
    @State private var mode: TransportMode?
    @State private var selectedEntity: TransportEntity?
    @State private var selectedTrack: [TransportTrackPoint] = []
    @State private var isLoadingDetails = false
    @State private var isLoadingEntity = false
    @State private var detailError: String?
    @State private var detailRequestID = UUID()
    @State private var selectionRequestID = UUID()

    private var isPad: Bool {
        UIDevice.current.userInterfaceIdiom == .pad
    }

    private var overview: TransportOverview? {
        isPad ? detailedOverview ?? model.transportOverview : model.transportOverview
    }

    var body: some View {
        BrandBackground {
            ScrollView {
                if isPad {
                    detailedWorkspace
                } else {
                    aggregateWorkspace
                }
            }
            .refreshable {
                if isPad {
                    await loadDetails(forceRefresh: true)
                } else {
                    await model.refreshTransport(forceRefresh: true)
                }
            }
        }
        .task(id: "\(isPad)-\(model.transportFocusCountry ?? "")-\(mode?.rawValue ?? "all")") {
            if isPad {
                await loadDetails(forceRefresh: false)
            }
        }
    }

    private var detailedWorkspace: some View {
        VStack(alignment: .leading, spacing: 18) {
            BrandSectionHeader(
                kicker: "Movement intelligence",
                title: "Shipping & flight routes",
                detail: "Live tracks, flight numbers, transport corridors, and country relationships."
            )

            IntelligenceEventPulseView()

            if let detailError {
                BrandCard(title: "Transport data unavailable", icon: "exclamationmark.triangle") {
                    Text(detailError)
                        .font(.subheadline)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                }
            }

            controls
            metricStrip
            takeawayStrip

            HStack(alignment: .top, spacing: 16) {
                BrandCard(
                    title: "\(model.transportFocusCountry ?? "Country") movement map",
                    icon: "map.fill"
                ) {
                    TransportCanvasMap(
                        entities: filteredEntities,
                        selectedID: selectedEntity?.id,
                        track: selectedTrack,
                        onSelect: { entity in
                            Task { await select(entity) }
                        }
                    )
                    .frame(minHeight: 440)
                }
                .frame(maxWidth: .infinity)

                entityDetail
                    .frame(width: 310)
            }

            HStack(alignment: .top, spacing: 16) {
                activityChart
                    .frame(maxWidth: .infinity)
                countryChart
                    .frame(maxWidth: .infinity)
            }

            HStack(alignment: .top, spacing: 16) {
                routeDiagram
                    .frame(maxWidth: .infinity)
                linkedCountryList
                    .frame(maxWidth: .infinity)
            }

            portMovements
            entityList
            provenance
        }
        .padding(22)
    }

    private var aggregateWorkspace: some View {
        VStack(alignment: .leading, spacing: 16) {
            BrandSectionHeader(
                kicker: "Transport pulse",
                title: "Live movement · \(model.transportFocusCountry ?? "country scope")",
                detail: "Current aircraft, vessels, routes, and country relationships in the country scope selected from the overview map."
            )

            IntelligenceEventPulseView()

            Picker("Movement layer", selection: $mode) {
                Text("Combined").tag(Optional<TransportMode>.none)
                Text("Flights").tag(Optional<TransportMode>.some(.aviation))
                Text("Shipping").tag(Optional<TransportMode>.some(.maritime))
            }
            .pickerStyle(.segmented)
            .onChange(of: mode) { _ in clearSelection() }

            BrandCard(
                title: "\(model.transportFocusCountry ?? "Scoped") live positions",
                icon: "map.fill"
            ) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label("\(filteredEntities.count) visible", systemImage: "location.north.line")
                        Spacer()
                        if let generated = overview?.generatedDate {
                            Text("Updated \(generated.formatted(date: .abbreviated, time: .standard))")
                        } else {
                            Text("Update time unavailable")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))

                    TransportNativeMap(
                        entities: filteredEntities,
                        selectedID: selectedEntity?.id,
                        scopeCountry: model.transportFocusCountry,
                        onSelect: { entity in Task { await select(entity) } }
                    )
                    .frame(height: 310)

                    if let selectedEntity {
                        HStack(spacing: 10) {
                            Image(systemName: selectedEntity.mode == .aviation ? "airplane" : "ferry.fill")
                                .foregroundStyle(selectedEntity.mode == .aviation
                                    ? ClaritasPalette.dataBlue(for: colorScheme)
                                    : ClaritasPalette.shellAccent(for: colorScheme))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(selectedEntity.display_name ?? selectedEntity.callsign ?? selectedEntity.entity_id)
                                    .font(.subheadline.weight(.semibold))
                                Text("\(selectedEntity.route_label ?? selectedEntity.current_location_name ?? "Route unresolved") · seen \(selectedEntity.observedDate?.formatted(date: .abbreviated, time: .standard) ?? selectedEntity.observed_at)")
                                    .font(.caption2)
                                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                    .lineLimit(2)
                            }
                            Spacer()
                        }
                        .padding(10)
                        .background(
                            ClaritasPalette.shellBackgroundElevated(for: colorScheme),
                            in: RoundedRectangle(cornerRadius: 10)
                        )
                    }

                    Text("Tap a marker for its latest identity and route. Counts reflect available AIS and ADS-B reception, not complete national traffic.")
                        .font(.caption2)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                }
            }

            if let error = model.transportLoadError {
                BrandCard(title: "Transport data unavailable", icon: "exclamationmark.triangle") {
                    Text(error)
                        .font(.subheadline)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                }
            }

            metricGrid
            takeawayStrip

            BrandCard(title: "Leading countries", icon: "globe.americas.fill") {
                VStack(spacing: 0) {
                    ForEach((overview?.countries ?? []).prefix(10)) { country in
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(country.country_name)
                                    .font(.subheadline.weight(.semibold))
                                Text(country.country)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            aggregatePill(
                                icon: "airplane",
                                value: country.aviation.active,
                                tone: ClaritasPalette.dataBlue(for: colorScheme)
                            )
                            aggregatePill(
                                icon: "ferry.fill",
                                value: country.maritime.active,
                                tone: ClaritasPalette.shellAccent(for: colorScheme)
                            )
                        }
                        .padding(.vertical, 10)
                        Divider()
                    }
                    if overview?.countries.isEmpty != false {
                        Text("Country aggregates will appear as the feeds establish coverage.")
                            .font(.subheadline)
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                            .padding(.vertical, 18)
                    }
                }
            }

            BrandCard(title: "Leading corridors", icon: "point.topleft.down.to.point.bottomright.curvepath") {
                VStack(spacing: 10) {
                    ForEach((overview?.routes ?? []).prefix(8)) { route in
                        HStack(spacing: 10) {
                            Image(systemName: route.mode == .aviation ? "airplane" : "ferry.fill")
                                .foregroundStyle(
                                    route.mode == .aviation
                                        ? ClaritasPalette.dataBlue(for: colorScheme)
                                        : ClaritasPalette.shellAccent(for: colorScheme)
                                )
                            Text(route.origin_country)
                                .font(.subheadline.weight(.bold))
                            Image(systemName: "arrow.right")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(route.destination_country)
                                .font(.subheadline.weight(.bold))
                            Spacer()
                            Text("\(route.active_count)")
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            provenance
        }
        .padding(16)
    }

    private var controls: some View {
        HStack(spacing: 10) {
            Picker("Mode", selection: $mode) {
                Text("Combined").tag(Optional<TransportMode>.none)
                Text("Flights").tag(Optional<TransportMode>.some(.aviation))
                Text("Shipping").tag(Optional<TransportMode>.some(.maritime))
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 420)
            .onChange(of: mode) { _ in
                clearSelection()
            }

            Spacer()

            if isLoadingDetails {
                ProgressView()
                    .controlSize(.small)
            }
            Button {
                Task { await loadDetails(forceRefresh: true) }
            } label: {
                Label("Refresh live data", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
            .disabled(isLoadingDetails)
        }
        .padding(10)
        .background(
            ClaritasPalette.shellBackgroundElevated(for: colorScheme),
            in: RoundedRectangle(cornerRadius: 12)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
        )
    }

    private var metricStrip: some View {
        HStack(spacing: 0) {
            metricCell(
                title: "Tracked now",
                value: overview?.summary.active ?? 0,
                detail: "\(overview?.summary.linked_countries ?? 0) linked countries",
                tone: ClaritasPalette.shellInk(for: colorScheme)
            )
            Divider()
            metricCell(
                title: "Aircraft",
                value: overview?.summary.modes.aviation.active ?? 0,
                detail: "\(overview?.summary.modes.aviation.routed ?? 0) plausible routes",
                tone: ClaritasPalette.dataBlue(for: colorScheme)
            )
            Divider()
            metricCell(
                title: "Vessels",
                value: overview?.summary.modes.maritime.active ?? 0,
                detail: "\(overview?.summary.modes.maritime.routed ?? 0) linked corridors",
                tone: ClaritasPalette.shellAccent(for: colorScheme)
            )
            Divider()
            metricCell(
                title: "Safety signals",
                value: overview?.summary.alerts ?? 0,
                detail: "Current emergency states",
                tone: ClaritasPalette.negativeText(for: colorScheme)
            )
        }
        .padding(.vertical, 13)
        .brandGlass(cornerRadius: ClaritasLayout.panelRadius, elevated: true)
    }

    private var metricGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            BrandMetricCard(
                title: "Aircraft",
                value: "\(overview?.summary.modes.aviation.active ?? 0)",
                detail: "\(overview?.summary.modes.aviation.routed ?? 0) routed",
                tone: ClaritasPalette.dataBlue(for: colorScheme)
            )
            BrandMetricCard(
                title: "Vessels",
                value: "\(overview?.summary.modes.maritime.active ?? 0)",
                detail: "\(overview?.summary.modes.maritime.routed ?? 0) corridors",
                tone: ClaritasPalette.shellAccent(for: colorScheme)
            )
            BrandMetricCard(
                title: "Countries",
                value: "\(overview?.summary.linked_countries ?? 0)",
                detail: "Origin, transit, destination, or flag",
                tone: ClaritasPalette.positiveText(for: colorScheme)
            )
            BrandMetricCard(
                title: "Alerts",
                value: "\(overview?.summary.alerts ?? 0)",
                detail: "Safety states",
                tone: ClaritasPalette.negativeText(for: colorScheme)
            )
        }
    }

    @ViewBuilder
    private var takeawayStrip: some View {
        let takeaways = overview?.takeaways ?? []
        if !takeaways.isEmpty {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: isPad ? 240 : 150), spacing: 12)],
                spacing: 12
            ) {
                ForEach(takeaways) { takeaway in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: takeaway.mode == .aviation ? "airplane" : "ferry.fill")
                            Text(takeaway.title.uppercased())
                                .lineLimit(1)
                            Spacer()
                            Text(trendLabel(takeaway))
                                .foregroundStyle(trendTone(takeaway.direction))
                        }
                        .font(.caption2.weight(.semibold))

                        Text(takeaway.summary)
                            .font(.subheadline.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)

                        Text(takeaway.qualifier)
                            .font(.caption2)
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(13)
                    .frame(maxWidth: .infinity, minHeight: 128, alignment: .topLeading)
                    .brandGlass(cornerRadius: 12, elevated: true)
                }
            }
        }
    }

    private var portMovements: some View {
        BrandCard(title: "Observed port transitions · 24h", icon: "anchor") {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 250), spacing: 10)],
                spacing: 10
            ) {
                ForEach((overview?.ports ?? []).prefix(12)) { port in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(port.location_name)
                                .font(.subheadline.weight(.semibold))
                            Text("\(port.country_name) · \(port.country)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        movementValue("Out", port.departures)
                        movementValue("In", port.arrivals)
                        movementValue("Cargo", port.cargo_vessel_departures)
                    }
                    .padding(10)
                    .background(
                        ClaritasPalette.shellBackgroundElevated(for: colorScheme),
                        in: RoundedRectangle(cornerRadius: 9)
                    )
                }
            }
        }
    }

    private func trendLabel(_ takeaway: TransportTakeaway) -> String {
        if takeaway.direction == "new" { return "New" }
        guard let change = takeaway.change_pct else { return "—" }
        let formatted = change.formatted(.number.precision(.fractionLength(1)))
        return change > 0 ? "+\(formatted)%" : "\(formatted)%"
    }

    private func trendTone(_ direction: String) -> Color {
        switch direction {
        case "up": return ClaritasPalette.positiveText(for: colorScheme)
        case "down": return ClaritasPalette.negativeText(for: colorScheme)
        default: return ClaritasPalette.shellMuted(for: colorScheme)
        }
    }

    private func movementValue(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text("\(value)")
                .font(.subheadline.weight(.semibold).monospacedDigit())
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func metricCell(title: String, value: Int, detail: String, tone: Color) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(1.1)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            Text(value.formatted())
                .font(.title2.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(tone)
            Text(detail)
                .font(.caption)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
    }

    private var entityDetail: some View {
        BrandCard(
            title: selectedEntity.map {
                $0.mode == .maritime ? "Vessel track" : "Flight track"
            } ?? "Vehicle details",
            icon: "scope"
        ) {
            if let entity = selectedEntity {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entity.display_name ?? entity.entity_id)
                            .font(.title3.weight(.semibold))
                        Text(entity.route_label ?? entity.status ?? "Route is resolving")
                            .font(.subheadline)
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    }

                    detailRow(
                        label: entity.mode == .aviation ? "Flight number" : "MMSI",
                        value: entity.flight_number ?? entity.callsign ?? entity.entity_id
                    )
                    detailRow(label: "Registration", value: entity.registration ?? "—")
                    detailRow(
                        label: "Speed",
                        value: entity.speed.map { "\(Int($0.rounded())) kt" } ?? "—"
                    )
                    detailRow(
                        label: entity.mode == .aviation ? "Altitude" : "Heading",
                        value: entity.mode == .aviation
                            ? entity.altitude.map { "\(Int($0.rounded()).formatted()) ft" } ?? "—"
                            : entity.heading.map { "\(Int($0.rounded()))°" } ?? "—"
                    )

                    Divider()
                    HStack {
                        countryNode(entity.origin_country_iso2 ?? entity.registration_country_iso2)
                        Image(systemName: "arrow.right")
                            .foregroundStyle(.secondary)
                        countryNode(entity.current_country_iso2 ?? "Transit")
                        Image(systemName: "arrow.right")
                            .foregroundStyle(.secondary)
                        countryNode(entity.destination_country_iso2)
                    }

                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 88), spacing: 5)],
                        alignment: .leading,
                        spacing: 5
                    ) {
                        ForEach(entity.country_links) { link in
                            Text("\(link.role) · \(link.country)")
                                .font(.caption2)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 4)
                                .background(
                                    ClaritasPalette.shellHighlight(for: colorScheme),
                                    in: Capsule()
                                )
                        }
                    }

                    if isLoadingEntity {
                        HStack(spacing: 7) {
                            ProgressView()
                                .controlSize(.small)
                            Text("Loading sampled trail…")
                        }
                        .font(.caption)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    } else {
                        Text("\(entity.linkage_confidence.capitalized) confidence · \(selectedTrack.count) sampled trail points")
                            .font(.caption)
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    }
                }
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "location.viewfinder")
                        .font(.largeTitle)
                        .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                    Text("Select an aircraft or vessel")
                        .font(.headline)
                    Text("Inspect identifiers, flight number, route, country chain, and sampled track.")
                        .font(.subheadline)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, minHeight: 300)
            }
        }
    }

    private var activityChart: some View {
        BrandCard(title: "24-hour sampled activity", icon: "chart.xyaxis.line") {
            if let points = overview?.activity, !points.isEmpty {
                Chart(points) { point in
                    LineMark(
                        x: .value("Time", point.bucketDate ?? .distantPast),
                        y: .value("Active", point.active_count)
                    )
                    .interpolationMethod(.catmullRom)
                    .foregroundStyle(by: .value("Mode", point.mode.rawValue.capitalized))
                    AreaMark(
                        x: .value("Time", point.bucketDate ?? .distantPast),
                        y: .value("Active", point.active_count)
                    )
                    .foregroundStyle(by: .value("Mode", point.mode.rawValue.capitalized))
                    .opacity(0.12)
                }
                .chartForegroundStyleScale([
                    "Aviation": ClaritasPalette.dataBlue(for: colorScheme),
                    "Maritime": ClaritasPalette.shellAccent(for: colorScheme)
                ])
                .frame(height: 260)
            } else {
                chartEmpty("Trail sampling is building the 24-hour baseline.")
            }
        }
    }

    private var countryChart: some View {
        let points = (overview?.countries ?? []).prefix(10).flatMap { country in
            [
                TransportCountryModePoint(
                    country: country.country,
                    mode: "Flights",
                    count: country.aviation.active
                ),
                TransportCountryModePoint(
                    country: country.country,
                    mode: "Vessels",
                    count: country.maritime.active
                )
            ]
        }
        return BrandCard(title: "Most connected countries", icon: "chart.bar.xaxis") {
            if !points.isEmpty {
                Chart(points) { point in
                    BarMark(
                        x: .value("Country", point.country),
                        y: .value("Active", point.count)
                    )
                    .foregroundStyle(by: .value("Mode", point.mode))
                    .position(by: .value("Mode", point.mode))
                }
                .chartForegroundStyleScale([
                    "Flights": ClaritasPalette.dataBlue(for: colorScheme),
                    "Vessels": ClaritasPalette.shellAccent(for: colorScheme)
                ])
                .frame(height: 260)
            } else {
                chartEmpty("No linked countries in the current scope.")
            }
        }
    }

    private var routeDiagram: some View {
        BrandCard(title: "Leading live corridors", icon: "point.topleft.down.to.point.bottomright.curvepath") {
            VStack(spacing: 0) {
                ForEach((overview?.routes ?? []).prefix(12)) { route in
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(route.origin_country)
                                .font(.headline)
                            Text(route.origin_name)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        VStack(spacing: 3) {
                            Image(systemName: route.mode == .aviation ? "airplane" : "ferry.fill")
                                .foregroundStyle(
                                    route.mode == .aviation
                                        ? ClaritasPalette.dataBlue(for: colorScheme)
                                        : ClaritasPalette.shellAccent(for: colorScheme)
                                )
                            Text("\(route.active_count)")
                                .font(.caption2.monospacedDigit())
                        }
                        Image(systemName: "arrow.right")
                            .foregroundStyle(.secondary)
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(route.destination_country)
                                .font(.headline)
                            Text(route.destination_name)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .padding(.vertical, 9)
                    Divider()
                }
            }
        }
    }

    private var linkedCountryList: some View {
        BrandCard(title: "Country linkage", icon: "link") {
            VStack(spacing: 0) {
                ForEach((overview?.countries ?? []).prefix(14)) { country in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(country.country_name)
                                .font(.subheadline.weight(.semibold))
                            Text(country.country)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        aggregatePill(
                            icon: "airplane",
                            value: country.aviation.active,
                            tone: ClaritasPalette.dataBlue(for: colorScheme)
                        )
                        aggregatePill(
                            icon: "ferry.fill",
                            value: country.maritime.active,
                            tone: ClaritasPalette.shellAccent(for: colorScheme)
                        )
                    }
                    .padding(.vertical, 9)
                    Divider()
                }
            }
        }
    }

    private var entityList: some View {
        BrandCard(title: "Flights and shipping movements", icon: "list.bullet.rectangle") {
            LazyVStack(spacing: 0) {
                ForEach(filteredEntities.prefix(120)) { entity in
                    Button {
                        Task { await select(entity) }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: entity.mode == .aviation ? "airplane" : "ferry.fill")
                                .frame(width: 24)
                                .foregroundStyle(
                                    entity.mode == .aviation
                                        ? ClaritasPalette.dataBlue(for: colorScheme)
                                        : ClaritasPalette.shellAccent(for: colorScheme)
                                )
                            VStack(alignment: .leading, spacing: 3) {
                                Text(
                                    entity.flight_number ??
                                    entity.callsign ??
                                    entity.display_name ??
                                    entity.entity_id
                                )
                                .font(.subheadline.weight(.semibold))
                                Text(
                                    entity.mode == .aviation
                                        ? [entity.registration, entity.vehicle_type]
                                            .compactMap { $0 }
                                            .joined(separator: " · ")
                                        : "MMSI \(entity.entity_id)"
                                )
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(entity.route_label ?? entity.status ?? "Resolving")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .frame(maxWidth: 220, alignment: .trailing)
                            Image(systemName: "chevron.right")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Divider()
                }
            }
        }
    }

    private var provenance: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label(
                "Maritime positions, vessel identity, and voyage metadata: AISstream.",
                systemImage: "ferry.fill"
            )
            Label(
                "Flight positions, callsigns, and plausible airport routes: adsb.lol (ODbL).",
                systemImage: "airplane"
            )
            Label(
                "Baltic AIS fallback: Fintraffic Digitraffic (CC BY 4.0).",
                systemImage: "ferry"
            )
            if overview?.coverage.maritime.configured == false {
                Label(
                    "Maritime feed is awaiting its server-side AISstream credential.",
                    systemImage: "key"
                )
                .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
            } else if let maritimeRuntimeMessage {
                Label(
                    maritimeRuntimeMessage,
                    systemImage: "arrow.clockwise"
                )
                .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
            }
        }
        .font(.caption)
        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
    }

    private var filteredEntities: [TransportEntity] {
        guard let mode else { return overview?.entities ?? [] }
        return (overview?.entities ?? []).filter { $0.mode == mode }
    }

    private var maritimeRuntimeMessage: String? {
        guard let maritime = overview?.coverage.maritime else { return nil }
        if maritime.primary_status == "upstream_stalled" || maritime.status == "upstream_stalled" {
            return maritime.fallback_last_snapshot_at == nil
                ? "AISstream is connected but its upstream feed is silent; automatic recovery is active."
                : "AISstream is connected but its upstream feed is silent; the official regional fallback remains active."
        }
        if maritime.last_error != nil {
            return "AISstream reported a stream error; Claritas is reconnecting automatically."
        }
        if maritime.persistence_error == true {
            return "AIS database writes are retrying; \(maritime.queue_depth ?? 0) vessel snapshots remain queued."
        }
        if maritime.status == "live" { return nil }
        if (maritime.queue_depth ?? 0) > 0 {
            return "Incrementally persisting \(maritime.queue_depth ?? 0) queued vessel snapshots."
        }
        if maritime.fallback_error == true && (maritime.messages_received ?? 0) == 0 {
            return "Global AIS is silent and the official Baltic fallback is retrying."
        }
        if maritime.connected == true && (maritime.messages_received ?? 0) == 0 {
            return "AISstream is connected with \(maritime.subscription_boxes ?? 1) coverage area(s), but no vessel frames have arrived yet."
        }
        switch maritime.status {
        case "receiving":
            return "AIS messages are being received and processed."
        case "connecting":
            return "AISstream is connected and awaiting vessel messages."
        case "reconnecting":
            return "AISstream is reconnecting after an idle or interrupted stream."
        default:
            return nil
        }
    }

    private func detailRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            Spacer()
            Text(value)
                .fontWeight(.semibold)
                .monospacedDigit()
        }
        .font(.subheadline)
    }

    private func countryNode(_ value: String?) -> some View {
        Text(value ?? "—")
            .font(.caption.weight(.bold))
            .frame(maxWidth: .infinity, minHeight: 38)
            .background(
                ClaritasPalette.shellBackgroundElevated(for: colorScheme),
                in: RoundedRectangle(cornerRadius: 8)
            )
    }

    private func aggregatePill(icon: String, value: Int, tone: Color) -> some View {
        Label("\(value)", systemImage: icon)
            .font(.caption.monospacedDigit())
            .foregroundStyle(tone)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(tone.opacity(0.1), in: Capsule())
    }

    private func chartEmpty(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            .frame(maxWidth: .infinity, minHeight: 260)
    }

    private func loadDetails(forceRefresh: Bool) async {
        guard let country = model.transportFocusCountry else {
            detailedOverview = nil
            detailError = "Choose a country to load transport intelligence."
            return
        }
        let requestID = UUID()
        detailRequestID = requestID
        isLoadingDetails = true
        detailError = nil
        defer {
            if detailRequestID == requestID {
                isLoadingDetails = false
            }
        }
        do {
            let value = try await model.api.fetchTransportOverview(
                detail: "full",
                mode: mode,
                country: country,
                entityLimit: 1_200,
                refresh: forceRefresh
            )
            guard detailRequestID == requestID else { return }
            detailedOverview = value
            if let selectedEntity,
               !value.entities.contains(where: { $0.id == selectedEntity.id }) {
                clearSelection()
            }
        } catch {
            if detailRequestID == requestID, !Task.isCancelled {
                detailError = error.localizedDescription
            }
        }
    }

    private func select(_ entity: TransportEntity) async {
        let requestID = UUID()
        selectionRequestID = requestID
        selectedEntity = entity
        selectedTrack = []
        isLoadingEntity = true
        defer {
            if selectionRequestID == requestID {
                isLoadingEntity = false
            }
        }
        do {
            let detail = try await model.api.fetchTransportEntity(
                mode: entity.mode,
                entityID: entity.entity_id
            )
            guard selectionRequestID == requestID else { return }
            selectedEntity = detail.entity
            selectedTrack = detail.track
        } catch {
            // Current snapshot remains visible while track sampling catches up.
        }
    }

    private func clearSelection() {
        selectionRequestID = UUID()
        selectedEntity = nil
        selectedTrack = []
        isLoadingEntity = false
    }
}

private struct TransportNativeMap: View {
    let entities: [TransportEntity]
    let selectedID: String?
    let scopeCountry: String?
    let onSelect: (TransportEntity) -> Void

    @State private var viewport = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 12, longitude: 0),
        span: MKCoordinateSpan(latitudeDelta: 142, longitudeDelta: 350)
    )

    private var plotted: [TransportEntity] {
        Array(entities.filter {
            guard let latitude = $0.latitude, let longitude = $0.longitude else { return false }
            return latitude.isFinite && longitude.isFinite && abs(latitude) <= 90 && abs(longitude) <= 180
        }.prefix(320))
    }

    var body: some View {
        Map(
            coordinateRegion: $viewport,
            interactionModes: [.pan, .zoom],
            showsUserLocation: false,
            annotationItems: plotted
        ) { entity in
            MapAnnotation(coordinate: CLLocationCoordinate2D(
                latitude: entity.latitude ?? 0,
                longitude: entity.longitude ?? 0
            )) {
                Button { onSelect(entity) } label: {
                    Image(systemName: entity.mode == .aviation ? "airplane" : "ferry.fill")
                        .font(.system(size: selectedID == entity.id ? 12 : 9, weight: .bold))
                        .foregroundStyle(Color(hex: "#07141E"))
                        .frame(
                            width: selectedID == entity.id ? 28 : 21,
                            height: selectedID == entity.id ? 28 : 21
                        )
                        .background(markerTone(entity).opacity(0.94), in: Circle())
                        .overlay(Circle().stroke(.white, lineWidth: selectedID == entity.id ? 2 : 1))
                        .rotationEffect(.degrees(entity.mode == .aviation ? (entity.heading ?? 0) - 45 : 0))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(entity.mode == .aviation ? "Aircraft" : "Vessel") \(entity.display_name ?? entity.entity_id)")
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.white.opacity(0.28), lineWidth: 1)
        )
        .overlay(alignment: .topLeading) {
            Text("CURRENT SCOPE · \((scopeCountry ?? "GLOBAL").uppercased())")
                .font(.caption2.weight(.bold))
                .tracking(1)
                .foregroundStyle(.white)
                .padding(.horizontal, 9)
                .padding(.vertical, 6)
                .background(Color.black.opacity(0.62), in: Capsule())
                .padding(9)
                .allowsHitTesting(false)
        }
        .onAppear { fitViewport() }
        .onChange(of: scopeCountry) { _ in fitViewport() }
        .onChange(of: plotted.map(\.id)) { _ in fitViewport() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Live transport map for \(scopeCountry ?? "the current country scope")")
    }

    private func markerTone(_ entity: TransportEntity) -> Color {
        entity.mode == .aviation ? Color(hex: "#91ADBA") : Color(hex: "#D3C3A5")
    }

    private func fitViewport() {
        let scoped = plotted.filter {
            guard let scope = scopeCountry?.uppercased() else { return true }
            return $0.current_country_iso2?.uppercased() == scope
        }
        let candidates = scoped.isEmpty ? plotted : scoped
        guard !candidates.isEmpty else { return }
        let latitudes = candidates.compactMap(\.latitude)
        let longitudes = candidates.compactMap(\.longitude)
        guard let minLat = latitudes.min(), let maxLat = latitudes.max(),
              let minLon = longitudes.min(), let maxLon = longitudes.max() else { return }
        viewport = MKCoordinateRegion(
            center: CLLocationCoordinate2D(
                latitude: (minLat + maxLat) / 2,
                longitude: (minLon + maxLon) / 2
            ),
            span: MKCoordinateSpan(
                latitudeDelta: min(142, max(2.5, (maxLat - minLat) * 1.35)),
                longitudeDelta: min(350, max(3, (maxLon - minLon) * 1.35))
            )
        )
    }
}

private struct TransportCountryModePoint: Identifiable {
    let country: String
    let mode: String
    let count: Int
    var id: String { "\(country)-\(mode)" }
}

private struct TransportCanvasMap: View {
    let entities: [TransportEntity]
    let selectedID: String?
    let track: [TransportTrackPoint]
    let onSelect: (TransportEntity) -> Void
    @Environment(\.colorScheme) private var colorScheme

    private var plottedEntities: [TransportEntity] {
        Array(entities.prefix(1_000))
    }

    var body: some View {
        GeometryReader { proxy in
            Canvas { context, size in
                let bounds = CGRect(origin: .zero, size: size)
                context.fill(
                    Path(roundedRect: bounds, cornerRadius: 12),
                    with: .color(ClaritasPalette.shellBackground(for: colorScheme))
                )
                drawGrid(context: context, size: size)
                drawContinents(context: context, size: size)
                drawRoutes(context: context, size: size)
                drawTrack(context: context, size: size)
                drawEntities(context: context, size: size)
            }
            .contentShape(Rectangle())
            .gesture(
                SpatialTapGesture()
                    .onEnded { event in
                        if let entity = nearestEntity(to: event.location, size: proxy.size) {
                            onSelect(entity)
                        }
                    }
            )
            .overlay(alignment: .bottomLeading) {
                HStack(spacing: 12) {
                    legendItem("Aircraft", color: ClaritasPalette.dataBlue(for: colorScheme))
                    legendItem("Vessels", color: ClaritasPalette.shellAccent(for: colorScheme))
                    Text("\(plottedEntities.count) visible")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .padding(9)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 9))
                .padding(10)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "Live transport map with \(plottedEntities.count) selectable vehicles"
        )
        .accessibilityHint("Tap near an aircraft or vessel to show its details")
    }

    private func project(latitude: Double, longitude: Double, size: CGSize) -> CGPoint {
        CGPoint(
            x: (longitude + 180) / 360 * size.width,
            y: (82 - latitude) / 142 * size.height
        )
    }

    private func drawGrid(context: GraphicsContext, size: CGSize) {
        var path = Path()
        for longitude in stride(from: -120.0, through: 120.0, by: 60.0) {
            let top = project(latitude: 82, longitude: longitude, size: size)
            let bottom = project(latitude: -60, longitude: longitude, size: size)
            path.move(to: top)
            path.addLine(to: bottom)
        }
        for latitude in stride(from: -30.0, through: 60.0, by: 30.0) {
            let left = project(latitude: latitude, longitude: -180, size: size)
            let right = project(latitude: latitude, longitude: 180, size: size)
            path.move(to: left)
            path.addLine(to: right)
        }
        context.stroke(
            path,
            with: .color(ClaritasPalette.shellBorder(for: colorScheme).opacity(0.55)),
            lineWidth: 0.6
        )
    }

    private func drawContinents(context: GraphicsContext, size: CGSize) {
        let continents: [[(Double, Double)]] = [
            [(-168, 72), (-52, 72), (-60, 18), (-100, 8), (-130, 24), (-168, 58)],
            [(-82, 12), (-34, 6), (-49, -56), (-72, -52), (-81, -5)],
            [(-12, 72), (40, 72), (35, 35), (10, 35), (-10, 45)],
            [(-18, 36), (52, 32), (43, -35), (18, -35), (-15, 5)],
            [(30, 72), (178, 68), (150, 5), (105, -10), (55, 10), (35, 35)],
            [(110, -10), (155, -10), (153, -44), (115, -40)]
        ]
        for polygon in continents {
            var path = Path()
            for (index, coordinate) in polygon.enumerated() {
                let point = project(
                    latitude: coordinate.1,
                    longitude: coordinate.0,
                    size: size
                )
                if index == 0 {
                    path.move(to: point)
                } else {
                    path.addLine(to: point)
                }
            }
            path.closeSubpath()
            context.fill(
                path,
                with: .color(ClaritasPalette.shellBackgroundElevated(for: colorScheme))
            )
            context.stroke(
                path,
                with: .color(ClaritasPalette.shellBorder(for: colorScheme)),
                lineWidth: 0.8
            )
        }
    }

    private func drawRoutes(context: GraphicsContext, size: CGSize) {
        for entity in plottedEntities.prefix(180) {
            guard
                let originLatitude = entity.origin_latitude,
                let originLongitude = entity.origin_longitude,
                let destinationLatitude = entity.destination_latitude,
                let destinationLongitude = entity.destination_longitude
            else { continue }
            let start = project(
                latitude: originLatitude,
                longitude: originLongitude,
                size: size
            )
            let end = project(
                latitude: destinationLatitude,
                longitude: destinationLongitude,
                size: size
            )
            var path = Path()
            path.move(to: start)
            path.addQuadCurve(
                to: end,
                control: CGPoint(
                    x: (start.x + end.x) / 2,
                    y: (start.y + end.y) / 2 - min(70, abs(end.x - start.x) * 0.18)
                )
            )
            context.stroke(
                path,
                with: .color(
                    (entity.mode == .aviation
                        ? ClaritasPalette.dataBlue(for: colorScheme)
                        : ClaritasPalette.shellAccent(for: colorScheme))
                        .opacity(entity.id == selectedID ? 0.9 : 0.2)
                ),
                lineWidth: entity.id == selectedID ? 2.2 : 0.8
            )
        }
    }

    private func drawTrack(context: GraphicsContext, size: CGSize) {
        guard track.count > 1 else { return }
        var path = Path()
        for (index, point) in track.enumerated() {
            let projected = project(
                latitude: point.latitude,
                longitude: point.longitude,
                size: size
            )
            if index == 0 {
                path.move(to: projected)
            } else {
                path.addLine(to: projected)
            }
        }
        context.stroke(
            path,
            with: .color(ClaritasPalette.shellInk(for: colorScheme)),
            lineWidth: 2.4
        )
    }

    private func drawEntities(context: GraphicsContext, size: CGSize) {
        for entity in plottedEntities {
            guard let latitude = entity.latitude, let longitude = entity.longitude else { continue }
            let point = project(latitude: latitude, longitude: longitude, size: size)
            let selected = entity.id == selectedID
            let radius = selected ? 6.5 : 3.2
            let rect = CGRect(
                x: point.x - radius,
                y: point.y - radius,
                width: radius * 2,
                height: radius * 2
            )
            let tone = entity.is_alert
                ? ClaritasPalette.negativeText(for: colorScheme)
                : entity.mode == .aviation
                    ? ClaritasPalette.dataBlue(for: colorScheme)
                    : ClaritasPalette.shellAccent(for: colorScheme)
            context.fill(Path(ellipseIn: rect), with: .color(tone))
            if selected {
                context.stroke(
                    Path(ellipseIn: rect.insetBy(dx: -3, dy: -3)),
                    with: .color(ClaritasPalette.shellInk(for: colorScheme)),
                    lineWidth: 1.5
                )
            }
        }
    }

    private func nearestEntity(to location: CGPoint, size: CGSize) -> TransportEntity? {
        plottedEntities
            .compactMap { entity -> (TransportEntity, CGFloat)? in
                guard let latitude = entity.latitude, let longitude = entity.longitude else {
                    return nil
                }
                let point = project(latitude: latitude, longitude: longitude, size: size)
                let distance = hypot(point.x - location.x, point.y - location.y)
                return distance <= 28 ? (entity, distance) : nil
            }
            .min { $0.1 < $1.1 }?
            .0
    }

    private func legendItem(_ label: String, color: Color) -> some View {
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
            Text(label)
                .font(.caption2)
        }
    }
}
