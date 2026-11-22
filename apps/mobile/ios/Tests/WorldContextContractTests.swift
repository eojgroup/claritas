import Foundation
import XCTest
@testable import ClaritasAppleModels

final class WorldContextContractTests: XCTestCase {
    func testRetainedTransportHistoryPreservesMissingDaysAndUnavailableYearComparison() throws {
        let json = """
        {"requested_days":400,"available_from":"2026-11-20T00:00:00Z","available_to":"2026-11-21T00:00:00Z","observed_days":1,
         "activity_retention_days":400,"movement_retention_days":100,"methodology":"Partial telemetry; missing is not zero",
         "series":[{"bucket":"2026-11-20T00:00:00Z","maritime_entities":null,"aviation_entities":null,"observed_hours":0,"ship_departures":null,"ship_arrivals":null,"source_names":[]},
                   {"bucket":"2026-11-21T00:00:00Z","maritime_entities":3,"aviation_entities":7,"observed_hours":5,"ship_departures":2,"ship_arrivals":1,"source_names":["retained"]}],
         "comparisons":[{"key":"year","label":"Same period last year","metric":"daily_peak_sampled_entities","current":{"start":"2026-10-23T00:00:00Z","end":"2026-11-22T00:00:00Z","days":30,"observed_days":1,"observation_hours":5,"average_daily_entities":10},"previous":{"start":"2025-10-23T00:00:00Z","end":"2025-11-22T00:00:00Z","days":30,"observed_days":0,"observation_hours":0,"average_daily_entities":null},"comparable":false,"change_percent":null,"notice":"Insufficient retained coverage"}]}
        """
        let history = try JSONDecoder().decode(TransportHistory.self, from: Data(json.utf8))
        XCTAssertEqual(history.activity_retention_days, 400)
        XCTAssertEqual(history.movement_retention_days, 100)
        XCTAssertNil(history.series[0].maritime_entities, "Missing days must not become zero-traffic observations")
        XCTAssertNotNil(history.series[1].date)
        XCTAssertEqual(history.series[1].observed_hours, 5)
        XCTAssertEqual(history.comparisons?.first?.comparable, false)
        XCTAssertNil(history.comparisons?.first?.change_percent)
    }

    private struct Fixture: Decodable {
        let event: IntelligenceEventDetail
        let transport: EventTransportDetail
        let weather: [CountryWeather]
        let market: CountryMarketDetail
        let scoped_transport: TransportOverview?
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
        let scopedTransport = try XCTUnwrap(fixture.scoped_transport)
        let history = try XCTUnwrap(scopedTransport.history)
        XCTAssertEqual(history.requested_days, 400)
        XCTAssertEqual(history.series.count, 400)
        XCTAssertTrue(history.series.allSatisfy { $0.date != nil })
        XCTAssertFalse(scopedTransport.entities.isEmpty)
    }
}
