import Foundation
import WidgetKit

enum WatchWidgetSnapshotStore {
    private static let suiteName = Bundle.main.object(forInfoDictionaryKey: "CLARITAS_WATCH_WIDGET_APP_GROUP") as? String

    static func save(briefing: DailySignalBriefing?, newsCount: Int, marketDirection: Double) {
        guard let defaults = suiteName.flatMap(UserDefaults.init(suiteName:)) else { return }
        defaults.set([
            "title": briefing?.title ?? "Daily briefing",
            "summary": briefing?.update_text ?? "Open Claritas for current signals.",
            "newsCount": newsCount,
            "marketDirection": marketDirection
        ], forKey: "claritas.watch.widget.snapshot")
        WidgetCenter.shared.reloadAllTimelines()
    }
}
