import Foundation
import SwiftUI

struct RootView: View {
    enum Tab: Hashable {
        case overview
        case dashboard
        case briefing
        case news
        case podcasts
        case weather
        case markets
        case admin
        case profile
        case policies

        var title: String {
            switch self {
            case .overview: return "Signal desk"
            case .dashboard: return "Dashboard"
            case .briefing: return "Briefing"
            case .news: return "News"
            case .podcasts: return "Podcasts"
            case .weather: return "Weather"
            case .markets: return "Markets"
            case .admin: return "Admin"
            case .profile: return "Profile"
            case .policies: return "Policies"
            }
        }

        var icon: String {
            switch self {
            case .overview: return "rectangle.3.group.fill"
            case .dashboard: return "square.grid.2x2"
            case .briefing: return "sparkles"
            case .news: return "newspaper"
            case .podcasts: return "mic.fill"
            case .weather: return "cloud.sun"
            case .markets: return "chart.line.uptrend.xyaxis"
            case .admin: return "shield.lefthalf.filled"
            case .profile: return "person.crop.circle"
            case .policies: return "doc.text"
            }
        }
    }

    @EnvironmentObject private var model: AppModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var colorScheme
    @State private var tab: Tab = .dashboard
    @State private var sidebarSelection: Tab? = .overview
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @AppStorage("THEME_DARK") private var dark: Bool = false

    var body: some View {
        Group {
            if model.authStatus == .authed {
                if !model.hasPaidAccess, model.authUser != nil {
                    PaywallView()
                } else if horizontalSizeClass == .regular {
                    regularWidthShell
                } else {
                    compactShell
                }
            } else {
                LoginView()
            }
        }
        .preferredColorScheme(dark ? .dark : .light)
        .task {
            await model.bootstrap()
        }
        .task(id: marketRefreshTaskKey) {
            guard model.authStatus == .authed, model.hasPaidAccess else { return }
            while !Task.isCancelled {
                await model.refreshMarketQuotes(forceRefresh: true)
                try? await Task.sleep(nanoseconds: 20_000_000_000)
            }
        }
        .task(id: marketStatusTaskKey) {
            guard model.authStatus == .authed, model.hasPaidAccess else { return }
            while !Task.isCancelled {
                await model.refreshMarketStatus(forceRefresh: true)
                try? await Task.sleep(nanoseconds: 60_000_000_000)
            }
        }
    }

    private var compactShell: some View {
        TabView(selection: $tab) {
            compactTab(.dashboard)
            compactTab(.briefing)
            compactTab(.news)
            compactTab(.podcasts)
            compactTab(.weather)
            compactTab(.markets)

            if model.isAdmin {
                compactTab(.admin)
            }

            compactTab(.profile)
            compactTab(.policies)
        }
        .tint(ClaritasPalette.shellAccent(for: dark ? ColorScheme.dark : ColorScheme.light))
        .onChange(of: model.isAdmin) { isAdmin in
            if !isAdmin && tab == .admin {
                tab = .dashboard
            }
        }
    }

    private func compactTab(_ item: Tab) -> some View {
        NavigationStack {
            destinationView(for: item)
                .navigationTitle(item == .dashboard ? "Claritas" : item.title)
                .modifier(ShellNavigationChrome())
        }
        .tabItem { Label(item.title, systemImage: item.icon) }
        .tag(item)
    }

    private var regularWidthShell: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            sidebar
        } detail: {
            NavigationStack {
                destinationView(for: resolvedSidebarSelection)
                    .navigationTitle(resolvedSidebarSelection.title)
                    .modifier(ShellNavigationChrome())
            }
        }
        .navigationSplitViewStyle(.balanced)
        .tint(ClaritasPalette.shellAccent(for: colorScheme))
        .onChange(of: model.isAdmin) { isAdmin in
            if !isAdmin && sidebarSelection == .admin {
                sidebarSelection = .dashboard
            }
        }
    }

    private var resolvedSidebarSelection: Tab {
        if let sidebarSelection, sidebarItems.contains(sidebarSelection) {
            return sidebarSelection
        }
        return .overview
    }

    private var sidebarItems: [Tab] {
        model.isAdmin
            ? [.overview, .dashboard, .briefing, .news, .podcasts, .weather, .markets, .admin, .profile, .policies]
            : [.overview, .dashboard, .briefing, .news, .podcasts, .weather, .markets, .profile, .policies]
    }

    private var sidebar: some View {
        List(selection: $sidebarSelection) {
            Section("Workspace") {
                sidebarLink(.overview)
                sidebarLink(.dashboard)
                sidebarLink(.briefing)
            }
            Section("Signals") {
                sidebarLink(.news)
                sidebarLink(.podcasts)
                sidebarLink(.weather)
                sidebarLink(.markets)
            }
            if model.isAdmin {
                Section("Operations") {
                    sidebarLink(.admin)
                }
            }
            Section("Account") {
                sidebarLink(.profile)
                sidebarLink(.policies)
            }
        }
        .navigationTitle("Claritas")
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .background(ClaritasPalette.shellSidebar(for: colorScheme))
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                ThemeToggle()
            }
        }
        .safeAreaInset(edge: .bottom) {
            sidebarStatus
        }
    }

    private func sidebarLink(_ item: Tab) -> some View {
        Label(item.title, systemImage: item.icon)
            .tag(item)
    }

    private var sidebarStatus: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            HStack(spacing: 8) {
                Circle()
                    .fill(ClaritasPalette.positiveText(for: colorScheme))
                    .frame(width: 7, height: 7)
                Text("Live workspace")
                    .font(.caption.weight(.semibold))
                Spacer()
                ThemeToggle()
                    .buttonStyle(.plain)
            }
            Text(model.authUser?.display_name ?? model.authUser?.email ?? "Signed in")
                .font(.caption2)
                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                .lineLimit(1)
        }
        .padding(14)
        .background(.ultraThinMaterial)
    }

    @ViewBuilder
    private func destinationView(for item: Tab) -> some View {
        switch item {
        case .overview:
            PadOverviewView(destination: $sidebarSelection)
        case .dashboard:
            DashboardView()
        case .briefing:
            DailyBriefingWorkspaceView()
        case .news:
            NewsWorkspaceView()
        case .podcasts:
            PodcastWorkspaceView()
        case .weather:
            WeatherWorkspaceView()
        case .markets:
            MarketsWorkspaceView()
        case .admin:
            AdminWorkspaceView()
        case .profile:
            ProfileView()
        case .policies:
            PoliciesWorkspaceView()
        }
    }

    private var marketRefreshTaskKey: String {
        "\(model.authStatus.rawValue)-\(model.hasPaidAccess)-quotes"
    }

    private var marketStatusTaskKey: String {
        "\(model.authStatus.rawValue)-\(model.hasPaidAccess)-status"
    }
}

struct ThemeToggle: View {
    @AppStorage("THEME_DARK") private var dark: Bool = false

    var body: some View {
        Button(action: { dark.toggle() }) {
            Image(systemName: dark ? "sun.max" : "moon")
        }
    }
}

struct DailyBriefingWorkspaceView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var briefingScheduleEnabled: Bool = true
    @State private var briefingScheduleTime: String = "07:00"
    @State private var briefingScheduleTimezone: String = TimeZone.current.identifier

    private static let baseScheduleTimeOptions: [String] = stride(from: 0, to: 24 * 60, by: 30).map { minutes in
        String(format: "%02d:%02d", minutes / 60, minutes % 60)
    }

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(spacing: 16) {
                    briefingCard
                    scheduleCard
                    signalSummary
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
            .refreshable {
                await refreshBriefingData()
            }
        }
        .task {
            if model.dailyBriefingSchedule == nil {
                await model.loadDailyBriefingSchedule()
            }
            applyScheduleDraft(model.dailyBriefingSchedule)
        }
        .onChange(of: model.dailyBriefingSchedule?.updated_at) { _ in
            applyScheduleDraft(model.dailyBriefingSchedule)
        }
    }

    private var briefingCard: some View {
        BrandCard(title: "Daily briefing", icon: "sparkles") {
            if let briefing = model.dailyBriefing {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(briefing.title)
                                .font(.title2.weight(.semibold))
                                .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                            Text("Updated \(briefing.updatedDate?.formatted(date: .abbreviated, time: .shortened) ?? briefing.briefing_date)")
                                .font(.caption)
                                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        }
                        Spacer()
                        Text(briefing.status.uppercased())
                            .font(.caption2.weight(.semibold))
                            .tracking(1.6)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(ClaritasPalette.positiveText(for: colorScheme).opacity(0.16), in: Capsule())
                            .foregroundStyle(ClaritasPalette.positiveText(for: colorScheme))
                    }

                    Text(briefing.update_text)
                        .font(.body)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        .fixedSize(horizontal: false, vertical: true)

                    if !briefing.key_takeaways.isEmpty {
                        Divider()
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(Array(briefing.key_takeaways.prefix(6).enumerated()), id: \.offset) { _, takeaway in
                                HStack(alignment: .top, spacing: 9) {
                                    Circle()
                                        .fill(ClaritasPalette.shellAccent(for: colorScheme))
                                        .frame(width: 6, height: 6)
                                        .padding(.top, 6)
                                    Text(takeaway)
                                        .font(.subheadline)
                                        .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }

                    Button {
                        Task { await refreshBriefingData() }
                    } label: {
                        Label("Refresh briefing", systemImage: "arrow.clockwise")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(ClaritasPalette.shellAccent(for: colorScheme))
                }
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "doc.text.magnifyingglass")
                        .font(.largeTitle)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    Text("No published briefing")
                        .font(.headline)
                        .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                    Button {
                        Task { await refreshBriefingData() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(ClaritasPalette.shellAccent(for: colorScheme))
                }
                .frame(maxWidth: .infinity, minHeight: 180)
            }
        }
    }

    private var scheduleCard: some View {
        BrandCard(title: "Schedule", icon: "clock.badge.checkmark") {
            VStack(alignment: .leading, spacing: 14) {
                Toggle(isOn: $briefingScheduleEnabled) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Daily briefing")
                            .font(.subheadline.weight(.semibold))
                        Text(scheduleSummary)
                            .font(.caption)
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Time")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        Picker("Time", selection: $briefingScheduleTime) {
                            ForEach(scheduleTimeOptions, id: \.self) { time in
                                Text(time).tag(time)
                            }
                        }
                        .pickerStyle(.menu)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Timezone")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        Picker("Timezone", selection: $briefingScheduleTimezone) {
                            ForEach(DailyBriefingScheduleOptions.timezoneOptions(including: briefingScheduleTimezone), id: \.self) { timezone in
                                Text(timezone).tag(timezone)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                }
                .padding(12)
                .background(ClaritasPalette.shellSurface(for: colorScheme), in: RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
                )

                if let schedule = model.dailyBriefingSchedule {
                    VStack(spacing: 8) {
                        BriefingInfoRow(label: "Last run", value: schedule.lastTriggeredDate.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "Not yet")
                        BriefingInfoRow(label: "Schedule date", value: schedule.last_scheduled_for ?? "—")
                    }
                } else if model.isLoadingDailyBriefingSchedule {
                    ProgressView("Loading schedule")
                        .font(.caption)
                }

                if let notice = model.dailyBriefingScheduleNotice {
                    Text(notice)
                        .font(.caption)
                        .foregroundStyle(ClaritasPalette.positiveText(for: colorScheme))
                }

                if let error = model.dailyBriefingScheduleError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(ClaritasPalette.negativeText(for: colorScheme))
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(ClaritasPalette.negativeText(for: colorScheme).opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                }

                Button {
                    saveBriefingSchedule()
                } label: {
                    Label(
                        model.isSavingDailyBriefingSchedule ? "Saving" : "Save schedule",
                        systemImage: "clock.badge.checkmark"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(ClaritasPalette.shellAccent(for: colorScheme))
                .disabled(model.isSavingDailyBriefingSchedule || model.isLoadingDailyBriefingSchedule)
            }
        }
    }

    private var signalSummary: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 12)], spacing: 12) {
            BrandMetricCard(title: "News", value: "\(model.news.count)", detail: "Signals in scope", tone: ClaritasPalette.dataBlue(for: colorScheme))
            BrandMetricCard(title: "Podcasts", value: "\(model.podcasts.count)", detail: "Evidence sources", tone: ClaritasPalette.shellAccentSecondary(for: colorScheme))
            BrandMetricCard(title: "Weather", value: "\(model.weather.count)", detail: "Current observations", tone: ClaritasPalette.shellAccent(for: colorScheme))
            BrandMetricCard(title: "Markets", value: "\(model.marketQuotes.count)", detail: "Tracked symbols", tone: ClaritasPalette.positiveText(for: colorScheme))
        }
    }

    private var scheduleSummary: String {
        guard briefingScheduleEnabled else { return "Paused" }
        return "Scheduled at \(briefingScheduleTime) \(briefingScheduleTimezone)"
    }

    private var scheduleTimeOptions: [String] {
        if Self.baseScheduleTimeOptions.contains(briefingScheduleTime) {
            return Self.baseScheduleTimeOptions
        }
        return ([briefingScheduleTime] + Self.baseScheduleTimeOptions)
            .reduce(into: [String]()) { options, value in
                if !options.contains(value) {
                    options.append(value)
                }
            }
    }

    private func applyScheduleDraft(_ schedule: DailyBriefingSchedule?) {
        guard let schedule else { return }
        briefingScheduleEnabled = schedule.enabled
        briefingScheduleTime = normalizedScheduleTime(schedule.scheduled_time)
        briefingScheduleTimezone = schedule.timezone.isEmpty ? TimeZone.current.identifier : schedule.timezone
    }

    private func saveBriefingSchedule() {
        let timezone = briefingScheduleTimezone.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !timezone.isEmpty else {
            model.dailyBriefingScheduleError = "Timezone is required."
            model.dailyBriefingScheduleNotice = nil
            return
        }

        Task {
            await model.updateDailyBriefingSchedule(
                enabled: briefingScheduleEnabled,
                scheduledTime: briefingScheduleTime,
                timezone: timezone
            )
        }
    }

    private func refreshBriefingData() async {
        await model.loadInitial()
        applyScheduleDraft(model.dailyBriefingSchedule)
    }

    private func normalizedScheduleTime(_ value: String) -> String {
        let parts = value.split(separator: ":")
        let hour = parts.first.flatMap { Int($0) } ?? 7
        let minute = parts.dropFirst().first.flatMap { Int($0) } ?? 0
        return String(format: "%02d:%02d", max(0, min(hour, 23)), max(0, min(minute, 59)))
    }
}

struct PodcastWorkspaceView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var query = ""
    @State private var signalType = "all"

    private let signalTypes = ["all", "entity", "topic", "claim", "event", "risk"]

    var body: some View {
        BrandBackground {
            ScrollView {
                LazyVStack(spacing: 16) {
                    controls
                    metrics

                    if let error = model.podcastLoadError {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(ClaritasPalette.negativeText(for: colorScheme))
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                ClaritasPalette.negativeText(for: colorScheme).opacity(0.12),
                                in: RoundedRectangle(cornerRadius: 10)
                            )
                    }

                    if model.podcasts.isEmpty && !model.isRefreshingPodcasts {
                        BrandCard(title: "No podcast intelligence", icon: "mic.slash") {
                            Text("No episodes match the current filters.")
                                .font(.subheadline)
                                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                .frame(maxWidth: .infinity, minHeight: 100)
                        }
                    }

                    ForEach(model.podcasts) { episode in
                        episodeCard(episode)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
            .refreshable {
                await refresh()
            }
        }
        .task {
            if model.podcasts.isEmpty {
                await refresh()
            }
        }
    }

    private var controls: some View {
        BrandCard(title: "Podcast evidence", icon: "waveform") {
            VStack(spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    TextField("Episode, entity, claim, event, or risk", text: $query)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit {
                            Task { await refresh() }
                        }
                    if !query.isEmpty {
                        Button {
                            query = ""
                            Task { await refresh() }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Clear podcast search")
                    }
                }
                .padding(10)
                .background(
                    ClaritasPalette.shellSurface(for: colorScheme),
                    in: RoundedRectangle(cornerRadius: 10)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
                )

                HStack {
                    Picker("Signal type", selection: $signalType) {
                        ForEach(signalTypes, id: \.self) { option in
                            Text(signalTypeLabel(option)).tag(option)
                        }
                    }
                    .pickerStyle(.menu)
                    .onChange(of: signalType) { _ in
                        Task { await refresh() }
                    }

                    Spacer()

                    Button {
                        Task { await refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .disabled(model.isRefreshingPodcasts)
                    .accessibilityLabel("Refresh podcast intelligence")
                }
            }
        }
    }

    private var metrics: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 12)], spacing: 12) {
            BrandMetricCard(
                title: "Episodes",
                value: "\(model.podcasts.count)",
                detail: "Current scope",
                tone: ClaritasPalette.dataBlue(for: colorScheme)
            )
            BrandMetricCard(
                title: "Transcripts",
                value: "\(model.podcasts.filter { $0.transcript_status == "available" }.count)",
                detail: "Evidence ready",
                tone: ClaritasPalette.positiveText(for: colorScheme)
            )
            BrandMetricCard(
                title: "Signals",
                value: "\(model.podcasts.reduce(0) { $0 + $1.signals.count })",
                detail: "Extracted findings",
                tone: ClaritasPalette.shellAccentSecondary(for: colorScheme)
            )
        }
    }

    private func episodeCard(_ episode: PodcastEpisode) -> some View {
        BrandCard(title: episode.feed_title, icon: "mic.fill") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 12) {
                    AsyncImage(url: URL(string: episode.image_url ?? episode.feed_image_url ?? "")) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Image(systemName: "waveform")
                            .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    }
                    .frame(width: 72, height: 72)
                    .background(ClaritasPalette.shellSurface(for: colorScheme))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                    VStack(alignment: .leading, spacing: 5) {
                        Text(episode.title)
                            .font(.headline)
                            .foregroundStyle(ClaritasPalette.shellInk(for: colorScheme))
                            .fixedSize(horizontal: false, vertical: true)
                        Text(
                            [
                                episode.eventDate?.formatted(date: .abbreviated, time: .shortened),
                                episode.durationLabel,
                                "Transcript \(episode.transcript_status)"
                            ]
                            .compactMap { $0 }
                            .joined(separator: " · ")
                        )
                        .font(.caption)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    }
                }

                if let summary = episode.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.subheadline)
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                        .lineLimit(4)
                }

                if !episode.external_links.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(episode.external_links) { link in
                                if let url = link.resolvedURL {
                                    Link(destination: url) {
                                        Label(link.label, systemImage: "arrow.up.right")
                                            .font(.caption.weight(.semibold))
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                        }
                    }
                }

                if !episode.signals.isEmpty {
                    Divider()
                    Text("Extracted signals")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    ForEach(episode.signals.prefix(5)) { signal in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 7) {
                                Text(signal.type.uppercased())
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(signalTone(signal))
                                if let risk = signal.risk_level {
                                    Text(risk.uppercased())
                                        .font(.caption2.weight(.semibold))
                                        .foregroundStyle(ClaritasPalette.shellAccentSecondary(for: colorScheme))
                                }
                            }
                            Text(signal.title)
                                .font(.subheadline.weight(.semibold))
                            if let summary = signal.summary {
                                Text(summary)
                                    .font(.caption)
                                    .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }

                if !episode.evidence.isEmpty {
                    Divider()
                    Text("Timestamped evidence")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                    ForEach(episode.evidence.prefix(4)) { evidence in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(evidence.timestampLabel)
                                    .font(.caption.monospacedDigit())
                                if let speaker = evidence.speaker {
                                    Text(speaker)
                                        .font(.caption.weight(.semibold))
                                }
                                Spacer()
                                if let source = evidence.source_url, let url = URL(string: source) {
                                    Link(destination: url) {
                                        Image(systemName: "arrow.up.right")
                                    }
                                    .accessibilityLabel("Open transcript source")
                                }
                            }
                            Text(evidence.text)
                                .font(.caption)
                                .foregroundStyle(ClaritasPalette.shellMuted(for: colorScheme))
                                .lineLimit(4)
                        }
                    }
                }
            }
        }
    }

    private func signalTone(_ signal: PodcastSignal) -> Color {
        switch signal.type {
        case "risk": return ClaritasPalette.negativeText(for: colorScheme)
        case "event": return ClaritasPalette.shellAccentSecondary(for: colorScheme)
        case "claim": return ClaritasPalette.dataBlue(for: colorScheme)
        default: return ClaritasPalette.positiveText(for: colorScheme)
        }
    }

    private func signalTypeLabel(_ value: String) -> String {
        switch value {
        case "entity": return "Entities"
        case "topic": return "Topics"
        case "claim": return "Claims"
        case "event": return "Events"
        case "risk": return "Risks"
        default: return "All signals"
        }
    }

    private func refresh() async {
        let cleanQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        await model.refreshPodcasts(
            query: cleanQuery.isEmpty ? nil : cleanQuery,
            signalType: signalType == "all" ? nil : signalType
        )
    }
}

private struct BriefingInfoRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline.weight(.semibold))
                .multilineTextAlignment(.trailing)
        }
    }
}

private struct ShellNavigationChrome: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    ThemeToggle()
                }
            }
            .toolbarBackground(.ultraThinMaterial, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarBackground(.ultraThinMaterial, for: .tabBar)
            .toolbarBackground(.visible, for: .tabBar)
            .tint(ClaritasPalette.shellAccent(for: colorScheme))
    }
}

struct PaywallView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openURL) private var openURL
    @State private var isSigningOut: Bool = false

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(spacing: 16) {
                    AdminCard {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Payment required")
                                .font(.caption.weight(.semibold))
                                .tracking(2)
                                .foregroundStyle(.secondary)

                            Text("Activate access to Claritas")
                                .font(.title3.weight(.semibold))

                            Text(
                                "You are signed in as \(userLabel), but this account does not currently have paid access to the application data endpoints."
                            )
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    AdminCard {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Status: \(reasonLabel)")
                                .font(.headline)

                            Text(subscriptionSummary)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)

                            if let periodEndSummary {
                                Text(periodEndSummary)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            HStack(spacing: 10) {
                                Button("Subscribe now") {
                                    openLink(billing?.checkout_url)
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(checkoutURL == nil)

                                if portalURL != nil {
                                    Button("Manage billing") {
                                        openLink(billing?.portal_url)
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }

                            HStack(spacing: 10) {
                                Button(model.isRefreshingAccess ? "Checking…" : "I have paid, refresh") {
                                    Task {
                                        await model.refreshAccess()
                                    }
                                }
                                .buttonStyle(.bordered)
                                .disabled(model.isRefreshingAccess)

                                Button(isSigningOut ? "Signing out…" : "Sign out") {
                                    Task {
                                        await signOut()
                                    }
                                }
                                .buttonStyle(.bordered)
                                .disabled(isSigningOut)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
        }
    }

    private var billing: BillingAccessState? {
        model.billingState
    }

    private var userLabel: String {
        if let email = model.authUser?.email, !email.isEmpty {
            return email
        }
        if let name = model.authUser?.display_name, !name.isEmpty {
            return name
        }
        if let id = model.authUser?.id {
            return "user #\(id)"
        }
        return "your account"
    }

    private var reasonLabel: String {
        switch billing?.reason ?? "" {
        case "no_subscription":
            return "No active subscription"
        case "subscription_expired":
            return "Subscription expired"
        case "subscription_inactive":
            return "Subscription inactive"
        case "trialing_subscription":
            return "Trial access"
        case "grace_period":
            return "Grace period"
        case "active_subscription":
            return "Active subscription"
        case "admin_override":
            return "Admin override"
        default:
            return "Access managed by billing"
        }
    }

    private var subscriptionSummary: String {
        guard let subscription = billing?.subscription else {
            return "No subscription is currently associated with this account."
        }
        return "Plan: \(subscription.plan.name) (\(subscription.plan.code)) - Subscription: \(subscription.status)"
    }

    private var periodEndSummary: String? {
        guard let currentPeriodEnd = billing?.subscription?.current_period_end else {
            return nil
        }
        return "Period end: \(formatDateTime(currentPeriodEnd))"
    }

    private var checkoutURL: URL? {
        validatedURL(billing?.checkout_url)
    }

    private var portalURL: URL? {
        validatedURL(billing?.portal_url)
    }

    private func openLink(_ rawURL: String?) {
        guard let url = validatedURL(rawURL) else { return }
        openURL(url)
    }

    private func validatedURL(_ rawURL: String?) -> URL? {
        guard let rawURL,
              let url = URL(string: rawURL) else {
            return nil
        }
        return url
    }

    private func signOut() async {
        guard !isSigningOut else { return }
        isSigningOut = true
        await model.logout()
        isSigningOut = false
    }
}

struct AdminWorkspaceView: View {
    enum Panel: String, CaseIterable, Identifiable {
        case ingestion
        case users

        var id: String { rawValue }
        var title: String {
            switch self {
            case .ingestion: return "Ingestion"
            case .users: return "Users & Roles"
            }
        }
    }

    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var panel: Panel = .ingestion

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(spacing: 16) {
                    AdminCard {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Admin control center")
                                .font(.title3.weight(.semibold))
                            Text("Manage ingestion pipelines, roles, and user access from native iOS.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if model.isAdmin {
                        Picker("Panel", selection: $panel) {
                            ForEach(Panel.allCases) { panel in
                                Text(panel.title).tag(panel)
                            }
                        }
                        .pickerStyle(.segmented)
                        .padding(6)
                        .background(
                            ClaritasPalette.shellSurface(for: colorScheme),
                            in: RoundedRectangle(cornerRadius: 14)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(ClaritasPalette.shellBorder(for: colorScheme), lineWidth: 1)
                        )

                        if panel == .ingestion {
                            AdminIngestionPanelView()
                        } else {
                            AdminUserManagementPanelView()
                        }
                    } else {
                        AdminCard {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Admin role required")
                                    .font(.headline)
                                Text("Your current account does not have the `admin` role.")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
        }
    }
}

private struct AdminIngestionPanelView: View {
    enum PipelineFilter: String, CaseIterable, Identifiable {
        case all
        case news
        case weather
        case market
        case podcasts
        case leadership

        var id: String { rawValue }
        var label: String { rawValue.capitalized }
        var pipeline: IngestionPipeline? {
            switch self {
            case .all: return nil
            case .news: return .news
            case .weather: return .weather
            case .market: return .market
            case .podcasts: return .podcasts
            case .leadership: return .leadership
            }
        }
    }

    enum MetricsWindow: Int, CaseIterable, Identifiable {
        case d7 = 7
        case d30 = 30
        case d90 = 90

        var id: Int { rawValue }
        var label: String { "\(rawValue)d" }
    }

    enum TheNewsApiDateMode: String, CaseIterable, Identifiable {
        case today
        case custom

        var id: String { rawValue }

        var label: String {
            switch self {
            case .today:
                return "Today"
            case .custom:
                return "Custom"
            }
        }
    }

    struct AutomationDraft {
        var enabled: Bool
        var scheduleEnabled: Bool
        var scheduleIntervalMinutes: Int
        var intelligentEnabled: Bool
        var minSpacingMinutes: Int
        var freshnessSlaMinutes: Int
        var demandWindowMinutes: Int
        var demandThreshold: Int
        var failureBackoffMinutes: Int
        var defaultPayloadText: String
        var dirty: Bool
    }

    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme

    @State private var runs: [AdminIngestionRun] = []
    @State private var selectedRunId: Int?
    @State private var selectedRun: AdminIngestionRun?
    @State private var logs: [AdminIngestionLog] = []
    @State private var points: [AdminIngestionMetricsPoint] = []
    @State private var totals: [AdminIngestionMetricsTotal] = []
    @State private var automationRules: [AdminIngestionAutomationRule] = []
    @State private var automationStatus: [AdminIngestionAutomationStatus] = []
    @State private var automationDrafts: [IngestionPipeline: AutomationDraft] = [:]
    @State private var pendingAutomationSave: Set<IngestionPipeline> = []

    @State private var pipelineFilter: PipelineFilter = .all
    @State private var metricsWindow: MetricsWindow = .d30

    @State private var runNewsApiProvider: Bool = true
    @State private var runTheNewsApiProvider: Bool = true
    @State private var runEverything: Bool = true
    @State private var runTopHeadlines: Bool = true
    @State private var newsQuery: String = "OpenAI"
    @State private var newsLanguage: String = "en"
    @State private var newsCountry: String = "us"
    @State private var newsCategory: String = "technology"
    @State private var theNewsApiDateMode: TheNewsApiDateMode = .today
    @State private var theNewsApiCustomDate: Date = Date()
    @State private var weatherCountry: String = ""
    @State private var marketSymbols: String = "AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,JPM"
    @State private var marketIncludeNews: Bool = true
    @State private var marketNewsCategory: String = "general"
    @State private var marketNewsMaxItems: String = "50"

    @State private var isLoadingOverview: Bool = false
    @State private var isTriggeringNews: Bool = false
    @State private var isTriggeringWeather: Bool = false
    @State private var isTriggeringMarket: Bool = false
    @State private var overviewError: String?
    @State private var runError: String?
    @State private var actionError: String?
    @State private var actionNotice: String?

    var body: some View {
        VStack(spacing: 12) {
            AdminCard {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Ingestion pipelines")
                            .font(.headline)
                        Spacer()
                        Button(action: { Task { await refreshOverview(silent: false) } }) {
                            Label("Refresh", systemImage: "arrow.clockwise")
                        }
                        .buttonStyle(.bordered)
                        .disabled(isLoadingOverview)
                    }

                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Pipeline")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Picker("Pipeline", selection: $pipelineFilter) {
                                ForEach(PipelineFilter.allCases) { filter in
                                    Text(filter.label).tag(filter)
                                }
                            }
                            .pickerStyle(.menu)
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Metrics window")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Picker("Metrics window", selection: $metricsWindow) {
                                ForEach(MetricsWindow.allCases) { window in
                                    Text(window.label).tag(window)
                                }
                            }
                            .pickerStyle(.menu)
                        }
                        Spacer()
                    }

                    if let overviewError {
                        AdminErrorText(overviewError)
                    }
                    if let actionError {
                        AdminErrorText(actionError)
                    }
                    if let actionNotice {
                        AdminNoticeText(actionNotice)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            AdminCard {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Trigger runs")
                        .font(.headline)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("News providers")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Toggle("NewsAPI", isOn: $runNewsApiProvider)
                        Toggle("TheNewsAPI", isOn: $runTheNewsApiProvider)

                        Toggle("Everything", isOn: $runEverything)
                            .disabled(!runNewsApiProvider)
                        Toggle("Top headlines", isOn: $runTopHeadlines)
                            .disabled(!runNewsApiProvider)

                        HStack(spacing: 8) {
                            TextField("Query", text: $newsQuery)
                                .textFieldStyle(.roundedBorder)
                            TextField("Language", text: $newsLanguage)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 90)
                        }
                        HStack(spacing: 8) {
                            TextField("Country", text: $newsCountry)
                                .textFieldStyle(.roundedBorder)
                            TextField("Category", text: $newsCategory)
                                .textFieldStyle(.roundedBorder)
                        }

                        VStack(alignment: .leading, spacing: 6) {
                            Text("TheNewsAPI published after")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Picker("Date mode", selection: $theNewsApiDateMode) {
                                ForEach(TheNewsApiDateMode.allCases) { mode in
                                    Text(mode.label).tag(mode)
                                }
                            }
                            .pickerStyle(.segmented)

                            if theNewsApiDateMode == .custom {
                                DatePicker(
                                    "Custom date",
                                    selection: $theNewsApiCustomDate,
                                    displayedComponents: .date
                                )
                                .datePickerStyle(.compact)
                                .labelsHidden()
                            }

                            Text("Resolved date: \(resolvedTheNewsApiPublishedAfter ?? "—")")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }

                        Button(action: { Task { await queueNewsRun() } }) {
                            Label(isTriggeringNews ? "Queueing news…" : "Queue News Run", systemImage: "paperplane")
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isTriggeringNews || isLoadingOverview)
                    }

                    Divider()

                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Weather country (optional ISO2)", text: $weatherCountry)
                            .textFieldStyle(.roundedBorder)
                        Button(action: { Task { await queueWeatherRun() } }) {
                            Label(isTriggeringWeather ? "Queueing weather…" : "Queue Weather Run", systemImage: "cloud.sun")
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isTriggeringWeather || isLoadingOverview)
                    }

                    Divider()

                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Market symbols (optional CSV)", text: $marketSymbols)
                            .textFieldStyle(.roundedBorder)

                        Toggle("Ingest Finnhub market news", isOn: $marketIncludeNews)

                        Picker("News category", selection: $marketNewsCategory) {
                            Text("General").tag("general")
                            Text("Forex").tag("forex")
                            Text("Crypto").tag("crypto")
                            Text("Merger").tag("merger")
                        }
                        .pickerStyle(.segmented)

                        HStack(spacing: 8) {
                            TextField("News max items", text: $marketNewsMaxItems)
                                .keyboardType(.numberPad)
                                .textFieldStyle(.roundedBorder)
                            Text("1-100")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Button(action: { Task { await queueMarketRun() } }) {
                            Label(isTriggeringMarket ? "Queueing market…" : "Queue Market Run", systemImage: "chart.line.uptrend.xyaxis")
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isTriggeringMarket || isLoadingOverview)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            AdminCard {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Pipeline automation")
                        .font(.headline)
                    Text("Scheduler + intelligent trigger controls")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    ForEach(IngestionPipeline.allCases) { pipeline in
                        if let rule = automationRule(for: pipeline),
                           let draft = automationDrafts[pipeline] {
                            let status = automationStatusForPipeline(pipeline)

                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Text(pipeline.label)
                                        .font(.subheadline.weight(.semibold))
                                    Spacer()
                                    if pendingAutomationSave.contains(pipeline) {
                                        ProgressView()
                                            .scaleEffect(0.8)
                                    }
                                }

                                Toggle("Enabled", isOn: Binding(
                                    get: { draft.enabled },
                                    set: { value in
                                        updateAutomationDraft(pipeline) { current in
                                            current.enabled = value
                                        }
                                    }
                                ))
                                Toggle("Scheduler", isOn: Binding(
                                    get: { draft.scheduleEnabled },
                                    set: { value in
                                        updateAutomationDraft(pipeline) { current in
                                            current.scheduleEnabled = value
                                        }
                                    }
                                ))
                                Toggle("Intelligent", isOn: Binding(
                                    get: { draft.intelligentEnabled },
                                    set: { value in
                                        updateAutomationDraft(pipeline) { current in
                                            current.intelligentEnabled = value
                                        }
                                    }
                                ))

                                Stepper(value: Binding(
                                    get: { draft.scheduleIntervalMinutes },
                                    set: { value in
                                        updateAutomationDraft(pipeline) { current in
                                            current.scheduleIntervalMinutes = value
                                        }
                                    }
                                ), in: 1...10080) {
                                    Text("Schedule every \(draft.scheduleIntervalMinutes) minutes")
                                        .font(.caption)
                                }

                                Stepper(value: Binding(
                                    get: { draft.freshnessSlaMinutes },
                                    set: { value in
                                        updateAutomationDraft(pipeline) { current in
                                            current.freshnessSlaMinutes = value
                                        }
                                    }
                                ), in: 1...43200) {
                                    Text("Freshness SLA \(draft.freshnessSlaMinutes) minutes")
                                        .font(.caption)
                                }

                                Stepper(value: Binding(
                                    get: { draft.demandWindowMinutes },
                                    set: { value in
                                        updateAutomationDraft(pipeline) { current in
                                            current.demandWindowMinutes = value
                                        }
                                    }
                                ), in: 1...1440) {
                                    Text("Demand window \(draft.demandWindowMinutes) minutes")
                                        .font(.caption)
                                }

                                Stepper(value: Binding(
                                    get: { draft.demandThreshold },
                                    set: { value in
                                        updateAutomationDraft(pipeline) { current in
                                            current.demandThreshold = value
                                        }
                                    }
                                ), in: 1...100000) {
                                    Text("Demand threshold \(draft.demandThreshold) requests")
                                        .font(.caption)
                                }

                                Stepper(value: Binding(
                                    get: { draft.minSpacingMinutes },
                                    set: { value in
                                        updateAutomationDraft(pipeline) { current in
                                            current.minSpacingMinutes = value
                                        }
                                    }
                                ), in: 1...10080) {
                                    Text("Min spacing \(draft.minSpacingMinutes) minutes")
                                        .font(.caption)
                                }

                                Stepper(value: Binding(
                                    get: { draft.failureBackoffMinutes },
                                    set: { value in
                                        updateAutomationDraft(pipeline) { current in
                                            current.failureBackoffMinutes = value
                                        }
                                    }
                                ), in: 1...10080) {
                                    Text("Failure backoff \(draft.failureBackoffMinutes) minutes")
                                        .font(.caption)
                                }

                                VStack(alignment: .leading, spacing: 6) {
                                    Text("Default payload (JSON)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    TextEditor(text: Binding(
                                        get: { draft.defaultPayloadText },
                                        set: { value in
                                            updateAutomationDraft(pipeline) { current in
                                                current.defaultPayloadText = value
                                            }
                                        }
                                    ))
                                    .font(.system(.caption, design: .monospaced))
                                    .frame(minHeight: 120)
                                    .padding(6)
                                    .background(Color.black.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                                }

                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Last run: \(formatDateTime(status?.last_run_at))")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                    Text("Last success: \(formatDateTime(status?.last_success_at))")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                    Text("Latest data: \(formatDateTime(status?.latest_data_at))")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                    Text("Data age: \(status?.data_age_minutes.map(String.init) ?? "—") minutes")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                    Text("Demand: \(status?.demand_requests ?? 0) requests / \(draft.demandWindowMinutes)m")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                    Text("Active runs: \(status?.active_runs ?? 0)")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                    Text("Next schedule: \(formatDateTime(rule.next_scheduled_at))")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                    Text("Last trigger: \(rule.last_trigger_reason ?? "—")")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }

                                if let lastError = rule.last_error,
                                   !lastError.isEmpty {
                                    AdminErrorText(lastError)
                                }

                                Button(action: { Task { await saveAutomationRule(for: pipeline) } }) {
                                    Text(pendingAutomationSave.contains(pipeline) ? "Saving…" : "Save automation")
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(!draft.dirty || pendingAutomationSave.contains(pipeline))
                            }
                            .padding(12)
                            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                        } else {
                            Text("Loading \(pipeline.label) automation…")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(10)
                                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            AdminCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Metrics summary")
                        .font(.headline)
                    if totals.isEmpty {
                        Text("No ingestion metrics available.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(totals) { total in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(total.pipeline.label)
                                        .font(.subheadline.weight(.semibold))
                                    Spacer()
                                    Text("\(total.run_count) runs")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Text("Success \(total.success_count) • Failed \(total.failed_count) • Running \(total.running_count) • Queued \(total.queued_count)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text("Inserted \(total.inserted) • Updated \(total.updated) • Skipped \(total.skipped)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(10)
                            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                        }
                    }
                    if !points.isEmpty {
                        Text("\(points.count) metric points loaded.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            AdminCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Recent runs")
                        .font(.headline)
                    if runs.isEmpty {
                        Text("No runs found.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(runs.prefix(40)) { run in
                            Button(action: { selectedRunId = run.id }) {
                                HStack(spacing: 10) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        HStack(spacing: 8) {
                                            Text("#\(run.id)")
                                                .font(.subheadline.weight(.semibold))
                                            Text(run.pipeline.label)
                                                .font(.caption)
                                                .padding(.horizontal, 8)
                                                .padding(.vertical, 4)
                                                .background(Color.primary.opacity(0.08), in: Capsule())
                                            Text(runSourceSummary(run))
                                                .font(.caption2.weight(.semibold))
                                                .padding(.horizontal, 8)
                                                .padding(.vertical, 4)
                                                .background(ClaritasPalette.positiveText(for: colorScheme).opacity(0.16), in: Capsule())
                                                .foregroundStyle(ClaritasPalette.positiveText(for: colorScheme))
                                        }
                                        Text(formatDateTime(run.started_at))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(run.status.label)
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(run.status.badgeColor.opacity(0.16), in: Capsule())
                                        .foregroundStyle(run.status.badgeColor)
                                }
                                .padding(10)
                                .background(
                                    (selectedRunId == run.id ? Color.accentColor.opacity(0.12) : Color.primary.opacity(0.04)),
                                    in: RoundedRectangle(cornerRadius: 10)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            AdminCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Run detail")
                        .font(.headline)
                    if let runError {
                        AdminErrorText(runError)
                    }
                    if let selectedRun {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Run #\(selectedRun.id) • \(selectedRun.pipeline.label)")
                                .font(.subheadline.weight(.semibold))
                            Text("Source: \(runSourceSummary(selectedRun))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("Status: \(selectedRun.status.label)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("Started: \(formatDateTime(selectedRun.started_at))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("Finished: \(formatDateTime(selectedRun.finished_at))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("Duration: \(durationLabel(selectedRun))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if let error = selectedRun.error, !error.isEmpty {
                                Text(error)
                                    .font(.caption)
                                    .foregroundStyle(.red)
                            }
                        }

                        Divider()

                        if logs.isEmpty {
                            Text("No logs yet.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(logs.prefix(120)) { log in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack(spacing: 8) {
                                        Text(log.level.rawValue.uppercased())
                                            .font(.caption2.weight(.semibold))
                                            .foregroundStyle(log.level.levelColor)
                                        Text(formatDateTime(log.logged_at))
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                    Text(log.message)
                                        .font(.footnote)
                                }
                                .padding(.vertical, 4)
                            }
                        }
                    } else {
                        Text("Select a run to inspect logs and details.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .task {
            await refreshOverview(silent: false)
        }
        .task(id: selectedRunId) {
            guard let selectedRunId else { return }
            await refreshRun(selectedRunId, silent: false)
        }
    }

    private var resolvedTheNewsApiPublishedAfter: String? {
        guard runTheNewsApiProvider else { return nil }
        switch theNewsApiDateMode {
        case .today:
            return localDateInputString(Date())
        case .custom:
            return localDateInputString(theNewsApiCustomDate)
        }
    }

    private func refreshOverview(silent: Bool) async {
        if !silent {
            isLoadingOverview = true
            overviewError = nil
        }

        async let runsResult: Result<[AdminIngestionRun], Error> = {
            do {
                return .success(try await model.api.fetchAdminIngestionRuns(
                    pipeline: pipelineFilter.pipeline,
                    limit: 100,
                    offset: 0
                ))
            } catch {
                return .failure(error)
            }
        }()

        async let metricsResult: Result<AdminIngestionMetricsResponse, Error> = {
            do {
                return .success(try await model.api.fetchAdminIngestionMetrics(
                    days: metricsWindow.rawValue,
                    pipeline: pipelineFilter.pipeline
                ))
            } catch {
                return .failure(error)
            }
        }()

        async let automationResult: Result<AdminIngestionAutomationResponse, Error> = {
            do {
                return .success(try await model.api.fetchAdminIngestionAutomation())
            } catch {
                return .failure(error)
            }
        }()

        let (resolvedRuns, resolvedMetrics, resolvedAutomation) = await (runsResult, metricsResult, automationResult)

        var errors: [String] = []

        switch resolvedRuns {
        case .success(let nextRuns):
            runs = nextRuns
            if let current = selectedRunId, nextRuns.contains(where: { $0.id == current }) {
                selectedRunId = current
            } else {
                selectedRunId = nextRuns.first?.id
            }
            if nextRuns.isEmpty {
                selectedRun = nil
                logs = []
            }
        case .failure(let error):
            errors.append("Runs: \(error.localizedDescription)")
        }

        switch resolvedMetrics {
        case .success(let metrics):
            points = metrics.points
            totals = metrics.totals
        case .failure(let error):
            errors.append("Metrics: \(error.localizedDescription)")
        }

        switch resolvedAutomation {
        case .success(let automation):
            automationRules = automation.rules
            automationStatus = automation.status

            var nextDrafts = automationDrafts
            for rule in automation.rules {
                if let existing = nextDrafts[rule.pipeline], existing.dirty {
                    continue
                }
                nextDrafts[rule.pipeline] = createAutomationDraft(from: rule)
            }
            automationDrafts = nextDrafts
        case .failure(let error):
            errors.append("Automation: \(error.localizedDescription)")
        }

        overviewError = errors.isEmpty ? nil : errors.joined(separator: " | ")

        if !silent {
            isLoadingOverview = false
        }
    }

    private func refreshRun(_ runId: Int, silent: Bool) async {
        if !silent {
            runError = nil
        }

        do {
            let detail = try await model.api.fetchAdminIngestionRun(runId: runId, logLimit: 300)
            selectedRun = detail.run
            logs = detail.logs
            runs = runs.map { candidate in
                candidate.id == detail.run.id ? detail.run : candidate
            }
        } catch {
            runError = error.localizedDescription
        }
    }

    private func queueNewsRun() async {
        guard runNewsApiProvider || runTheNewsApiProvider else {
            actionError = "Select at least one news provider."
            actionNotice = nil
            return
        }

        guard !runNewsApiProvider || runEverything || runTopHeadlines else {
            actionError = "Enable at least one NewsAPI step or disable NewsAPI."
            actionNotice = nil
            return
        }

        isTriggeringNews = true
        actionError = nil
        actionNotice = nil
        do {
            let detail = try await model.api.triggerAdminNewsIngestion(
                runNewsApiProvider: runNewsApiProvider,
                runTheNewsApiProvider: runTheNewsApiProvider,
                runEverything: runEverything,
                runTopHeadlines: runTopHeadlines,
                query: newsQuery,
                language: newsLanguage,
                country: newsCountry,
                category: newsCategory,
                theNewsApiPublishedAfter: resolvedTheNewsApiPublishedAfter
            )
            selectedRunId = detail.run.id
            selectedRun = detail.run
            logs = detail.logs
            actionNotice = "News ingestion run #\(detail.run.id) was queued."
            await refreshOverview(silent: true)
        } catch {
            actionError = error.localizedDescription
        }
        isTriggeringNews = false
    }

    private func queueWeatherRun() async {
        isTriggeringWeather = true
        actionError = nil
        actionNotice = nil
        do {
            let detail = try await model.api.triggerAdminWeatherIngestion(country: weatherCountry)
            selectedRunId = detail.run.id
            selectedRun = detail.run
            logs = detail.logs
            actionNotice = "Weather ingestion run #\(detail.run.id) was queued."
            await refreshOverview(silent: true)
        } catch {
            actionError = error.localizedDescription
        }
        isTriggeringWeather = false
    }

    private func queueMarketRun() async {
        isTriggeringMarket = true
        actionError = nil
        actionNotice = nil
        do {
            let symbols = marketSymbols
                .split(whereSeparator: { $0 == "," || $0.isWhitespace })
                .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            let parsedMaxItems = Int(marketNewsMaxItems.trimmingCharacters(in: .whitespacesAndNewlines))
            let newsMaxItems: Int? = {
                guard let parsedMaxItems else { return nil }
                guard parsedMaxItems > 0 else { return nil }
                return min(max(parsedMaxItems, 1), 100)
            }()
            let detail = try await model.api.triggerAdminMarketIngestion(
                symbols: symbols.isEmpty ? nil : symbols,
                includeNews: marketIncludeNews,
                newsCategory: marketNewsCategory,
                newsMinId: nil,
                newsMaxItems: newsMaxItems
            )
            selectedRunId = detail.run.id
            selectedRun = detail.run
            logs = detail.logs
            actionNotice = "Market ingestion run #\(detail.run.id) was queued."
            await refreshOverview(silent: true)
        } catch {
            actionError = error.localizedDescription
        }
        isTriggeringMarket = false
    }

    private func automationRule(for pipeline: IngestionPipeline) -> AdminIngestionAutomationRule? {
        automationRules.first(where: { $0.pipeline == pipeline })
    }

    private func automationStatusForPipeline(_ pipeline: IngestionPipeline) -> AdminIngestionAutomationStatus? {
        automationStatus.first(where: { $0.pipeline == pipeline })
    }

    private func updateAutomationDraft(_ pipeline: IngestionPipeline, mutate: (inout AutomationDraft) -> Void) {
        guard var draft = automationDrafts[pipeline] else { return }
        mutate(&draft)
        draft.dirty = true
        automationDrafts[pipeline] = draft
    }

    private func createAutomationDraft(from rule: AdminIngestionAutomationRule) -> AutomationDraft {
        AutomationDraft(
            enabled: rule.enabled,
            scheduleEnabled: rule.schedule_enabled,
            scheduleIntervalMinutes: rule.schedule_interval_minutes,
            intelligentEnabled: rule.intelligent_enabled,
            minSpacingMinutes: rule.min_spacing_minutes,
            freshnessSlaMinutes: rule.freshness_sla_minutes,
            demandWindowMinutes: rule.demand_window_minutes,
            demandThreshold: rule.demand_threshold,
            failureBackoffMinutes: rule.failure_backoff_minutes,
            defaultPayloadText: automationPayloadText(rule.default_payload),
            dirty: false
        )
    }

    private func automationPayloadText(_ value: JSONValue?) -> String {
        let payloadObject: Any
        if case .object(let object)? = value {
            payloadObject = object.mapValues { $0.foundationObject }
        } else {
            payloadObject = [String: Any]()
        }

        guard JSONSerialization.isValidJSONObject(payloadObject),
              let data = try? JSONSerialization.data(withJSONObject: payloadObject, options: [.prettyPrinted]),
              let text = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return text
    }

    private func saveAutomationRule(for pipeline: IngestionPipeline) async {
        guard let draft = automationDrafts[pipeline] else { return }

        let payloadText = draft.defaultPayloadText.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedPayloadText = payloadText.isEmpty ? "{}" : payloadText

        guard let payloadData = resolvedPayloadText.data(using: .utf8) else {
            actionError = "Default payload for \(pipeline.label) is not valid text."
            actionNotice = nil
            return
        }

        let defaultPayload: [String: Any]
        do {
            let parsed = try JSONSerialization.jsonObject(with: payloadData, options: [])
            guard let object = parsed as? [String: Any] else {
                actionError = "Default payload for \(pipeline.label) must be a JSON object."
                actionNotice = nil
                return
            }
            defaultPayload = object
        } catch {
            actionError = "Default payload for \(pipeline.label) is not valid JSON."
            actionNotice = nil
            return
        }

        pendingAutomationSave.insert(pipeline)
        actionError = nil
        actionNotice = nil

        do {
            let updatedRule = try await model.api.updateAdminIngestionAutomationRule(
                pipeline: pipeline,
                patch: [
                    "enabled": draft.enabled,
                    "schedule_enabled": draft.scheduleEnabled,
                    "schedule_interval_minutes": draft.scheduleIntervalMinutes,
                    "intelligent_enabled": draft.intelligentEnabled,
                    "min_spacing_minutes": draft.minSpacingMinutes,
                    "freshness_sla_minutes": draft.freshnessSlaMinutes,
                    "demand_window_minutes": draft.demandWindowMinutes,
                    "demand_threshold": draft.demandThreshold,
                    "failure_backoff_minutes": draft.failureBackoffMinutes,
                    "default_payload": defaultPayload
                ]
            )

            automationRules = automationRules.map { existing in
                existing.pipeline == pipeline ? updatedRule : existing
            }
            automationDrafts[pipeline] = createAutomationDraft(from: updatedRule)
            actionNotice = "\(pipeline.label) automation updated."
            await refreshOverview(silent: true)
        } catch {
            actionError = error.localizedDescription
        }

        pendingAutomationSave.remove(pipeline)
    }

    private func durationLabel(_ run: AdminIngestionRun) -> String {
        if let durationMs = firstStatNumber(run.stats, paths: ["duration_ms"]),
           durationMs > 0 {
            return "\(Int(durationMs.rounded() / 1000.0))s"
        }
        guard let finished = run.finished_at else {
            return run.status == .running || run.status == .queued ? "Running" : "—"
        }
        guard let startedDate = APIDateParser.parse(run.started_at),
              let finishedDate = APIDateParser.parse(finished) else {
            return "—"
        }
        let seconds = Int(finishedDate.timeIntervalSince(startedDate).rounded())
        return seconds >= 0 ? "\(seconds)s" : "—"
    }

    private func firstStatNumber(_ stats: JSONValue?, paths: [String]) -> Double? {
        for path in paths {
            if let value = statNumber(stats, path: path) {
                return value
            }
        }
        return nil
    }

    private func statNumber(_ stats: JSONValue?, path: String) -> Double? {
        guard var current = stats else { return nil }
        for key in path.split(separator: ".") {
            guard case .object(let object) = current,
                  let next = object[String(key)] else {
                return nil
            }
            current = next
        }

        switch current {
        case .number(let value):
            return value
        case .string(let value):
            return Double(value)
        default:
            return nil
        }
    }

    private func prettySourceName(_ value: String) -> String {
        switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "newsapi":
            return "NewsAPI"
        case "thenewsapi":
            return "TheNewsAPI"
        case "openweather":
            return "OpenWeather"
        case "finnhub":
            return "Finnhub"
        default:
            return value
        }
    }

    private func runSourceSummary(_ run: AdminIngestionRun) -> String {
        guard run.pipeline == .news else { return prettySourceName(run.source_name) }
        guard case .object(let payload)? = run.request_payload,
              case .object(let providers)? = payload["providers"] else {
            return prettySourceName(run.source_name)
        }

        let hasExplicitProviders = providers["newsapi"] != nil || providers["thenewsapi"] != nil
        guard hasExplicitProviders else { return prettySourceName(run.source_name) }

        var labels: [String] = []
        if providers["newsapi"]?.bool != false {
            labels.append("NewsAPI")
        }
        if providers["thenewsapi"]?.bool == true {
            labels.append("TheNewsAPI")
        }

        if labels.isEmpty { return prettySourceName(run.source_name) }
        return labels.joined(separator: " + ")
    }
}

private struct AdminUserManagementPanelView: View {
    struct SubscriptionDraft {
        var planCode: String
        var status: String
        var provider: String
        var currentPeriodEnd: String
    }

    @EnvironmentObject private var model: AppModel

    @State private var roles: [AdminRole] = []
    @State private var billingPlans: [AdminBillingPlan] = []
    @State private var users: [AdminUser] = []
    @State private var totalUsers: Int = 0

    @State private var search: String = ""
    @State private var appliedSearch: String = ""
    @State private var roleFilter: String = "all"
    @State private var includeInactive: Bool = false

    @State private var isLoading: Bool = false
    @State private var errorMessage: String?
    @State private var noticeMessage: String?
    @State private var roleDrafts: [Int: Set<String>] = [:]
    @State private var subscriptionDrafts: [Int: SubscriptionDraft] = [:]
    @State private var pendingRoleSave: Set<Int> = []
    @State private var pendingStatusSave: Set<Int> = []
    @State private var pendingSubscriptionSave: Set<Int> = []

    @State private var newRoleKey: String = ""
    @State private var newRoleDescription: String = ""
    @State private var isCreatingRole: Bool = false

    private let allowedStatuses = [
        "trialing",
        "active",
        "past_due",
        "grace_period",
        "canceled",
        "unpaid",
        "incomplete"
    ]

    var body: some View {
        VStack(spacing: 12) {
            AdminCard {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Users & roles")
                            .font(.headline)
                        Spacer()
                        Button("Apply filters") {
                            appliedSearch = search.trimmingCharacters(in: .whitespacesAndNewlines)
                            Task { await loadData() }
                        }
                        .buttonStyle(.bordered)
                        Button("Refresh") {
                            Task { await loadData() }
                        }
                        .buttonStyle(.bordered)
                    }

                    HStack(spacing: 10) {
                        TextField("Search user", text: $search)
                            .textFieldStyle(.roundedBorder)
                        Picker("Role", selection: $roleFilter) {
                            Text("All roles").tag("all")
                            ForEach(roles.map(\.key), id: \.self) { key in
                                Text(key).tag(key)
                            }
                        }
                        .pickerStyle(.menu)
                    }

                    Toggle("Include inactive users", isOn: $includeInactive)
                        .font(.subheadline)

                    if let errorMessage {
                        AdminErrorText(errorMessage)
                    }
                    if let noticeMessage {
                        AdminNoticeText(noticeMessage)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            AdminCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Roles (\(roles.count))")
                        .font(.headline)

                    if roles.isEmpty {
                        Text("No roles found.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(roles) { role in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(role.key)
                                        .font(.subheadline.weight(.semibold))
                                    Spacer()
                                    Text("\(role.user_count) users")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Text(role.description ?? "No description")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(10)
                            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                        }
                    }

                    Divider()

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Create role")
                            .font(.subheadline.weight(.semibold))
                        TextField("Role key (e.g. analyst)", text: $newRoleKey)
                            .textFieldStyle(.roundedBorder)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        TextField("Description (optional)", text: $newRoleDescription)
                            .textFieldStyle(.roundedBorder)
                        Button(action: { Task { await createRole() } }) {
                            Text(isCreatingRole ? "Creating…" : "Create role")
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isCreatingRole)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            AdminCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Users (\(users.count)/\(totalUsers))")
                        .font(.headline)

                    if isLoading {
                        ProgressView()
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if users.isEmpty, !isLoading {
                        Text("No users match the current filters.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        let defaultPlanCode = resolvedDefaultPlanCode()

                        ForEach(users) { user in
                            let roleDraft = roleDrafts[user.id] ?? Set(user.roles)
                            let subscriptionDraft = subscriptionDrafts[user.id] ?? makeSubscriptionDraft(for: user, defaultPlanCode: defaultPlanCode)
                            let subscriptionStatus = normalizedSubscriptionStatus(user.subscription?.status)

                            VStack(alignment: .leading, spacing: 8) {
                                HStack(alignment: .top) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(user.display_name ?? user.email ?? "User #\(user.id)")
                                            .font(.subheadline.weight(.semibold))
                                        Text(user.email ?? "No email")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                        if let lastSeen = user.last_seen_at {
                                            Text("Last seen \(formatDateTime(lastSeen))")
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer()

                                    VStack(alignment: .trailing, spacing: 4) {
                                        Text(user.is_active ? "Active" : "Inactive")
                                            .font(.caption.weight(.semibold))
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 4)
                                            .background((user.is_active ? Color.green : Color.gray).opacity(0.16), in: Capsule())
                                            .foregroundStyle(user.is_active ? Color.green : Color.secondary)

                                        Text(subscriptionStatus)
                                            .font(.caption2.weight(.semibold))
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 4)
                                            .background(subscriptionBadgeColor(for: subscriptionStatus).opacity(0.16), in: Capsule())
                                            .foregroundStyle(subscriptionBadgeColor(for: subscriptionStatus))
                                    }
                                }

                                if !user.providers.isEmpty {
                                    Text("Providers: \(user.providers.joined(separator: ", "))")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }

                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Billing")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)

                                    Picker("Billing plan", selection: Binding(
                                        get: { subscriptionDraft.planCode },
                                        set: { value in
                                            updateSubscriptionDraft(for: user.id) { current in
                                                current.planCode = value
                                            }
                                        }
                                    )) {
                                        if billingPlans.isEmpty {
                                            Text("No plans").tag("")
                                        }
                                        ForEach(billingPlans) { plan in
                                            Text("\(plan.name) (\(plan.code))").tag(plan.code)
                                        }
                                    }
                                    .pickerStyle(.menu)

                                    Picker("Subscription status", selection: Binding(
                                        get: { subscriptionDraft.status },
                                        set: { value in
                                            updateSubscriptionDraft(for: user.id) { current in
                                                current.status = normalizedSubscriptionStatus(value)
                                            }
                                        }
                                    )) {
                                        ForEach(allowedStatuses, id: \.self) { status in
                                            Text(status).tag(status)
                                        }
                                    }
                                    .pickerStyle(.menu)

                                    TextField("Provider", text: Binding(
                                        get: { subscriptionDraft.provider },
                                        set: { value in
                                            updateSubscriptionDraft(for: user.id) { current in
                                                current.provider = value
                                            }
                                        }
                                    ))
                                    .textFieldStyle(.roundedBorder)

                                    TextField("Period end (optional) YYYY-MM-DD", text: Binding(
                                        get: { subscriptionDraft.currentPeriodEnd },
                                        set: { value in
                                            updateSubscriptionDraft(for: user.id) { current in
                                                current.currentPeriodEnd = value
                                            }
                                        }
                                    ))
                                    .textFieldStyle(.roundedBorder)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                }

                                if !roles.isEmpty {
                                    ScrollView(.horizontal, showsIndicators: false) {
                                        HStack(spacing: 6) {
                                            ForEach(roles.map(\.key), id: \.self) { roleKey in
                                                let selected = roleDraft.contains(roleKey)
                                                Button(roleKey) {
                                                    toggleRole(for: user.id, roleKey: roleKey, fallbackRoles: user.roles)
                                                }
                                                .buttonStyle(.bordered)
                                                .tint(selected ? Color.accentColor : Color.secondary)
                                            }
                                        }
                                    }
                                }

                                HStack {
                                    Button(action: { Task { await saveRoles(for: user) } }) {
                                        Text(pendingRoleSave.contains(user.id) ? "Saving roles…" : "Save roles")
                                    }
                                    .buttonStyle(.bordered)
                                    .disabled(pendingRoleSave.contains(user.id) || !isDraftDirty(for: user))

                                    Button(action: { Task { await saveSubscription(for: user) } }) {
                                        Text(pendingSubscriptionSave.contains(user.id) ? "Saving billing…" : "Save billing")
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .tint(.blue)
                                    .disabled(pendingSubscriptionSave.contains(user.id) || billingPlans.isEmpty)

                                    Button(action: { Task { await toggleStatus(for: user) } }) {
                                        Text(pendingStatusSave.contains(user.id) ? "Updating…" : (user.is_active ? "Deactivate" : "Activate"))
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .tint(user.is_active ? .orange : .green)
                                    .disabled(pendingStatusSave.contains(user.id))

                                    Spacer()
                                }
                            }
                            .padding(10)
                            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .task {
            await loadData()
        }
    }

    private func loadData() async {
        isLoading = true
        errorMessage = nil
        do {
            async let rolesTask = model.api.fetchAdminRoles()
            async let usersTask = model.api.fetchAdminUsers(
                limit: 200,
                offset: 0,
                q: appliedSearch.isEmpty ? nil : appliedSearch,
                role: roleFilter == "all" ? nil : roleFilter,
                includeInactive: includeInactive
            )
            async let plansTask = model.api.fetchAdminBillingPlans()

            let (nextRoles, userResponse, nextPlans) = try await (rolesTask, usersTask, plansTask)
            roles = nextRoles
            users = userResponse.users
            totalUsers = userResponse.total
            billingPlans = nextPlans

            let defaultPlanCode = nextPlans.first?.code ?? "pro"
            var nextRoleDrafts: [Int: Set<String>] = [:]
            var nextSubscriptionDrafts: [Int: SubscriptionDraft] = [:]

            for user in userResponse.users {
                nextRoleDrafts[user.id] = Set(user.roles)
                nextSubscriptionDrafts[user.id] = makeSubscriptionDraft(for: user, defaultPlanCode: defaultPlanCode)
            }

            roleDrafts = nextRoleDrafts
            subscriptionDrafts = nextSubscriptionDrafts
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func resolvedDefaultPlanCode() -> String {
        billingPlans.first?.code ?? "pro"
    }

    private func normalizedSubscriptionStatus(_ value: String?) -> String {
        guard let value else { return "incomplete" }
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if allowedStatuses.contains(normalized) {
            return normalized
        }
        return "incomplete"
    }

    private func subscriptionBadgeColor(for status: String) -> Color {
        switch status {
        case "active", "trialing", "grace_period":
            return .green
        default:
            return .orange
        }
    }

    private func makeSubscriptionDraft(for user: AdminUser, defaultPlanCode: String) -> SubscriptionDraft {
        SubscriptionDraft(
            planCode: user.subscription?.plan?.code ?? defaultPlanCode,
            status: normalizedSubscriptionStatus(user.subscription?.status),
            provider: user.subscription?.provider ?? "manual",
            currentPeriodEnd: dateInputValue(from: user.subscription?.current_period_end)
        )
    }

    private func dateInputValue(from value: String?) -> String {
        guard let value else { return "" }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 10 else { return "" }
        return String(trimmed.prefix(10))
    }

    private func updateSubscriptionDraft(for userId: Int, mutate: (inout SubscriptionDraft) -> Void) {
        guard var draft = subscriptionDrafts[userId] else { return }
        mutate(&draft)
        subscriptionDrafts[userId] = draft
    }

    private func toggleRole(for userId: Int, roleKey: String, fallbackRoles: [String]) {
        var draft = roleDrafts[userId] ?? Set(fallbackRoles)
        if draft.contains(roleKey) {
            draft.remove(roleKey)
        } else {
            draft.insert(roleKey)
        }
        roleDrafts[userId] = draft
    }

    private func isDraftDirty(for user: AdminUser) -> Bool {
        let draft = roleDrafts[user.id] ?? Set(user.roles)
        return draft != Set(user.roles)
    }

    private func saveRoles(for user: AdminUser) async {
        pendingRoleSave.insert(user.id)
        errorMessage = nil
        noticeMessage = nil
        let draft = Array(roleDrafts[user.id] ?? Set(user.roles)).sorted()

        do {
            if let updated = try await model.api.updateAdminUserRoles(userId: user.id, roles: draft) {
                users = users.map { candidate in
                    candidate.id == user.id ? updated : candidate
                }
                roleDrafts[user.id] = Set(updated.roles)
                subscriptionDrafts[user.id] = makeSubscriptionDraft(for: updated, defaultPlanCode: resolvedDefaultPlanCode())
                noticeMessage = "Updated roles for \(updated.email ?? updated.display_name ?? "user #\(updated.id)")."
            } else {
                noticeMessage = "Role update completed."
            }
        } catch {
            errorMessage = error.localizedDescription
        }

        pendingRoleSave.remove(user.id)
    }

    private func saveSubscription(for user: AdminUser) async {
        guard let draft = subscriptionDrafts[user.id] else {
            subscriptionDrafts[user.id] = makeSubscriptionDraft(for: user, defaultPlanCode: resolvedDefaultPlanCode())
            return
        }

        let planCode = draft.planCode.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !planCode.isEmpty else {
            errorMessage = "Select a billing plan before saving subscription."
            noticeMessage = nil
            return
        }

        let status = normalizedSubscriptionStatus(draft.status)
        let provider = draft.provider.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedProvider = provider.isEmpty ? "manual" : provider
        let periodEndInput = draft.currentPeriodEnd.trimmingCharacters(in: .whitespacesAndNewlines)

        if !periodEndInput.isEmpty && DateFormatter.adminDateInput.date(from: periodEndInput) == nil {
            errorMessage = "Period end must use YYYY-MM-DD format."
            noticeMessage = nil
            return
        }

        let currentPeriodEndISO = periodEndInput.isEmpty ? nil : "\(periodEndInput)T23:59:59.000Z"

        pendingSubscriptionSave.insert(user.id)
        errorMessage = nil
        noticeMessage = nil

        do {
            if let updated = try await model.api.updateAdminUserSubscription(
                userId: user.id,
                planCode: planCode,
                status: status,
                provider: resolvedProvider,
                currentPeriodEndISO: currentPeriodEndISO
            ) {
                users = users.map { candidate in
                    candidate.id == user.id ? updated : candidate
                }
                roleDrafts[user.id] = Set(updated.roles)
                subscriptionDrafts[user.id] = makeSubscriptionDraft(for: updated, defaultPlanCode: resolvedDefaultPlanCode())
                noticeMessage = "Updated subscription for \(updated.email ?? updated.display_name ?? "user #\(updated.id)")."
            } else {
                noticeMessage = "Subscription update completed."
            }
        } catch {
            errorMessage = error.localizedDescription
        }

        pendingSubscriptionSave.remove(user.id)
    }

    private func toggleStatus(for user: AdminUser) async {
        pendingStatusSave.insert(user.id)
        errorMessage = nil
        noticeMessage = nil
        do {
            if let updated = try await model.api.updateAdminUserStatus(userId: user.id, isActive: !user.is_active) {
                users = users.map { candidate in
                    candidate.id == user.id ? updated : candidate
                }
                roleDrafts[user.id] = Set(updated.roles)
                subscriptionDrafts[user.id] = makeSubscriptionDraft(for: updated, defaultPlanCode: resolvedDefaultPlanCode())
                noticeMessage = "\(updated.email ?? updated.display_name ?? "user #\(updated.id)") is now \(updated.is_active ? "active" : "inactive")."
            } else {
                noticeMessage = "Status update completed."
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        pendingStatusSave.remove(user.id)
    }

    private func createRole() async {
        let key = newRoleKey.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !key.isEmpty else {
            errorMessage = "Role key is required."
            noticeMessage = nil
            return
        }

        isCreatingRole = true
        errorMessage = nil
        noticeMessage = nil
        do {
            _ = try await model.api.createAdminRole(
                key: key,
                description: newRoleDescription.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            newRoleKey = ""
            newRoleDescription = ""
            noticeMessage = "Role \"\(key)\" created."
            await loadData()
        } catch {
            errorMessage = error.localizedDescription
        }
        isCreatingRole = false
    }
}

private struct AdminCard<Content: View>: View {
    @ViewBuilder var content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            content
        }
        .padding(16)
        .brandGlass(cornerRadius: 16)
    }
}

private struct AdminErrorText: View {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var body: some View {
        Text(message)
            .font(.footnote)
            .foregroundStyle(.red)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct AdminNoticeText: View {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var body: some View {
        Text(message)
            .font(.footnote)
            .foregroundStyle(Color.green)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }
}

private extension IngestionPipeline {
    var label: String {
        switch self {
        case .news: return "News"
        case .weather: return "Weather"
        case .market: return "Market"
        case .podcasts: return "Podcasts"
        case .leadership: return "Leadership"
        }
    }
}

private extension IngestionRunStatus {
    var label: String {
        switch self {
        case .queued: return "Queued"
        case .running: return "Running"
        case .success: return "Success"
        case .failed: return "Failed"
        case .unknown: return "Unknown"
        }
    }

    var badgeColor: Color {
        switch self {
        case .success: return .green
        case .failed: return .red
        case .running: return .blue
        case .queued: return .orange
        case .unknown: return .secondary
        }
    }
}

private extension IngestionLogLevel {
    var levelColor: Color {
        switch self {
        case .info: return .secondary
        case .warn: return .orange
        case .error: return .red
        }
    }
}

private func formatDateTime(_ value: String?) -> String {
    guard let value, !value.isEmpty else { return "—" }
    guard let date = APIDateParser.parse(value) else { return value }
    return DateFormatter.adminDateTime.string(from: date)
}

private func localDateInputString(_ date: Date) -> String {
    DateFormatter.localDateInput.string(from: date)
}

private extension DateFormatter {
    static let adminDateTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    static let localDateInput: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static let adminDateInput: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}
