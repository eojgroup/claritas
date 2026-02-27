import SwiftUI

struct RootView: View {
    enum Tab: Hashable {
        case dashboard
        case admin
        case profile
    }

    @EnvironmentObject private var model: AppModel
    @State private var tab: Tab = .dashboard
    @AppStorage("THEME_DARK") private var dark: Bool = false

    var body: some View {
        Group {
            if model.authStatus == .authed {
                TabView(selection: $tab) {
                    NavigationStack {
                        DashboardView()
                            .navigationTitle("Claritas")
                            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { ThemeToggle() } }
                    }
                    .tabItem { Label("Dashboard", systemImage: "globe") }
                    .tag(Tab.dashboard)

                    if model.isAdmin {
                        NavigationStack {
                            AdminWorkspaceView()
                                .navigationTitle("Admin")
                                .toolbar { ToolbarItem(placement: .navigationBarTrailing) { ThemeToggle() } }
                        }
                        .tabItem { Label("Admin", systemImage: "shield.lefthalf.filled") }
                        .tag(Tab.admin)
                    }

                    NavigationStack {
                        ProfileView()
                            .navigationTitle("Profile")
                    }
                    .tabItem { Label("Profile", systemImage: "person.crop.circle") }
                    .tag(Tab.profile)
                }
                .tint(Color(red: 0.12, green: 0.42, blue: 0.4))
                .onChange(of: model.isAdmin) { isAdmin in
                    if !isAdmin && tab == .admin {
                        tab = .dashboard
                    }
                }
            } else {
                LoginView()
            }
        }
        .preferredColorScheme(dark ? .dark : .light)
        .task {
            await model.bootstrap()
        }
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

private struct AdminWorkspaceView: View {
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
                            Color(.systemBackground).opacity(0.86),
                            in: RoundedRectangle(cornerRadius: 14)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(Color.primary.opacity(0.1), lineWidth: 1)
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

        var id: String { rawValue }
        var label: String { rawValue.capitalized }
        var pipeline: IngestionPipeline? {
            switch self {
            case .all: return nil
            case .news: return .news
            case .weather: return .weather
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

    @EnvironmentObject private var model: AppModel

    @State private var runs: [AdminIngestionRun] = []
    @State private var selectedRunId: Int?
    @State private var selectedRun: AdminIngestionRun?
    @State private var logs: [AdminIngestionLog] = []
    @State private var points: [AdminIngestionMetricsPoint] = []
    @State private var totals: [AdminIngestionMetricsTotal] = []

    @State private var pipelineFilter: PipelineFilter = .all
    @State private var metricsWindow: MetricsWindow = .d30

    @State private var runEverything: Bool = true
    @State private var runTopHeadlines: Bool = true
    @State private var newsQuery: String = "OpenAI"
    @State private var newsLanguage: String = "en"
    @State private var newsCountry: String = "us"
    @State private var newsCategory: String = "technology"
    @State private var weatherCountry: String = ""

    @State private var isLoadingOverview: Bool = false
    @State private var isTriggeringNews: Bool = false
    @State private var isTriggeringWeather: Bool = false
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
                    Text("News runs include NewsAPI and, when configured, TheNewsAPI.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    VStack(alignment: .leading, spacing: 8) {
                        Toggle("Everything", isOn: $runEverything)
                        Toggle("Top headlines", isOn: $runTopHeadlines)

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
                                            Text(prettySourceName(run.source_name))
                                                .font(.caption2.weight(.semibold))
                                                .padding(.horizontal, 8)
                                                .padding(.vertical, 4)
                                                .background(Color(red: 0.06, green: 0.41, blue: 0.33).opacity(0.16), in: Capsule())
                                                .foregroundStyle(Color(red: 0.06, green: 0.41, blue: 0.33))
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
                                .background((selectedRunId == run.id ? Color.accentColor.opacity(0.12) : Color.primary.opacity(0.04)), in: RoundedRectangle(cornerRadius: 10))
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
                            Text("Source: \(prettySourceName(selectedRun.source_name))")
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

    private func refreshOverview(silent: Bool) async {
        if !silent {
            isLoadingOverview = true
            overviewError = nil
        }

        do {
            async let runsTask = model.api.fetchAdminIngestionRuns(
                pipeline: pipelineFilter.pipeline,
                limit: 100,
                offset: 0
            )
            async let metricsTask = model.api.fetchAdminIngestionMetrics(
                days: metricsWindow.rawValue,
                pipeline: pipelineFilter.pipeline
            )
            let (nextRuns, metrics) = try await (runsTask, metricsTask)
            runs = nextRuns
            points = metrics.points
            totals = metrics.totals

            if let current = selectedRunId, nextRuns.contains(where: { $0.id == current }) {
                selectedRunId = current
            } else {
                selectedRunId = nextRuns.first?.id
            }
            if nextRuns.isEmpty {
                selectedRun = nil
                logs = []
            }
        } catch {
            overviewError = error.localizedDescription
        }

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
        guard runEverything || runTopHeadlines else {
            actionError = "Enable at least one News step."
            actionNotice = nil
            return
        }

        isTriggeringNews = true
        actionError = nil
        actionNotice = nil
        do {
            let detail = try await model.api.triggerAdminNewsIngestion(
                runEverything: runEverything,
                runTopHeadlines: runTopHeadlines,
                query: newsQuery,
                language: newsLanguage,
                country: newsCountry,
                category: newsCategory
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
        default:
            return value
        }
    }
}

private struct AdminUserManagementPanelView: View {
    @EnvironmentObject private var model: AppModel

    @State private var roles: [AdminRole] = []
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
    @State private var pendingRoleSave: Set<Int> = []
    @State private var pendingStatusSave: Set<Int> = []

    @State private var newRoleKey: String = ""
    @State private var newRoleDescription: String = ""
    @State private var isCreatingRole: Bool = false

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
                        ForEach(users) { user in
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
                                    Text(user.is_active ? "Active" : "Inactive")
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 4)
                                        .background((user.is_active ? Color.green : Color.gray).opacity(0.16), in: Capsule())
                                        .foregroundStyle(user.is_active ? Color.green : Color.secondary)
                                }

                                if !roles.isEmpty {
                                    ScrollView(.horizontal, showsIndicators: false) {
                                        HStack(spacing: 6) {
                                            ForEach(roles.map(\.key), id: \.self) { roleKey in
                                                let selected = (roleDrafts[user.id] ?? Set(user.roles)).contains(roleKey)
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

                                    Button(action: { Task { await toggleStatus(for: user) } }) {
                                        Text(pendingStatusSave.contains(user.id) ? "Updating…" : (user.is_active ? "Deactivate" : "Activate"))
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .tint(user.is_active ? .orange : .green)
                                    .disabled(pendingStatusSave.contains(user.id))

                                    Spacer()
                                }

                                if !user.providers.isEmpty {
                                    Text("Providers: \(user.providers.joined(separator: ", "))")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
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
            let (nextRoles, userResponse) = try await (rolesTask, usersTask)
            roles = nextRoles
            users = userResponse.users
            totalUsers = userResponse.total

            var nextDrafts: [Int: Set<String>] = [:]
            for user in userResponse.users {
                nextDrafts[user.id] = Set(user.roles)
            }
            roleDrafts = nextDrafts
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
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
                noticeMessage = "Updated roles for \(updated.email ?? updated.display_name ?? "user #\(updated.id)")."
            } else {
                noticeMessage = "Role update completed."
            }
        } catch {
            errorMessage = error.localizedDescription
        }

        pendingRoleSave.remove(user.id)
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
        .background(Color(.systemBackground).opacity(0.94), in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.primary.opacity(0.1), lineWidth: 1)
        )
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

private extension DateFormatter {
    static let adminDateTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}
