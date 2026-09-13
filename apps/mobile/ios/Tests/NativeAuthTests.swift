import Foundation
import XCTest
@testable import ClaritasAppleModels

final class NativeAuthTests: XCTestCase {
    func testProviderAvailabilityFailsClosedWithoutExplicitEnablement() {
        let disabled = AuthProvider(
            id: .microsoft,
            enabled: false,
            display_name: nil,
            icon: nil,
            start_path: nil
        )
        let enabled = AuthProvider(
            id: .google,
            enabled: true,
            display_name: nil,
            icon: nil,
            start_path: nil
        )

        XCTAssertEqual(AuthProviderAvailability.enabledProviderIDs([]), [])
        XCTAssertEqual(AuthProviderAvailability.enabledProviderIDs([disabled]), [])
        XCTAssertFalse(AuthProviderAvailability.isEnabled(.apple, in: [enabled]))
        XCTAssertEqual(AuthProviderAvailability.enabledProviderIDs([disabled, enabled]), [.google])
    }

    func testHandoffRequestUsesBackendContractFieldNames() throws {
        let request = AuthHandoffRequest(code: "one-time", code_verifier: "verifier")
        let data = try JSONEncoder().encode(request)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])

        XCTAssertEqual(object, ["code": "one-time", "code_verifier": "verifier"])
    }

    func testExactCallbackAcceptsOneTimeCode() {
        let callback = URL(string: "claritas://auth/callback?code=single-use-code")!

        XCTAssertTrue(NativeAuthCallback.matchesExpectedEndpoint(callback))
        XCTAssertEqual(NativeAuthCallback.parse(callback), .handoffCode("single-use-code"))
    }

    func testBearerTokenCallbackFailsClosed() {
        let legacy = URL(string: "claritas://auth/callback?token=reusable-session")!
        let mixed = URL(string: "claritas://auth/callback?code=one-time&token=reusable-session")!

        XCTAssertNil(NativeAuthCallback.parse(legacy))
        XCTAssertNil(NativeAuthCallback.parse(mixed))
    }

    func testExplicitEmptyFragmentAcceptsServerHandoff() {
        let callback = URL(string: "claritas://auth/callback?code=single-use-code#")!

        XCTAssertTrue(NativeAuthCallback.matchesExpectedEndpoint(callback))
        XCTAssertEqual(NativeAuthCallback.parse(callback), .handoffCode("single-use-code"))
        XCTAssertNil(NativeAuthCallback.parse(URL(string: "claritas://auth/callback#code=fragment-only")!))
        XCTAssertNil(NativeAuthCallback.parse(URL(string: "claritas://auth/callback?token=bearer#")!))
        XCTAssertNil(NativeAuthCallback.parse(URL(string: "claritas://evil/callback?code=value#")!))
    }

    func testCallbackRejectsEveryEndpointVariation() {
        let invalidURLs = [
            "https://auth/callback?code=value",
            "claritas://evil/callback?code=value",
            "claritas://auth/other?code=value",
            "claritas://auth/callback/?code=value",
            "claritas://user@auth/callback?code=value",
            "claritas://auth:443/callback?code=value",
            "claritas://auth/callback?code=value#fragment"
        ].compactMap { URL(string: $0) }

        XCTAssertEqual(invalidURLs.count, 7)
        for url in invalidURLs {
            XCTAssertFalse(NativeAuthCallback.matchesExpectedEndpoint(url), "Unexpectedly trusted \(url)")
            XCTAssertNil(NativeAuthCallback.parse(url))
        }
    }

    func testDuplicateOrConflictingCallbackParametersAreRejected() {
        XCTAssertNil(
            NativeAuthCallback.parse(
                URL(string: "claritas://auth/callback?code=first&code=second")!
            )
        )
        XCTAssertNil(
            NativeAuthCallback.parse(
                URL(string: "claritas://auth/callback?code=value&error=access_denied")!
            )
        )
    }

    func testProviderErrorUsesDescriptionWithoutAcceptingCode() {
        let callback = URL(
            string: "claritas://auth/callback?error=access_denied&error_description=Sign%20in%20was%20denied"
        )!

        XCTAssertEqual(NativeAuthCallback.parse(callback), .providerError("Sign in was denied"))
    }

    func testPKCEChallengeMatchesRFC7636Vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

        XCTAssertTrue(NativeAuthPKCE.isValidVerifier(verifier))
        XCTAssertEqual(
            NativeAuthPKCE.challenge(for: verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        )
    }

    func testGeneratedPKCEVerifierMeetsNativeContract() {
        let first = NativeAuthPKCE.makeVerifier()
        let second = NativeAuthPKCE.makeVerifier()

        XCTAssertTrue(NativeAuthPKCE.isValidVerifier(first))
        XCTAssertEqual(first.utf8.count, 43)
        XCTAssertEqual(NativeAuthPKCE.challenge(for: first).utf8.count, 43)
        XCTAssertNotEqual(first, second)
    }
}
