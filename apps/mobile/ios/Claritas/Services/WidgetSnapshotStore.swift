import Foundation
import WidgetKit

enum WidgetSnapshotStore {
    private static let suiteName = Bundle.main.object(forInfoDictionaryKey: "CLARITAS_WIDGET_APP_GROUP") as? String
    private static let snapshotKey = "claritas.widget.snapshot"

    static func save(
        newsCount: Int,
        countryMarkets: [CountryMarketOverview],
        weather: [CountryWeather]
    ) {
        guard let defaults = suiteName.flatMap(UserDefaults.init(suiteName:)) else { return }
        let averageMove: Double = {
            let moves = countryMarkets.compactMap(\.composite_change_percent)
            guard !moves.isEmpty else { return 0 }
            return moves.reduce(0, +) / Double(moves.count)
        }()
        let hottest = weather.max { ($0.temp_c ?? -.infinity) < ($1.temp_c ?? -.infinity) }
        let hottestTemperature = hottest?.temp_c
        let hottestTemperatureLabel = hottestTemperature.map { String(format: "%.0f°C", $0) } ?? "—"
        let hottestCountry = hottest?.country.uppercased() ?? "—"
        let snapshot: [String: Any] = [
            "dailyTitle": "Geospatial signal pulse",
            "dailyText": "\(newsCount) news signals · markets \(String(format: "%+.1f%%", averageMove)) · \(hottestCountry) \(hottestTemperatureLabel)",
            "newsCount": newsCount,
            "marketMove": averageMove,
            "weatherCountry": hottestCountry,
            "weatherTemp": hottestTemperature ?? 0,
            "updatedAt": Date().timeIntervalSince1970
        ]
        defaults.set(snapshot, forKey: snapshotKey)
        WidgetCenter.shared.reloadAllTimelines()
    }
}
