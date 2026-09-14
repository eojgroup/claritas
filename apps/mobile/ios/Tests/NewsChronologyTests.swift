import Foundation
import XCTest
@testable import ClaritasAppleModels

final class NewsChronologyTests: XCTestCase {
    func testNewestSortUsesInstantsInsteadOfISO8601TextOrder() throws {
        let earlierWithPositiveOffset = try item(
            id: 1,
            eventTime: "2026-09-07T10:00:00+02:00",
            timelineAt: "2026-09-07T10:00:00+02:00"
        )
        let laterInUTC = try item(
            id: 2,
            eventTime: "2026-09-07T08:30:00Z",
            timelineAt: "2026-09-07T08:30:00.000Z"
        )

        XCTAssertEqual(
            NewsChronology.sorted(
                [earlierWithPositiveOffset, laterInUTC],
                order: .newestFirst
            ).map(\.id),
            [2, 1]
        )
        XCTAssertEqual(
            NewsChronology.sorted(
                [laterInUTC, earlierWithPositiveOffset],
                order: .oldestFirst
            ).map(\.id),
            [1, 2]
        )
    }

    func testCanonicalTimelineWinsWhileBasisKeepsItsProvenanceLabel() throws {
        let published = try item(
            id: 1,
            eventTime: "2026-09-07T09:00:00Z",
            basis: "publisher_published_verified",
            timelineAt: "2026-09-07T08:00:00Z",
            publishedAt: "2026-09-07T07:00:00Z",
            discoveredAt: "2026-09-07T09:00:00Z",
            publisherVerified: true
        )
        let discovered = try item(
            id: 2,
            eventTime: "2026-09-07T10:00:00Z",
            basis: "provider_first_seen",
            timelineAt: "2026-09-07T09:30:00Z",
            discoveredAt: "2026-09-07T09:20:00Z"
        )
        let mixedSource = try item(
            id: 3,
            eventTime: "2026-09-07T11:00:00Z",
            basis: "publisher_published_or_provider_discovered",
            timelineAt: "2026-09-07T10:30:00Z"
        )

        XCTAssertEqual(published.chronologyLabel, "Published")
        XCTAssertTrue(published.chronologyDisplayText.hasPrefix("Published "))
        XCTAssertTrue(published.chronologyDisplayText.contains("2026"))
        XCTAssertTrue(published.chronologyDisplayText.contains(TimeZone.current.abbreviation(for: published.chronologyDate!) ?? TimeZone.current.identifier))
        XCTAssertEqual(
            published.chronologyDate,
            APIDateParser.parse("2026-09-07T08:00:00Z")
        )
        XCTAssertEqual(discovered.chronologyLabel, "First seen")
        XCTAssertEqual(
            discovered.chronologyDate,
            APIDateParser.parse("2026-09-07T09:30:00Z")
        )
        XCTAssertEqual(mixedSource.chronologyLabel, "Source time")
    }

    func testLegacySnapshotUsesDiscoveryFallbackAndUndatedItemsSortLast() throws {
        let legacyDiscovery = try item(
            id: 1,
            eventTime: "2026-09-07T07:00:00Z",
            basis: "provider_first_seen",
            discoveredAt: "2026-09-07T08:00:00Z"
        )
        let undated = try item(id: 2, eventTime: nil)

        XCTAssertEqual(
            legacyDiscovery.chronologyDate,
            APIDateParser.parse("2026-09-07T08:00:00Z")
        )
        XCTAssertEqual(
            NewsChronology.sorted([undated, legacyDiscovery], order: .newestFirst).map(\.id),
            [1, 2]
        )
    }

    private func item(
        id: Int,
        eventTime: String?,
        basis: String = "provider_first_seen",
        timelineAt: String? = nil,
        publishedAt: String? = nil,
        discoveredAt: String? = nil,
        publisherVerified: Bool = false
    ) throws -> NewsItem {
        var time: [String: Any] = [
            "basis": basis,
            "is_publisher_verified": publisherVerified
        ]
        if let timelineAt { time["timeline_at"] = timelineAt }
        if let publishedAt { time["published_at"] = publishedAt }
        if let discoveredAt { time["discovered_at"] = discoveredAt }

        var payload: [String: Any] = [
            "id": id,
            "time": time
        ]
        if let eventTime { payload["event_time"] = eventTime }

        let data = try JSONSerialization.data(withJSONObject: payload)
        return try JSONDecoder().decode(NewsItem.self, from: data)
    }
}
