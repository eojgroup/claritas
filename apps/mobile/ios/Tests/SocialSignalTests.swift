import Foundation
import XCTest
@testable import ClaritasAppleModels

final class SocialSignalTests: XCTestCase {
    func testAdminSocialPipelineDecodesWithoutInvalidatingRunLists() throws {
        let pipeline = try JSONDecoder().decode(IngestionPipeline.self, from: Data("\"social\"".utf8))
        XCTAssertEqual(pipeline, .social)
    }

    func testSocialContractPreservesSpeakerResponsibilityAndFactBoundary() throws {
        let value = try decode(
            id: 9,
            postedAt: "2026-09-07T08:30:00Z",
            displayName: "Port Watch",
            handle: "portwatch"
        )

        XCTAssertEqual(value.linked_events?.first?.id, "investigation-9")
        XCTAssertEqual(value.authorLabel, "Port Watch")
        XCTAssertEqual(value.handleLabel, "@portwatch")
        XCTAssertEqual(value.responsible_party.name, "Port Watch")
        XCTAssertEqual(value.signal_nature, "claim")
        XCTAssertEqual(value.verification_status, "unverified")
        XCTAssertFalse(value.is_fact)
        XCTAssertTrue(value.posted_by.platform_verified)
        XCTAssertEqual(value.engagement.quotes, 2)
        XCTAssertEqual(value.engagement.views, 5)
        XCTAssertEqual(value.responsible_party.caveat, "Account attribution does not establish factual accuracy.")
    }

    func testRedditHandleAndProviderSpecificEngagementRemainPlatformNative() throws {
        let value = try decode(
            id: 13,
            postedAt: "2026-09-07T10:00:00Z",
            displayName: nil,
            handle: "u/portwatch",
            platform: .reddit
        )

        XCTAssertEqual(value.handleLabel, "u/portwatch")
        XCTAssertFalse(value.handleLabel?.hasPrefix("@") ?? true)
        XCTAssertEqual(value.engagement.score, 17)
        XCTAssertEqual(value.engagement.comments, 3)
        XCTAssertEqual(value.engagement.upvote_ratio, 0.91)
    }

    func testSocialChronologySortsByDateInstantAndThenStableIdentifier() throws {
        let earlier = try decode(
            id: 10,
            postedAt: "2026-09-07T08:00:00Z",
            displayName: nil,
            handle: "earlier"
        )
        let later = try decode(
            id: 11,
            postedAt: "2026-09-07T08:30:00Z",
            displayName: nil,
            handle: "later"
        )
        let sameTimeHigherID = try decode(
            id: 12,
            postedAt: "2026-09-07T08:30:00Z",
            displayName: nil,
            handle: "same"
        )

        XCTAssertEqual(SocialSignal.newestFirst([earlier, later, sameTimeHigherID]).map(\.id), [12, 11, 10])
    }

    private func decode(
        id: Int,
        postedAt: String,
        displayName: String?,
        handle: String,
        platform: SocialPlatform = .x
    ) throws -> SocialSignal {
        let object: [String: Any] = [
            "linked_events": [["id": "investigation-9", "title": "Port closure", "country_iso2": "SE", "rationale": "Topic and time context"]],
            "id": id,
            "platform": platform.rawValue,
            "content_type": "social_post",
            "signal_nature": "claim",
            "verification_status": "unverified",
            "is_fact": false,
            "text": "Account claims the port is closed.",
            "title": NSNull(),
            "url": "https://x.com/portwatch/status/\(id)",
            "posted_at": postedAt,
            "acquired_at": "2026-09-07T09:00:00Z",
            "language_code": "en",
            "country_iso2": "DE",
            "engagement": [
                "likes": 1,
                "replies": 0,
                "reposts": 0,
                "quotes": 2,
                "views": 5,
                "score": 17,
                "comments": 3,
                "upvote_ratio": 0.91
            ],
            "posted_by": [
                "account_id": "account-\(id)",
                "handle": handle,
                "display_name": displayName as Any? ?? NSNull(),
                "profile_url": NSNull(),
                "avatar_url": NSNull(),
                "platform_verified": true
            ],
            "responsible_party": [
                "name": displayName ?? handle,
                "account_id": "account-\(id)",
                "type": "account_holder",
                "attribution_basis": "platform_account",
                "caveat": "Account attribution does not establish factual accuracy."
            ],
            "credibility": [
                "tier": "unverified_social",
                "score": NSNull(),
                "platform_verified_account": true,
                "rationale": "Platform identity does not establish truth."
            ],
            "warning": "Unverified social-media claim.",
            "payload_metadata": NSNull()
        ]
        let data = try JSONSerialization.data(withJSONObject: object)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(SocialSignal.self, from: data)
    }
}
