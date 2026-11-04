import Foundation
import XCTest
@testable import ClaritasAppleModels

final class IntelligenceTranslationTests: XCTestCase {
    func testCachedEnglishHeadlineKeepsArabicHebrewAndSpanishOriginalsAndProvenance() throws {
        for (language, original) in [("ar", "أخبار الميناء"), ("he", "חדשות הנמל"), ("es", "Noticias del puerto")] {
            var raw = eventPayload(title: "Port news")
            raw.merge(translationFields(language: language, original: original), uniquingKeysWith: { _, new in new })
            let event = try decode(IntelligenceEvent.self, raw)
            XCTAssertEqual(event.title, "Port news")
            XCTAssertEqual(event.original_title, original)
            XCTAssertEqual(event.headlineTranslationDisclosure, "AI translated headline · \(language.uppercased())→EN")
            XCTAssertEqual(event.translation?.provider, "openrouter")
            XCTAssertEqual(event.translation?.source_content_preserved, true)
            XCTAssertEqual(IntelligenceTranslationPresentation.original(event.original_title, display: event.title), original)
            XCTAssertEqual(Set([event, event]).count, 1, "translation metadata remains compatible with map event identity")
        }
    }

    func testQuotaAndPendingStatesKeepTheOriginalReadableAndDoNotClaimTranslation() throws {
        var raw = eventPayload(title: "أخبار الميناء")
        raw["original_title"] = "أخبار الميناء"
        raw["language_code"] = "ar"
        raw["display_language"] = "en"
        raw["translation_status"] = "pending"
        raw["translation_availability"] = ["status": "quota_limited", "reason": "Provider free allowance reached"]
        let limited = try decode(IntelligenceEvent.self, raw)
        XCTAssertEqual(limited.title, "أخبار الميناء")
        XCTAssertNil(limited.translation)
        XCTAssertEqual(limited.headlineTranslationDisclosure, "Original language · translation allowance reached")
        raw["translation_availability"] = ["status": "pending"]
        XCTAssertEqual(try decode(IntelligenceEvent.self, raw).headlineTranslationDisclosure, "Original language · translation pending")
    }

    func testEnglishAndLegacyEventsDoNotInventTranslationMetadata() throws {
        let legacy = try decode(IntelligenceEvent.self, eventPayload(title: "Port news"))
        XCTAssertNil(legacy.headlineTranslationDisclosure)
        XCTAssertNil(legacy.original_title)
        var english = eventPayload(title: "Port news")
        english["language_code"] = "en"
        english["translation_status"] = "not_required"
        XCTAssertNil(try decode(IntelligenceEvent.self, english).headlineTranslationDisclosure)
        XCTAssertNil(IntelligenceTranslationPresentation.original("Port news", display: "Port news"))
    }

    func testOverviewTimelineAndSourceReferencesUseTheSameCachedHeadlineContract() throws {
        var raw: [String: Any] = [
            "event_id": "event-1", "occurred_at": "2026-11-04T10:00:00Z", "title": "Port news",
            "topic": "transport", "topic_label": "Transport", "severity": "medium", "priority_score": 40,
            "priority_reasons": ["Recorded relevance"],
            "source_refs": [["label": "Port news", "url": "https://publisher.example/report", "domain": "news",
                             "original_title": "חדשות הנמל", "language_code": "he", "translation_status": "translated"]],
        ]
        raw.merge(translationFields(language: "he", original: "חדשות הנמל"), uniquingKeysWith: { _, new in new })
        let entry = try decode(IntelligenceOverview.TimelineEntry.self, raw)
        XCTAssertEqual(entry.title, "Port news")
        XCTAssertEqual(entry.original_title, "חדשות הנמל")
        XCTAssertEqual(entry.source_refs.first?.original_title, "חדשות הנמל")
        XCTAssertEqual(entry.source_refs.first?.url, "https://publisher.example/report")
        XCTAssertEqual(entry.headlineTranslationDisclosure, "AI translated headline · HE→EN")
    }

    func testEvidenceAndLinkedNewsDecodeHeadlineOnlyMetadataWithoutSummaryStatus() throws {
        var evidence: [String: Any] = ["id": "evidence-1", "domain": "news", "evidence_type": "reported_event",
            "source_record_type": "item", "source_record_id": "1", "observed_at": "2026-11-04T10:00:00Z",
            "confidence": 0.7, "relationship": "reported", "source_title": "Port news", "source_summary": "Texto original"]
        evidence.merge(translationFields(language: "es", original: "Noticias del puerto"), uniquingKeysWith: { _, new in new })
        let decoded = try decode(IntelligenceEvidence.self, evidence)
        XCTAssertEqual(decoded.source_summary, "Texto original")
        XCTAssertEqual(decoded.original_title, "Noticias del puerto")
        XCTAssertEqual(decoded.headlineTranslationDisclosure, "AI translated headline · ES→EN")
        evidence["title"] = "Port news"
        let linked = try decode(IntelligenceLinkedNews.self, evidence)
        XCTAssertEqual(linked.translation?.provider, "openrouter")
        XCTAssertEqual(linked.original_title, "Noticias del puerto")
    }

    func testGeneratedEnglishSummaryRemainsDistinctFromOriginalSourceExcerpt() throws {
        var raw = eventPayload(title: "Port news")
        raw.merge(translationFields(language: "es", original: "Noticias del puerto"), uniquingKeysWith: { _, new in new })
        raw["summary"] = "An English summary of the publisher headline and excerpt."
        raw["original_summary"] = "Texto original del editor."
        raw["summary_translation_status"] = "translated"
        raw["translation_notice"] = "Source content retained."
        let event = try decode(IntelligenceEvent.self, raw)
        XCTAssertEqual(event.summary_translation_status, "translated")
        XCTAssertEqual(event.original_summary, "Texto original del editor.")
        XCTAssertEqual(IntelligenceTranslationPresentation.original(event.original_summary, display: event.summary), "Texto original del editor.")
        XCTAssertEqual(event.translation_notice, "Source content retained.")
    }

    private func decode<T: Decodable>(_ type: T.Type, _ raw: [String: Any]) throws -> T {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(type, from: JSONSerialization.data(withJSONObject: raw))
    }

    private func translationFields(language: String, original: String) -> [String: Any] {
        ["original_title": original, "language_code": language, "display_language": "en", "translated_title": "Port news",
         "translation_status": "translated", "translation": ["target_language_code": "en", "headline_kind": "ai_translation",
             "provider": "openrouter", "model": "free-model:free", "title_generated_at": "2026-11-04T09:00:00Z",
             "source_content_preserved": true, "article_body_used": false]]
    }

    private func eventPayload(title: String) -> [String: Any] {
        ["id": "event-1", "event_type": "transport_disruption", "title": title, "summary": "Source excerpt",
         "status": "active", "severity": "medium", "confidence": 0.7, "start_time": "2026-11-04T09:00:00Z",
         "last_activity_time": "2026-11-04T10:00:00Z", "source_diversity": 1, "domain_count": 1,
         "relevance_score": 0.4, "urgency_score": 0.4, "materiality_score": 0.4,
         "evidence_count": 1, "earth_observation_available": false]
    }
}
