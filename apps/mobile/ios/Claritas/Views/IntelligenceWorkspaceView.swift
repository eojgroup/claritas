import SwiftUI
import UIKit

struct IntelligenceWorkspaceView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var events: [IntelligenceEvent] = []
    @State private var selectedID: String?
    @State private var detail: IntelligenceEventDetail?
    @State private var watches: [IntelligenceWatch] = []
    @State private var alerts: [IntelligenceAlert] = []
    @State private var watchPending = false
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    BrandSectionHeader(
                        kicker: "Shared event graph",
                        title: "Intelligence events",
                        detail: "Cross-domain evidence with explicit confidence, provenance, and assessment boundaries."
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
        if let detail {
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

                if !detail.earth_observations.isEmpty {
                    BrandCard(title: "Observed context", icon: "sensor.tag.radiowaves.forward") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(alignment: .top, spacing: 10) {
                                ForEach(detail.earth_observations.prefix(5)) { observation in
                                    EarthObservationTile(observation: observation)
                                        .frame(width: 250)
                                }
                            }
                        }
                    }
                }

                BrandCard(title: "Evidence", icon: "square.stack.3d.up") {
                    ForEach(Array(Dictionary(grouping: detail.evidence, by: \.domain).keys.sorted()), id: \.self) { domain in
                        DisclosureGroup(domain.replacingOccurrences(of: "_", with: " ").uppercased()) {
                            ForEach(detail.evidence.filter { $0.domain == domain }) { item in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("\(item.evidence_type.replacingOccurrences(of: "_", with: " ")) · \(item.relationship.replacingOccurrences(of: "_", with: " "))")
                                        .font(.caption.weight(.semibold))
                                    Text("\(item.source_name ?? item.source_record_type) · \(Int(item.confidence * 100))% confidence")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                    if let attribution = item.attribution {
                                        Text("Attribution: \(attribution)")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .padding(.vertical, 6)
                            }
                        }
                        .font(.caption.weight(.semibold))
                        Divider()
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
                ProgressView().frame(maxWidth: .infinity, minHeight: 130)
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

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let eventRequest = model.api.fetchIntelligenceEvents(limit: 60, country: model.selectedCountry)
            async let watchRequest = model.api.fetchIntelligenceWatchlist()
            async let alertRequest = model.api.fetchIntelligenceAlerts()
            let (rows, nextWatches, nextAlerts) = try await (eventRequest, watchRequest, alertRequest)
            events = rows
            watches = nextWatches
            alerts = nextAlerts
            if let requested = model.selectedIntelligenceEventID,
               rows.contains(where: { $0.id == requested }) {
                selectedID = requested
                model.selectedIntelligenceEventID = nil
            }
            if selectedID == nil || !rows.contains(where: { $0.id == selectedID }) {
                selectedID = rows.first?.id
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadDetail() async {
        guard let selectedID else { detail = nil; return }
        do {
            detail = try await model.api.fetchIntelligenceEvent(id: selectedID)
        } catch {
            self.error = error.localizedDescription
        }
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
            async let watchRequest = model.api.fetchIntelligenceWatchlist()
            async let alertRequest = model.api.fetchIntelligenceAlerts()
            let (nextWatches, nextAlerts) = try await (watchRequest, alertRequest)
            watches = nextWatches
            alerts = nextAlerts
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
}

struct EarthObservationWorkspaceView: View {
    @EnvironmentObject private var model: AppModel
    @State private var observations: [EarthObservation] = []
    @State private var providers: [EarthProviderStatus] = []
    @State private var comparePosition = 0.5
    @State private var isLoading = false
    @State private var error: String?

    private var comparable: [EarthObservation] {
        Array(observations.filter { !$0.assets.isEmpty }.prefix(2))
    }

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    BrandSectionHeader(
                        kicker: "Governed observation layer",
                        title: "Earth observation",
                        detail: "Ranked scenes, bounded areas, explicit quality, and provider provenance."
                    )

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
                            EarthComparisonView(before: comparable[1], after: comparable[0], position: $comparePosition)
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

    var body: some View {
        if !events.isEmpty {
            BrandCard(title: "Correlated event pulse", icon: "dot.radiowaves.left.and.right") {
                ForEach(events.prefix(3)) { event in
                    HStack(alignment: .top) {
                        Circle()
                            .fill(event.severity == .critical ? Color.red : event.severity == .high ? Color.orange : Color.blue)
                            .frame(width: 7, height: 7)
                            .padding(.top, 5)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(event.title).font(.caption.weight(.semibold)).lineLimit(2)
                            Text("\(event.location_name ?? event.primary_country_iso2 ?? "Global") · \(event.evidence_count) evidence")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    if event.id != events.prefix(3).last?.id { Divider() }
                }
            }
            .task { events = (try? await model.api.fetchIntelligenceEvents(limit: 3, country: model.selectedCountry)) ?? [] }
        } else {
            Color.clear.frame(height: 0)
                .task { events = (try? await model.api.fetchIntelligenceEvents(limit: 3, country: model.selectedCountry)) ?? [] }
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

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.secondary.opacity(0.08))
            }
        }
        .task(id: path) {
            guard let data = try? await model.api.fetchEarthAsset(path: path) else { return }
            image = UIImage(data: data)
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
