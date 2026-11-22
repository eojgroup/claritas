import Foundation
import XCTest
@testable import ClaritasAppleModels

final class WorldContextContractTests: XCTestCase {
    private struct Fixture: Decodable {
        let event: IntelligenceEventDetail
        let transport: EventTransportDetail
        let weather: [CountryWeather]
        let market: CountryMarketDetail
    }
    func testProductionCountryAndAnomalyDrilldownContracts() throws {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/WorldContext.json")
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            guard let date = APIDateParser.parse(value) else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid date")) }
            return date
        }
        let fixture = try decoder.decode(Fixture.self, from: Data(contentsOf: file))
        XCTAssertEqual(fixture.event.event.event_type, "transport_activity_change")
        XCTAssertEqual(fixture.transport.coverage, "retained_movements")
        let start = try XCTUnwrap(fixture.transport.window_start), end = try XCTUnwrap(fixture.transport.window_end)
        XCTAssertFalse(fixture.transport.movements.isEmpty)
        XCTAssertTrue(fixture.transport.movements.allSatisfy { $0.observed_at >= start && $0.observed_at < end })
        XCTAssertTrue(fixture.transport.hours.allSatisfy { $0.utcHour >= 0 && $0.utcHour < 24 && $0.observed_at < end })
        let weather = try XCTUnwrap(fixture.weather.first)
        XCTAssertEqual(weather.country, fixture.market.summary.country)
        XCTAssertNotNil(weather.observedDate)
        XCTAssertFalse(weather.forecast?.isEmpty ?? true)
        XCTAssertTrue(weather.forecast?.allSatisfy { APIDateParser.parse($0.forecast_time) != nil } ?? false)
        XCTAssertFalse(fixture.market.fx_history.isEmpty)
        XCTAssertTrue(fixture.market.fx_history.allSatisfy { $0.date != nil && $0.value.isFinite })
    }
}
