import Foundation
import WidgetKit

enum WidgetSnapshotStore {
    private static let suiteName = Bundle.main.object(forInfoDictionaryKey: "CLARITAS_WIDGET_APP_GROUP") as? String
    private static let snapshotKey = "claritas.widget.snapshot"

    static func save(
        newsCount: Int,
        marketQuotes: [MarketQuote],
        weather: [CountryWeather]
    ) {
        guard let defaults = suiteName.flatMap(UserDefaults.init(suiteName:)) else { return }
        let averageMove: Double = {
            let moves = marketQuotes.compactMap(\.percent_change)
            guard !moves.isEmpty else { return 0 }
            return moves.reduce(0, +) / Double(moves.count)
        }()
        let hottest = weather.max { ($0.temp_c ?? -.infinity) < ($1.temp_c ?? -.infinity) }
        let hottestTemperature = hottest?.temp_c
        let hottestTemperatureLabel = hottestTemperature.map { String(format: "%.0f°C", $0) } ?? "—"
        defaults.set([
            "dailyTitle": "Geospatial signal pulse",
            "dailyText": "\(newsCount) news signals · markets \(String(format: "%+.1f%%", averageMove)) · \(hottest?.country.uppercased() ?? "—") \(hottestTemperatureLabel)",
            "newsCount": newsCount,
            "marketMove": averageMove,
            "weatherCountry": hottest?.country.uppercased() ?? "—",
            "weatherTemp": hottest?.temp_c ?? 0,
            "updatedAt": Date().timeIntervalSince1970
        ], forKey: snapshotKey)
        WidgetCenter.shared.reloadAllTimelines()
    }
}
