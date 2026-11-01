import SwiftUI
import UIKit

struct IntelligenceWorkspaceView: View {
    /// A selected story stays beside the world map instead of opening another workspace.
    var contextualEventID: String? = nil
    var onOpenEvent: ((IntelligenceEvent) -> Void)? = nil
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
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
    @State private var includeExpired = false
    @State private var showsCompactDetail = false
    @State private var evidenceFilter: String?
    @State private var evidenceFilterEventID: String?
    @State private var evidenceNavigationID = UUID()
    @State private var detailScrollTarget = "investigation-evidence"

    var body: some View {
        BrandBackground {
            if contextualEventID != nil {
                detailScrollView
                    .refreshable {
                        await loadDetail()
                        await loadGibsContext()
                    }
            } else if horizontalSizeClass == .regular && onOpenEvent == nil {
                regularWorkspace
            } else {
                compactWorkspace
            }
        }
        .task(id: "\(includeExpired)|\(model.selectedCountry ?? "global")") {
            guard contextualEventID == nil else { return }
            await load()
        }
        .task(id: contextualEventID) {
            guard let contextualEventID else { return }
            selectEvent(contextualEventID, revealDetail: false)
            if let nextWatches = try? await model.api.fetchIntelligenceWatchlist(), !Task.isCancelled { watches = nextWatches }
        }
        .task(id: selectedID) { await loadDetail() }
        .task(id: selectedID) { await loadGibsContext() }
        .navigationDestination(isPresented: $showsCompactDetail) {
            BrandBackground {
                detailScrollView
                .refreshable {
                    await loadDetail()
                    await loadGibsContext()
                }
            }
            .navigationTitle(detail?.event.event_type.replacingOccurrences(of: "_", with: " ").capitalized ?? "Investigation")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onChange(of: model.selectedIntelligenceEventID) { requested in
            guard contextualEventID == nil, onOpenEvent == nil else { return }
            guard let requested, !requested.isEmpty else { return }
            selectEvent(requested, revealDetail: true)
            model.selectedIntelligenceEventID = nil
        }
        .onChange(of: horizontalSizeClass) { next in
            guard contextualEventID == nil, onOpenEvent == nil else { return }
            if next == .regular {
                showsCompactDetail = false
                if selectedID == nil { selectedID = events.first?.id }
            }
        }
    }

    private var detailScrollView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                eventDetail.padding(14)
            }
            .onChange(of: evidenceNavigationID) { _ in
                withAnimation { proxy.scrollTo(detailScrollTarget, anchor: .top) }
            }
            .onChange(of: detail?.event.id) { _ in
                proxy.scrollTo("investigation-overview", anchor: .top)
            }
        }
    }

    private var compactWorkspace: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                workspaceHeader
                if onOpenEvent == nil { alertsCard }
                eventCollection
            }
            .padding(14)
        }
        .refreshable { await load() }
    }

    private var regularWorkspace: some View {
        GeometryReader { proxy in
            HStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        workspaceHeader
                        alertsCard
                        eventCollection
                    }
                    .padding(16)
                }
                .frame(width: min(max(proxy.size.width * 0.34, 340), 430))
                .refreshable { await load() }

                Divider()

                detailScrollView
                .frame(maxWidth: .infinity)
                .refreshable {
                    await loadDetail()
                    await loadGibsContext()
                }
            }
        }
    }

    private var workspaceHeader: some View {
        VStack(alignment: .leading, spacing: 14) {
            BrandSectionHeader(
                kicker: "Every source · one event stream",
                title: "What’s happening",
                detail: horizontalSizeClass == .compact
                    ? nil
                    : "Follow a developing event from its location to the reporting, observations and imagery behind it."
            )

            Picker("Event visibility", selection: $includeExpired) {
                Text("Current").tag(false)
                Text("Archive").tag(true)
            }
            .pickerStyle(.segmented)
            .accessibilityHint("Current hides events after their visibility window. Archive includes expired events.")

            if let error {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.red.opacity(0.09), in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }

    @ViewBuilder
    private var alertsCard: some View {
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
                            Image(systemName: "chevron.right")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        }
                        .frame(maxWidth: .infinity, minHeight: ClaritasLayout.minimumTouchTarget, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if alert.id != alerts.prefix(6).last?.id { Divider() }
                }
            }
        }
    }

    @ViewBuilder
    private var eventCollection: some View {
        if isLoading && events.isEmpty {
            ProgressView("Loading priority events")
                .frame(maxWidth: .infinity, minHeight: 160)
        } else if events.isEmpty {
            emptyState
        } else {
            eventList
        }
    }

    private var eventList: some View {
        BrandCard(title: "Priority events", icon: "dot.radiowaves.left.and.right") {
            VStack(alignment: .leading, spacing: 10) {
                LazyVStack(spacing: 6) {
                    ForEach(events) { event in
                        let isSelected = event.id == selectedID
                        Button {
                            if let onOpenEvent { onOpenEvent(event) }
                            else { selectEvent(event.id, revealDetail: true) }
                        } label: {
                            HStack(alignment: .top, spacing: 10) {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(isSelected ? ClaritasPalette.shellAccent(for: colorScheme) : Color.clear)
                                    .frame(width: 4)
                                    .padding(.vertical, 2)

                                VStack(alignment: .leading, spacing: 7) {
                                    HStack {
                                        Label(event.originLabel.uppercased(), systemImage: event.originIcon)
                                            .font(.caption2.weight(.bold))
                                            .tracking(isSelected ? 0.7 : 0)
                                            .foregroundStyle(isSelected ? ClaritasPalette.shellAccent(for: colorScheme) : ClaritasPalette.shellMuted(for: colorScheme))
                                        Spacer()
                                        severityBadge(event.severity)
                                    }
                                    Text(event.title)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                                        .multilineTextAlignment(.leading)
                                        .lineLimit(horizontalSizeClass == .compact ? 2 : nil)
                                    HStack(spacing: 6) {
                                        Text(event.primary_country_iso2 ?? event.location_name ?? "Global")
                                        Text("· \(event.evidence_count) linked records")
                                        Spacer(minLength: 0)
                                        Text(event.last_activity_time, style: .time)
                                    }
                                    .font(.caption2)
                                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                    if event.freshness_state == "expired" {
                                        Text("Expired")
                                            .font(.caption2)
                                            .foregroundStyle(ClaritasPalette.negativeText(for: colorScheme))
                                    }
                                }
                            }
                            .padding(11)
                            .frame(maxWidth: .infinity, minHeight: ClaritasLayout.minimumTouchTarget, alignment: .leading)
                            .background(
                                isSelected ? ClaritasPalette.shellHighlight(for: colorScheme) : Color.clear,
                                in: RoundedRectangle(cornerRadius: 12)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(
                                        isSelected ? ClaritasPalette.shellAccent(for: colorScheme).opacity(0.48) : Color.clear,
                                        lineWidth: 1
                                    )
                            )
                            .contentShape(RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(isSelected ? "Active investigation" : "Open investigation"): \(event.title)")
                        .accessibilityValue(isSelected ? "Selected" : "Not selected")
                        .accessibilityAddTraits(isSelected ? .isSelected : [])
                    }
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
                Color.clear.frame(height: 0).id("investigation-overview")
                BrandCard(title: "What’s happening", icon: "scope") {
                    Label("STARTED FROM \(detail.event.originLabel.uppercased())", systemImage: detail.event.originIcon)
                        .font(.caption2.weight(.bold))
                        .tracking(0.9)
                        .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
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
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Started \(detail.event.start_time.formatted(date: .abbreviated, time: .standard))")
                        Text("Updated \(detail.event.last_activity_time.formatted(date: .abbreviated, time: .standard))")
                        if let expiresAt = detail.event.expires_at {
                            Text("\(detail.event.freshness_state == "expired" ? "Expired" : "Current until") \(expiresAt.formatted(date: .abbreviated, time: .standard))")
                                .foregroundStyle(detail.event.freshness_state == "expired" ? ClaritasPalette.negativeText(for: colorScheme) : ClaritasPalette.shellMuted(for: colorScheme))
                        }
                    }
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 10) {
                        eventUnderstandingRow(
                            label: "What happened",
                            icon: "text.alignleft",
                            text: detail.understanding?.what_happened ?? detail.event.summary
                        )
                        eventUnderstandingRow(
                            label: "Where",
                            icon: "mappin.and.ellipse",
                            text: detail.understanding?.location
                                ?? detail.event.location_name
                                ?? detail.event.primary_country_iso2
                                ?? "Location not yet resolved"
                        )
                        eventUnderstandingRow(
                            label: "Why it matters",
                            icon: "sparkles",
                            text: (detail.event.priority_reasons?.isEmpty == false ? detail.event.priority_reasons?.joined(separator: " · ") : nil)
                                ?? detail.understanding?.why_interesting
                                ?? "Claritas prioritised this event from its severity, relevance, recency, and linked evidence. Correlation does not establish causation."
                        )
                    }
                    if watchTarget != nil {
                        HStack {
                            Button {
                                Task { await toggleWatch() }
                            } label: {
                                Label(activeWatch == nil ? "Watch this scope" : "Stop watching", systemImage: activeWatch == nil ? "bell" : "bell.slash")
                            }
                            .buttonStyle(.bordered)
                            .disabled(watchPending)
                            if activeWatch != nil {
                                Button {
                                    Task { await toggleWatchEmail() }
                                } label: {
                                    Label(watchEmailEnabled ? "Email alerts on" : "Email alerts off", systemImage: "envelope")
                                }
                                .buttonStyle(.bordered)
                                .tint(watchEmailEnabled ? ClaritasPalette.shellAccentSecondary(for: colorScheme) : nil)
                                .disabled(watchPending)
                            }
                        }
                        if activeWatch != nil {
                            Text("Email delivery requires a verified account email and email delivery enabled in your briefing profile.")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    HStack {
                        score("Relevance", detail.event.relevance_score)
                        score("Urgency", detail.event.urgency_score)
                        score("Materiality", detail.event.materiality_score)
                    }
                }

                if !detail.earth_observations.isEmpty || gibsTrueColorLayer != nil {
                    BrandCard(title: "Event imagery", icon: "sensor.tag.radiowaves.forward") {
                        Text("Visual context for this event: \(detail.event.title)")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                        Text("Images stay with the selected event so their location and evidence status remain clear. They provide context, not automatic proof of a report or its cause.")
                            .font(.caption)
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))

                        if let observation = detail.earth_observations.sortedForDisplay.first(where: { $0.preferredDisplayAsset != nil }) {
                            VStack(alignment: .leading, spacing: 9) {
                                EventImageryHero(observation: observation)
                                Label("EVENT-SPECIFIC OBSERVATION", systemImage: "checkmark.seal")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(ClaritasPalette.positiveText(for: colorScheme))
                                Text("Linked to this event and its mapped area · \(observation.displayProductName) captured \(observation.capture_start.formatted(date: .abbreviated, time: .shortened)).")
                                    .font(.caption)
                                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                if let interpretation = observation.model_interpretation?.summary, !interpretation.isEmpty {
                                    Text(interpretation)
                                        .font(.caption2)
                                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                        .lineLimit(3)
                                }
                            }

                            let additionalObservations = Array(detail.earth_observations.sortedForDisplay
                                .filter { $0.preferredDisplayAsset != nil }
                                .dropFirst()
                                .prefix(4))
                            if !additionalObservations.isEmpty {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("MORE OBSERVATIONS FOR THIS EVENT")
                                        .font(.caption2.weight(.bold))
                                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                    ScrollView(.horizontal, showsIndicators: false) {
                                        HStack(alignment: .top, spacing: 10) {
                                            ForEach(additionalObservations) { observation in
                                                EarthObservationTile(observation: observation, showsInvestigationLink: false)
                                                    .frame(width: 250)
                                            }
                                        }
                                        .padding(.vertical, 1)
                                    }
                                }
                            }
                        } else if let layer = gibsTrueColorLayer {
                            VStack(alignment: .leading, spacing: 9) {
                                EventImageryHero(browseLayer: layer, unavailableLabel: "NASA context preview unavailable")
                                HStack {
                                    Text("REGIONAL BROWSE CONTEXT · NOT PROOF")
                                        .font(.caption2.weight(.bold))
                                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                    Spacer()
                                    Text(layer.date)
                                        .font(.caption2.monospacedDigit())
                                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                }
                                Text("\(layer.title) is associated with this event’s mapped area, but it is not event-specific observation evidence.")
                                    .font(.caption)
                                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                Text(gibsContext?.notice ?? "NASA GIBS browse imagery provides context and is not proof of physical change or causation.")
                                    .font(.caption2)
                                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                if let sourceURL = URL(string: layer.provenance.source_url) {
                                    Link("NASA GIBS provenance", destination: sourceURL)
                                        .font(.caption2.weight(.semibold))
                                }
                                Text(layer.provenance.attribution)
                                    .font(.caption2)
                                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                            }
                            .padding(10)
                            .background(ClaritasPalette.shellSurfaceMuted(for: colorScheme), in: RoundedRectangle(cornerRadius: 14))
                        } else {
                            Label("No defensible event-specific observation is available yet", systemImage: "photo.badge.exclamationmark")
                                .font(.subheadline.weight(.semibold))
                            Text("The evidence thread remains usable without imagery. Claritas never substitutes a scene from an unrelated event or location.")
                                .font(.caption)
                                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        }
                    }

                }

                signalExplorer(detail)
                signalReader(detail)

                let contextAssessments = detail.evidence.filter(isContextAssessment)
                if !contextAssessments.isEmpty {
                    BrandCard(title: "Context coverage status", icon: "eye") {
                        Text("Coverage and comparison assessments describe what the available data can support. They are not counted as linked observations or reports.")
                            .font(.caption)
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        ForEach(contextAssessments) { item in
                            VStack(alignment: .leading, spacing: 5) {
                                Label(contextStatusLabel(for: item), systemImage: contextStatusIcon(for: item))
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                                Text(item.source_summary ?? "Claritas recorded a qualified coverage assessment for this event.")
                                    .font(.caption2)
                                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                            }
                            .padding(.vertical, 5)
                            if item.id != contextAssessments.last?.id { Divider() }
                        }
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
                    BrandCard(title: "Likely related investigations", icon: "point.3.connected.trianglepath.dotted") {
                        Text("These investigations met a qualified location, spatial, or entity anchor. They are contextual links, not asserted causation.")
                            .font(.caption2)
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        ForEach(detail.related_events) { event in
                            Button { selectEvent(event.id, revealDetail: true) } label: {
                                HStack(alignment: .top, spacing: 9) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text("LIKELY RELATED · \(event.relationship.replacingOccurrences(of: "_", with: " ").uppercased())")
                                            .font(.caption2.weight(.bold))
                                            .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                                        Text(event.title)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                                        Text("\(Int(event.confidence * 100))% relationship confidence · \(Int(event.relevance_score * 100))% relevance")
                                            .font(.caption2)
                                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                        if let rationale = event.rationale, !rationale.isEmpty {
                                            Text(rationale).font(.caption2).foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                        }
                                    }
                                    Spacer()
                                    severityBadge(event.severity)
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                }
                                .padding(10)
                                .frame(maxWidth: .infinity, minHeight: ClaritasLayout.minimumTouchTarget, alignment: .leading)
                                .background(ClaritasPalette.shellSurfaceMuted(for: colorScheme), in: RoundedRectangle(cornerRadius: 10))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Open likely related investigation: \(event.title)")
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

    private func signalExplorer(_ detail: IntelligenceEventDetail) -> some View {
        let groups = Dictionary(grouping: detail.evidence.filter { !isContextAssessment($0) }, by: signalGroup)
        let domains = Array(Set(groups.keys)
            .union(detail.context_signals.map(\.domain))
            .union(detail.unattachedSocialContext.isEmpty ? [] : ["social"])
            .union(detail.regional_reporting?.items.isEmpty == false ? ["news"] : [])).sorted {
                if $0 == $1 { return false }
                if $0 == detail.event.origin_domain { return true }
                if $1 == detail.event.origin_domain { return false }
                return signalDomainLabel($0) < signalDomainLabel($1)
            }
        let activeFilter = evidenceFilterEventID == detail.event.id ? evidenceFilter : nil
        return BrandCard(title: "Related signals", icon: "point.3.connected.trianglepath.dotted") {
            VStack(alignment: .leading, spacing: 8) {
                Label("Started from \(detail.event.originLabel)", systemImage: detail.event.originIcon)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                Text(detail.event.title)
                    .font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(detail.evidence.filter { !isContextAssessment($0) }.count + detail.unattachedSocialContext.count) attached sources · \(detail.related_events.count) related events")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(ClaritasPalette.shellHighlight(for: colorScheme).opacity(0.35), in: RoundedRectangle(cornerRadius: 12))

            HStack(spacing: 8) {
                Image(systemName: "arrow.down")
                Text("Choose a signal type to see the sources and why they connect")
                    .fixedSize(horizontal: false, vertical: true)
            }
            .font(.caption2).foregroundStyle(.secondary)
            .padding(.leading, 15)

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 145), spacing: 9)], alignment: .leading, spacing: 9) {
                ForEach(domains, id: \.self) { domain in
                    let records = groups[domain] ?? []
                    let contextCount = detail.context_signals.filter { $0.domain == domain && !$0.metrics.isEmpty }.count
                        + (domain == "news" ? (detail.regional_reporting?.items.count ?? 0) : 0)
                    let count = records.count + (domain == "social" ? detail.unattachedSocialContext.count : 0)
                    Button {
                        evidenceFilter = activeFilter == domain ? nil : domain
                        evidenceFilterEventID = detail.event.id
                        detailScrollTarget = "investigation-evidence"
                        evidenceNavigationID = UUID()
                    } label: {
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Image(systemName: signalDomainIcon(domain))
                                    .font(.title3)
                                    .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                                Spacer(minLength: 0)
                                Text(count + contextCount == 0 ? "—" : "\(count > 0 ? count : contextCount)")
                                    .font(.title3.monospacedDigit().weight(.semibold))
                            }
                            Text(signalDomainLabel(domain)).font(.caption.weight(.bold))
                            Text(count > 0 ? "Attached sources" : contextCount > 0 ? "Regional context" : "Coverage status")
                                .font(.caption2).foregroundStyle(.secondary)
                            let dimensions = Set(records.flatMap { IntelligenceLinkagePresentation.dimensions(for: $0.correlation_factors) }).sorted()
                            Text(dimensions.isEmpty ? (count > 0 ? "Review the connection →" : "Place + time only →") : dimensions.joined(separator: " + "))
                                .font(.caption2)
                                .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(11)
                        .frame(maxWidth: .infinity, minHeight: 115, alignment: .topLeading)
                        .background(activeFilter == domain ? ClaritasPalette.shellHighlight(for: colorScheme) : ClaritasPalette.shellSurfaceMuted(for: colorScheme), in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(activeFilter == domain ? ClaritasPalette.shellAccent(for: colorScheme) : ClaritasPalette.shellBorder(for: colorScheme)))
                        .contentShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(signalDomainLabel(domain)): \(count) attached sources, \(contextCount) regional context records")
                    .accessibilityAddTraits(activeFilter == domain ? .isSelected : [])
                }
            }
            let missing = detail.signal_coverage.filter { $0.state == "none" }.map(\.label)
            if !missing.isEmpty {
                Text("No attached sources: \(missing.joined(separator: ", ")).")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            Text("A connection describes shared evidence, place, timing, topic or entity. Regional context and model interpretation do not establish confirmation.")
                .font(.caption2).foregroundStyle(.secondary)
        }
    }

    private func signalReader(_ detail: IntelligenceEventDetail) -> some View {
        let activeFilter = evidenceFilterEventID == detail.event.id ? evidenceFilter : nil
        let records = detail.evidence.filter { !isContextAssessment($0) && (activeFilter == nil || signalGroup($0) == activeFilter) }
            .sorted { $0.observed_at > $1.observed_at }
        return BrandCard(title: activeFilter.map(signalDomainLabel) ?? "All related sources", icon: "list.bullet.rectangle") {
            if activeFilter != nil {
                Button("Show all signal types") { evidenceFilter = nil }
                    .font(.caption.weight(.semibold))
                    .frame(minHeight: ClaritasLayout.minimumTouchTarget)
            }
            ForEach(records) { item in
                evidenceSourceRow(item)
                if item.id != records.last?.id { Divider() }
            }
            if activeFilter == nil || activeFilter == "social" {
                ForEach(detail.unattachedSocialContext) { post in
                    VStack(alignment: .leading, spacing: 7) {
                        Label("Socials · unverified claim", systemImage: "bubble.left.and.bubble.right")
                            .font(.caption2.weight(.bold)).foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                        Text(post.text).font(.subheadline)
                        Text("\(post.author) · \(post.platform) · \(post.posted_at.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption2).foregroundStyle(.secondary)
                        if let url = URL(string: post.url) {
                            Link("Open attributed post ↗", destination: url).font(.caption.weight(.semibold))
                                .frame(minHeight: ClaritasLayout.minimumTouchTarget)
                        }
                    }.padding(.vertical, 8)
                }
            }
            ForEach(detail.context_signals.filter { activeFilter == nil || $0.domain == activeFilter }) { context in
                regionalSignalRow(context)
            }
            if (activeFilter == nil || activeFilter == "news"), let regional = detail.regional_reporting {
                VStack(alignment: .leading, spacing: 8) {
                    Label("In the same region", systemImage: "map")
                        .font(.subheadline.weight(.semibold))
                    Text("Place + time only · not linked reporting").font(.caption.weight(.semibold))
                        .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                    Text(regional.notice).font(.caption2).foregroundStyle(.secondary)
                    Text("\(regional.window_start.formatted(date: .abbreviated, time: .shortened)) – \(regional.window_end.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption2).foregroundStyle(.secondary)
                    ForEach(regional.items) { item in
                        VStack(alignment: .leading, spacing: 5) {
                            Text("\(item.scope_label) · \(item.publisher)")
                                .font(.caption2).foregroundStyle(.secondary)
                            Text(item.title).font(.subheadline.weight(.semibold))
                                .fixedSize(horizontal: false, vertical: true)
                            Text(item.observed_at.formatted(date: .abbreviated, time: .shortened))
                                .font(.caption2).foregroundStyle(.secondary)
                            HStack(spacing: 12) {
                                if let url = URL(string: item.url) {
                                    Link("Open source ↗", destination: url).font(.caption.weight(.semibold))
                                        .frame(minHeight: ClaritasLayout.minimumTouchTarget)
                                }
                            }
                            SourceInvestigationButton(domain: "news", recordType: "item", recordID: item.id) { id in
                                selectEvent(id, revealDetail: true)
                            }
                        }
                        .padding(.vertical, 8)
                        if item.id != regional.items.last?.id { Divider() }
                    }
                    if regional.items.isEmpty {
                        Text("No other reporting is available in this place and time window.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(12)
                .background(ClaritasPalette.shellSurfaceMuted(for: colorScheme), in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .id("investigation-evidence")
    }

    private func evidenceSourceRow(_ item: IntelligenceEvidence) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 9) {
                if let summary = item.source_summary, !summary.isEmpty {
                    Text(summary).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
                Text(IntelligenceLinkagePresentation.explanation(for: item.correlation_factors))
                    .font(.caption).foregroundStyle(.secondary)
                if let score = item.correlation_score, IntelligenceLinkagePresentation.decision(in: item.correlation_factors) == "attached" {
                    Text("Connection match: \(Int((score * 100).rounded()))% · not a probability of causation")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                if let attribution = item.attribution, !attribution.isEmpty {
                    Text(attribution).font(.caption2).foregroundStyle(.secondary)
                }
                if let license = item.license, !license.isEmpty {
                    Text(license).font(.caption2).foregroundStyle(.secondary)
                }
                if let source = item.source_url, let url = URL(string: source) {
                    Link("Open original source ↗", destination: url)
                        .font(.caption.weight(.semibold))
                        .frame(minHeight: ClaritasLayout.minimumTouchTarget)
                }
            }.padding(.vertical, 8)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: signalDomainIcon(signalGroup(item)))
                    .font(.subheadline)
                    .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                    .frame(width: 32, height: 32)
                    .background(ClaritasPalette.dataBlue(for: colorScheme).opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 5) {
                    Text("\(signalDomainLabel(signalGroup(item))) · \(evidenceLabel(item.relationship))")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                    Text(item.source_title ?? item.evidence_type.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                        .fixedSize(horizontal: false, vertical: true)
                    Text("\(item.source_name ?? "Source record") · \(item.observed_at.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption2).foregroundStyle(.secondary)
                    Text(IntelligenceLinkagePresentation.label(for: item.correlation_factors))
                        .font(.caption2.weight(.semibold)).foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                    let dimensions = IntelligenceLinkagePresentation.dimensions(for: item.correlation_factors)
                    if !dimensions.isEmpty {
                        Text(dimensions.joined(separator: " + "))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, minHeight: ClaritasLayout.minimumTouchTarget, alignment: .leading)
        }
    }

    private func regionalSignalRow(_ context: IntelligenceContextSignal) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Label("\(signalDomainLabel(context.domain)) · regional context", systemImage: signalDomainIcon(context.domain))
                .font(.caption.weight(.semibold))
                .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
            Text(context.title).font(.subheadline.weight(.semibold))
            Text(context.summary).font(.caption)
            if !context.metrics.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 115))], alignment: .leading) {
                    ForEach(Array(context.metrics.enumerated()), id: \.offset) { _, metric in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(metric.value.formatted(.number.precision(.fractionLength(0...1))))
                                .font(.title3.monospacedDigit().weight(.semibold))
                            Text("\(metric.label) · \(metric.unit)")
                                .font(.caption2).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            Text("\(context.scope_label) · place + time only")
                .font(.caption2.weight(.semibold))
            if let observed = context.observed_at {
                Text("As of \(observed.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            Text(context.coverage_notice).font(.caption2).foregroundStyle(.secondary)
            if let route = context.native_route {
                Button("Explore \(signalDomainLabel(context.domain).lowercased()) →") {
                    NotificationCenter.default.post(name: .claritasWatchOpenDestination, object: route, userInfo: ["country": detail?.event.primary_country_iso2 ?? ""])
                }
                .font(.caption.weight(.semibold))
                .frame(minHeight: ClaritasLayout.minimumTouchTarget)
            }
        }
        .padding(12)
        .background(ClaritasPalette.shellSurfaceMuted(for: colorScheme), in: RoundedRectangle(cornerRadius: 12))
    }

    private func eventUnderstandingRow(label: String, icon: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(ClaritasPalette.shellAccentSecondary(for: colorScheme))
                .frame(width: 24, height: 24)
                .background(ClaritasPalette.shellAccentSecondary(for: colorScheme).opacity(0.12), in: RoundedRectangle(cornerRadius: 7))
            VStack(alignment: .leading, spacing: 3) {
                Text(label.uppercased())
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                Text(text)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 9) {
            Image(systemName: "dot.radiowaves.left.and.right")
                .font(.title)
            Text("No current events in this scope")
                .font(.headline)
            Text("Events can start from any source. Browse the source sections or change your country scope.")
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

    private func selectEvent(_ id: String, revealDetail: Bool) {
        if selectedID != id {
            detail = nil
            gibsContext = nil
            detailError = nil
            detailLoading = true
        }
        selectedID = id
        if revealDetail && horizontalSizeClass != .regular {
            showsCompactDetail = true
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        let watchTask = Task { () -> [IntelligenceWatch]? in
            guard onOpenEvent == nil else { return nil }
            return try? await model.api.fetchIntelligenceWatchlist()
        }
        let alertTask = Task { () -> [IntelligenceAlert]? in
            guard onOpenEvent == nil else { return nil }
            return try? await model.api.fetchIntelligenceAlerts()
        }
        do {
            let rows = try await model.api.fetchIntelligenceEvents(
                limit: 60,
                country: model.selectedCountry,
                includeExpired: includeExpired
            )
            guard !Task.isCancelled else { return }
            events = rows
            if onOpenEvent == nil, let requested = model.selectedIntelligenceEventID {
                selectEvent(requested, revealDetail: true)
                model.selectedIntelligenceEventID = nil
            } else if onOpenEvent == nil && (selectedID == nil || !rows.contains(where: { $0.id == selectedID })) {
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
            guard !Task.isCancelled, self.selectedID == selectedID else { return }
            detail = loaded
            if contextualEventID != nil, model.selectedIntelligenceEventID == loaded.event.id {
                model.selectIntelligenceEvent(loaded.event)
            }
            if !events.contains(where: { $0.id == loaded.event.id }) {
                events.insert(loaded.event, at: 0)
            }
        } catch {
            guard !Task.isCancelled, self.selectedID == selectedID else { return }
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
        guard !Task.isCancelled, self.selectedID == selectedID else { return }
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

    private var watchEmailEnabled: Bool {
        activeWatch?.metadata?.email_enabled == true
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

    private func toggleWatchEmail() async {
        guard let target = watchTarget, let activeWatch, !watchPending else { return }
        watchPending = true
        defer { watchPending = false }
        do {
            _ = try await model.api.saveIntelligenceWatch(
                type: target.type,
                key: target.key,
                minimumSeverity: activeWatch.minimum_severity,
                alertsEnabled: activeWatch.alerts_enabled,
                emailEnabled: !watchEmailEnabled
            )
            watches = try await model.api.fetchIntelligenceWatchlist()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func open(_ alert: IntelligenceAlert) async {
        selectEvent(alert.event_id, revealDetail: true)
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

    private func sortedSignalDomains(_ groups: [String: [IntelligenceEvidence]]) -> [String] {
        groups.keys.sorted { left, right in
            let leftCount = groups[left]?.count ?? 0
            let rightCount = groups[right]?.count ?? 0
            return leftCount == rightCount
                ? signalDomainLabel(left) < signalDomainLabel(right)
                : leftCount > rightCount
        }
    }

    private func signalGroup(_ item: IntelligenceEvidence) -> String {
        SignalDomainPresentation.group(domain: item.domain, recordType: item.source_record_type, relationship: item.relationship)
    }

    private func signalDomainLabel(_ domain: String) -> String { SignalDomainPresentation.label(domain) }

    private func signalDomainIcon(_ domain: String) -> String { SignalDomainPresentation.icon(domain) }

    private func contextStatusCode(for item: IntelligenceEvidence) -> String? {
        let metadata = item.metadata?.object
        let factors = item.correlation_factors?.object
        let declaredStatus = metadata?["coverage_status"]?.string
            ?? metadata?["classification"]?.string
            ?? factors?["coverage_status"]?.string
            ?? factors?["classification"]?.string
        let knownStatuses = Set([
            "no_local_sample",
            "comparison_pending",
            "no_nearby_coverage",
            "insufficient_comparable_coverage",
        ])
        if let declaredStatus, knownStatuses.contains(declaredStatus) {
            return declaredStatus
        }

        // Conservative fallback for payloads produced before assessment
        // metadata was exposed to the Apple clients.
        let evidenceType = item.evidence_type.lowercased()
        let sourceRecordType = item.source_record_type.lowercased()
        let assessmentText = [item.source_title, item.source_summary]
            .compactMap { $0 }
            .joined(separator: " ")
            .lowercased()
        if evidenceType == "event_area_weather_unavailable"
            || sourceRecordType == "event_weather_coverage" {
            return "no_local_sample"
        }
        if evidenceType == "event_area_activity_comparison" {
            if assessmentText.contains("comparison pending")
                || assessmentText.contains("complete post-event hour") {
                return "comparison_pending"
            }
            if assessmentText.contains("no transport track points")
                || assessmentText.contains("no nearby transport coverage") {
                return "no_nearby_coverage"
            }
            if assessmentText.contains("baseline is too small")
                || assessmentText.contains("insufficient comparable coverage")
                || assessmentText.contains("insufficient nearby transport coverage") {
                return "insufficient_comparable_coverage"
            }
        }
        return nil
    }

    private func isContextAssessment(_ item: IntelligenceEvidence) -> Bool {
        item.relationship.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "assessment"
            || contextStatusCode(for: item) != nil
    }

    private func contextStatusLabel(for item: IntelligenceEvidence) -> String {
        switch contextStatusCode(for: item) {
        case "no_local_sample": return "No local weather coverage"
        case "comparison_pending": return "Transport comparison pending"
        case "no_nearby_coverage": return "No nearby transport coverage"
        case "insufficient_comparable_coverage": return "Insufficient nearby transport coverage"
        default:
            let domain = item.domain.lowercased()
            if domain.contains("news") { return "Reporting coverage assessment" }
            if domain.contains("weather") { return "Weather coverage assessment" }
            if domain.contains("transport") { return "Transport coverage assessment" }
            return "Context coverage assessment"
        }
    }

    private func contextStatusIcon(for item: IntelligenceEvidence) -> String {
        let domain = item.domain.lowercased()
        if domain.contains("weather") { return "cloud.slash" }
        if domain.contains("transport") { return "arrow.triangle.2.circlepath" }
        if domain.contains("news") { return "newspaper.fill" }
        return "info.circle"
    }

    private func signalLinkExplanation(_ records: [IntelligenceEvidence]) -> String {
        let attached = records.filter {
            IntelligenceLinkagePresentation.decision(in: $0.correlation_factors) == "attached"
        }
        if let linked = attached.first {
            return IntelligenceLinkagePresentation.explanation(for: linked.correlation_factors)
        }
        if let sourceRecord = records.first(where: {
            IntelligenceLinkagePresentation.decision(in: $0.correlation_factors) == "created"
        }) {
            return IntelligenceLinkagePresentation.explanation(for: sourceRecord.correlation_factors)
        }
        return "\(records.count) \(records.count == 1 ? "record is" : "records are") attached as labelled event evidence."
    }

    private func evidenceLabel(_ relationship: String) -> String {
        switch relationship.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
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
        switch relationship.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
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
    @State private var comparable: [EarthObservation] = []
    @State private var comparisonNotice: String?
    @State private var comparePosition = 0.5
    @State private var isLoading = false
    @State private var error: String?

    private func comparisonCandidate(in observations: [EarthObservation]) -> (before: EarthObservation, after: EarthObservation)? {
        let visualProducts = Set(["true_color", "false_color", "sar"])
        let candidates = observations
            .filter { $0.preferredDisplayAsset != nil && $0.event_id != nil && visualProducts.contains($0.product_type) }
            .sorted { $0.capture_start > $1.capture_start }
        for after in candidates {
            if let before = candidates.first(where: {
                $0.id != after.id
                    && $0.event_id == after.event_id
                    && $0.location_id == after.location_id
                    && $0.provider == after.provider
                    && $0.product_type == after.product_type
                    && $0.capture_start < after.capture_start
            }) {
                return (before, after)
            }
        }
        return nil
    }

    private func validatedComparison(
        in observations: [EarthObservation],
        response: EarthComparisonResponse
    ) -> [EarthObservation] {
        guard ["available", "limited_comparability"].contains(response.status),
              let beforeSceneID = response.before?.id,
              let afterSceneID = response.after?.id,
              beforeSceneID != afterSceneID,
              let before = observations.first(where: { $0.scene_id == beforeSceneID && $0.preferredDisplayAsset != nil }),
              let after = observations.first(where: { $0.scene_id == afterSceneID && $0.preferredDisplayAsset != nil }),
              before.event_id != nil,
              before.event_id == after.event_id,
              before.location_id == after.location_id,
              before.provider == after.provider,
              before.product_type == after.product_type,
              before.capture_start < after.capture_start
        else { return [] }
        return [before, after]
    }

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    BrandSectionHeader(
                        kicker: "Source lens · global catalogue",
                        title: "Imagery library",
                        detail: "Browse governed acquisitions here. Open an event on the world overview to see its imagery beside the reporting and observations."
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
                            EarthComparisonView(before: comparable[0], after: comparable[1], position: $comparePosition)
                                .frame(height: 260)
                            Slider(value: $comparePosition, in: 0...1)
                                .accessibilityLabel("Before and after comparison position")
                            Text(comparisonNotice ?? "Sensor, season, cloud, and viewing geometry can resemble physical change. Visual differences are contextual evidence, not automatic proof of cause.")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    } else if let comparisonNotice {
                        BrandCard(title: "Comparison unavailable", icon: "rectangle.on.rectangle.slash") {
                            Text(comparisonNotice)
                                .font(.caption)
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
            let sortedObservations = result.observations.sortedForDisplay
            observations = sortedObservations
            providers = result.providers
            comparable = []
            comparisonNotice = nil
            error = nil
            if let candidate = comparisonCandidate(in: sortedObservations) {
                do {
                    let validation = try await model.api.requestEarthComparison(observationID: candidate.after.id)
                    comparable = validatedComparison(in: sortedObservations, response: validation)
                    comparisonNotice = comparable.count == 2
                        ? validation.notice
                        : (validation.reason ?? validation.notice ?? "No defensible before/after pair is currently available.")
                } catch {
                    comparisonNotice = "Claritas could not validate a defensible before/after pair."
                }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// The current event stream follows the map's country selection.
struct IntelligenceEventPulseView: View {
    enum Presentation: Equatable { case list, horizontal }

    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var events: [IntelligenceEvent] = []
    @State private var isLoading = true
    @State private var showsAllEvents = false
    @State private var pendingEvent: IntelligenceEvent?
    var presentation: Presentation = .list
    var country: String? = nil
    @State private var loadError: String?

    private var scopeCountry: String? { country ?? model.selectedCountry }

    var body: some View {
        BrandCard {
            HStack {
                Label(scopeCountry.map { "What’s happening in \($0)" } ?? "What’s happening", systemImage: "dot.radiowaves.left.and.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                Spacer()
                Button {
                    showsAllEvents = true
                } label: {
                    Label("All events", systemImage: "line.3.horizontal.decrease")
                        .font(.caption.weight(.semibold))
                        .frame(minHeight: ClaritasLayout.minimumTouchTarget)
                }
                .buttonStyle(.plain)
            }

            if isLoading && events.isEmpty {
                ProgressView("Loading events")
                    .font(.caption)
            } else if !events.isEmpty {
                if presentation == .horizontal && horizontalSizeClass == .regular {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 8) {
                        ForEach(events.prefix(6)) { event in eventButton(event) }
                    }
                } else {
                    VStack(spacing: 0) {
                        ForEach(events.prefix(4)) { event in
                            eventButton(event)
                            if event.id != events.prefix(4).last?.id { Divider() }
                        }
                    }
                }
            } else {
                Text(loadError ?? "No current priority events in this scope.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .sheet(isPresented: $showsAllEvents, onDismiss: {
            if let event = pendingEvent {
                pendingEvent = nil
                openEvent(event)
            }
        }) {
            NavigationStack {
                IntelligenceWorkspaceView(onOpenEvent: { event in
                    pendingEvent = event
                    showsAllEvents = false
                })
                    .navigationTitle("Events")
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showsAllEvents = false }
                        }
                    }
            }
            .presentationDragIndicator(.visible)
        }
        .task(id: scopeCountry) {
            events = []
            loadError = nil
            while !Task.isCancelled {
                isLoading = events.isEmpty
                do {
                    let nextEvents = try await model.api.fetchIntelligenceEvents(limit: 6, country: scopeCountry)
                    guard !Task.isCancelled else { return }
                    events = nextEvents
                    loadError = nil
                } catch {
                    guard !Task.isCancelled else { return }
                    loadError = "Events unavailable. Open All events to retry."
                }
                isLoading = false
                do { try await Task.sleep(nanoseconds: 300_000_000_000) }
                catch { return }
            }
        }
    }

    private func eventButton(_ event: IntelligenceEvent) -> some View {
        Button {
            openEvent(event)
        } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: event.originIcon)
                    .font(.caption)
                    .foregroundStyle(severityColor(event.severity))
                    .frame(width: 20)
                    .padding(.top, 3)
                VStack(alignment: .leading, spacing: 4) {
                    Text(event.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                    Text("\(event.severity.rawValue.capitalized) · \(event.primary_country_iso2 ?? event.location_name ?? "Global") · \(event.evidence_count) linked records")
                        .font(.caption2)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        .lineLimit(1)
                    if event.earth_observation_available {
                        Label("Imagery linked to this event", systemImage: "sensor.tag.radiowaves.forward")
                            .font(.caption2)
                            .foregroundStyle(ClaritasPalette.dataBlue(for: colorScheme))
                    }
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 6) {
                    Text(event.last_activity_time, style: .time)
                        .font(.caption2.monospacedDigit())
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                }
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
            }
            .frame(maxWidth: .infinity, minHeight: ClaritasLayout.minimumTouchTarget, alignment: .leading)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open \(event.severity.rawValue) priority event: \(event.title), \(event.location_name ?? event.primary_country_iso2 ?? "Global"), \(event.evidence_count) linked records")
    }

    private func openEvent(_ event: IntelligenceEvent) {
        model.selectIntelligenceEvent(event)
        NotificationCenter.default.post(
            name: .claritasWatchOpenDestination,
            object: "intelligence",
            userInfo: ["eventID": event.id, "country": event.primary_country_iso2 ?? ""]
        )
    }

    private func severityColor(_ severity: IntelligenceSeverity) -> Color {
        switch severity {
        case .critical: return ClaritasPalette.negativeText(for: colorScheme)
        case .high: return ClaritasPalette.shellAccent(for: colorScheme)
        case .medium: return ClaritasPalette.dataBlue(for: colorScheme)
        case .low: return ClaritasPalette.shellMuted(for: colorScheme)
        }
    }
}

private struct EventImageryHero: View {
    @Environment(\.colorScheme) private var colorScheme
    let observation: EarthObservation?
    let browseLayer: GibsEventLayer?
    let unavailableLabel: String

    init(observation: EarthObservation) {
        self.observation = observation
        self.browseLayer = nil
        self.unavailableLabel = "Event observation unavailable"
    }

    init(browseLayer: GibsEventLayer, unavailableLabel: String) {
        self.observation = nil
        self.browseLayer = browseLayer
        self.unavailableLabel = unavailableLabel
    }

    private var contextLabel: String {
        if let observation { return observation.displayProductName.uppercased() }
        return "REGIONAL BROWSE CONTEXT"
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let asset = observation?.preferredDisplayAsset {
                AuthenticatedEarthImage(path: asset.url, contentMode: .fit)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let browseLayer {
                AuthenticatedRemoteImage(
                    url: browseLayer.preview_url,
                    unavailableLabel: unavailableLabel,
                    contentMode: .fit
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Image(systemName: "photo.badge.exclamationmark")
                    .font(.title2)
                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            Text(contextLabel)
                .font(.caption2.weight(.bold))
                .tracking(0.7)
                .foregroundStyle(.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(.black.opacity(0.68), in: Capsule())
                .padding(10)
        }
        .frame(maxWidth: .infinity)
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .background(ClaritasPalette.shellSidebar(for: colorScheme))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(ClaritasPalette.shellBorderStrong(for: colorScheme), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(observation == nil ? "Regional browse context image" : "Event-specific observation image")
    }
}

private struct EarthObservationTile: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    let observation: EarthObservation
    var showsInvestigationLink = true

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if let asset = observation.preferredDisplayAsset {
                AuthenticatedEarthImage(path: asset.url, contentMode: .fit)
                    .frame(maxWidth: .infinity)
                    .aspectRatio(16.0 / 9.0, contentMode: .fit)
                    .background(ClaritasPalette.shellSidebar(for: colorScheme))
                    .clipShape(RoundedRectangle(cornerRadius: 11))
            } else {
                Image(systemName: "photo.badge.exclamationmark")
                    .frame(maxWidth: .infinity)
                    .aspectRatio(16.0 / 9.0, contentMode: .fit)
                    .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 11))
            }
            Text(observation.location_name ?? "Monitored area").font(.subheadline.weight(.semibold))
            Text("\(observation.displayProductName) · \(observation.mission)")
                .font(.caption).foregroundStyle(.secondary)
            if observation.isAnalyticalLayer {
                Text("ANALYTICAL LAYER · NOT NATURAL COLOR")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.orange)
            }
            HStack {
                Text(observation.capture_start.formatted(date: .abbreviated, time: .shortened))
                Spacer()
                if let cloud = observation.cloud_cover { Text("\(Int(cloud))% cloud") }
            }
            .font(.caption2).foregroundStyle(.secondary)
            if let interpretation = observation.model_interpretation {
                VStack(alignment: .leading, spacing: 4) {
                    Label("MODEL INTERPRETATION · NOT A SENSOR MEASUREMENT", systemImage: "sparkles")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(ClaritasPalette.shellAccentSecondary(for: colorScheme))
                    if let summary = interpretation.summary, !summary.isEmpty {
                        Text(summary)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(4)
                    }
                    if let feature = interpretation.findings?.first, !feature.isEmpty {
                        Text("Observed feature: \(feature)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    if let change = interpretation.possible_changes?.first, !change.isEmpty {
                        Text("Possible change: \(change)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                .padding(8)
                .background(ClaritasPalette.shellSurfaceMuted(for: colorScheme), in: RoundedRectangle(cornerRadius: 8))
            }
            if showsInvestigationLink {
                SourceInvestigationButton(domain: "imagery", recordType: "earth_observation", recordID: observation.id)
            }
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
            if let beforeAsset = before.preferredDisplayAsset,
               let afterAsset = after.preferredDisplayAsset {
                ZStack(alignment: .leading) {
                    AuthenticatedEarthImage(path: beforeAsset.url, contentMode: .fit)
                        .frame(width: geometry.size.width, height: geometry.size.height)
                    AuthenticatedEarthImage(path: afterAsset.url, contentMode: .fit)
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
            } else {
                Label("Comparison images unavailable", systemImage: "photo.badge.exclamationmark")
                    .font(.caption)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }
}

struct AuthenticatedEarthImage: View {
    @EnvironmentObject private var model: AppModel
    let path: String
    var contentMode: ContentMode = .fill
    @State private var image: UIImage?
    @State private var loadError: String?
    @State private var retryID = 0

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
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

struct AuthenticatedRemoteImage: View {
    @EnvironmentObject private var model: AppModel
    let url: String
    var unavailableLabel = "Satellite image unavailable"
    var contentMode: ContentMode = .fit
    @State private var image: UIImage?
    @State private var loadError: String?
    @State private var retryID = 0

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else if let loadError {
                VStack(spacing: 8) {
                    Label(unavailableLabel, systemImage: "photo.badge.exclamationmark")
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
        .task(id: "\(url)-\(retryID)") {
            image = nil
            loadError = nil
            do {
                let data = try await model.api.fetchProxiedImage(url: url)
                guard let decoded = UIImage(data: data) else {
                    loadError = "The returned context is not a supported image."
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

    private var actionableOutboxCount: Int {
        let actionable = Set(["pending", "queued", "processing", "running", "failed"])
        return status?.backbone.outbox
            .filter { actionable.contains($0.status.lowercased()) }
            .reduce(0) { $0 + $1.count } ?? 0
    }

    private var activeEarthJobCount: Int {
        let active = Set(["pending", "queued", "processing", "running", "budget_deferred"])
        return status?.earth_observation.queue
            .filter { active.contains($0.status.lowercased()) }
            .reduce(0) { $0 + $1.count } ?? 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            BrandCard(title: "Event and Earth Observation", icon: "dot.radiowaves.left.and.right") {
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(.red)
                }
                HStack {
                    adminMetric("Backlog", actionableOutboxCount)
                    adminMetric("Active EO", activeEarthJobCount)
                    adminMetric("Images", status?.earth_observation.assets.count ?? 0)
                    adminMetric("Needs attention", (status?.backbone.unresolved_dead_letters ?? 0) + (status?.earth_observation.recent_jobs.filter { ["failed", "dead_letter"].contains($0.status) }.count ?? 0))
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
