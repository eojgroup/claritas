import SwiftUI
import WidgetKit

private struct WatchEntry: TimelineEntry { let date: Date; let title: String; let text: String }
private struct WatchProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchEntry { .init(date: .now, title: "Daily briefing", text: "Signals ready") }
    func getSnapshot(in context: Context, completion: @escaping (WatchEntry) -> Void) { completion(entry()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchEntry>) -> Void) { completion(Timeline(entries: [entry()], policy: .after(.now.addingTimeInterval(30 * 60)))) }
    private func entry() -> WatchEntry {
        let suiteName = Bundle.main.object(forInfoDictionaryKey: "CLARITAS_WATCH_WIDGET_APP_GROUP") as? String
        let values = suiteName.flatMap(UserDefaults.init(suiteName:))?.dictionary(forKey: "claritas.watch.widget.snapshot") ?? [:]
        return .init(date: .now, title: values["title"] as? String ?? "Daily briefing", text: values["text"] as? String ?? "Open Claritas for today’s signals.")
    }
}
struct ClaritasWatchWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ClaritasWatchWidget", provider: WatchProvider()) { entry in
            VStack(alignment: .leading, spacing: 3) {
                Label("Briefing", systemImage: "sparkles").font(.caption2.weight(.bold)).foregroundStyle(.orange)
                Text(entry.title).font(.caption.weight(.semibold)).lineLimit(2)
                Text(entry.text).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
            .background(Color(red: 0.04, green: 0.11, blue: 0.18))
        }
        .configurationDisplayName("Claritas briefing")
        .description("Open today’s intelligence briefing.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}
@main struct ClaritasWatchWidgets: WidgetBundle { var body: some Widget { ClaritasWatchWidget() } }
