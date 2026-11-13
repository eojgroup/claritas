import XCTest
@testable import ClaritasAppleModels

final class SignalMapProjectionTests: XCTestCase {
    private let world = SignalMapProjection(minLongitude: -180, maxLongitude: 180, minLatitude: -60, maxLatitude: 82)

    func testPortraitPadAndSplitViewKeepTheMapWideWithABottomPanel() {
        XCTAssertFalse(SignalMapLayout.usesSidebar(width: 1024, height: 1290))
        XCTAssertFalse(SignalMapLayout.usesSidebar(width: 850, height: 750))
        XCTAssertFalse(SignalMapLayout.usesSidebar(width: 393, height: 720))
        XCTAssertTrue(SignalMapLayout.usesSidebar(width: 1024, height: 710))
        XCTAssertTrue(SignalMapLayout.usesSidebar(width: 1366, height: 940))
    }

    func testRotationPreservesThePannedCenterAndGeographicPixelScale() {
        let old = world.fitted(width: 390, height: 430, zoom: 4, offsetX: 70, offsetY: -40)
        let camera = world.resizedViewport(width: 390, height: 430, newWidth: 900, newHeight: 610,
            zoom: 4, offsetX: 70, offsetY: -40)
        let next = world.fitted(width: 900, height: 610, zoom: camera.zoom, offsetX: camera.offsetX, offsetY: camera.offsetY)
        for raw in [(0.0, 0.0), (0.4, 0.6)] {
            let before = old.point(rawX: raw.0, rawY: raw.1)
            let after = next.point(rawX: raw.0, rawY: raw.1)
            XCTAssertEqual(before.x - 195, after.x - 450, accuracy: 0.000001)
            XCTAssertEqual(before.y - 215, after.y - 305, accuracy: 0.000001)
        }
    }

    func testPhoneAndPadPreserveTheSameCountryProportions() {
        func ratio(width: Double, height: Double) -> Double {
            let west = world.point(latitude: 40, longitude: 10, width: width, height: height)
            let east = world.point(latitude: 40, longitude: 20, width: width, height: height)
            let north = world.point(latitude: 50, longitude: 10, width: width, height: height)
            return (east.x - west.x) / (west.y - north.y)
        }
        XCTAssertEqual(ratio(width: 340, height: 280), ratio(width: 900, height: 420), accuracy: 0.000001)
        let origin = SignalMapProjection.raw(latitude: 0, longitude: 0)
        XCTAssertEqual(origin.x, 0)
        XCTAssertEqual(origin.y, 0)
        let equator = SignalMapProjection.raw(latitude: 0, longitude: 180)
        XCTAssertEqual(equator.x, Double.pi * 0.8707, accuracy: 0.000001)
    }

    func testZoomTransformsGeographyWithoutClampingOffscreenPinsToEdges() {
        let base = world.point(latitude: 50, longitude: 10, width: 340, height: 280)
        let zoomed = world.point(latitude: 50, longitude: 10, width: 340, height: 280, zoom: 2, offsetX: 12, offsetY: -9)
        XCTAssertEqual(zoomed.x, 170 + (base.x - 170) * 2 + 12, accuracy: 0.000001)
        XCTAssertEqual(zoomed.y, 140 + (base.y - 140) * 2 - 9, accuracy: 0.000001)
        XCTAssertGreaterThan(world.point(latitude: 0, longitude: 180, width: 340, height: 280, zoom: 5).x, 340)
    }

    func testNearbyPinsRetainEveryEventAndImageryWhenGrouped() {
        let pins = [SignalMapPinGroup(id: "a", eventIDs: ["a"], x: 10, y: 10, hasImagery: false),
                    SignalMapPinGroup(id: "b", eventIDs: ["b"], x: 20, y: 15, hasImagery: true),
                    SignalMapPinGroup(id: "c", eventIDs: ["c"], x: 150, y: 150, hasImagery: false)]
        let groups = SignalMapPinGroup.groups(pins)
        XCTAssertEqual(groups.count, 2)
        XCTAssertEqual(groups[0].eventIDs, ["a", "b"])
        XCTAssertTrue(groups[0].hasImagery)
        XCTAssertEqual(groups.flatMap(\.eventIDs).sorted(), ["a", "b", "c"])
        XCTAssertEqual(SignalMapPinGroup.groups(pins, distance: 5).count, 3)
    }
}
