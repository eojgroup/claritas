import SwiftUI
import UIKit
import ImageIO
import Charts

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
    @State private var detailRequestID = UUID()
    @State private var error: String?
    @State private var detailError: String?
    @State private var includeExpired = false
    @State private var showsCompactDetail = false
    @State private var evidenceFilter: String?
    @State private var evidenceFilterEventID: String?
    @State private var evidenceNavigationID = UUID()
    @State private var detailScrollTarget = "investigation-evidence"
    @State private var showsEvidence = false
    @State private var showsContext = false
    @State private var showsEventOptions = false
    @State private var visualLayer: String?
    @State private var weatherVisual: EventWeatherVisual?
    @State private var weatherLoaded = false
    @State private var weatherError: String?
    @State private var weatherRetry = 0
    @State private var showsMovements = false

    init(contextualEventID: String? = nil, onOpenEvent: ((IntelligenceEvent) -> Void)? = nil) {
        self.contextualEventID = contextualEventID
        self.onOpenEvent = onOpenEvent
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-qa-event-snapshot") {
            _visualLayer = State(initialValue: "transport")
            _showsMovements = State(initialValue: true)
        }
        #endif
    }

    var body: some View {
        BrandBackground {
            if contextualEventID != nil {
                detailScrollView
                    .refreshable {
                        await loadDetail()
                        if showsContext { await loadGibsContext() }
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
        }
        .task(id: selectedID) { await loadDetail() }
        .onChange(of: selectedID) { _ in
            visualLayer = nil; weatherVisual = nil; weatherLoaded = false; weatherError = nil
            showsMovements = false
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-qa-event-snapshot") {
                visualLayer = "transport"; showsMovements = true
            }
            #endif
        }
        .task(id: "\(selectedID ?? "none")|\(visualLayer ?? "none")|\(weatherRetry)") {
            guard visualLayer == "weather", !weatherLoaded, let selectedID else { return }
            do {
                let value = try await model.api.fetchEventWeather(id: selectedID)
                guard !Task.isCancelled, self.selectedID == selectedID else { return }
                weatherVisual = value; weatherLoaded = true
            } catch {
                guard !Task.isCancelled, self.selectedID == selectedID else { return }
                weatherError = "Weather could not be loaded."; weatherLoaded = true
            }
        }
        .task(id: "\(selectedID ?? "none")|\(showsContext)") {
            guard showsContext else { return }
            await loadDetail(includeContext: true)
            await loadGibsContext()
        }
        .task(id: showsEventOptions) {
            guard showsEventOptions else { return }
            if let next = try? await model.api.fetchIntelligenceWatchlist(), !Task.isCancelled { watches = next }
        }
        .navigationDestination(isPresented: $showsCompactDetail) {
            BrandBackground {
                detailScrollView
                .refreshable {
                    await loadDetail()
                    if showsContext { await loadGibsContext() }
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
                    if showsContext { await loadGibsContext() }
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
                                    if let disclosure = event.headlineTranslationDisclosure {
                                        Text(disclosure).font(.caption2).foregroundStyle(.secondary)
                                    }
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
        if detailLoading && detail?.event.id != selectedID {
            BrandCard { ProgressView("Loading event") .frame(maxWidth: .infinity, minHeight: 100) }
        } else if let detailError, detail?.event.id != selectedID {
            BrandCard(title: "Event unavailable", icon: "exclamationmark.triangle") {
                Text(detailError).font(.caption).foregroundStyle(.secondary)
                Button("Retry") { Task { await loadDetail() } }.buttonStyle(.bordered)
            }
        } else if let detail, detail.event.id == selectedID {
            VStack(alignment: .leading, spacing: 12) {
                Color.clear.frame(height: 0).id("investigation-overview")
                BrandCard {
                    HStack(spacing: 8) {
                        severityBadge(detail.event.severity)
                        Text(detail.event.originLabel).font(.caption.weight(.semibold))
                        Spacer()
                        if detail.event.isArchived {
                            Label("Archived", systemImage: "clock.arrow.circlepath").font(.caption2)
                        }
                    }
                    Text(detail.event.title).font(.title3.weight(.semibold))
                    IntelligenceHeadlineNotice(
                        disclosure: detail.event.headlineTranslationDisclosure,
                        original: IntelligenceTranslationPresentation.original(detail.event.original_title, display: detail.event.title),
                        originalSummary: IntelligenceTranslationPresentation.original(detail.event.original_summary, display: detail.event.summary),
                        summaryTranslated: detail.event.summary_translation_status == "translated",
                        translation: detail.event.translation,
                        availability: detail.event.translation_availability
                    )
                    if let summary = essentialText(detail.understanding?.what_happened ?? detail.event.summary) {
                        Text(summary).font(.subheadline).lineLimit(5)
                        if detail.event.summary_translation_status == "translated" {
                            Text("AI-generated summary · source reporting").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    if let location = essentialText(detail.understanding?.location ?? detail.event.location_name
                        ?? detail.event.primary_country_iso2.flatMap { Locale.current.localizedString(forRegionCode: $0) }) {
                        Label(location, systemImage: "mappin.and.ellipse").font(.caption)
                    }
                    Text("Started \(detail.event.start_time.formatted(date: .abbreviated, time: .shortened)) · Updated \(detail.event.last_activity_time.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    let sources = detail.evidence.filter { !isContextAssessment($0) }
                    Label("\(sources.count) linked sources", systemImage: "link")
                        .font(.caption).foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                    if let reason = detail.event.priority_reasons?.compactMap({ essentialText($0) }).first {
                        Text(reason).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    if detailLoading { ProgressView().controlSize(.small) }
                    if let detailError {
                        Text("Refresh unavailable · \(detailError)").font(.caption2).foregroundStyle(.secondary)
                    }
                }

                eventVisuals(detail)

                let signalGroups = Dictionary(grouping: detail.evidence.filter { !isContextAssessment($0) }, by: signalGroup)
                if !signalGroups.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(signalGroups.keys.sorted(), id: \.self) { domain in
                                Button {
                                    evidenceFilter = domain; evidenceFilterEventID = detail.event.id; showsEvidence = true
                                } label: {
                                    Label("\(signalDomainLabel(domain)) · \(signalGroups[domain]?.count ?? 0)", systemImage: signalDomainIcon(domain))
                                        .font(.caption.weight(.semibold)).padding(.horizontal, 12).frame(minHeight: 44)
                                }.buttonStyle(.bordered)
                            }
                        }
                    }.accessibilityLabel("Related sources in this event")
                }

                if detail.evidence.contains(where: { !isContextAssessment($0) }) {
                    BrandCard {
                        DisclosureGroup(isExpanded: $showsEvidence) {
                            if showsEvidence { signalReader(detail) }
                        } label: {
                            Label("Sources and evidence (\(detail.evidence.filter { !isContextAssessment($0) }.count))", systemImage: "list.bullet.rectangle")
                                .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                        }
                    }
                }

                BrandCard {
                    DisclosureGroup(isExpanded: $showsContext) {
                        if showsContext {
                            if !detail.context_images.isEmpty {
                                ForEach(Array(detail.context_images.prefix(3))) { image in
                                    ReusedContextImageCard(image: image) { id in
                                        if contextualEventID != nil { model.selectedIntelligenceEventID = id }
                                        else { selectEvent(id, revealDetail: true) }
                                    }
                                }
                            }
                            if let layer = gibsTrueColorLayer {
                                EventImageryHero(browseLayer: layer, unavailableLabel: "Regional image unavailable")
                                Text("Regional browse context · not proof · \(layer.date)")
                                    .font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                                Text(layer.provenance.attribution).font(.caption2).foregroundStyle(.secondary)
                            }
                            if !detail.context_signals.isEmpty || !detail.unattachedSocialContext.isEmpty
                                || detail.regional_reporting?.items.isEmpty == false {
                                signalExplorer(detail)
                                signalReader(detail)
                            }
                            ForEach(detail.related_events) { event in
                                Button { selectEvent(event.id, revealDetail: true) } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("Likely related · \(event.relationship.replacingOccurrences(of: "_", with: " "))")
                                            .font(.caption2).foregroundStyle(.secondary)
                                        Text(event.title).font(.subheadline.weight(.semibold))
                                    }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                }.buttonStyle(.plain)
                            }
                            ForEach(detail.evidence.filter(isContextAssessment)) { item in
                                if let summary = essentialText(item.source_summary) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Label(contextStatusLabel(for: item), systemImage: contextStatusIcon(for: item))
                                            .font(.caption.weight(.semibold))
                                        Text(summary).font(.caption2).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            if let notice = essentialText(detail.epistemic_notice) {
                                Text(notice).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    } label: {
                        Label("More context", systemImage: "square.stack").font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                    }
                }

                BrandCard {
                    DisclosureGroup(isExpanded: $showsEventOptions) {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Started \(detail.event.start_time.formatted(date: .abbreviated, time: .shortened))")
                                .font(.caption.monospacedDigit())
                            Text(detail.event.status.capitalized).font(.caption)
                            if let summary = essentialText(detail.event.summary) {
                                Text(summary).font(.caption)
                            }
                            if watchTarget != nil {
                                Button { Task { await toggleWatch() } } label: {
                                    Label(activeWatch == nil ? "Watch this scope" : "Stop watching", systemImage: "bell")
                                }.buttonStyle(.bordered).disabled(watchPending)
                                if activeWatch != nil {
                                    Button { Task { await toggleWatchEmail() } } label: {
                                        Label(watchEmailEnabled ? "Email alerts on" : "Email alerts off", systemImage: "envelope")
                                    }.buttonStyle(.bordered).disabled(watchPending)
                                }
                            }
                            HStack {
                                score("Relevance", detail.event.relevance_score)
                                score("Urgency", detail.event.urgency_score)
                                score("Materiality", detail.event.materiality_score)
                            }
                        }
                    } label: {
                        Text("Event details and alerts").font(.caption.weight(.semibold)).frame(minHeight: 44)
                    }
                }
            }
        }
    }

    private func essentialText(_ value: String?) -> String? {
        guard let text = value?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
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
            Text("A connection describes shared evidence, place, timing, topic or entity. Regional context and model interpretation do not establish confirmation.")
                .font(.caption2).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func eventVisuals(_ detail: IntelligenceEventDetail) -> some View {
        let hasImages = !detail.news_images.isEmpty || !detail.context_images.isEmpty
            || detail.earth_observations.contains { $0.preferredDisplayAsset != nil }
        let hasTransport = detail.evidence.contains { item in
            guard item.domain == "transport", item.evidence_type == "rolling_baseline_anomaly",
                  let current = item.metadata?.object?["current"]?.number,
                  let baseline = item.metadata?.object?["baseline"]?.number else { return false }
            return current.isFinite && baseline.isFinite && current >= 0 && baseline >= 0
        }
        let selected = visualLayer ?? (hasImages ? "images" : hasTransport ? "transport" : "none")
        if hasImages || hasTransport || detail.event.primary_country_iso2 != nil {
            HStack(spacing: 8) {
                if hasImages { visualButton("Images", layer: "images", selected: selected) }
                if hasTransport { visualButton("Transport", layer: "transport", selected: selected) }
                if detail.event.primary_country_iso2 != nil {
                    visualButton(weatherLoaded ? "Weather" : "Load weather", layer: "weather", selected: selected)
                }
            }.accessibilityElement(children: .contain).accessibilityLabel("Event visual layers")
            if selected == "images" {
                if let observation = detail.earth_observations.sortedForDisplay.first(where: { $0.preferredDisplayAsset != nil }) {
                    BrandCard {
                        EventImageryHero(observation: observation)
                        Label("Linked observation · \(observation.capture_start.formatted(date: .abbreviated, time: .shortened))", systemImage: "photo")
                            .font(.caption2).foregroundStyle(.secondary)
                        if let attribution = observation.attribution {
                            Text(attribution).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }

                if !detail.news_images.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(alignment: .top, spacing: 12) {
                            ForEach(Array(detail.news_images.prefix(3))) { image in
                                VStack(alignment: .leading, spacing: 6) {
                                    AuthenticatedEarthImage(path: image.preview_url, contentMode: .fit, unavailableLabel: "Publisher image unavailable")
                                        .aspectRatio(16.0 / 9.0, contentMode: .fit)
                                        .clipShape(RoundedRectangle(cornerRadius: 10))
                                    Text(image.caption ?? image.article_title).font(.caption).lineLimit(2)
                                    if let url = URL(string: image.article_url), url.scheme == "https" {
                                        Link(image.publisher, destination: url).font(.caption.weight(.semibold))
                                    }
                                    if let published = image.article_published_at {
                                        Text("Published \(published.formatted(date: .abbreviated, time: .shortened))")
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                    Text("Publisher photo · capture unverified").font(.caption2).foregroundStyle(.secondary)
                                }.frame(width: 260, alignment: .leading)
                            }
                        }
                    }
                }

                if detail.earth_observations.sortedForDisplay.first(where: { $0.preferredDisplayAsset != nil }) == nil,
                   let image = detail.context_images.first {
                    ReusedContextImageCard(image: image) { id in
                        if contextualEventID != nil { model.selectedIntelligenceEventID = id }
                        else { selectEvent(id, revealDetail: true) }
                    }
                }

            } else if selected == "transport" {
                transportSignalChart(detail)
            } else if selected == "weather" {
                if !weatherLoaded { ProgressView("Loading weather context") }
                else if let weatherVisual { eventWeatherCard(weatherVisual) }
                else {
                    Text(weatherError ?? "No weather reference sample close to this event’s update time.")
                        .font(.caption).foregroundStyle(.secondary)
                    if weatherError != nil {
                        Button("Retry weather") { weatherLoaded = false; weatherError = nil; weatherRetry += 1 }
                            .buttonStyle(.bordered)
                    }
                }
            }
        }
    }

    private func visualButton(_ title: String, layer: String, selected: String) -> some View {
        Button { visualLayer = layer } label: { Text(title).font(.caption.weight(.semibold)).frame(minHeight: 30) }
            .buttonStyle(.bordered)
            .tint(selected == layer ? ClaritasPalette.shellAccent(for: colorScheme) : .secondary)
            .accessibilityValue(selected == layer ? "Selected" : "")
    }

    private func eventWeatherCard(_ weather: EventWeatherVisual) -> some View {
        BrandCard(title: "Weather · \(weather.location_name)", icon: "cloud.sun") {
            Text(weather.scope_label).font(.caption2).foregroundStyle(.secondary)
            HStack(alignment: .top, spacing: 18) {
                if let temperature = weather.temp_c {
                    VStack(alignment: .leading) {
                        Text("\(temperature.formatted())°C").font(.title2.weight(.semibold))
                        Text(weather.weather_desc ?? "Temperature").font(.caption2)
                    }
                }
                if let rain = weather.precipitation_mm {
                    VStack(alignment: .leading) { Text("\(rain.formatted()) mm").font(.headline); Text("Precipitation").font(.caption2) }
                }
                if let wind = weather.wind_speed {
                    VStack(alignment: .leading) {
                        Text("\(wind.formatted()) m/s").font(.headline)
                        if let direction = weather.wind_direction {
                            HStack { Image(systemName: "location.north.fill").rotationEffect(.degrees(direction)); Text("Wind from \(Int(direction))°") }.font(.caption2)
                        } else { Text("Wind").font(.caption2) }
                    }
                }
            }
            if weather.forecast.count >= 2 {
                Text("Temperature forecast").font(.caption.weight(.semibold))
                Chart(weather.forecast) { point in
                    LineMark(x: .value("Forecast time", point.forecast_time), y: .value("Temperature °C", point.temp_c))
                        .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                }.frame(height: 110)
                Text("Forecast · not observed event history").font(.caption2).foregroundStyle(.secondary)
            }
            Text("\(weather.source_kind?.contains("model") == true ? "Modelled reference" : "Reference sample") · \(weather.observed_at.formatted(date: .abbreviated, time: .shortened))")
                .font(.caption2).foregroundStyle(.secondary)
            Text(weather.attribution).font(.caption2).foregroundStyle(.secondary)
            DisclosureGroup("Scope & source") { Text(weather.notice).font(.caption2).foregroundStyle(.secondary) }.font(.caption)
        }
    }

    @ViewBuilder
    private func transportSignalChart(_ detail: IntelligenceEventDetail) -> some View {
        if let evidence = detail.evidence.first(where: { $0.domain == "transport" && $0.evidence_type == "rolling_baseline_anomaly" }),
           let metadata = evidence.metadata?.object,
           let current = metadata["current"]?.number,
           let baseline = metadata["baseline"]?.number,
           current.isFinite, baseline.isFinite, current >= 0, baseline >= 0 {
            BrandCard(title: "Transport activity", icon: "chart.bar") {
                Chart {
                    BarMark(x: .value("Movements", current), y: .value("Period", "Observed"))
                        .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                        .annotation(position: .trailing) { Text(current.formatted()).font(.caption2) }
                    BarMark(x: .value("Movements", baseline), y: .value("Period", "Baseline"))
                        .foregroundStyle(Color.secondary.opacity(0.5))
                        .annotation(position: .trailing) { Text(baseline.formatted()).font(.caption2) }
                }.frame(height: 100)
                Text("Arrivals and departures · Same completed UTC hours. Telemetry coverage; a change alone does not establish disruption.")
                    .font(.caption2).foregroundStyle(.secondary)
                DisclosureGroup("Explore this anomaly’s movements", isExpanded: $showsMovements) {
                    if showsMovements { EventMovementDetailView(eventID: detail.event.id).id(detail.event.id) }
                }.font(.subheadline).padding(.vertical, 8)
            }
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
            ForEach(detail.context_signals.filter { !$0.metrics.isEmpty && (activeFilter == nil || $0.domain == activeFilter) }) { context in
                regionalSignalRow(context)
            }
            if (activeFilter == nil || activeFilter == "news"), let regional = detail.regional_reporting, !regional.items.isEmpty {
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
                    if item.summary_translation_status == "translated" {
                        Text("AI-generated English summary · source headline/excerpt only")
                            .font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    } else if item.translation_status == "translated" {
                        Text("Original source excerpt").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    }
                    Text(summary).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
                if let originalSummary = IntelligenceTranslationPresentation.original(item.original_summary, display: item.source_summary) {
                    Text("Original source excerpt: \(originalSummary)").font(.caption).foregroundStyle(.secondary)
                }
                if let original = IntelligenceTranslationPresentation.original(item.original_title, display: item.source_title) {
                    Text("Original headline: \(original)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let translation = item.translation {
                    Text("Headline translation: \(translation.provider)\(translation.model.map { " · \($0)" } ?? "")")
                        .font(.caption2).foregroundStyle(.secondary)
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
                ForEach(item.transcript_excerpts ?? []) { excerpt in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(excerpt.timeLabel).font(.caption.weight(.semibold))
                        Text(excerpt.quote).font(.caption)
                        Text("Attributed transcript · not independent confirmation").font(.caption2).foregroundStyle(.secondary)
                    }
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
                    if let disclosure = item.headlineTranslationDisclosure {
                        Text(disclosure).font(.caption2).foregroundStyle(.secondary)
                    }
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
            showsEvidence = false
            showsContext = false
            showsEventOptions = false
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
            guard !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
        guard !Task.isCancelled else { return }
        if let nextWatches = await watchTask.value { watches = nextWatches }
        guard !Task.isCancelled else { return }
        if let nextAlerts = await alertTask.value { alerts = nextAlerts }
    }

    private func loadDetail(includeContext: Bool = false) async {
        guard let selectedID else {
            detail = nil
            detailError = nil
            detailLoading = false
            return
        }
        if detail?.event.id != selectedID { detail = nil }
        let requestID = UUID()
        detailRequestID = requestID
        detailError = nil
        detailLoading = true
        defer {
            if self.selectedID == selectedID, detailRequestID == requestID { detailLoading = false }
        }
        do {
            let loaded: IntelligenceEventDetail
            #if DEBUG
            if let fixture = model.mapReviewEvent, fixture.event.id == selectedID { loaded = fixture }
            else { loaded = try await model.api.fetchIntelligenceEvent(id: selectedID, includeContext: includeContext || showsContext) }
            #else
            loaded = try await model.api.fetchIntelligenceEvent(id: selectedID, includeContext: includeContext || showsContext)
            #endif
            guard !Task.isCancelled, self.selectedID == selectedID, detailRequestID == requestID else { return }
            detail = loaded
            if contextualEventID != nil, model.selectedIntelligenceEventID == loaded.event.id {
                model.selectIntelligenceEvent(loaded.event)
            }
            if !events.contains(where: { $0.id == loaded.event.id }) {
                events.insert(loaded.event, at: 0)
            }
        } catch {
            guard !Task.isCancelled, self.selectedID == selectedID, detailRequestID == requestID else { return }
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
                    if let disclosure = event.headlineTranslationDisclosure {
                        Text(disclosure).font(.caption2).foregroundStyle(.secondary)
                    }
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

private struct ReusedContextImageCard: View {
    let image: IntelligenceContextImage
    let onOpenInvestigation: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Group {
                if image.isStoredAsset {
                    AuthenticatedEarthImage(path: image.displayURL, contentMode: .fit, unavailableLabel: "Location image unavailable")
                } else {
                    AuthenticatedRemoteImage(url: image.displayURL, unavailableLabel: "Location image unavailable", contentMode: .fit)
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            Label(image.kind == "satellite" ? "PREVIOUS SATELLITE CONTEXT" : "PREVIOUS ARTICLE IMAGE", systemImage: image.kind == "satellite" ? "globe" : "newspaper")
                .font(.caption2.weight(.bold))
            Text(image.title).font(.subheadline.weight(.semibold)).lineLimit(3)
            if let location = image.location_name { Text(location).font(.caption) }
            if let date = image.displayDate {
                Text("\(image.dateLabel) \(date.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption.monospacedDigit())
            }
            Text(image.notice).font(.caption2).foregroundStyle(.secondary)
            Text(image.attribution).font(.caption2).foregroundStyle(.secondary)
            Text(image.license).font(.caption2).foregroundStyle(.secondary)
            if let source = image.source_url, let url = URL(string: source), ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                Link("Original source", destination: url).font(.caption.weight(.semibold))
            }
            if let eventID = image.source_event_id {
                Button { onOpenInvestigation(eventID) } label: {
                    Text(image.source_event_title ?? "Original investigation")
                        .font(.caption.weight(.semibold))
                        .multilineTextAlignment(.leading)
                        .frame(minHeight: ClaritasLayout.minimumTouchTarget, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open original investigation: \(image.source_event_title ?? eventID)")
            }
        }
        .padding(10)
        .background(.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
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

private struct DevelopmentSignalVisual: View {
    let visual: OverviewSignalVisual
    var compact = false
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if visual.kind == "transport", let current = visual.current, let baseline = visual.baseline,
               current.isFinite, baseline.isFinite, current >= 0, baseline >= 0 {
                Text(compact ? "Transport · \(visual.observed_at.formatted(date: .omitted, time: .shortened))" : "Transport activity").font(.caption2.weight(.semibold))
                GeometryReader { geometry in
                    VStack(alignment: .leading, spacing: 6) {
                        bar("Observed", value: current, maximum: max(1, max(current, baseline)), width: geometry.size.width, color: .orange)
                        bar("Baseline", value: baseline, maximum: max(1, max(current, baseline)), width: geometry.size.width, color: .secondary)
                    }
                }.frame(height: 36)
            } else if visual.kind == "weather" {
                HStack {
                    if let temperature = visual.temp_c { Label(String(format: "%.1f°C", temperature), systemImage: "thermometer.medium") }
                    if let rain = visual.precipitation_mm { Text(String(format: "%.1f mm", rain)) }
                    if let wind = visual.wind_speed { Text(String(format: "%.1f m/s", wind)) }
                }.font(.caption.weight(.semibold))
            }
            if !compact { Text("\(visual.label) · \(visual.observed_at.formatted(date: .abbreviated, time: .shortened))").font(.caption2).foregroundStyle(.secondary) }
            else if visual.kind == "weather" { Text("Country weather reference · \(visual.observed_at.formatted(date: .omitted, time: .shortened))").font(.caption2).foregroundStyle(.secondary) }
        }.padding(compact ? 5 : 8).background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .combine).accessibilityHint("\(visual.label), observed \(visual.observed_at.formatted())")
    }
    private func bar(_ label: String, value: Double, maximum: Double, width: CGFloat, color: Color) -> some View {
        HStack(spacing: 6) {
            Text(label).frame(width: 56, alignment: .leading)
            Capsule().fill(color).frame(width: max(1, max(1, width - 116) * CGFloat(value / maximum)), height: 5)
            Text(value.formatted()).lineLimit(1)
        }.font(.system(size: 10))
    }
}

struct AuthenticatedEarthImage: View {
    @EnvironmentObject private var model: AppModel
    let path: String
    var compact = false
    var contentMode: ContentMode = .fill
    var unavailableLabel = "Observation image unavailable"
    @State private var image: UIImage?
    @State private var loadError: String?
    @State private var retryID = 0

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else if let loadError {
                if compact {
                    Image(systemName: "photo.badge.exclamationmark").font(.caption)
                        .frame(maxWidth: .infinity, maxHeight: .infinity).background(.secondary.opacity(0.08))
                        .accessibilityLabel("Image unavailable")
                } else {
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
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.secondary.opacity(0.08))
            }
        }
        .task(id: "\(path)-\(retryID)") {
            image = nil
            loadError = nil
            do {
                let data = try await model.api.fetchStoredImage(path: path)
                let decoded = try await NativeImageDecoder.decode(data)
                try Task.checkCancellation()
                image = decoded
            } catch {
                guard !Task.isCancelled else { return }
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
                let decoded = try await NativeImageDecoder.decode(data)
                try Task.checkCancellation()
                image = decoded
            } catch {
                guard !Task.isCancelled else { return }
                loadError = error.localizedDescription
            }
        }
    }
}

private enum NativeImageDecoder {
    /// Decode a display-sized bitmap off the main actor. Source images can be
    /// much larger than their card; ImageIO avoids allocating their full raster.
    static func decode(_ data: Data) async throws -> UIImage {
        try Task.checkCancellation()
        let decoding = Task.detached(priority: .utility) {
            try Task.checkCancellation()
            guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
                  let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: 1_536,
                    kCGImageSourceShouldCacheImmediately: true,
                  ] as CFDictionary) else {
                throw APIError(status: 502, message: "The returned asset is not a supported image.")
            }
            try Task.checkCancellation()
            return UIImage(cgImage: thumbnail)
        }
        return try await withTaskCancellationHandler {
            try await decoding.value
        } onCancel: {
            decoding.cancel()
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

/// A single scoped read drives the chart, topic pulse and event timeline.
struct IntelligenceOverviewPanel: View {
    var automaticallyRefresh = true
    var embedded = false
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase
    @State private var showsExplanation = false
    @State private var showsMore = false

    private var scope: IntelligenceOverviewScope { model.overviewScope }
    private var countries: [String] {
        Array(Set(model.countryStats.map(\.country)
            + (model.intelligenceOverview?.countries?.map(\.country_iso2) ?? [])
            + (model.intelligenceOverview?.locations.compactMap(\.country_iso2) ?? [])
            + (model.selectedCountry.map { [$0] } ?? []))).sorted {
                countryName($0).localizedStandardCompare(countryName($1)) == .orderedAscending
            }
    }

    var body: some View {
        BrandCard(framed: !embedded) {
            header
            if !embedded { controls }
            if let overview = model.intelligenceOverview {
                if !overview.hasUsableData {
                    ProgressView("Preparing this overview")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, minHeight: 96)
                } else {
                    if overview.snapshot?.isStale == true {
                        Label("Last saved overview", systemImage: "clock.arrow.circlepath")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    if embedded {
                        Text(overview.summary.momentumLabel)
                            .font(.caption).foregroundStyle(.secondary)
                    } else {
                        summary(overview)
                        topics(overview)
                    }
                    activityChart(overview)
                    if embedded { topics(overview) }
                    Divider().padding(.vertical, 4)
                    timeline(overview)
                }
                DisclosureGroup(isExpanded: $showsExplanation) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(overview.coverage.comparison_notice)
                        Text(overview.coverage.priority_notice)
                        Text(overview.coverage.notice)
                        Text("Activity covers the full window; developments show the latest updates.")
                        Text("Updated \(overview.generated_at.formatted(date: .abbreviated, time: .shortened))")
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                } label: {
                    Text("How this view is measured").font(.caption.weight(.semibold))
                }
                if overview.coverage.truncated {
                    Label("Bounded sample · some investigations are outside this view", systemImage: "info.circle")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if let error = model.intelligenceOverviewError {
                    refreshFailure(error)
                }
            } else if model.isRefreshingIntelligenceOverview {
                ProgressView("Loading overview")
                    .frame(maxWidth: .infinity, minHeight: 96)
            } else {
                refreshFailure(model.intelligenceOverviewError ?? "The event picture is not available yet.")
            }
        }
        .task(id: "\(scope.requestKey)|\(scenePhase == .active)") {
            guard automaticallyRefresh, scenePhase == .active else { return }
            showsMore = false
            while !Task.isCancelled {
                await model.refreshIntelligenceOverview()
                let delay: UInt64 = model.intelligenceOverview?.snapshot?.isWarming == true
                    ? 15_000_000_000 : 120_000_000_000
                do { try await Task.sleep(nanoseconds: delay) }
                catch { return }
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            if embedded {
                Menu {
                    Picker("Event priority", selection: $model.overviewPriority) {
                        Text("High priority").tag("high")
                        Text("All events").tag("all")
                    }
                    Picker("Time window", selection: $model.overviewHours) {
                        Text("24 hours").tag(24)
                        Text("3 days").tag(72)
                        Text("7 days").tag(168)
                    }
                    Picker("Topic", selection: $model.overviewTopic) {
                        Text("All topics").tag(Optional<String>.none)
                        ForEach(IntelligenceOverviewScope.topics, id: \.key) { topic in
                            Text(topic.label).tag(Optional(topic.key))
                        }
                    }
                    Picker("Location", selection: $model.selectedCountry) {
                        Text("Worldwide").tag(Optional<String>.none)
                        ForEach(countries, id: \.self) { country in
                            Text(countryName(country)).tag(Optional(country))
                        }
                    }
                } label: {
                    Label(model.overviewPriority == "high" ? "High priority" : "All developments", systemImage: "line.3.horizontal.decrease")
                        .font(.caption.weight(.semibold)).frame(minHeight: 44)
                }.accessibilityLabel("Filter developments")
            } else {
                VStack(alignment: .leading, spacing: 3) {
                Text("Developments")
                    .font(.title3.weight(.semibold))
                }
            }
            Spacer(minLength: 8)
            Button {
                Task { await model.refreshIntelligenceOverview(force: true) }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .frame(minWidth: 44, minHeight: 44)
            }
            .disabled(model.isRefreshingIntelligenceOverview)
            .accessibilityLabel("Refresh overview")
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("Event priority", selection: $model.overviewPriority) {
                Text("High priority").tag("high")
                Text("All events").tag("all")
            }
            .pickerStyle(.segmented)
            Picker("Time window", selection: $model.overviewHours) {
                Text("24 hours").tag(24)
                Text("3 days").tag(72)
                Text("7 days").tag(168)
            }
            .pickerStyle(.segmented)
            HStack {
                Picker("Topic", selection: $model.overviewTopic) {
                    Text("All topics").tag(Optional<String>.none)
                    ForEach(IntelligenceOverviewScope.topics, id: \.key) { topic in
                        Text(topic.label).tag(Optional(topic.key))
                    }
                }
                .pickerStyle(.menu)
                Spacer()
                Picker("Location", selection: $model.selectedCountry) {
                    Text("Worldwide").tag(Optional<String>.none)
                    ForEach(countries, id: \.self) { country in
                        Text(countryName(country)).tag(Optional(country))
                    }
                }
                .pickerStyle(.menu)
            }
            .font(.caption.weight(.semibold))
        }
    }

    private func summary(_ overview: IntelligenceOverview) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(overview.summary.event_count)\(overview.coverage.truncated ? "+" : "")")
                    .font(.system(.title2, design: .rounded).weight(.semibold))
                    .monospacedDigit()
                Text("updated investigations").font(.caption).foregroundStyle(.secondary)
            }
            Label(overview.coverage.comparison_available ? overview.summary.momentumLabel : "Sample capped · comparison unavailable",
                  systemImage: overview.coverage.comparison_available ? overview.summary.momentumIcon : "info.circle")
                .font(.caption.weight(.medium))
                .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
            HStack(spacing: 18) {
                if model.overviewPriority == "all" {
                    Label("\(overview.summary.high_priority_count) high priority", systemImage: "bolt")
                }
                Label("\(overview.summary.location_count) locations", systemImage: "mappin.and.ellipse")
            }
            .font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func activityChart(_ overview: IntelligenceOverview) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Activity through time").font(.caption.weight(.semibold))
                Spacer()
                Text("Recorded updates").font(.caption2).foregroundStyle(.secondary)
            }
            Chart(overview.buckets) { bucket in
                let midpoint = bucket.start.addingTimeInterval(bucket.end.timeIntervalSince(bucket.start) / 2)
                if overview.coverage.comparison_available {
                    BarMark(x: .value("Time", midpoint), y: .value("Previous", bucket.previous_event_count))
                        .foregroundStyle(.secondary.opacity(0.23))
                        .position(by: .value("Window", "Previous"))
                }
                BarMark(x: .value("Time", midpoint), y: .value("Current", bucket.event_count))
                    .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme).opacity(model.overviewBucket == nil || overview.buckets.firstIndex(where: { $0.id == bucket.id }) == model.overviewBucket ? 1 : 0.35))
                    .position(by: .value("Window", "Current"))
            }
            .chartOverlay { proxy in
                GeometryReader { geometry in
                    Rectangle().fill(.clear).contentShape(Rectangle())
                        .gesture(SpatialTapGesture().onEnded { value in
                            let plot = geometry[proxy.plotAreaFrame]
                            guard plot.contains(value.location), let date: Date = proxy.value(atX: value.location.x - plot.minX),
                                  let index = overview.buckets.firstIndex(where: { date >= $0.start && date < $0.end }) else { return }
                            model.overviewBucket = model.overviewBucket == index ? nil : index
                            showsMore = false
                        })
                }
            }
            .chartLegend(.hidden)
            .chartXScale(domain: overview.window.start...overview.window.end)
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { value in
                    AxisGridLine()
                    AxisValueLabel(format: overview.window.bucket_hours < 24 ? .dateTime.hour() : .dateTime.month().day())
                }
            }
            .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) }
            .frame(height: 112)
            .accessibilityLabel(overview.coverage.comparison_available
                ? "Investigation activity: \(overview.summary.event_count) in the selected window; \(overview.summary.previous_event_count) in the previous window."
                : "At least \(overview.summary.event_count) sampled investigation updates. Comparison unavailable because the sample is capped.")
            HStack(spacing: 12) {
                Label("Selected window", systemImage: "square.fill")
                    .foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                if overview.coverage.comparison_available {
                    Label("Previous window", systemImage: "square.fill").foregroundStyle(.secondary)
                }
            }
            .font(.caption2)
            HStack {
                if let selection = overview.selection, overview.filters.bucket == model.overviewBucket {
                    Text("\(selection.event_count) updates · \(selection.start.formatted(date: .abbreviated, time: .shortened)) – \(selection.end.formatted(date: .omitted, time: .shortened))")
                        .font(.caption2).foregroundStyle(.secondary)
                } else {
                    Text(model.overviewBucket == nil ? "Tap an interval to explore the map and developments" : model.intelligenceOverviewError == nil ? "Loading selected interval…" : "Selected interval unavailable")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                if model.overviewBucket != nil { Button("Full period") { model.overviewBucket = nil }.font(.caption2).frame(minHeight: 44) }
                Menu {
                    Button("Full period") { model.overviewBucket = nil }
                    ForEach(Array(overview.buckets.enumerated()), id: \.offset) { index, bucket in
                        Button("\(bucket.start.formatted(date: .abbreviated, time: .shortened)) · \(bucket.event_count) updates") { model.overviewBucket = index; showsMore = false }
                    }
                } label: { Image(systemName: "clock").frame(minWidth: 44, minHeight: 44) }
                .accessibilityLabel("Choose activity interval or return to full period")
            }
        }
    }

    @ViewBuilder
    private func topics(_ overview: IntelligenceOverview) -> some View {
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 8) {
                    Button("All topics") { model.overviewTopic = nil }
                        .font(.caption.weight(.semibold)).padding(.horizontal, 12).frame(minHeight: 44)
                        .background(model.overviewTopic == nil ? ClaritasPalette.shellAccent(for: colorScheme).opacity(0.2) : ClaritasPalette.shellSurfaceMuted(for: colorScheme), in: Capsule())
                    ForEach(IntelligenceOverviewScope.topics, id: \.key) { topic in
                        Button {
                            model.overviewTopic = model.overviewTopic == topic.key ? nil : topic.key
                        } label: {
                            HStack(spacing: 5) {
                                Text(topic.label).font(.caption.weight(.semibold))
                                if let count = overview.topics.first(where: { $0.key == topic.key })?.event_count { Text(count.formatted()).font(.caption2.monospacedDigit()) }
                            }
                            .padding(10)
                            .frame(minHeight: 44, alignment: .leading)
                            .background(model.overviewTopic == topic.key ? ClaritasPalette.shellAccent(for: colorScheme).opacity(0.2) : ClaritasPalette.shellSurfaceMuted(for: colorScheme), in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Filter \(topic.label)")
                        .accessibilityAddTraits(model.overviewTopic == topic.key ? .isSelected : [])
                    }
                }
            }
    }

    private func timeline(_ overview: IntelligenceOverview) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Key developments").font(.subheadline.weight(.semibold))
            if overview.filters.bucket != model.overviewBucket {
                if model.intelligenceOverviewError == nil { ProgressView("Loading selected interval…").font(.caption) }
                else { Text("Selected interval unavailable. Retry below or return to the full period.").font(.caption).foregroundStyle(.secondary) }
            } else if overview.timeline.isEmpty {
                Text(model.overviewPriority == "high" ? "No high priority developments here. Try All events or a wider window." : "No developments in this scope.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            ForEach(Array(overview.timeline.prefix(overview.filters.bucket == model.overviewBucket ? (showsMore ? 24 : 8) : 0))) { entry in
                timelineRow(entry, overview: overview)
            }
            if overview.timeline.count > 8 {
                Button(showsMore ? "Show fewer developments" : "Show more developments") { showsMore.toggle() }
                    .font(.caption.weight(.semibold))
                    .frame(minHeight: 44)
            }
        }
    }

    private func timelineRow(_ entry: IntelligenceOverview.TimelineEntry, overview: IntelligenceOverview) -> some View {
        Button {
            if let event = overview.events.first(where: { $0.id == entry.event_id }) { model.selectIntelligenceEvent(event) }
            else { model.selectedIntelligenceEventID = entry.event_id }
        } label: {
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 5) {
                            Text(entry.severity.capitalized).fontWeight(.semibold)
                            Text(entry.occurred_at.formatted(date: .abbreviated, time: .shortened)).monospacedDigit()
                        }.font(.caption2).foregroundStyle(.secondary)
                        Text(entry.title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary).lineLimit(2)
                        Text([entry.topic_label, entry.location_name ?? entry.country_iso2.map(countryName)].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                        if let disclosure = entry.headlineTranslationDisclosure { Text(disclosure).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                        HStack(spacing: 5) {
                            if !entry.source_refs.isEmpty { Text("\(entry.source_refs.count) source\(entry.source_refs.count == 1 ? "" : "s")") }
                            else if let visual = entry.signal_visual { Text(visual.kind == "transport" ? "Transport data" : "Weather reference") }
                            if overview.events.first(where: { $0.id == entry.event_id })?.isArchived == true { Text("· Archived") }
                            Spacer(minLength: 2)
                            Image(systemName: "chevron.right")
                        }.font(.caption2).foregroundStyle(ClaritasPalette.shellAccent(for: colorScheme))
                    }
                    if let image = entry.imagery {
                        VStack(alignment: .leading, spacing: 3) {
                            AuthenticatedEarthImage(path: image.preview_url, compact: true).frame(width: 96, height: 72).clipped().cornerRadius(7)
                            Text(image.captured_at.map { "Satellite · \($0.formatted(date: .abbreviated, time: .omitted))" } ?? "Publisher photo")
                                .font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
                            Text(image.attribution).font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
                        }.frame(width: 96)
                        .accessibilityLabel("\(image.attribution), \(image.captured_at.map { "captured " + $0.formatted() } ?? "report updated " + entry.occurred_at.formatted())")
                    }
                }
                if let visual = entry.signal_visual { DevelopmentSignalVisual(visual: visual, compact: true) }
                Divider().padding(.top, 4)
            }
            .padding(.vertical, 5)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open investigation: \(entry.title), \(entry.severity) reported severity")
    }

    private func refreshFailure(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(message).font(.caption).foregroundStyle(.secondary)
            Button("Retry overview") { Task { await model.refreshIntelligenceOverview(force: true) } }
                .font(.caption.weight(.semibold)).frame(minHeight: 44)
                .disabled(model.isRefreshingIntelligenceOverview)
        }
    }

    private func countryName(_ code: String) -> String {
        Locale.current.localizedString(forRegionCode: code) ?? code
    }
}


/// Cached headline provenance is inspectable without another API/model read.
private struct IntelligenceHeadlineNotice: View {
    let disclosure: String?
    let original: String?
    let originalSummary: String?
    let summaryTranslated: Bool
    let translation: IntelligenceHeadlineTranslation?
    let availability: NewsTranslationAvailability?

    var body: some View {
        if let disclosure {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 5) {
                    if let original { Text("Original headline: \(original)") }
                    if let originalSummary { Text("Original source excerpt: \(originalSummary)") }
                    if let translation {
                        Text("\(translation.provider)\(translation.model.map { " · \($0)" } ?? "")")
                        if let date = translation.title_generated_at.flatMap(APIDateParser.parse) {
                            Text("Translated \(date.formatted(date: .abbreviated, time: .shortened))")
                        }
                        Text(summaryTranslated
                             ? "The headline is translated and the English summary is generated from the publisher headline/excerpt. Original reporting and source links are preserved."
                             : "Only the headline is translated. The source excerpt remains in its original language; original reporting and links are preserved.")
                    } else if let reason = availability?.reason {
                        Text(reason)
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            } label: {
                Text(disclosure).font(.caption2)
            }
        }
    }
}

/// Optional drill-down anchored to the selected anomaly, never a global transport page.
private struct EventMovementDetailView: View {
    let eventID: String
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var data: EventTransportDetail?
    @State private var loading = true
    @State private var failed = false
    @State private var retry = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if loading { ProgressView("Loading anomaly movements") }
            else if failed {
                Text("Movement details could not be loaded.").font(.caption)
                Button("Retry movements") { retry += 1 }.frame(minHeight: 44)
            } else if let data {
                Text(data.location_name).font(.headline)
                if let end = data.window_end {
                    Text("Comparison ends \(end.formatted(date: .abbreviated, time: .shortened)) · \(data.source_name ?? "Retained telemetry")")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                if !data.hours.isEmpty {
                    Text("Tracked movements by hour").font(.caption.weight(.semibold))
                    Chart(data.hours) { hour in
                        BarMark(x: .value("UTC hour", hour.utcHour), y: .value("Movements", hour.arrivals + hour.departures))
                            .foregroundStyle(ClaritasPalette.shellAccentSecondary(for: colorScheme))
                    }.frame(height: 140).chartXAxisLabel("UTC hour")
                }
                if !data.movements.isEmpty {
                    Text("Recent movements in this comparison").font(.caption.weight(.semibold))
                    ForEach(data.movements) { movement in
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(movement.entity_name ?? "Vessel \(movement.entity_id)").font(.caption.weight(.semibold))
                                Text("\(movement.event_type.capitalized) · \(movement.vehicle_category ?? "Vessel")")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(movement.observed_at.formatted(date: .omitted, time: .shortened)).font(.caption2.monospacedDigit())
                        }.padding(.vertical, 4)
                    }
                    Text("Movement times use your device time zone.").font(.caption2).foregroundStyle(.secondary)
                }
                if data.coverage == "summary_only" {
                    Text("Only the retained comparison summary is available.").font(.caption)
                }
                Text(data.notice).font(.caption2).foregroundStyle(.secondary)
            } else { Text("No retained movement details for this event.").font(.caption) }
        }
        .task(id: "\(eventID)|\(retry)") {
            loading = true; failed = false; data = nil
            do {
                let result: EventTransportDetail?
                #if DEBUG
                if let fixture = model.mapReviewTransport { result = fixture }
                else { result = try await model.api.fetchEventTransport(id: eventID) }
                #else
                result = try await model.api.fetchEventTransport(id: eventID)
                #endif
                guard !Task.isCancelled else { return }
                data = result; loading = false
            } catch {
                guard !Task.isCancelled else { return }
                loading = false; failed = true
            }
        }
    }
}
