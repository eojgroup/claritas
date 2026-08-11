import SwiftUI
import UIKit

struct IntelligenceWorkspaceView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var events: [IntelligenceEvent] = []
    @State private var selectedID: String?
    @State private var detail: IntelligenceEventDetail?
    @State private var gibsContext: GibsEventContext?
    @State private var watches: [IntelligenceWatch] = []
    @State private var alerts: [IntelligenceAlert] = []
    @State private var watchPending = false
    @State private var isLoading = false
    @State private var detailLoading = false
    @State private var error: String?
    @State private var detailError: String?

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    BrandSectionHeader(
                        kicker: "One event · every evidence lens",
                        title: "Signal desk",
                        detail: "Follow a development from first report through physical observation, operational effects, market response, and assessed meaning."
                    )

                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(.red)
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.red.opacity(0.09), in: RoundedRectangle(cornerRadius: 14))
                    }

                    if !alerts.isEmpty {
                        BrandCard(title: "Watchlist alerts", icon: "bell.badge") {
                            ForEach(alerts.prefix(6)) { alert in
                                Button {
                                    Task { await open(alert) }
                                } label: {
                                    HStack(alignment: .top, spacing: 9) {
                                        Circle()
                                            .fill(alert.severity == .critical ? Color.red : Color.orange)
                                            .frame(width: 7, height: 7)
                                            .padding(.top, 5)
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(alert.title).font(.caption.weight(.semibold)).foregroundStyle(.primary)
                                            Text(alert.location_name ?? alert.primary_country_iso2 ?? "Global")
                                                .font(.caption2).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                if alert.id != alerts.prefix(6).last?.id { Divider() }
                            }
                        }
                    }

                    if isLoading && events.isEmpty {
                        ProgressView("Loading correlated events")
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else if events.isEmpty {
                        emptyState
                    } else {
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .top, spacing: 14) {
                                eventList.frame(width: 330)
                                eventDetail.frame(maxWidth: .infinity)
                            }
                            VStack(spacing: 14) {
                                eventList
                                eventDetail
                            }
                        }
                    }
                }
                .padding()
            }
            .refreshable { await load() }
        }
        .task { await load() }
        .task(id: selectedID) { await loadDetail() }
        .task(id: selectedID) { await loadGibsContext() }
        .onChange(of: model.selectedIntelligenceEventID) { requested in
            guard let requested, !requested.isEmpty else { return }
            selectedID = requested
            model.selectedIntelligenceEventID = nil
        }
    }

    private var eventList: some View {
        BrandCard(title: "Prioritized stream", icon: "dot.radiowaves.left.and.right") {
            LazyVStack(spacing: 0) {
                ForEach(events) { event in
                    Button {
                        selectedID = event.id
                    } label: {
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Text(event.event_type.replacingOccurrences(of: "_", with: " ").uppercased())
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                Spacer()
                                severityBadge(event.severity)
                            }
                            Text(event.title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.primary)
                                .multilineTextAlignment(.leading)
                            HStack(spacing: 8) {
                                Label(event.location_name ?? event.primary_country_iso2 ?? "Global", systemImage: "mappin")
                                Text("\(event.evidence_count) evidence")
                            }
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 11)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if event.id != events.last?.id { Divider() }
                }
            }
        }
    }

    @ViewBuilder
    private var eventDetail: some View {
        if detailLoading {
            BrandCard(title: "Event detail", icon: "scope") {
                ProgressView("Loading evidence thread")
                    .frame(maxWidth: .infinity, minHeight: 130)
            }
        } else if let detailError {
            BrandCard(title: "Event detail unavailable", icon: "exclamationmark.triangle") {
                Text(detailError)
                    .font(.caption)
                    .foregroundStyle(.red)
                Button("Retry event") { Task { await loadDetail() } }
                    .buttonStyle(.bordered)
            }
        } else if let detail, detail.event.id == selectedID {
            VStack(alignment: .leading, spacing: 14) {
                BrandCard(title: "Assessment", icon: "scope") {
                    HStack(spacing: 8) {
                        severityBadge(detail.event.severity)
                        Text(detail.event.status.uppercased())
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text("\(Int(detail.event.confidence * 100))% confidence")
                            .font(.caption.monospacedDigit())
                    }
                    Text(detail.event.title)
                        .font(.title3.weight(.semibold))
                    Text(detail.event.summary)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if watchTarget != nil {
                        Button {
                            Task { await toggleWatch() }
                        } label: {
                            Label(activeWatch == nil ? "Watch this scope" : "Stop watching", systemImage: activeWatch == nil ? "bell" : "bell.slash")
                        }
                        .buttonStyle(.bordered)
                        .disabled(watchPending)
                    }
                    HStack {
                        score("Relevance", detail.event.relevance_score)
                        score("Urgency", detail.event.urgency_score)
                        score("Materiality", detail.event.materiality_score)
                    }
                }

                BrandCard(title: "Satellite context", icon: "sensor.tag.radiowaves.forward") {
                    Text("Event-scoped imagery can show physical conditions at this area of interest. It is context—not automatic proof of a report or its cause.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if let layer = gibsTrueColorLayer {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("CONTEXT · NOT PROOF")
                                    .font(.caption2.weight(.bold))
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 4)
                                    .background(.secondary.opacity(0.12), in: Capsule())
                                Spacer()
                                Text(layer.date).font(.caption2).foregroundStyle(.secondary)
                            }
                            if let previewURL = URL(string: layer.preview_url) {
                                AsyncImage(url: previewURL) { phase in
                                    switch phase {
                                    case .empty:
                                        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                                    case .success(let image):
                                        image.resizable().scaledToFill()
                                    default:
                                        Label("NASA context preview unavailable", systemImage: "photo.badge.exclamationmark")
                                            .font(.caption)
                                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                                    }
                                }
                                .frame(height: 180)
                                .background(.secondary.opacity(0.08))
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                            Text(layer.title).font(.caption.weight(.semibold))
                            Text(gibsContext?.notice ?? "NASA GIBS browse imagery provides context and is not proof of physical change or causation.")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            if let sourceURL = URL(string: layer.provenance.source_url) {
                                Link("NASA GIBS provenance", destination: sourceURL)
                                    .font(.caption2.weight(.semibold))
                            }
                            Text(layer.provenance.attribution)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .padding(10)
                        .background(.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                    }

                    if !detail.earth_observations.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(alignment: .top, spacing: 10) {
                                ForEach(detail.earth_observations.prefix(5)) { observation in
                                    EarthObservationTile(observation: observation)
                                        .frame(width: 250)
                                }
                            }
                        }
                    } else {
                        Label("No defensible event-specific observation is available yet", systemImage: "photo.badge.exclamationmark")
                            .font(.subheadline.weight(.semibold))
                        Text("The evidence thread remains usable without imagery. Claritas never substitutes a scene from an unrelated event or location.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                BrandCard(title: "Evidence thread", icon: "point.topleft.down.to.point.bottomright.curvepath") {
                    ForEach(detail.evidence.sorted { $0.observed_at < $1.observed_at }) { item in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: evidenceIcon(item.relationship))
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                                .frame(width: 22, height: 22)
                                .background(ClaritasPalette.dataBlue(for: colorScheme).opacity(0.12), in: Circle())
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(evidenceLabel(item.relationship).uppercased())
                                        .font(.caption2.weight(.bold))
                                    Text(item.domain.replacingOccurrences(of: "_", with: " ").uppercased())
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                    Spacer()
                                    Text(item.observed_at.formatted(date: .abbreviated, time: .shortened))
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                Text(item.source_title ?? item.evidence_type.replacingOccurrences(of: "_", with: " ").capitalized)
                                    .font(.caption.weight(.semibold))
                                if let summary = item.source_summary, !summary.isEmpty {
                                    Text(summary).font(.caption2).foregroundStyle(.secondary).lineLimit(3)
                                }
                                Text("\(item.source_name ?? item.source_record_type) · \(Int(item.confidence * 100))% confidence")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                if let attribution = item.attribution, !attribution.isEmpty {
                                    Text("Attribution: \(attribution)")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                if let license = item.license, !license.isEmpty {
                                    Text("License: \(license)")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                if let source = item.source_url, let url = URL(string: source) {
                                    Link("Open source record", destination: url).font(.caption2.weight(.semibold))
                                }
                            }
                        }
                        .padding(.vertical, 6)
                        if item.id != detail.evidence.sorted(by: { $0.observed_at < $1.observed_at }).last?.id { Divider() }
                    }
                }

                if !detail.locations.isEmpty {
                    BrandCard(title: "Affected locations", icon: "mappin.and.ellipse") {
                        ForEach(detail.locations) { location in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(location.canonical_name)
                                    .font(.subheadline.weight(.semibold))
                                Text("\(location.relationship.replacingOccurrences(of: "_", with: " ").capitalized) · \(location.location_type.replacingOccurrences(of: "_", with: " ")) · \(Int(location.confidence * 100))% confidence")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                if let attribution = location.attribution, !attribution.isEmpty {
                                    Text(attribution)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            if location.id != detail.locations.last?.id { Divider() }
                        }
                    }
                }

                if !detail.related_events.isEmpty {
                    BrandCard(title: "Related investigations", icon: "point.3.connected.trianglepath.dotted") {
                        Text("Relationships are qualified context, not asserted causation.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        ForEach(detail.related_events) { event in
                            Button { selectedID = event.id } label: {
                                HStack(alignment: .top, spacing: 9) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(event.relationship.replacingOccurrences(of: "_", with: " ").uppercased())
                                            .font(.caption2.weight(.bold))
                                            .foregroundStyle(.secondary)
                                        Text(event.title)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(.primary)
                                        Text("\(Int(event.confidence * 100))% relationship confidence · \(Int(event.relevance_score * 100))% relevance")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                        if let rationale = event.rationale, !rationale.isEmpty {
                                            Text(rationale).font(.caption2).foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer()
                                    severityBadge(event.severity)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            if event.id != detail.related_events.last?.id { Divider() }
                        }
                    }
                }

                Label(detail.epistemic_notice, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding()
                    .background(.orange.opacity(colorScheme == .dark ? 0.13 : 0.09), in: RoundedRectangle(cornerRadius: 14))
            }
        } else {
            BrandCard(title: "Event detail", icon: "scope") {
                Text("Select an event to inspect its evidence thread.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 130)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 9) {
            Image(systemName: "dot.radiowaves.left.and.right")
                .font(.title)
            Text("No material correlated events")
                .font(.headline)
            Text("Source dashboards remain available while the event graph waits for defensible evidence.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 190)
        .padding()
    }

    private var gibsTrueColorLayer: GibsEventLayer? {
        gibsContext?.layers.first {
            $0.category == "true_color" && URL(string: $0.preview_url) != nil
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        let watchTask = Task { try? await model.api.fetchIntelligenceWatchlist() }
        let alertTask = Task { try? await model.api.fetchIntelligenceAlerts() }
        do {
            let rows = try await model.api.fetchIntelligenceEvents(limit: 60, country: model.selectedCountry)
            events = rows
            if let requested = model.selectedIntelligenceEventID {
                selectedID = requested
                model.selectedIntelligenceEventID = nil
            } else if selectedID == nil {
                selectedID = rows.first?.id
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        if let nextWatches = await watchTask.value { watches = nextWatches }
        if let nextAlerts = await alertTask.value { alerts = nextAlerts }
    }

    private func loadDetail() async {
        guard let selectedID else {
            detail = nil
            detailError = nil
            detailLoading = false
            return
        }
        detail = nil
        detailError = nil
        detailLoading = true
        defer {
            if self.selectedID == selectedID { detailLoading = false }
        }
        do {
            let loaded = try await model.api.fetchIntelligenceEvent(id: selectedID)
            guard self.selectedID == selectedID else { return }
            detail = loaded
            if !events.contains(where: { $0.id == loaded.event.id }) {
                events.insert(loaded.event, at: 0)
            }
        } catch {
            guard self.selectedID == selectedID else { return }
            detail = nil
            detailError = error.localizedDescription
        }
    }

    private func loadGibsContext() async {
        guard let selectedID else {
            gibsContext = nil
            return
        }
        gibsContext = nil
        let loaded = try? await model.api.fetchEventGibsContext(id: selectedID)
        guard self.selectedID == selectedID else { return }
        gibsContext = loaded
    }

    private var watchTarget: (type: String, key: String)? {
        guard let event = detail?.event else { return nil }
        if let country = event.primary_country_iso2 { return ("country", country) }
        return ("event_type", event.event_type)
    }

    private var activeWatch: IntelligenceWatch? {
        guard let target = watchTarget else { return nil }
        return watches.first { $0.watch_type == target.type && $0.watch_key == target.key }
    }

    private func toggleWatch() async {
        guard let target = watchTarget, !watchPending else { return }
        watchPending = true
        defer { watchPending = false }
        do {
            if let activeWatch { try await model.api.deleteIntelligenceWatch(id: activeWatch.id) }
            else { _ = try await model.api.saveIntelligenceWatch(type: target.type, key: target.key) }
            watches = try await model.api.fetchIntelligenceWatchlist()
            if let nextAlerts = try? await model.api.fetchIntelligenceAlerts() { alerts = nextAlerts }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func open(_ alert: IntelligenceAlert) async {
        selectedID = alert.event_id
        do {
            try await model.api.acknowledgeIntelligenceAlert(id: alert.id)
            alerts.removeAll { $0.id == alert.id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func score(_ label: String, _ value: Double) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text("\(Int(value * 100))%").font(.headline.monospacedDigit())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func severityBadge(_ severity: IntelligenceSeverity) -> some View {
        Text(severity.rawValue.uppercased())
            .font(.system(size: 9, weight: .bold))
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .foregroundStyle(severity == .critical ? Color.red : severity == .high ? Color.orange : Color.secondary)
            .background((severity == .critical ? Color.red : severity == .high ? Color.orange : Color.secondary).opacity(0.12), in: Capsule())
    }

    private func evidenceLabel(_ relationship: String) -> String {
        switch relationship {
        case "reported": return "Reported"
        case "observed": return "Observed"
        case "corroborates": return "Corroborates"
        case "derived": return "Derived"
        case "model_interpretation": return "Model interpretation"
        case "assessment": return "Assessment"
        case "contradicts": return "Contradicts"
        default: return "Context"
        }
    }

    private func evidenceIcon(_ relationship: String) -> String {
        switch relationship {
        case "reported": return "newspaper"
        case "observed", "corroborates": return "sensor.tag.radiowaves.forward"
        case "derived": return "function"
        case "model_interpretation": return "sparkles"
        case "assessment": return "scope"
        case "contradicts": return "exclamationmark.triangle"
        default: return "link"
        }
    }
}

struct EarthObservationWorkspaceView: View {
    @EnvironmentObject private var model: AppModel
    @State private var observations: [EarthObservation] = []
    @State private var providers: [EarthProviderStatus] = []
    @State private var comparePosition = 0.5
    @State private var isLoading = false
    @State private var error: String?

    private var comparable: [EarthObservation] {
        let candidates = observations.filter { !$0.assets.isEmpty && $0.event_id != nil }
        for after in candidates {
            if let before = candidates.first(where: {
                $0.id != after.id
                    && $0.event_id == after.event_id
                    && $0.location_id == after.location_id
                    && $0.provider == after.provider
                    && $0.product_type == after.product_type
                    && $0.capture_start < after.capture_start
            }) {
                return [before, after]
            }
        }
        return []
    }

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    BrandSectionHeader(
                        kicker: "Source lens · global catalogue",
                        title: "Imagery library",
                        detail: "Browse governed acquisitions here. Open Signal desk to understand why an image matters to a specific event."
                    )

                    IntelligenceEventPulseView()

                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(providers) { provider in
                                VStack(alignment: .leading, spacing: 5) {
                                    HStack {
                                        Text(provider.provider.replacingOccurrences(of: "_", with: " ").capitalized)
                                            .font(.caption.weight(.semibold))
                                        Spacer()
                                        Text(provider.state.replacingOccurrences(of: "_", with: " ").uppercased())
                                            .font(.system(size: 8, weight: .bold))
                                    }
                                    Text(provider.reason ?? provider.attribution)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                                .padding(12)
                                .frame(width: 245, height: 88, alignment: .topLeading)
                                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
                            }
                        }
                    }

                    if comparable.count == 2 {
                        BrandCard(title: "Acquisition comparison", icon: "slider.horizontal.below.rectangle") {
                            EarthComparisonView(before: comparable[0], after: comparable[1], position: $comparePosition)
                                .frame(height: 260)
                            Slider(value: $comparePosition, in: 0...1)
                                .accessibilityLabel("Before and after comparison position")
                            Text("Sensor, season, cloud, and viewing geometry can resemble physical change. Visual differences are contextual evidence, not automatic proof of cause.")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if isLoading && observations.isEmpty {
                        ProgressView("Loading observations")
                            .frame(maxWidth: .infinity, minHeight: 150)
                    } else if observations.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "photo.badge.exclamationmark")
                            Text("No observation assets in this scope").font(.headline)
                            Text("Core intelligence remains available while optional providers are disabled or waiting for a suitable scene.")
                                .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity, minHeight: 170)
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 245), spacing: 12)], spacing: 12) {
                            ForEach(observations) { EarthObservationTile(observation: $0) }
                        }
                    }
                }
                .padding()
            }
            .refreshable { await load() }
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let result = try await model.api.fetchEarthObservations(limit: 60)
            observations = result.observations
            providers = result.providers
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct IntelligenceEventPulseView: View {
    @EnvironmentObject private var model: AppModel
    @State private var events: [IntelligenceEvent] = []
    @State private var isLoading = true

    var body: some View {
        Group {
            if isLoading {
                BrandCard(title: "Correlated event pulse", icon: "dot.radiowaves.left.and.right") {
                    ProgressView("Loading linked events")
                        .font(.caption)
                        .frame(maxWidth: .infinity, minHeight: 46)
                }
            } else if !events.isEmpty {
                BrandCard(title: "Correlated event pulse", icon: "dot.radiowaves.left.and.right") {
                    ForEach(events.prefix(3)) { event in
                        Button {
                            model.selectedIntelligenceEventID = event.id
                            NotificationCenter.default.post(
                                name: .claritasWatchOpenDestination,
                                object: "intelligence",
                                userInfo: ["eventID": event.id]
                            )
                        } label: {
                            HStack(alignment: .top) {
                                Circle()
                                    .fill(event.severity == .critical ? Color.red : event.severity == .high ? Color.orange : Color.blue)
                                    .frame(width: 7, height: 7)
                                    .padding(.top, 5)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(event.title).font(.caption.weight(.semibold)).lineLimit(2)
                                    Text("\(event.location_name ?? event.primary_country_iso2 ?? "Global") · \(event.domain_count) lenses · \(event.evidence_count) evidence")
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if event.id != events.prefix(3).last?.id { Divider() }
                    }
                }
            } else {
                Color.clear.frame(height: 0)
            }
        }
        .task(id: model.selectedCountry) {
            isLoading = true
            events = (try? await model.api.fetchIntelligenceEvents(limit: 3, country: model.selectedCountry)) ?? []
            isLoading = false
        }
    }
}

private struct EarthObservationTile: View {
    @EnvironmentObject private var model: AppModel
    let observation: EarthObservation

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if let asset = observation.assets.first {
                AuthenticatedEarthImage(path: asset.url)
                    .frame(height: 145)
                    .clipShape(RoundedRectangle(cornerRadius: 11))
            } else {
                Image(systemName: "photo.badge.exclamationmark")
                    .frame(maxWidth: .infinity, minHeight: 145)
                    .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 11))
            }
            Text(observation.location_name ?? "Monitored area").font(.subheadline.weight(.semibold))
            Text("\(observation.product_type.replacingOccurrences(of: "_", with: " ").capitalized) · \(observation.mission)")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Text(observation.capture_start.formatted(date: .abbreviated, time: .shortened))
                Spacer()
                if let cloud = observation.cloud_cover { Text("\(Int(cloud))% cloud") }
            }
            .font(.caption2).foregroundStyle(.secondary)
            if let url = URL(string: observation.source_url) {
                Link("Provider provenance", destination: url).font(.caption.weight(.semibold))
            }
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct EarthComparisonView: View {
    let before: EarthObservation
    let after: EarthObservation
    @Binding var position: Double

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                AuthenticatedEarthImage(path: before.assets[0].url)
                    .frame(width: geometry.size.width, height: geometry.size.height)
                AuthenticatedEarthImage(path: after.assets[0].url)
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .frame(width: geometry.size.width * position, alignment: .leading)
                    .clipped()
                Rectangle().fill(.white).frame(width: 2).offset(x: geometry.size.width * position)
                VStack {
                    Spacer()
                    HStack {
                        Text("After").padding(6).background(.black.opacity(0.65), in: Capsule())
                        Spacer()
                        Text("Before").padding(6).background(.black.opacity(0.65), in: Capsule())
                    }
                    .font(.caption2.weight(.bold)).foregroundStyle(.white).padding(8)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }
}

private struct AuthenticatedEarthImage: View {
    @EnvironmentObject private var model: AppModel
    let path: String
    @State private var image: UIImage?
    @State private var loadError: String?
    @State private var retryID = 0

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else if let loadError {
                VStack(spacing: 8) {
                    Label("Observation image unavailable", systemImage: "photo.badge.exclamationmark")
                        .font(.caption.weight(.semibold))
                    Text(loadError)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                    Button("Retry image") { retryID += 1 }
                        .buttonStyle(.bordered)
                        .font(.caption)
                }
                .padding(12)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.secondary.opacity(0.08))
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.secondary.opacity(0.08))
            }
        }
        .task(id: "\(path)-\(retryID)") {
            image = nil
            loadError = nil
            do {
                let data = try await model.api.fetchEarthAsset(path: path)
                guard let decoded = UIImage(data: data) else {
                    loadError = "The returned asset is not a supported image."
                    return
                }
                image = decoded
            } catch {
                loadError = error.localizedDescription
            }
        }
    }
}

struct AdminIntelligenceOperationsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var status: AdminIntelligenceStatus?
    @State private var isLoading = false
    @State private var runningProvider: String?
    @State private var error: String?

    private var providerStatuses: [EarthProviderStatus] {
        var seen = Set<String>()
        return ((status?.rapid_sources ?? []) + (status?.earth_observation.providers ?? []))
            .filter { seen.insert($0.provider).inserted }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            BrandCard(title: "Event and Earth Observation", icon: "dot.radiowaves.left.and.right") {
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.red)
                }
                HStack {
                    adminMetric("Outbox", status?.backbone.outbox.reduce(0) { $0 + $1.count } ?? 0)
                    adminMetric("Dead letters", status?.backbone.unresolved_dead_letters ?? 0)
                    adminMetric("Assets", status?.earth_observation.assets.count ?? 0)
                    adminMetric("Alerts", status?.alert_candidates.count ?? 0)
                }
                ForEach(providerStatuses) { provider in
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(provider.provider.replacingOccurrences(of: "_", with: " ").capitalized)
                                .font(.subheadline.weight(.semibold))
                            Text(provider.last_error ?? provider.reason ?? provider.attribution)
                                .font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                        }
                        Spacer()
                        Text(provider.state.replacingOccurrences(of: "_", with: " ").uppercased())
                            .font(.system(size: 9, weight: .bold)).foregroundStyle(.secondary)
                    }
                    Divider()
                }
                HStack {
                    ForEach(["usgs", "nasa-firms"], id: \.self) { provider in
                        Button {
                            Task { await run(provider) }
                        } label: {
                            Label("Run \(provider)", systemImage: "play.fill")
                        }
                        .buttonStyle(.bordered)
                        .disabled(runningProvider != nil)
                    }
                    Spacer()
                    Button { Task { await load() } } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Refresh event operations")
                }
            }

            if let failed = status?.earth_observation.recent_jobs.filter({ ["failed", "dead_letter", "budget_deferred"].contains($0.status) }), !failed.isEmpty {
                BrandCard(title: "Failed jobs", icon: "exclamationmark.arrow.triangle.2.circlepath") {
                    ForEach(failed.prefix(10)) { job in
                        VStack(alignment: .leading, spacing: 3) {
                            Text("\(job.job_type.replacingOccurrences(of: "_", with: " ")) · \(job.status.replacingOccurrences(of: "_", with: " "))")
                                .font(.caption.weight(.semibold))
                            Text("\(job.location_name ?? "No location") · attempt \(job.attempts)/\(job.max_attempts)")
                                .font(.caption2).foregroundStyle(.secondary)
                            if let lastError = job.last_error {
                                Text(lastError).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                        Divider()
                    }
                }
            }
        }
        .task { await load() }
        .overlay { if isLoading && status == nil { ProgressView() } }
    }

    private func adminMetric(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text("\(value)").font(.headline.monospacedDigit())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do { status = try await model.api.fetchAdminIntelligenceStatus(); error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func run(_ provider: String) async {
        runningProvider = provider
        defer { runningProvider = nil }
        do { try await model.api.runIntelligenceProvider(provider); await load() }
        catch { self.error = error.localizedDescription }
    }
}
