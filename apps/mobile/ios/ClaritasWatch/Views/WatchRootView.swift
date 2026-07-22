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
                    WatchNewsView()
                    WatchMarketsView()
                    WatchWeatherView()
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

    private var topMover: MarketQuote? {
        model.markets.max { abs($0.percent_change ?? 0) < abs($1.percent_change ?? 0) }
    }

    private var topWeather: CountryWeather? {
        model.weatherAlerts.first ?? model.weather.first
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        WatchSectionLabel(title: "Signal glance", icon: "waveform.path.ecg")
                        Spacer()
                        WatchRefreshStatus()
                    }

                    WatchCard {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(model.criticalSignalCount)")
                                    .font(.title.weight(.semibold))
                                    .monospacedDigit()
                                    .foregroundStyle(
                                        model.criticalSignalCount > 0
                                            ? WatchPalette.orange
                                            : WatchPalette.sage
                                    )
                                Text("Threshold signals")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(
                                systemName: model.criticalSignalCount > 0
                                    ? "exclamationmark.triangle.fill"
                                    : "checkmark.circle.fill"
                            )
                            .foregroundStyle(
                                model.criticalSignalCount > 0
                                    ? WatchPalette.orange
                                    : WatchPalette.sage
                            )
                        }
                    }

                    if let mover = topMover {
                        WatchCard {
                            VStack(alignment: .leading, spacing: 3) {
                                WatchSectionLabel(title: "Top market move", icon: "chart.line.uptrend.xyaxis")
                                HStack {
                                    Text(mover.symbol)
                                        .font(.headline)
                                    Spacer()
                                    Text(mover.percent_change.map { String(format: "%+.2f%%", $0) } ?? "—")
                                        .font(.headline.monospacedDigit())
                                        .foregroundStyle((mover.percent_change ?? 0) >= 0 ? WatchPalette.sage : WatchPalette.negative)
                                }
                            }
                        }
                    }

                    if let weather = topWeather {
                        WatchCard {
                            VStack(alignment: .leading, spacing: 3) {
                                WatchSectionLabel(title: "Weather scope", icon: "cloud.sun.fill")
                                HStack {
                                    Text(weather.country.uppercased())
                                        .font(.headline)
                                    Spacer()
                                    Text(weather.temp_c.map { String(format: "%.0f°", $0) } ?? "—")
                                        .font(.headline.monospacedDigit())
                                }
                                Text(weather.weather_desc ?? weather.weather_main ?? "Current conditions")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }

                    if let story = model.news.first {
                        WatchCard {
                            VStack(alignment: .leading, spacing: 3) {
                                WatchSectionLabel(title: "Latest headline", icon: "newspaper")
                                Text(story.title ?? "Untitled")
                                    .font(.caption.weight(.semibold))
                                    .lineLimit(2)
                            }
                        }
                    }

                    HStack {
                        Button {
                            model.openOnPhone("dashboard")
                        } label: {
                            Label("iPhone", systemImage: "iphone")
                        }

                        Button {
                            Task { await model.refresh() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .accessibilityLabel("Refresh signals")
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
                        Text(briefing.title)
                            .font(.headline)
                            .foregroundStyle(WatchPalette.cream)

                        Text(briefing.update_text)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)

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

                    if let briefing = model.personalBriefing {
                        WatchCard {
                            VStack(alignment: .leading, spacing: 5) {
                                WatchSectionLabel(title: "Your briefing", icon: "person.crop.circle")
                                Text(briefing.title)
                                    .font(.caption.weight(.semibold))
                                    .lineLimit(2)
                                Text(briefing.update_text)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(3)
                            }
                        }
                    } else {
                        WatchCard {
                            Text("Your newsletter briefing will appear here after delivery.")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
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
        .onChange(of: model.briefingSchedule?.updated_at) { _ in
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

    var body: some View {
        NavigationStack {
            List {
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
                    WatchSectionLabel(title: "Podcasts", icon: "mic.fill")
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
