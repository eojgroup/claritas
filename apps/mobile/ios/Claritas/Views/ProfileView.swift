import SwiftUI

struct ProfileView: View {
    enum Section: String, CaseIterable, Identifiable {
        case overview
        case identity
        case preferences
        case security
        case policies

        var id: String { rawValue }

        var title: String {
            switch self {
            case .overview: return "Overview"
            case .identity: return "Identity"
            case .preferences: return "Preferences"
            case .security: return "Security"
            case .policies: return "Policies"
            }
        }
    }

    @EnvironmentObject private var model: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage("THEME_DARK") private var dark: Bool = true
    @AppStorage("DEFAULT_MAP_MODE") private var defaultMapMode: String = "signals"
    @AppStorage("DEFAULT_LIST_MODE") private var defaultListMode: String = "news"
    @State private var isSigningOut: Bool = false
    @State private var section: Section = .overview
    @State private var briefingScheduleEnabled: Bool = true
    @State private var briefingScheduleTime: Date = ProfileView.dateFromScheduleTime("07:00")
    @State private var briefingScheduleTimezone: String = TimeZone.current.identifier

    private var displayName: String {
        model.authUser?.display_name ?? model.authUser?.email ?? "Signed in"
    }

    private var emailLabel: String {
        model.authUser?.email ?? "Email not provided"
    }

    private var userInitials: String {
        let source = model.authUser?.display_name ?? model.authUser?.email ?? "C"
        let parts = source.split(separator: " ")
        if parts.count >= 2 {
            let first = parts.first?.first.map(String.init) ?? ""
            let last = parts.last?.first.map(String.init) ?? ""
            return (first + last).uppercased()
        }
        return String(source.prefix(1)).uppercased()
    }

    var body: some View {
        BrandBackground {
            ScrollView {
                VStack(spacing: 18) {
                    headerCard
                    sectionPicker
                    sectionContent
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
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

    private var sectionPicker: some View {
        BrandCard {
            Picker("Section", selection: $section) {
                ForEach(Section.allCases) { section in
                    Text(section.title).tag(section)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    @ViewBuilder
    private var sectionContent: some View {
        switch section {
        case .overview:
            accountDetailsCard
            sessionHealthCard
            preferencesCard
        case .identity:
            accountDetailsCard
            providerCard
        case .preferences:
            preferencesCard
            workspaceDefaultsCard
        case .security:
            securityCard
            sessionHealthCard
            sessionCard
        case .policies:
            policiesCard
        }
    }

    private var headerCard: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 20)
                .fill(
                    LinearGradient(
                        colors: [
                            ClaritasPalette.darkBlue,
                            ClaritasPalette.darkGreen.opacity(0.82)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 16) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 14)
                            .fill(Color.white.opacity(0.15))
                            .frame(width: 64, height: 64)
                        Text(userInitials)
                            .font(.title2.weight(.semibold))
                            .foregroundStyle(.white)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Signed in as")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.white.opacity(0.7))
                            .textCase(.uppercase)
                            .tracking(3)
                        Text(displayName)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(.white)
                        Text(emailLabel)
                            .font(.footnote)
                            .foregroundStyle(Color.white.opacity(0.7))
                    }
                    Spacer()
                }
                HStack(spacing: 8) {
                    ForEach(model.authUser?.roles ?? ["Standard access"], id: \.self) { role in
                        Text(role.uppercased())
                            .font(.caption2.weight(.semibold))
                            .tracking(2)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color.white.opacity(0.15), in: Capsule())
                            .foregroundStyle(.white)
                    }
                }
            }
            .padding(20)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.15), radius: 20, x: 0, y: 12)
    }

    private var accountDetailsCard: some View {
        BrandCard(title: "Account details", icon: "person.crop.circle") {
            ProfileRow(label: "User ID", value: model.authUser.map { String($0.id) } ?? "—")
            ProfileRow(label: "Display name", value: model.authUser?.display_name ?? "Not set")
            ProfileRow(label: "Email", value: model.authUser?.email ?? "Not provided")
            ProfileRow(label: "Roles", value: (model.authUser?.roles?.isEmpty == false) ? (model.authUser?.roles?.joined(separator: ", ") ?? "") : "Standard access")
        }
    }

    private var providerCard: some View {
        BrandCard(title: "Identity providers", icon: "lock.shield") {
            if model.authProviders.isEmpty {
                Text("No providers reported yet.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ForEach(model.authProviders) { provider in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(providerLabel(provider))
                                .font(.subheadline.weight(.semibold))
                            Text(provider.enabled ? "Enabled and ready" : "Disabled")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(provider.enabled ? "Active" : "Inactive")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(provider.enabled ? ClaritasPalette.darkGreen.opacity(0.2) : ClaritasPalette.grey.opacity(0.2), in: Capsule())
                            .foregroundStyle(provider.enabled ? ClaritasPalette.darkGreen : ClaritasPalette.grey)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private var preferencesCard: some View {
        BrandCard(title: "Preferences", icon: "slider.horizontal.3") {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Theme")
                            .font(.subheadline.weight(.semibold))
                        Text("Match your current workspace.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(action: { dark.toggle() }) {
                        Label(dark ? "Light" : "Dark", systemImage: dark ? "sun.max.fill" : "moon.fill")
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    .tint(ClaritasPalette.shellAccent(for: colorScheme))
                }

                Divider()

                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Event alerts")
                            .font(.subheadline.weight(.semibold))
                        Text(model.pushRegistrationError ?? "Watched high-impact signals can open directly in Signal desk.")
                            .font(.caption)
                            .foregroundStyle(model.pushRegistrationError == nil ? Color.secondary : Color.orange)
                    }
                    Spacer()
                    Button {
                        Task { await model.configurePushNotifications() }
                    } label: {
                        Label("Enable", systemImage: "bell.badge")
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                }

                Divider()

                VStack(alignment: .leading, spacing: 12) {
                    Toggle(isOn: $briefingScheduleEnabled) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Daily briefing")
                                .font(.subheadline.weight(.semibold))
                            Text("Scheduled at \(Self.scheduleTimeString(from: briefingScheduleTime)) \(briefingScheduleTimezone)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    DatePicker(
                        "Time",
                        selection: $briefingScheduleTime,
                        displayedComponents: .hourAndMinute
                    )
                    .datePickerStyle(.compact)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Timezone")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Picker("Timezone", selection: $briefingScheduleTimezone) {
                            ForEach(DailyBriefingScheduleOptions.timezoneOptions(including: briefingScheduleTimezone), id: \.self) { timezone in
                                Text(timezone).tag(timezone)
                            }
                        }
                        .pickerStyle(.menu)
                    }

                    if let schedule = model.dailyBriefingSchedule {
                        ProfileRow(
                            label: "Last run",
                            value: schedule.lastTriggeredDate.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "Not yet"
                        )
                        if let scheduleDate = schedule.last_scheduled_for {
                            ProfileRow(label: "Schedule date", value: scheduleDate)
                        }
                    }

                    if let notice = model.dailyBriefingScheduleNotice {
                        Text(notice)
                            .font(.caption)
                            .foregroundStyle(ClaritasPalette.positiveText(for: colorScheme))
                    }

                    if let error = model.dailyBriefingScheduleError {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    Button(action: saveBriefingSchedule) {
                        Label(
                            model.isSavingDailyBriefingSchedule ? "Saving…" : "Save schedule",
                            systemImage: "clock.badge.checkmark"
                        )
                        .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(ClaritasPalette.shellAccent(for: colorScheme))
                    .disabled(model.isSavingDailyBriefingSchedule || model.isLoadingDailyBriefingSchedule)
                }
            }
        }
    }

    private var workspaceDefaultsCard: some View {
        BrandCard(title: "Workspace defaults", icon: "globe") {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Default map mode")
                        .font(.subheadline.weight(.semibold))
                    Picker("Default map mode", selection: $defaultMapMode) {
                        Text("Signals").tag("signals")
                        Text("News").tag("news")
                        Text("Weather").tag("weather")
                        Text("Leaders").tag("leadership")
                    }
                    .pickerStyle(.segmented)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Default list mode")
                        .font(.subheadline.weight(.semibold))
                    Picker("Default list mode", selection: $defaultListMode) {
                        Text("News").tag("news")
                        Text("Weather").tag("weather")
                        Text("Markets").tag("market")
                    }
                    .pickerStyle(.segmented)
                }

                Text("These defaults are applied when the dashboard overview opens.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var securityCard: some View {
        BrandCard(title: "Access roles", icon: "checkmark.shield") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Session tokens are short-lived and scoped to approved identity providers.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                FlexibleRoleCloud(roles: model.authUser?.roles ?? ["Standard access"])
            }
        }
    }

    private var sessionHealthCard: some View {
        BrandCard(title: "Session health", icon: "waveform.path.ecg") {
            ProfileRow(label: "Session status", value: "Active")
            ProfileRow(label: "Provider", value: "Managed")
            ProfileRow(label: "Role count", value: String(model.authUser?.roles?.count ?? 1))

            Text("All access events are recorded for audit readiness.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
        }
    }

    private var policiesCard: some View {
        BrandCard(title: "Policies", icon: "doc.text") {
            VStack(alignment: .leading, spacing: 12) {
                Text("Claritas policies define how data is protected, retained, and used across the platform.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                FlexibleRoleCloud(roles: legalPolicies.map(\.title))

                Text("Open the Policies tab for the full legal summaries and brand palette reference.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var sessionCard: some View {
        BrandCard(title: "Session", icon: "checkmark.seal") {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Active session")
                        .font(.subheadline.weight(.semibold))
                    Text("Managed by your identity provider.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: signOut) {
                    Label(isSigningOut ? "Signing out…" : "Sign out", systemImage: "arrow.backward.circle")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(ClaritasPalette.shellAccent(for: colorScheme))
                .disabled(isSigningOut)
            }
        }
    }

    private func signOut() {
        guard !isSigningOut else { return }
        isSigningOut = true
        Task {
            await model.logout()
            isSigningOut = false
        }
    }

    private func applyScheduleDraft(_ schedule: DailyBriefingSchedule?) {
        guard let schedule else { return }
        briefingScheduleEnabled = schedule.enabled
        briefingScheduleTime = Self.dateFromScheduleTime(schedule.scheduled_time)
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
                scheduledTime: Self.scheduleTimeString(from: briefingScheduleTime),
                timezone: timezone
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

    private func providerLabel(_ provider: AuthProvider) -> String {
        if let name = provider.display_name, !name.isEmpty { return name }
        switch provider.id {
        case .google: return "Google"
        case .microsoft: return "Microsoft"
        case .apple: return "Apple"
        }
    }
}

private struct FlexibleRoleCloud: View {
    let roles: [String]
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(roles, id: \.self) { role in
                Text(role.uppercased())
                    .font(.caption2.weight(.semibold))
                    .tracking(1.8)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(ClaritasPalette.darkGreen.opacity(0.14), in: Capsule())
                    .foregroundStyle(ClaritasPalette.positiveText(for: colorScheme))
            }
        }
    }
}

private struct ProfileRow: View {
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
                .foregroundStyle(.primary)
                .multilineTextAlignment(.trailing)
        }
    }
}
