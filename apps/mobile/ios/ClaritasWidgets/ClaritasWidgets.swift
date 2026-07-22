import SwiftUI
import WidgetKit

private struct ClaritasWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: ClaritasWidgetSnapshot
}

private struct ClaritasWidgetSnapshot {
    let dailyTitle: String
    let dailyText: String
    let personalTitle: String
    let personalText: String
    let newsCount: Int
    let marketMove: Double
    let weatherCountry: String
    let weatherTemp: Double

    static let placeholder = ClaritasWidgetSnapshot(dailyTitle: "Daily signal briefing", dailyText: "Concise global intelligence, ready for review.", personalTitle: "Your briefing", personalText: "A personal update is ready.", newsCount: 12, marketMove: 0.8, weatherCountry: "TN", weatherTemp: 28)
}

private struct ClaritasWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> ClaritasWidgetEntry { .init(date: .now, snapshot: .placeholder) }
    func getSnapshot(in context: Context, completion: @escaping (ClaritasWidgetEntry) -> Void) { completion(.init(date: .now, snapshot: loadSnapshot())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<ClaritasWidgetEntry>) -> Void) {
        let entry = ClaritasWidgetEntry(date: .now, snapshot: loadSnapshot())
        completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(30 * 60))))
    }

    private func loadSnapshot() -> ClaritasWidgetSnapshot {
        let suiteName = Bundle.main.object(forInfoDictionaryKey: "CLARITAS_WIDGET_APP_GROUP") as? String
        let values = suiteName.flatMap(UserDefaults.init(suiteName:))?.dictionary(forKey: "claritas.widget.snapshot") ?? [:]
        return ClaritasWidgetSnapshot(
            dailyTitle: values["dailyTitle"] as? String ?? ClaritasWidgetSnapshot.placeholder.dailyTitle,
            dailyText: values["dailyText"] as? String ?? ClaritasWidgetSnapshot.placeholder.dailyText,
            personalTitle: values["personalTitle"] as? String ?? ClaritasWidgetSnapshot.placeholder.personalTitle,
            personalText: values["personalText"] as? String ?? ClaritasWidgetSnapshot.placeholder.personalText,
            newsCount: values["newsCount"] as? Int ?? 0,
            marketMove: values["marketMove"] as? Double ?? 0,
            weatherCountry: values["weatherCountry"] as? String ?? "—",
            weatherTemp: values["weatherTemp"] as? Double ?? 0
        )
    }
}

struct ClaritasBriefingWidget: Widget {
    let kind = "ClaritasBriefingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ClaritasWidgetProvider()) { entry in
            ClaritasWidgetView(entry: entry)
        }
        .configurationDisplayName("Claritas briefing")
        .description("A concise view of today’s global and personal intelligence.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

private struct ClaritasWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ClaritasWidgetEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label("CLARITAS", systemImage: "sparkles")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.orange)
            Text(family == .systemSmall ? entry.snapshot.dailyTitle : entry.snapshot.personalTitle)
                .font(.headline)
                .lineLimit(2)
            Text(family == .systemSmall ? entry.snapshot.dailyText : entry.snapshot.personalText)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(family == .systemLarge ? 5 : 3)
            Spacer(minLength: 0)
            HStack(spacing: 10) {
                Label("\(entry.snapshot.newsCount)", systemImage: "newspaper")
                Label(String(format: "%+.1f%%", entry.snapshot.marketMove), systemImage: "chart.line.uptrend.xyaxis")
            }
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        .background(Color(red: 0.04, green: 0.11, blue: 0.18))
    }
}

@main
struct ClaritasWidgets: WidgetBundle {
    var body: some Widget { ClaritasBriefingWidget() }
}
