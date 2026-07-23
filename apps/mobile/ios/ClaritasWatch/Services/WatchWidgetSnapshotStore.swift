import Foundation
import WidgetKit

enum WatchWidgetSnapshotStore {
    private static let suiteName = Bundle.main.object(forInfoDictionaryKey: "CLARITAS_WATCH_WIDGET_APP_GROUP") as? String

    static func save(
        newsCount: Int,
        marketDirection: Double
    ) {
        guard let defaults = suiteName.flatMap(UserDefaults.init(suiteName:)) else { return }
        defaults.set([
            "title": "Geospatial signal pulse",
            "summary": "\(newsCount) news · markets \(String(format: "%+.1f%%", marketDirection))",
            "newsCount": newsCount,
            "marketDirection": marketDirection,
            "updatedAt": Date().timeIntervalSince1970
        ], forKey: "claritas.watch.widget.snapshot")
        WidgetCenter.shared.reloadAllTimelines()
    }
}
