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
                    WatchBriefingView()
                    WatchBriefingScheduleView()
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

                        ForEach(Array(briefing.key_takeaways.prefix(4).enumerated()), id: \.offset) { _, takeaway in
                            HStack(alignment: .top, spacing: 6) {
                                Circle()
                                    .fill(WatchPalette.orange)
                                    .frame(width: 5, height: 5)
                                    .padding(.top, 5)
                                Text(takeaway)
                                    .font(.caption2)
                            }
                        }
                    } else {
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
                        Task { await model.refresh() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .disabled(isRefreshing)
                }
                .padding(.horizontal, 3)
            }
            .containerBackground(WatchPalette.navy.gradient, for: .navigation)
        }
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
    @EnvironmentObject private var model: WatchAppModel
    @State private var enabled = true
    @State private var scheduledTime = WatchBriefingScheduleView.dateFromScheduleTime("07:00")
    @State private var timezone = TimeZone.current.identifier

    var body: some View {
        NavigationStack {
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
                    ForEach(model.news.prefix(10)) { item in
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
                    WatchSectionLabel(title: "News", icon: "newspaper")
                }
            }
            .navigationTitle("News")
            .containerBackground(WatchPalette.navy.gradient, for: .navigation)
        }
    }
}

private struct WatchMarketsView: View {
    @EnvironmentObject private var model: WatchAppModel

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(model.markets.prefix(12)) { quote in
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
                    WatchSectionLabel(title: "Markets", icon: "chart.line.uptrend.xyaxis")
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
                    ForEach(model.weather.prefix(12)) { item in
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
                    WatchSectionLabel(title: "Weather", icon: "cloud.sun")
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
