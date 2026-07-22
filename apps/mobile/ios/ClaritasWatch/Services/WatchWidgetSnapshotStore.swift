import Foundation
import WidgetKit

enum WatchWidgetSnapshotStore {
    private static let suiteName = Bundle.main.object(forInfoDictionaryKey: "CLARITAS_WATCH_WIDGET_APP_GROUP") as? String
    static func save(briefing: DailySignalBriefing?, personalBriefing: PersonalDailyBriefing?) {
        guard let defaults = suiteName.flatMap(UserDefaults.init(suiteName:)) else { return }
        defaults.set([
            "title": personalBriefing?.title ?? briefing?.title ?? "Daily briefing",
            "text": personalBriefing?.update_text ?? briefing?.update_text ?? "Open Claritas for today’s signals.",
            "updatedAt": Date().timeIntervalSince1970
        ], forKey: "claritas.watch.widget.snapshot")
        WidgetCenter.shared.reloadAllTimelines()
    }
}
