import Foundation
import XCTest
@testable import ClaritasAppleModels

final class DailyBriefingReadingTests: XCTestCase {
    func testReadingKeepsEveryParagraphAndTakeaway() throws {
        let payload: [String: Any] = [
            "id": 1, "briefing_date": "2026-11-21", "title": "Daily briefing",
            "update_text": " First paragraph.\r\n\r\nSecond paragraph.\n\n\nThird paragraph. ",
            "key_takeaways": (1...8).map { "Takeaway \($0)" }, "status": "published",
            "published_at": "2026-11-21T07:00:00Z", "created_at": "2026-11-21T06:55:00Z", "updated_at": "2026-11-21T07:05:00Z"
        ]
        let briefing = try JSONDecoder().decode(DailySignalBriefing.self, from: JSONSerialization.data(withJSONObject: payload))
        XCTAssertEqual(briefing.readingParagraphs, ["First paragraph.", "Second paragraph.", "Third paragraph."])
        XCTAssertEqual(briefing.key_takeaways.count, 8)
        XCTAssertEqual(briefing.publishedDate, APIDateParser.parse("2026-11-21T07:00:00Z"))
    }

    func testPublishedBriefingFixtureIsReadable() throws {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/DailyBriefing.json")
        let briefing = try JSONDecoder().decode(DailySignalBriefing.self, from: Data(contentsOf: file))
        XCTAssertEqual(briefing.status, "published")
        XCTAssertFalse(briefing.title.isEmpty)
        XCTAssertFalse(briefing.readingParagraphs.isEmpty)
        XCTAssertNotNil(briefing.publishedDate)
    }
}
