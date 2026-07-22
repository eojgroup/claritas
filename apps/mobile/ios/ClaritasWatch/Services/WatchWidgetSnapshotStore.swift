import Foundation
import WidgetKit

enum WatchWidgetSnapshotStore {
    private static let suiteName = Bundle.main.object(forInfoDictionaryKey: "CLARITAS_WATCH_WIDGET_APP_GROUP") as? String

    static func save(
        briefing: DailySignalBriefing?,
        personalBriefing: PersonalDailyBriefing?,
        newsCount: Int,
        marketDirection: Double
    ) {
        guard let defaults = suiteName.flatMap(UserDefaults.init(suiteName:)) else { return }
        defaults.set([
            "title": personalBriefing?.title ?? briefing?.title ?? "Daily briefing",
            "summary": personalBriefing?.update_text ?? briefing?.update_text ?? "Open Claritas for current signals.",
            "newsCount": newsCount,
            "marketDirection": marketDirection,
            "updatedAt": Date().timeIntervalSince1970
        ], forKey: "claritas.watch.widget.snapshot")
        WidgetCenter.shared.reloadAllTimelines()
    }
}
