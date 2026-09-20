import Foundation
import XCTest
@testable import ClaritasAppleModels

final class NewsAdditionalContextTests: XCTestCase {
    func testSourceOnlyAndLegacyLinksStayHidden() throws {
        XCTAssertFalse(try event(count: nil).hasAdditionalContext)
        XCTAssertFalse(try event(count: 0).hasAdditionalContext)
        XCTAssertTrue(try event(count: 2).hasAdditionalContext)
        XCTAssertEqual(try event(count: 2).additionalContextLabel, "2 additional sources")
    }

    func testOnlyAvailableImageryCountsAsAdditionalContext() throws {
        XCTAssertFalse(try event(count: 0, imagery: "queued").hasAdditionalContext)
        XCTAssertFalse(try event(count: 0, imagery: "processing").hasAdditionalContext)
        XCTAssertTrue(try event(count: 0, imagery: "imagery_available").hasAdditionalContext)
        XCTAssertEqual(try event(count: 0, imagery: "imagery_available").additionalContextLabel, "Satellite imagery available")
    }

    private func event(count: Int?, imagery: String = "not_requested") throws -> NewsLinkedEvent {
        var raw: [String: Any] = ["id": "event-1", "title": "Same article", "event_type": "news", "status": "active",
            "severity": "low", "confidence": 0.5, "relevance_score": 0.5, "domain_count": 1,
            "evidence_count": 1, "domains": ["news"], "earth_observation_state": imagery]
        if let count { raw["additional_evidence_count"] = count }
        return try JSONDecoder().decode(NewsLinkedEvent.self, from: JSONSerialization.data(withJSONObject: raw))
    }
}
