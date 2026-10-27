import Foundation
import XCTest
@testable import ClaritasAppleModels

final class NewsTranslationAvailabilityTests: XCTestCase {
    func testFreeQuotaDisclosurePreservesOriginalHeadline() throws {
        let item = try JSONDecoder().decode(NewsItem.self, from: Data("""
        {"id":55,"title":"Noticias del puerto","language_code":"es",
         "translation_availability":{"status":"quota_limited","reason":"Free quota reached","retry_after":null}}
        """.utf8))
        XCTAssertEqual(item.presentationTitle, "Noticias del puerto")
        XCTAssertEqual(item.translationDisclosure, "Original language · free translation quota reached")
        XCTAssertFalse(item.hasAITranslatedHeadline)
    }

    func testPendingTranslationIsDistinctFromAnAvailableAITranslation() throws {
        let item = try JSONDecoder().decode(NewsItem.self, from: Data("""
        {"id":56,"title":"Noticias del puerto","language_code":"es",
         "translation_availability":{"status":"pending","reason":null}}
        """.utf8))
        XCTAssertEqual(item.translationDisclosure, "Original language · translation pending")
        XCTAssertFalse(item.hasAITranslatedHeadline)
    }

    func testMatchingLanguageAndLegacySnapshotsDoNotClaimAnAITranslation() throws {
        let english = try JSONDecoder().decode(NewsItem.self, from: Data("""
        {"id":57,"title":"Port news","language_code":"en"}
        """.utf8))
        XCTAssertNil(english.translationDisclosure)
        let legacy = try JSONDecoder().decode(NewsItem.self, from: Data("""
        {"id":58,"title":"Noticias del puerto","language_code":"es"}
        """.utf8))
        XCTAssertEqual(legacy.presentationTitle, "Noticias del puerto")
        XCTAssertEqual(legacy.translationDisclosure, "Original language · translation status unavailable")
    }
}
