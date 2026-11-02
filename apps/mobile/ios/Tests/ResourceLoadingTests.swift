import Foundation
import XCTest
@testable import ClaritasAppleModels

private actor ResourceGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var isOpen = false

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { continuation = $0 }
    }

    func open() {
        isOpen = true
        continuation?.resume()
        continuation = nil
    }
}

private actor FetchCounter {
    private(set) var count = 0
    func increment() { count += 1 }
}

final class ResourceLoadingTests: XCTestCase {
    func testStoredImagePathsAcceptContentVersionsAndRejectUntrustedDestinations() {
        XCTAssertTrue(StoredImagePath.isValid("/api/earth-observation/assets/asset-1?v=abcdef0123456789"))
        XCTAssertTrue(StoredImagePath.isValid("/api/news-images/image-1/preview"))
        for path in ["https://example.com/api/earth-observation/assets/asset-1", "//example.com/api/earth-observation/assets/asset-1",
                     "/api/earth-observation/assets/a/../../auth/me", "/api/news-images/a/preview?url=https://example.com",
                     "/api/earth-observation/assets/a?v=not-a-hash", "/api/earth-observation/assets/a#fragment"] {
            XCTAssertFalse(StoredImagePath.isValid(path), path)
        }
    }

    @MainActor
    func testFastResourceAppearsWhileAnotherResourceIsStillPending() async {
        let gate = ResourceGate()
        var displayed: [String] = []
        let slow = Task { @MainActor in
            await ProgressiveResourceLoader.load(fetch: {
                await gate.wait()
                return "slow"
            }, isCurrent: { true }, apply: { displayed.append($0) })
        }
        let error = await ProgressiveResourceLoader.load(fetch: { "fast" }, isCurrent: { true }, apply: {
            displayed.append($0)
        })
        XCTAssertNil(error)
        XCTAssertEqual(displayed, ["fast"])
        await gate.open()
        _ = await slow.value
        XCTAssertEqual(displayed, ["fast", "slow"])
    }

    @MainActor
    func testOldSessionCannotRestoreClearedDataOrReportAnOldFailure() async {
        let gate = ResourceGate()
        var isCurrent = true
        var displayed: String?
        let pending = Task { @MainActor in
            await ProgressiveResourceLoader.load(fetch: {
                await gate.wait()
                return "old account"
            }, isCurrent: { isCurrent }, apply: { displayed = $0 })
        }
        isCurrent = false
        await gate.open()
        _ = await pending.value
        XCTAssertNil(displayed)
        var reportedError = false
        let error = await ProgressiveResourceLoader.load(fetch: { () throws -> String in
            throw URLError(.timedOut)
        }, isCurrent: { false }, apply: { displayed = $0 }, onError: { _ in reportedError = true })
        XCTAssertNil(error)
        XCTAssertFalse(reportedError)
    }

    @MainActor
    func testOneFailedResourceDoesNotSuppressOtherResults() async {
        var failure: Error?
        let error = await ProgressiveResourceLoader.load(fetch: { () throws -> String in
            throw URLError(.timedOut)
        }, isCurrent: { true }, apply: { _ in XCTFail("Failed fetch must not publish") }, onError: { failure = $0 })
        XCTAssertNotNil(error)
        XCTAssertNotNil(failure)
        var displayed: String?
        _ = await ProgressiveResourceLoader.load(fetch: { "available" }, isCurrent: { true }, apply: { displayed = $0 })
        XCTAssertEqual(displayed, "available")
    }

    func testConcurrentIdenticalReadsShareOneFetchAndLaterReadsAreFresh() async throws {
        let requests = AsyncRequestCoalescer<String, String>()
        let counter = FetchCounter()
        let fetch: @Sendable () async throws -> String = {
            await counter.increment()
            try await Task.sleep(nanoseconds: 100_000_000)
            return "response"
        }
        let values = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<12 { group.addTask { try await requests.value(for: "same-scope", fetch: fetch) } }
            var values: [String] = []
            for try await value in group { values.append(value) }
            return values
        }
        XCTAssertEqual(values, Array(repeating: "response", count: 12))
        let sharedCount = await counter.count
        XCTAssertEqual(sharedCount, 1)
        _ = try await requests.value(for: "same-scope", fetch: fetch)
        let refreshedCount = await counter.count
        XCTAssertEqual(refreshedCount, 2)
    }

    func testFailuresAreRetriedAndDifferentAuthScopesStaySeparate() async throws {
        let requests = AsyncRequestCoalescer<String, String>()
        do {
            _ = try await requests.value(for: "account-a") { throw URLError(.timedOut) }
            XCTFail("Expected fetch failure")
        } catch { XCTAssertTrue(error is URLError) }
        let retried = try await requests.value(for: "account-a") { "new response" }
        XCTAssertEqual(retried, "new response")
        async let a = requests.value(for: "account-a") { "a" }
        async let b = requests.value(for: "account-b") { "b" }
        let results = try await [a, b]
        XCTAssertEqual(results, ["a", "b"])
    }

    func testImageDownloadsAreSharedAndReusedWithinTheSession() async throws {
        let images = ImageDataCache(maximumBytes: 100)
        let counter = FetchCounter()
        let fetch: @Sendable () async throws -> Data = {
            await counter.increment()
            try await Task.sleep(nanoseconds: 50_000_000)
            return Data([1, 2, 3])
        }
        try await withThrowingTaskGroup(of: Data.self) { group in
            for _ in 0..<10 { group.addTask { try await images.data(for: "asset", fetch: fetch) } }
            for try await data in group { XCTAssertEqual(data, Data([1, 2, 3])) }
        }
        _ = try await images.data(for: "asset", fetch: fetch)
        let count = await counter.count
        XCTAssertEqual(count, 1)
        // A new auth session receives a new cache and cannot read old images.
        let nextSession = ImageDataCache(maximumBytes: 100)
        let next = try await nextSession.data(for: "asset") { Data([4]) }
        XCTAssertEqual(next, Data([4]))
    }

    func testImageCacheEvictsLeastRecentlyReadWithinItsByteBudget() async throws {
        let images = ImageDataCache(maximumBytes: 6)
        _ = try await images.data(for: "a") { Data([1, 1]) }
        _ = try await images.data(for: "b") { Data([2, 2]) }
        _ = try await images.data(for: "a") { XCTFail("a should be cached"); return Data() }
        _ = try await images.data(for: "c") { Data([3, 3, 3, 3]) }
        let retained = try await images.data(for: "a") { XCTFail("recent a should be retained"); return Data() }
        XCTAssertEqual(retained, Data([1, 1]))
        let evicted = try await images.data(for: "b") { Data([9, 9]) }
        XCTAssertEqual(evicted, Data([9, 9]))
    }

    func testImageFailuresAndOversizedEntriesCanBeRetried() async throws {
        let images = ImageDataCache(maximumBytes: 2)
        do {
            _ = try await images.data(for: "failed") { throw URLError(.timedOut) }
            XCTFail("Expected failure")
        } catch { XCTAssertTrue(error is URLError) }
        let retried = try await images.data(for: "failed") { Data([1]) }
        XCTAssertEqual(retried, Data([1]))
        _ = try await images.data(for: "large") { Data([1, 2, 3]) }
        let oversizedRetry = try await images.data(for: "large") { Data([4]) }
        XCTAssertEqual(oversizedRetry, Data([4]))
        let paused = ImageDataCache(lifetime: 0)
        _ = try await paused.data(for: "asset") { Data([1]) }
        let fresh = try await paused.data(for: "asset") { Data([2]) }
        XCTAssertEqual(fresh, Data([2]))
    }
}
