import Foundation
import XCTest
@testable import ClaritasAppleModels

final class OverviewAnalyticsTests: XCTestCase {
    func testCountryAttentionAndPlainMapKinds() throws {
        var raw = payload()
        raw["countries"] = [["country_iso2": "JP", "event_count": 30, "high_priority_count": 18,
                             "attention_score": 83, "previous_event_count": 8, "peak_priority_score": 92]]
        let view = try decode(raw)
        XCTAssertEqual(view.countries?.first?.attention_score, 83)
        XCTAssertEqual(view.countries?.first?.previous_event_count, 8)
        XCTAssertEqual(SignalMapEventKind(eventType: "earthquake").label, "Earthquake")
        XCTAssertEqual(SignalMapEventKind(eventType: "severe_storm").label, "Storm")
        XCTAssertEqual(SignalMapEventKind(eventType: "reported_development").label, "News report")
    }
    func testLinkedCountryHeatRetainsSingleEqualAndWeakConnections() throws {
        XCTAssertEqual(CountryLinkHeatScale.intensity(value:7,maximum:7),1,accuracy:0.001)
        XCTAssertGreaterThan(CountryLinkHeatScale.intensity(value:1,maximum:10000),0.18)
        XCTAssertLessThan(CountryLinkHeatScale.intensity(value:1,maximum:10000),CountryLinkHeatScale.intensity(value:100,maximum:10000))
        XCTAssertEqual(CountryLinkHeatScale.intensity(value:0,maximum:7),0)
        var raw = payload()
        raw["country_links"] = [["country_iso2":"SE","event_count":8,"high_priority_count":3],["country_iso2":"NO","event_count":2,"high_priority_count":1]]
        let view = try decode(raw)
        XCTAssertEqual(view.country_links?.last?.country_iso2,"NO")
        XCTAssertEqual(view.country_links?.last?.event_count,2)
        XCTAssertNil(try decode(payload()).country_links)
    }
    func testSearchScopeQueriesRejectStaleUnsearchedResponses() throws {
        let query = IntelligenceOverviewScope(query:"  Outlook outage  ")
        XCTAssertEqual(query.query,"Outlook outage")
        XCTAssertTrue(query.queryItems.contains(URLQueryItem(name:"q",value:"Outlook outage")))
        XCTAssertNotEqual(query.requestKey,IntelligenceOverviewScope().requestKey)
        XCTAssertFalse(try decode(payload()).matches(scope:query))
        var raw = payload(); raw["filters"] = ["country":NSNull(),"topic":NSNull(),"q":"Outlook outage"]
        XCTAssertTrue(try decode(raw).matches(scope:query))
        XCTAssertEqual(IntelligenceOverviewScope(query:String(repeating:"x",count:250)).query.count,200)
    }
    func testTimeIntervalScopesHaveDistinctRequestsAndRejectOutOfWindowBuckets() throws {
        let full = IntelligenceOverviewScope()
        let selected = IntelligenceOverviewScope(bucket: 0)
        XCTAssertNotEqual(full.requestKey, selected.requestKey)
        XCTAssertEqual(full.baseRequestKey, selected.baseRequestKey)
        XCTAssertTrue(selected.queryItems.contains(URLQueryItem(name: "bucket", value: "0")))
        XCTAssertNil(IntelligenceOverviewScope(bucket: 12).bucket)
        XCTAssertEqual(IntelligenceOverviewScope(hours: 168, bucket: 13).bucket, 13)
        XCTAssertFalse(try decode(payload()).matches(scope: selected), "an unscoped response must not masquerade as the chosen interval")
        var raw = payload()
        raw["filters"] = ["country": NSNull(), "topic": NSNull(), "bucket": 0]
        raw["selection"] = ["bucket": 0, "start": "2026-11-02T12:00:00Z", "end": "2026-11-02T14:00:00Z", "event_count": 33, "high_priority_count": 5]
        let decoded = try decode(raw)
        XCTAssertTrue(decoded.matches(scope: selected))
        XCTAssertEqual(decoded.selection?.event_count, 33)
    }
    func testScopeBoundsAndKeysSeparateWindowsTopicsAndLocations() {
        let scope = IntelligenceOverviewScope(hours: 72, country: " uk ", topic: "security")
        XCTAssertEqual(scope.hours, 72)
        XCTAssertEqual(scope.country, "GB")
        XCTAssertEqual(scope.topic, "security")
        XCTAssertEqual(scope.queryItems, [
            URLQueryItem(name: "hours", value: "72"), URLQueryItem(name: "priority", value: "all"),
            URLQueryItem(name: "country", value: "GB"),
            URLQueryItem(name: "topic", value: "security"),
        ])
        XCTAssertNotEqual(scope.requestKey, IntelligenceOverviewScope(hours: 24, country: "GB", topic: "security").requestKey)
        XCTAssertNotEqual(scope.requestKey, IntelligenceOverviewScope(hours: 72, country: "US", topic: "security").requestKey)
        XCTAssertNotEqual(scope.requestKey, IntelligenceOverviewScope(hours: 72, country: "GB", topic: "markets").requestKey)
        let invalid = IntelligenceOverviewScope(hours: 999, country: "WORLD", topic: "unknown")
        XCTAssertEqual(invalid.hours, 24)
        XCTAssertNil(invalid.country)
        XCTAssertNil(invalid.topic)
    }

    func testOverviewPreservesExactEventSourceAndAcquisitionDatesForDrilldown() throws {
        let overview = try decode(payload())
        let entry = try XCTUnwrap(overview.timeline.first)
        let event = try XCTUnwrap(overview.events.first)
        XCTAssertEqual(entry.event_id, event.id)
        XCTAssertEqual(entry.priority_score, 82)
        XCTAssertEqual(event.priority_score, 0.82)
        XCTAssertEqual(entry.source_refs.first?.url, "https://publisher.example/report")
        XCTAssertLessThan(try XCTUnwrap(entry.imagery?.captured_at), entry.occurred_at,
                          "the scene acquisition date must not be presented as the investigation update")
        XCTAssertTrue(StoredImagePath.isValid(try XCTUnwrap(entry.imagery?.preview_url)))
        XCTAssertEqual(event.status, "resolved")
        XCTAssertEqual(event.freshness_state, "expired")
        XCTAssertTrue(event.isArchived)
        XCTAssertTrue(overview.currentEvents.isEmpty, "historical cards cannot contribute live map or complication alerts")
        XCTAssertEqual(overview.summary.momentumLabel, "2 more than the previous window")
    }

    func testFullWindowMapAndCountryCoverageIsIndependentOfLatestCards() throws {
        var raw = payload()
        raw["countries"] = [["country_iso2": "SE", "event_count": 1200, "high_priority_count": 50]]
        var located = try XCTUnwrap((raw["events"] as? [[String: Any]])?.first)
        located["id"] = "older-located-event"
        located["latitude"] = 59.3
        located["longitude"] = 18.1
        located["imagery"] = ["preview_url": "/api/news-images/photo/preview", "captured_at": NSNull(), "attribution": "Publisher", "source_kind": "publisher"]
        raw["map_events"] = [located]
        raw["visual_events"] = [located]
        let overview = try decode(raw)
        XCTAssertEqual(overview.countries?.first?.event_count, 1200)
        XCTAssertEqual(overview.map_events?.first?.id, "older-located-event")
        XCTAssertFalse(overview.timeline.contains { $0.event_id == "older-located-event" })
        XCTAssertEqual(overview.visual_events?.first?.imagery?.source_kind, "publisher")
        XCTAssertNil(overview.visual_events?.first?.imagery?.captured_at)
    }

    func testCappedAndEmptyComparisonsDoNotClaimPercentGrowth() throws {
        var capped = payload()
        capped["coverage"] = ["sample_limit": 300, "sampled_events": 600, "truncated": true,
                              "comparison_available": false, "notice": "Lower bounds", "comparison_notice": "Unavailable",
                              "priority_notice": "Navigation aid"]
        capped["summary"] = ["event_count": 300, "previous_event_count": 300, "change": 0,
                             "change_percent": NSNull(), "direction": "unavailable", "high_priority_count": 20, "location_count": 12]
        let overview = try decode(capped)
        XCTAssertFalse(overview.coverage.comparison_available)
        XCTAssertNil(overview.summary.change_percent)
        XCTAssertEqual(overview.summary.momentumLabel, "Sample capped · comparison unavailable")
        let quiet = IntelligenceOverview.Summary(event_count: 0, previous_event_count: 0, change: 0,
                                                  change_percent: nil, direction: "quiet", high_priority_count: 0, location_count: 0)
        XCTAssertEqual(quiet.momentumLabel, "No recorded updates in either window")
    }

    func testPriorityDefaultsAndScopeCoordinationRejectDifferentCohorts() throws {
        let high = IntelligenceOverviewScope(priority: "high")
        let all = IntelligenceOverviewScope()
        XCTAssertEqual(high.priority, "high")
        XCTAssertEqual(all.priority, "all")
        XCTAssertEqual(IntelligenceOverviewScope(priority: "unknown").priority, "all")
        XCTAssertNotEqual(high.requestKey, all.requestKey)
        XCTAssertTrue(all.queryItems.contains(URLQueryItem(name: "priority", value: "all")))

        var raw = payload()
        raw["filters"] = ["country": NSNull(), "topic": NSNull(), "priority": "high"]
        let overview = try decode(raw)
        XCTAssertTrue(overview.matches(scope: high))
        XCTAssertFalse(overview.matches(scope: all))
        XCTAssertFalse(overview.matches(scope: IntelligenceOverviewScope(country: "GB")))
        XCTAssertFalse(overview.matches(scope: IntelligenceOverviewScope(topic: "security")))
        XCTAssertFalse(overview.matches(scope: IntelligenceOverviewScope(hours: 168)))
        let legacy = try decode(payload())
        XCTAssertNil(legacy.snapshot)
        XCTAssertEqual(legacy.coverage.sample_limit, 300)
        XCTAssertTrue(legacy.hasUsableData)
        XCTAssertNil(legacy.filters.priority)
        XCTAssertTrue(legacy.matches(scope: high))
    }

    func testEntireWindowCountsDoNotDependOnCardLimitAndSavedSnapshotRemainsVisible() throws {
        var raw = payload()
        raw["summary"] = ["event_count": 1250, "previous_event_count": 1000, "change": 250,
                          "change_percent": 25, "direction": "rising", "high_priority_count": 1250, "location_count": 80]
        raw["buckets"] = [["start": "2026-11-02T12:00:00Z", "end": "2026-11-03T12:00:00Z",
                           "event_count": 1250, "previous_event_count": 1000, "high_priority_count": 1250]]
        raw["coverage"] = ["sample_limit": NSNull(), "sampled_events": 2250, "truncated": false,
                           "comparison_available": true, "notice": "Entire selected window", "comparison_notice": "Recorded updates",
                           "priority_notice": "Navigation aid"]
        raw["snapshot"] = ["status": "stale", "generated_at": "2026-11-03T12:00:00Z", "age_seconds": 150]
        let overview = try decode(raw)
        XCTAssertNil(overview.coverage.sample_limit)
        XCTAssertTrue(overview.hasUsableData)
        XCTAssertEqual(overview.events.count, 1)
        XCTAssertEqual(overview.timeline.count, 1)
        XCTAssertEqual(overview.summary.event_count, 1250)
        XCTAssertEqual(overview.buckets.reduce(0) { $0 + $1.event_count }, 1250)
        XCTAssertTrue(overview.coverage.comparison_available)
        XCTAssertFalse(overview.coverage.truncated)
        XCTAssertEqual(overview.snapshot?.age_seconds, 150)
        XCTAssertTrue(overview.snapshot?.isStale == true)
        XCTAssertEqual(overview.summary.momentumLabel, "250 more than the previous window")

        raw["snapshot"] = ["status": "warming", "generated_at": NSNull(), "age_seconds": NSNull()]
        let warming = try decode(raw)
        XCTAssertTrue(warming.snapshot?.isWarming == true)
        XCTAssertFalse(warming.hasUsableData, "a warming snapshot cannot be presented as zero recorded activity")
        XCTAssertNil(warming.snapshot?.generated_at)
        XCTAssertNil(warming.snapshot?.age_seconds)
    }

    func testMapCandidatesContainOnlyTheListedDevelopments() throws {
        var raw = payload()
        let listed = try XCTUnwrap((raw["events"] as? [[String: Any]])?.first)
        var unlisted = listed
        unlisted["id"] = "event-outside-timeline"
        raw["events"] = [listed, unlisted]
        let overview = try decode(raw)
        XCTAssertEqual(overview.events.count, 2)
        XCTAssertEqual(overview.timelineEvents.map(\.id), overview.timeline.map(\.event_id))
        XCTAssertFalse(overview.timelineEvents.contains { $0.id == "event-outside-timeline" })
        raw["timeline"] = []
        XCTAssertTrue(try decode(raw).timelineEvents.isEmpty)
    }

    private func decode(_ raw: [String: Any]) throws -> IntelligenceOverview {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(IntelligenceOverview.self, from: JSONSerialization.data(withJSONObject: raw))
    }

    private func payload() -> [String: Any] {
        let event: [String: Any] = [
            "id": "event-1", "event_type": "security_incident", "title": "Port investigation", "summary": "Source reporting",
            "status": "resolved", "severity": "high", "confidence": 0.7, "start_time": "2026-11-02T12:00:00Z",
            "last_activity_time": "2026-11-03T10:00:00Z", "expires_at": "2026-11-03T10:30:00Z", "freshness_state": "expired",
            "primary_country_iso2": "GB", "source_diversity": 2, "domain_count": 2, "relevance_score": 0.8,
            "urgency_score": 0.7, "materiality_score": 0.7, "evidence_count": 3, "earth_observation_available": true,
            "priority_score": 0.82,
        ]
        return [
            "generated_at": "2026-11-03T12:00:00Z",
            "window": ["hours": 24, "start": "2026-11-02T12:00:00Z", "end": "2026-11-03T12:00:00Z",
                       "previous_start": "2026-11-01T12:00:00Z", "previous_end": "2026-11-02T12:00:00Z", "bucket_hours": 2],
            "filters": ["country": NSNull(), "topic": NSNull()],
            "summary": ["event_count": 5, "previous_event_count": 3, "change": 2, "change_percent": 67,
                        "direction": "rising", "high_priority_count": 1, "location_count": 2],
            "topics": [["key": "security", "label": "Security", "event_count": 5, "previous_event_count": 3,
                        "change": 2, "direction": "rising", "priority_score": 82, "event_ids": ["event-1"]]],
            "locations": [], "buckets": [], "events": [event],
            "timeline": [["event_id": "event-1", "occurred_at": "2026-11-03T10:00:00Z", "title": "Port investigation",
                          "topic": "security", "topic_label": "Security", "location_name": "Port", "country_iso2": "GB",
                          "severity": "high", "priority_score": 82, "priority_reasons": ["High recorded relevance"],
                          "source_refs": [["label": "Publisher report", "url": "https://publisher.example/report", "domain": "news"]],
                          "imagery": ["preview_url": "/api/earth-observation/assets/scene-1?v=abcdef0123456789",
                                      "captured_at": "2026-11-02T00:00:00Z", "attribution": "Copernicus"]]],
            "coverage": ["sample_limit": 300, "sampled_events": 8, "truncated": false, "comparison_available": true,
                         "notice": "Bounded latest-updated sample", "comparison_notice": "Not incident totals", "priority_notice": "Navigation aid"],
        ]
    }
}
