import Foundation
import XCTest
@testable import ClaritasAppleModels

final class NewsHandoffTests: XCTestCase {
    func testSnapshotPreservesExactReportAndProvenanceWithoutRawProviderPayload() throws {
        let item = try report(extra: ["payload": ["raw": String(repeating: "x", count: 100_000)]])
        let data = try XCTUnwrap(NewsHandoffSnapshot.encode(item))
        let received = try XCTUnwrap(NewsHandoffSnapshot.decode(data, expectedID: 42))

        XCTAssertLessThan(data.count, NewsHandoffSnapshot.maximumBytes)
        XCTAssertEqual(received.id, 42)
        XCTAssertEqual(received.title, "Archived report")
        XCTAssertEqual(received.url, "https://publisher.example/report")
        XCTAssertEqual(received.publisher, "Original publisher")
        XCTAssertEqual(received.countries, ["GB", "FR"])
        XCTAssertEqual(received.chronologyDate, item.chronologyDate)
        XCTAssertNil(received.payload)
    }

    func testSnapshotRejectsWrongIdentityAndMalformedOrOversizedMessages() throws {
        let data = try XCTUnwrap(NewsHandoffSnapshot.encode(try report()))

        XCTAssertNil(NewsHandoffSnapshot.decode(data, expectedID: 43))
        XCTAssertNil(NewsHandoffSnapshot.decode(data, expectedID: 0))
        XCTAssertNil(NewsHandoffSnapshot.decode(Data("invalid".utf8), expectedID: 42))
        XCTAssertNil(NewsHandoffSnapshot.decode(Data(repeating: 32, count: NewsHandoffSnapshot.maximumBytes + 1), expectedID: 42))
    }

    func testOversizedPresentationDoesNotExceedConnectivityMessageBudget() throws {
        let item = try report(extra: ["summary": String(repeating: "x", count: NewsHandoffSnapshot.maximumBytes)])
        XCTAssertNil(NewsHandoffSnapshot.encode(item))
    }

    private func report(extra: [String: Any] = [:]) throws -> NewsItem {
        var object: [String: Any] = [
            "id": 42,
            "title": "Archived report",
            "url": "https://publisher.example/report",
            "publisher": "Original publisher",
            "source_name": "institutional_rss",
            "countries": ["GB", "FR"],
            "event_time": "2026-09-01T09:00:00Z"
        ]
        object.merge(extra) { _, new in new }
        return try JSONDecoder().decode(NewsItem.self, from: JSONSerialization.data(withJSONObject: object))
    }
}
