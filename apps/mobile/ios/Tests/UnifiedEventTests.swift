import Foundation
import XCTest
@testable import ClaritasAppleModels

final class UnifiedEventTests: XCTestCase {
    func testEveryOriginKeepsItsIdentityAndPriorityExplanation() throws {
        for domain in ["news", "earth_observation", "imagery", "transport", "podcast", "social", "weather", "market"] {
            var raw = eventPayload
            raw["origin_domain"] = domain
            raw["signal_domains"] = [domain, "news"]
            raw["priority_score"] = 0.74
            raw["priority_reasons"] = ["Time-sensitive development", "Context across 2 source types"]
            let event = try decode(IntelligenceEvent.self, raw)
            XCTAssertEqual(event.origin_domain, domain)
            XCTAssertEqual(event.originLabel, SignalDomainPresentation.label(domain))
            XCTAssertEqual(event.signal_domains, [domain, "news"])
            XCTAssertEqual(event.priority_score, 0.74)
            XCTAssertEqual(event.priority_reasons?.count, 2)
        }
    }

    func testSensorImageryAndModelSourcesKeepDistinctFamilies() {
        XCTAssertEqual(SignalDomainPresentation.group(domain: "podcast", recordType: "intelligence_signal", relationship: "model_interpretation"), "podcast")
        XCTAssertEqual(SignalDomainPresentation.group(domain: "disaster", recordType: "quake", relationship: "observed"), "earth_observation")
        XCTAssertEqual(SignalDomainPresentation.group(domain: "earth_observation", recordType: "earth_observation", relationship: "observed"), "imagery")
        XCTAssertEqual(SignalDomainPresentation.group(domain: "earth_observation", recordType: "earth_observation", relationship: "model_interpretation"), "model_interpretation")
    }

    func testLegacyDetailsRemainReadableWithoutInventingCoverage() throws {
        let detail = try decode(IntelligenceEventDetail.self, ["event": eventPayload])
        XCTAssertNil(detail.event.origin_domain)
        XCTAssertEqual(detail.event.originLabel, "Signal")
        XCTAssertEqual(detail.event.signalTypesLabel, "1 signal types")
        XCTAssertTrue(detail.signal_coverage.isEmpty)
        XCTAssertTrue(detail.context_signals.isEmpty)
        XCTAssertTrue(detail.context_images.isEmpty)
        XCTAssertNil(detail.regional_reporting)
    }

    func testReusedImageryRetainsOriginalDatesAndSourceWithoutBecomingEvidence() throws {
        let detail = try decode(IntelligenceEventDetail.self, [
            "event": eventPayload,
            "context_images": [[
                "id": "saved-image", "kind": "news", "preview_url": "/api/news-images/image-1/preview",
                "width": 1024, "height": 768, "published_at": "2026-09-20T12:00:00Z",
                "collected_at": "2026-09-21T12:00:00Z", "source_event_id": "older-event",
                "source_event_title": "Earlier report", "source_url": "https://example.com/report",
                "title": "Previously collected port image", "attribution": "Publisher",
                "license": "Publisher rights retained", "location_name": "Port",
                "match_reason": "same_specific_location", "notice": "Capture time is unverified; context only.",
            ]],
        ])
        let image = try XCTUnwrap(detail.context_images.first)
        XCTAssertTrue(image.isStoredAsset)
        XCTAssertNil(image.captured_at)
        XCTAssertEqual(image.displayDate, image.published_at)
        XCTAssertEqual(image.dateLabel, "Published")
        XCTAssertEqual(image.source_event_id, "older-event")
        XCTAssertTrue(detail.evidence.isEmpty)
        XCTAssertTrue(detail.earth_observations.isEmpty)
    }

    func testRegionalTransportMetricsStayOutsideAttachedEvidence() throws {
        let detail = try decode(IntelligenceEventDetail.self, [
            "event": eventPayload,
            "signal_coverage": [["domain": "transport", "label": "Transport", "count": 0, "state": "none"]],
            "context_signals": [[
                "id": "regional-transport-CO", "domain": "transport", "title": "Transport activity",
                "summary": "Observed samples in Colombia", "scope_label": "Same country · CO",
                "relationship": "regional_context", "observed_at": "2026-09-23T12:00:00Z",
                "metrics": [["label": "Tracked aircraft", "value": 27, "unit": "unique vehicles"]],
                "coverage_notice": "Partial coverage; not total national traffic",
            ]],
        ])
        XCTAssertTrue(detail.evidence.isEmpty)
        XCTAssertEqual(detail.signal_coverage.first?.state, "none")
        XCTAssertEqual(detail.context_signals.first?.relationship, "regional_context")
        XCTAssertEqual(detail.context_signals.first?.metrics.first?.value, 27)
    }

    func testSocialOriginIsNotRepeatedAsAdditionalSocialContext() throws {
        let detail = try decode(IntelligenceEventDetail.self, [
            "event": eventPayload,
            "evidence": [[
                "id": "evidence-1", "domain": "social", "evidence_type": "social_claim",
                "source_record_type": "social_signal", "source_record_id": "42",
                "observed_at": "2026-09-23T12:00:00Z", "confidence": 0.3, "relationship": "context",
            ]],
            "social_context": [socialPayload(id: 42), socialPayload(id: 43)],
        ])
        XCTAssertEqual(detail.unattachedSocialContext.map(\.signal_id), [43])
    }

    func testUnresolvedSourceDoesNotRequireAnEventID() throws {
        let result = try decode(IntelligenceSourceResolution.self, ["status": "pending", "reason": "Awaiting source assessment"])
        XCTAssertNil(result.event_id)
        XCTAssertEqual(result.status, "pending")
        XCTAssertEqual(result.reason, "Awaiting source assessment")
    }

    private var eventPayload: [String: Any] {
        [
            "id": "event-1", "event_type": "logistics_development", "title": "Colombia logistics development",
            "summary": "Source reporting describes a logistics acquisition", "status": "active", "severity": "medium",
            "confidence": 0.65, "start_time": "2026-09-23T12:00:00Z", "last_activity_time": "2026-09-23T12:00:00Z",
            "primary_country_iso2": "CO", "source_diversity": 1, "domain_count": 1,
            "relevance_score": 0.6, "urgency_score": 0.4, "materiality_score": 0.5,
            "evidence_count": 1, "earth_observation_available": false,
        ]
    }

    private func socialPayload(id: Int) -> [String: Any] {
        [
            "event_id": "event-1", "signal_id": id, "platform": "bluesky", "text": "Attributed claim",
            "url": "https://example.com/post/\(id)", "author": "Example account",
            "posted_at": "2026-09-23T12:00:00Z", "assessment_boundary": "Unverified claim",
        ]
    }

    private func decode<T: Decodable>(_ type: T.Type, _ raw: [String: Any]) throws -> T {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(type, from: JSONSerialization.data(withJSONObject: raw))
    }
}
