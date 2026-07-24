import SwiftUI
import WidgetKit

private struct ClaritasWatchEntry: TimelineEntry {
    let date: Date
    let title: String
    let summary: String
    let newsCount: Int
    let marketDirection: Double
}

private struct ClaritasWatchProvider: TimelineProvider {
    func placeholder(in context: Context) -> ClaritasWatchEntry {
        .init(date: .now, title: "Geospatial signal pulse", summary: "Signals ready", newsCount: 8, marketDirection: 0.4)
    }

    func getSnapshot(in context: Context, completion: @escaping (ClaritasWatchEntry) -> Void) { completion(entry()) }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ClaritasWatchEntry>) -> Void) {
        completion(Timeline(entries: [entry()], policy: .after(.now.addingTimeInterval(30 * 60))))
    }

    private func entry() -> ClaritasWatchEntry {
        let suiteName = Bundle.main.object(forInfoDictionaryKey: "CLARITAS_WATCH_WIDGET_APP_GROUP") as? String
        let values = suiteName.flatMap(UserDefaults.init(suiteName:))?.dictionary(forKey: "claritas.watch.widget.snapshot") ?? [:]
        return .init(
            date: .now,
            title: values["title"] as? String ?? "Geospatial signal pulse",
            summary: values["summary"] as? String ?? "Open Claritas for current signals.",
            newsCount: values["newsCount"] as? Int ?? 0,
            marketDirection: values["marketDirection"] as? Double ?? 0
        )
    }
}

struct ClaritasWatchWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ClaritasWatchWidget", provider: ClaritasWatchProvider()) { entry in
            VStack(alignment: .leading, spacing: 3) {
                Label("Signal map", systemImage: "globe.europe.africa.fill")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Color(red: 237.0 / 255.0, green: 163.0 / 255.0, blue: 106.0 / 255.0))
                Text(entry.title).font(.caption.weight(.semibold)).lineLimit(2)
                Text(entry.summary).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                Text("\(entry.newsCount) news · \(String(format: "%+.1f%%", entry.marketDirection))")
                    .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
            }
            .background(Color(red: 8.0 / 255.0, green: 17.0 / 255.0, blue: 25.0 / 255.0))
        }
        .configurationDisplayName("Claritas signal pulse")
        .description("Today’s cross-source signal pulse.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@main struct ClaritasWatchWidgets: WidgetBundle { var body: some Widget { ClaritasWatchWidget() } }
