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
}
