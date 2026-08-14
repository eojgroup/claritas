import Charts
import Foundation
import MapKit
import SwiftUI
import UIKit

struct TransportWorkspaceView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var detailedOverview: TransportOverview?
    @State private var detailedOverviewCountry: String?
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
        guard isPad else { return model.transportOverview }
        let scope = model.transportFocusCountry?.uppercased()
        if detailedOverviewCountry == scope {
            return detailedOverview
        }
        return model.transportOverviewCountry?.uppercased() == scope
            ? model.transportOverview
            : nil
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
                    TransportTrackingMap(
                        entities: filteredEntities,
                        routes: overview?.routes ?? [],
                        mode: mode,
                        selectedID: selectedEntity?.id,
                        track: selectedTrack,
                        scopeCountry: model.transportFocusCountry,
                        onSelect: { entity in
                            Task { await select(entity) }
                        },
                        onSelectCountry: selectScopeCountry
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

                    TransportTrackingMap(
                        entities: filteredEntities,
                        routes: overview?.routes ?? [],
                        mode: mode,
                        selectedID: selectedEntity?.id,
                        track: selectedTrack,
                        scopeCountry: model.transportFocusCountry,
                        compactPresentation: true,
                        onSelect: { entity in Task { await select(entity) } },
                        onSelectCountry: selectScopeCountry
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
            detailedOverviewCountry = nil
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
            guard detailRequestID == requestID,
                  model.transportFocusCountry?.uppercased() == country.uppercased() else { return }
            detailedOverview = value
            detailedOverviewCountry = country.uppercased()
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

    private func selectScopeCountry(_ country: String) {
        let normalized = country.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard normalized.range(of: "^[A-Z]{2}$", options: .regularExpression) != nil,
              normalized != model.transportFocusCountry?.uppercased() else { return }
        clearSelection()
        detailedOverview = nil
        detailedOverviewCountry = nil
        model.selectedCountry = normalized
    }
}

// The dedicated transport workspace uses the same native MapKit foundation as
// the overview map.  Unlike the old canvas, it retains real map gestures and
// layers the country relationship, resolved vehicle route, and sampled trail
// over current aircraft and vessel positions.
private enum TransportMapViewport: String {
    case world
    case links
}

private struct TransportCountryModePoint: Identifiable {
    let country: String
    let mode: String
    let count: Int

    var id: String { "\(country)-\(mode)" }
}

private struct TransportMapConnection: Identifiable {
    let mode: TransportMode
    let originCountry: String
    let originName: String
    let destinationCountry: String
    let destinationName: String
    let activeCount: Int

    var id: String { "\(mode.rawValue)-\(originCountry)-\(destinationCountry)" }

    static func make(
        routes: [TransportRouteAggregate],
        scopeCountry: String?,
        mode: TransportMode?
    ) -> [TransportMapConnection] {
        guard let scope = scopeCountry?.uppercased() else { return [] }
        var sourceByID: [String: TransportRouteAggregate] = [:]
        var countsByID: [String: Int] = [:]

        for route in routes {
            if let mode, route.mode != mode { continue }
            let origin = route.origin_country.uppercased()
            let destination = route.destination_country.uppercased()
            guard origin != destination, origin == scope || destination == scope else { continue }
            let id = "\(route.mode.rawValue)-\(origin)-\(destination)"
            sourceByID[id] = route
            countsByID[id, default: 0] += route.active_count
        }

        return sourceByID.compactMap { id, route in
            guard let count = countsByID[id] else { return nil }
            return TransportMapConnection(
                mode: route.mode,
                originCountry: route.origin_country.uppercased(),
                originName: route.origin_name,
                destinationCountry: route.destination_country.uppercased(),
                destinationName: route.destination_name,
                activeCount: count
            )
        }
        .sorted {
            $0.activeCount == $1.activeCount
                ? $0.id < $1.id
                : $0.activeCount > $1.activeCount
        }
    }
}

private struct TransportTrackingMap: View {
    let entities: [TransportEntity]
    let routes: [TransportRouteAggregate]
    let mode: TransportMode?
    let selectedID: String?
    let track: [TransportTrackPoint]
    let scopeCountry: String?
    var compactPresentation = false
    let onSelect: (TransportEntity) -> Void
    let onSelectCountry: (String) -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var viewport: TransportMapViewport = .links
    @State private var viewportToken = 0

    private var connections: [TransportMapConnection] {
        TransportMapConnection.make(routes: routes, scopeCountry: scopeCountry, mode: mode)
    }

    private var visibleEntities: [TransportEntity] {
        Array(entities.prefix(compactPresentation ? 200 : 320))
    }

    var body: some View {
        MapKitTransportTrackingView(
            entities: visibleEntities,
            connections: connections,
            selectedID: selectedID,
            track: track,
            scopeCountry: scopeCountry,
            viewport: viewport,
            viewportToken: viewportToken,
            compactPresentation: compactPresentation,
            darkAppearance: colorScheme == .dark,
            onSelect: onSelect,
            onSelectCountry: onSelectCountry
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
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
        .overlay(alignment: .topTrailing) {
            VStack(spacing: 0) {
                viewportButton(icon: "globe", label: "Show world") {
                    setViewport(.world)
                }
                Divider().frame(width: 30)
                viewportButton(icon: "point.topleft.down.to.point.bottomright.curvepath", label: "Show country links") {
                    setViewport(.links)
                }
                .disabled(connections.isEmpty)
            }
            .background(Color(hex: "#11222E").opacity(0.92), in: RoundedRectangle(cornerRadius: 9))
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .stroke(Color.white.opacity(0.16), lineWidth: 1)
            )
            .padding(9)
        }
        .overlay(alignment: .bottomLeading) {
            HStack(spacing: 9) {
                if mode != .maritime { legend("Aircraft", color: Color(hex: "#78A9BA")) }
                if mode != .aviation { legend("Vessels", color: Color(hex: "#D6A66B")) }
                if !connections.isEmpty { legend("Country links", color: Color(hex: "#D87543"), line: true) }
                if track.count > 1 { legend("Trail", color: .white, line: true) }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(Color.black.opacity(0.62), in: Capsule())
            .padding(9)
            .allowsHitTesting(false)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            "Live transport tracking map with \(visibleEntities.count) vehicles and \(connections.count) country connections"
        )
        .accessibilityHint("Tap a vehicle for its details or a country label to change transport scope")
    }

    private func viewportButton(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color(hex: "#F2EEE6"))
                .frame(width: ClaritasLayout.minimumTouchTarget, height: ClaritasLayout.minimumTouchTarget)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func legend(_ label: String, color: Color, line: Bool = false) -> some View {
        HStack(spacing: 4) {
            if line {
                Capsule().fill(color).frame(width: 13, height: 2)
            } else {
                Circle().fill(color).frame(width: 7, height: 7)
            }
            Text(label)
                .font(.system(size: 8, weight: .medium))
                .foregroundStyle(.white.opacity(0.9))
        }
    }

    private func setViewport(_ next: TransportMapViewport) {
        viewport = next
        viewportToken += 1
    }
}

private struct MapKitTransportTrackingView: UIViewRepresentable {
    let entities: [TransportEntity]
    let connections: [TransportMapConnection]
    let selectedID: String?
    let track: [TransportTrackPoint]
    let scopeCountry: String?
    let viewport: TransportMapViewport
    let viewportToken: Int
    let compactPresentation: Bool
    let darkAppearance: Bool
    let onSelect: (TransportEntity) -> Void
    let onSelectCountry: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView(frame: .zero)
        map.delegate = context.coordinator
        map.isRotateEnabled = false
        map.isPitchEnabled = false
        map.showsCompass = true
        map.showsScale = !compactPresentation
        map.pointOfInterestFilter = .excludingAll
        map.register(MKMarkerAnnotationView.self, forAnnotationViewWithReuseIdentifier: Coordinator.countryReuseID)
        map.register(MKAnnotationView.self, forAnnotationViewWithReuseIdentifier: Coordinator.entityReuseID)

        let configuration = MKStandardMapConfiguration(elevationStyle: .flat)
        configuration.emphasisStyle = .muted
        configuration.pointOfInterestFilter = .excludingAll
        map.preferredConfiguration = configuration

        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleMapTap(_:)))
        tap.cancelsTouchesInView = false
        tap.delegate = context.coordinator
        map.addGestureRecognizer(tap)
        context.coordinator.mapView = map
        context.coordinator.update(map, with: self, force: true)
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.update(map, with: self, force: false)
    }

    final class Coordinator: NSObject, MKMapViewDelegate, UIGestureRecognizerDelegate {
        static let countryReuseID = "claritas-transport-country"
        static let entityReuseID = "claritas-transport-entity"

        private var parent: MapKitTransportTrackingView
        private var countryPolygons: [ObjectIdentifier: String] = [:]
        private var overlayStyles: [ObjectIdentifier: TransportOverlayStyle] = [:]
        private var overlaySignature = ""
        private var annotationSignature = ""
        private var viewportSignature = ""
        weak var mapView: MKMapView?

        init(parent: MapKitTransportTrackingView) {
            self.parent = parent
        }

        func update(_ map: MKMapView, with next: MapKitTransportTrackingView, force: Bool) {
            parent = next
            map.showsScale = !next.compactPresentation

            let nextOverlaySignature = [
                next.scopeCountry?.uppercased() ?? "",
                next.connections.map { "\($0.id):\($0.activeCount)" }.joined(separator: ","),
                next.entities.prefix(140).map { entity in
                    "\(entity.id):\(entity.origin_latitude ?? 0):\(entity.origin_longitude ?? 0):\(entity.destination_latitude ?? 0):\(entity.destination_longitude ?? 0)"
                }.joined(separator: ","),
                next.selectedID ?? "",
                next.track.map { "\($0.latitude):\($0.longitude):\($0.observed_at)" }.joined(separator: ","),
                next.darkAppearance ? "dark" : "light"
            ].joined(separator: "|")
            if force || nextOverlaySignature != overlaySignature {
                overlaySignature = nextOverlaySignature
                installOverlays(on: map)
            }

            let nextAnnotationSignature = [
                next.scopeCountry?.uppercased() ?? "",
                next.selectedID ?? "",
                next.connections.map { "\($0.id):\($0.activeCount)" }.joined(separator: ","),
                next.entities.map { entity in
                    "\(entity.id):\(entity.latitude ?? 0):\(entity.longitude ?? 0):\(entity.heading ?? 0):\(entity.is_alert):\(entity.observed_at)"
                }.joined(separator: ",")
            ].joined(separator: "|")
            if force || nextAnnotationSignature != annotationSignature {
                annotationSignature = nextAnnotationSignature
                installAnnotations(on: map)
            }

            let nextViewportSignature = [
                next.scopeCountry?.uppercased() ?? "",
                next.viewport.rawValue,
                String(next.viewportToken),
                next.selectedID ?? ""
            ].joined(separator: "|")
            if force || nextViewportSignature != viewportSignature {
                viewportSignature = nextViewportSignature
                setViewport(on: map, animated: !force)
            }
        }

        private func installOverlays(on map: MKMapView) {
            map.removeOverlays(map.overlays)
            countryPolygons.removeAll(keepingCapacity: true)
            overlayStyles.removeAll(keepingCapacity: true)

            var countryOverlays: [MKOverlay] = []
            for boundary in NaturalEarthCountryBoundaries.shared.boundaries {
                for polygon in boundary.polygons {
                    countryPolygons[ObjectIdentifier(polygon)] = boundary.iso
                    countryOverlays.append(polygon)
                }
            }
            map.addOverlays(countryOverlays, level: .aboveRoads)

            let corridorOverlays = parent.connections.compactMap { connection -> MKPolyline? in
                guard let start = CountryCentroidLookup.coordinate(for: connection.originCountry),
                      let end = CountryCentroidLookup.coordinate(for: connection.destinationCountry) else { return nil }
                let line = MKPolyline(coordinates: curvedCoordinates(from: start, to: end), count: 3)
                overlayStyles[ObjectIdentifier(line)] = .countryConnection(connection.mode, connection.activeCount)
                return line
            }
            map.addOverlays(corridorOverlays, level: .aboveRoads)

            let routeOverlays = parent.entities.prefix(140).compactMap { entity -> MKPolyline? in
                guard let start = coordinate(latitude: entity.origin_latitude, longitude: entity.origin_longitude),
                      let end = coordinate(latitude: entity.destination_latitude, longitude: entity.destination_longitude) else { return nil }
                let line = MKPolyline(coordinates: curvedCoordinates(from: start, to: end), count: 3)
                overlayStyles[ObjectIdentifier(line)] = .vehicleRoute(entity.mode, entity.id == parent.selectedID)
                return line
            }
            map.addOverlays(routeOverlays, level: .aboveRoads)

            let sampledTrack = parent.track.compactMap { point in
                coordinate(latitude: point.latitude, longitude: point.longitude)
            }
            if sampledTrack.count > 1 {
                let line = MKPolyline(coordinates: sampledTrack, count: sampledTrack.count)
                overlayStyles[ObjectIdentifier(line)] = .sampledTrack
                map.addOverlay(line, level: .aboveRoads)
            }
        }

        private func installAnnotations(on map: MKMapView) {
            map.removeAnnotations(map.annotations.filter { !($0 is MKUserLocation) })

            let scope = parent.scopeCountry?.uppercased()
            var countries = scope.map { [$0] } ?? []
            for connection in parent.connections {
                if !countries.contains(connection.originCountry) { countries.append(connection.originCountry) }
                if !countries.contains(connection.destinationCountry) { countries.append(connection.destinationCountry) }
            }
            let countryCounts = parent.connections.reduce(into: [String: Int]()) { result, connection in
                result[connection.originCountry, default: 0] += connection.activeCount
                result[connection.destinationCountry, default: 0] += connection.activeCount
            }
            let countryAnnotations: [MKAnnotation] = countries.prefix(18).compactMap { iso in
                guard let coordinate = CountryCentroidLookup.coordinate(for: iso) else { return nil }
                return TransportCountryAnnotation(
                    iso: iso,
                    coordinate: coordinate,
                    activeCount: countryCounts[iso] ?? 0,
                    selected: iso == scope
                )
            }
            let entityAnnotations: [MKAnnotation] = parent.entities.compactMap(TransportEntityAnnotation.init)
            map.addAnnotations(countryAnnotations + entityAnnotations)
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let polygon = overlay as? MKPolygon {
                let renderer = MKPolygonRenderer(polygon: polygon)
                let iso = countryPolygons[ObjectIdentifier(polygon)]
                let scope = parent.scopeCountry?.uppercased()
                let linked = parent.connections.contains {
                    $0.originCountry == iso || $0.destinationCountry == iso
                }
                renderer.fillColor = iso == scope
                    ? UIColor(red: 0.85, green: 0.65, blue: 0.42, alpha: 0.22)
                    : linked
                        ? UIColor(red: 0.36, green: 0.66, blue: 0.74, alpha: 0.14)
                        : .clear
                renderer.strokeColor = iso == scope
                    ? UIColor.white.withAlphaComponent(0.92)
                    : linked
                        ? UIColor(red: 0.50, green: 0.75, blue: 0.82, alpha: 0.82)
                        : UIColor.white.withAlphaComponent(0.16)
                renderer.lineWidth = iso == scope ? 2.1 : linked ? 1.25 : 0.55
                return renderer
            }
            guard let line = overlay as? MKPolyline,
                  let style = overlayStyles[ObjectIdentifier(line)] else {
                return MKOverlayRenderer(overlay: overlay)
            }
            let renderer = MKPolylineRenderer(polyline: line)
            switch style {
            case let .countryConnection(mode, count):
                renderer.strokeColor = mode == .aviation
                    ? UIColor(red: 0.42, green: 0.69, blue: 0.79, alpha: 0.88)
                    : UIColor(red: 0.87, green: 0.61, blue: 0.36, alpha: 0.88)
                renderer.lineWidth = min(5, 1.3 + log2(Double(max(count, 1))))
                renderer.lineDashPattern = [NSNumber(value: 6), NSNumber(value: 4)]
            case let .vehicleRoute(mode, selected):
                renderer.strokeColor = mode == .aviation
                    ? UIColor(red: 0.48, green: 0.72, blue: 0.80, alpha: selected ? 0.92 : 0.24)
                    : UIColor(red: 0.90, green: 0.64, blue: 0.39, alpha: selected ? 0.92 : 0.24)
                renderer.lineWidth = selected ? 2.7 : 0.9
            case .sampledTrack:
                renderer.strokeColor = UIColor.white.withAlphaComponent(0.96)
                renderer.lineWidth = 3
                renderer.lineDashPattern = nil
            }
            return renderer
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if let country = annotation as? TransportCountryAnnotation {
                let view = mapView.dequeueReusableAnnotationView(
                    withIdentifier: Self.countryReuseID,
                    for: country
                ) as! MKMarkerAnnotationView
                view.annotation = country
                view.markerTintColor = country.selected
                    ? UIColor(red: 0.85, green: 0.65, blue: 0.42, alpha: 1)
                    : UIColor(red: 0.42, green: 0.69, blue: 0.79, alpha: 1)
                view.glyphText = country.iso
                view.glyphTintColor = UIColor(red: 0.03, green: 0.08, blue: 0.12, alpha: 1)
                view.displayPriority = country.selected ? .required : .defaultHigh
                view.canShowCallout = false
                view.titleVisibility = .hidden
                view.subtitleVisibility = .hidden
                view.accessibilityLabel = "\(country.iso), \(country.activeCount) active country-linked movements"
                return view
            }
            if let entity = annotation as? TransportEntityAnnotation {
                let view = mapView.dequeueReusableAnnotationView(
                    withIdentifier: Self.entityReuseID,
                    for: entity
                )
                view.annotation = entity
                let aviation = entity.entity.mode == .aviation
                let tone = entity.entity.is_alert
                    ? UIColor(red: 0.82, green: 0.35, blue: 0.33, alpha: 1)
                    : aviation
                        ? UIColor(red: 0.47, green: 0.66, blue: 0.73, alpha: 1)
                        : UIColor(red: 0.84, green: 0.65, blue: 0.42, alpha: 1)
                view.image = UIImage(systemName: aviation ? "airplane" : "ferry.fill")?
                    .withTintColor(tone, renderingMode: .alwaysOriginal)
                view.transform = aviation
                    ? CGAffineTransform(rotationAngle: CGFloat((entity.entity.heading ?? 0) - 45) * .pi / 180)
                    : .identity
                view.displayPriority = entity.entity.id == parent.selectedID || entity.entity.is_alert
                    ? .required
                    : .defaultLow
                view.collisionMode = .circle
                view.canShowCallout = false
                view.accessibilityLabel = "\(aviation ? "Aircraft" : "Vessel") \(entity.entity.display_name ?? entity.entity.entity_id)"
                return view
            }
            return nil
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            defer { mapView.deselectAnnotation(view.annotation, animated: false) }
            if let country = view.annotation as? TransportCountryAnnotation {
                parent.onSelectCountry(country.iso)
            } else if let entity = view.annotation as? TransportEntityAnnotation {
                parent.onSelect(entity.entity)
            }
        }

        @objc func handleMapTap(_ recognizer: UITapGestureRecognizer) {
            guard recognizer.state == .ended, let map = mapView else { return }
            let point = MKMapPoint(map.convert(recognizer.location(in: map), toCoordinateFrom: map))
            for overlay in map.overlays.reversed() {
                guard let polygon = overlay as? MKPolygon,
                      let iso = countryPolygons[ObjectIdentifier(polygon)],
                      let renderer = map.renderer(for: polygon) as? MKPolygonRenderer else { continue }
                if renderer.path == nil { renderer.createPath() }
                if renderer.path?.contains(renderer.point(for: point)) == true {
                    parent.onSelectCountry(iso)
                    return
                }
            }
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            var view: UIView? = touch.view
            while let current = view {
                if current is MKAnnotationView { return false }
                view = current.superview
            }
            return true
        }

        private func setViewport(on map: MKMapView, animated: Bool) {
            if let selectedID = parent.selectedID,
               let entity = parent.entities.first(where: { $0.id == selectedID }),
               let coordinate = coordinate(latitude: entity.latitude, longitude: entity.longitude) {
                map.setRegion(
                    MKCoordinateRegion(
                        center: coordinate,
                        span: MKCoordinateSpan(latitudeDelta: 22, longitudeDelta: 28)
                    ),
                    animated: animated
                )
                return
            }
            guard parent.viewport == .links else {
                map.setRegion(
                    MKCoordinateRegion(
                        center: CLLocationCoordinate2D(latitude: 15, longitude: 0),
                        span: MKCoordinateSpan(latitudeDelta: 145, longitudeDelta: 358)
                    ),
                    animated: animated
                )
                return
            }
            var coordinates: [CLLocationCoordinate2D] = []
            if let scope = parent.scopeCountry,
               let coordinate = CountryCentroidLookup.coordinate(for: scope) {
                coordinates.append(coordinate)
            }
            for connection in parent.connections {
                if let origin = CountryCentroidLookup.coordinate(for: connection.originCountry) {
                    coordinates.append(origin)
                }
                if let destination = CountryCentroidLookup.coordinate(for: connection.destinationCountry) {
                    coordinates.append(destination)
                }
            }
            guard !coordinates.isEmpty else {
                map.setRegion(
                    MKCoordinateRegion(
                        center: CLLocationCoordinate2D(latitude: 15, longitude: 0),
                        span: MKCoordinateSpan(latitudeDelta: 145, longitudeDelta: 358)
                    ),
                    animated: animated
                )
                return
            }
            let latitudes = coordinates.map(\.latitude)
            let longitudes = coordinates.map(\.longitude)
            guard let minLat = latitudes.min(), let maxLat = latitudes.max(),
                  let minLon = longitudes.min(), let maxLon = longitudes.max() else { return }
            map.setRegion(
                MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2),
                    span: MKCoordinateSpan(
                        latitudeDelta: min(145, max(18, (maxLat - minLat) * 1.35)),
                        longitudeDelta: min(350, max(24, (maxLon - minLon) * 1.35))
                    )
                ),
                animated: animated
            )
        }

        private func coordinate(latitude: Double?, longitude: Double?) -> CLLocationCoordinate2D? {
            guard let latitude, let longitude,
                  latitude.isFinite, longitude.isFinite,
                  abs(latitude) <= 90, abs(longitude) <= 180 else { return nil }
            return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        }

        private func curvedCoordinates(
            from start: CLLocationCoordinate2D,
            to end: CLLocationCoordinate2D
        ) -> [CLLocationCoordinate2D] {
            let longitudeDelta = normalizedLongitude(end.longitude - start.longitude)
            let midpointLongitude = normalizedLongitude(start.longitude + longitudeDelta / 2)
            let arc = min(16, max(2, abs(longitudeDelta) * 0.10))
            let midpointLatitude = min(82, max(-70, (start.latitude + end.latitude) / 2 + arc))
            return [
                start,
                CLLocationCoordinate2D(latitude: midpointLatitude, longitude: midpointLongitude),
                end
            ]
        }

        private func normalizedLongitude(_ value: CLLocationDegrees) -> CLLocationDegrees {
            var normalized = value
            while normalized > 180 { normalized -= 360 }
            while normalized < -180 { normalized += 360 }
            return normalized
        }
    }
}

private enum TransportOverlayStyle {
    case countryConnection(TransportMode, Int)
    case vehicleRoute(TransportMode, Bool)
    case sampledTrack
}

private final class TransportCountryAnnotation: NSObject, MKAnnotation {
    let iso: String
    let activeCount: Int
    let selected: Bool
    dynamic var coordinate: CLLocationCoordinate2D

    init(iso: String, coordinate: CLLocationCoordinate2D, activeCount: Int, selected: Bool) {
        self.iso = iso
        self.coordinate = coordinate
        self.activeCount = activeCount
        self.selected = selected
    }
}

private final class TransportEntityAnnotation: NSObject, MKAnnotation {
    let entity: TransportEntity
    let coordinate: CLLocationCoordinate2D

    init?(_ entity: TransportEntity) {
        guard let latitude = entity.latitude,
              let longitude = entity.longitude,
              latitude.isFinite,
              longitude.isFinite,
              abs(latitude) <= 90,
              abs(longitude) <= 180 else { return nil }
        self.entity = entity
        coordinate = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}
