import assert from "node:assert/strict";
import test from "node:test";
import {
  MARITIME_PORTS,
  aisBoundingBoxContains,
  monitoredPortAisBoundingBoxes,
} from "./maritime-ports";

test("default AISstream coverage targets every monitored port without a world box", () => {
  const boxes = monitoredPortAisBoundingBoxes();
  assert.equal(boxes.length, MARITIME_PORTS.length);
  assert.ok(boxes.length > 12);
  assert.equal(
    boxes.some(
      (box) =>
        box[0][0] === -90 &&
        box[0][1] === -180 &&
        box[1][0] === 90 &&
        box[1][1] === 180,
    ),
    false,
  );
  for (const [index, port] of MARITIME_PORTS.entries()) {
    assert.equal(
      aisBoundingBoxContains(boxes[index], port.latitude, port.longitude),
      true,
      `${port.name} must be covered`,
    );
  }
});

test("Singapore targeted coverage includes the port and western approaches", () => {
  const singaporeIndex = MARITIME_PORTS.findIndex(
    (port) => port.iso2 === "SG" && port.name === "Singapore",
  );
  assert.notEqual(singaporeIndex, -1);
  const box = monitoredPortAisBoundingBoxes()[singaporeIndex];
  assert.equal(aisBoundingBoxContains(box, 1.25, 103.82), true);
  // The current MPA schema example is west of the port geofence but inside
  // the monitored AIS approach area; ingestion must not omit this traffic.
  assert.equal(aisBoundingBoxContains(box, 1.38355737046, 103.180721026), true);
});

test("targeted AISstream coverage includes governed Norwegian and Danish ports", () => {
  const boxes = monitoredPortAisBoundingBoxes();
  const expectedPorts = [
    { iso2: "NO", name: "Oslo", latitude: 59.90, longitude: 10.75 },
    { iso2: "NO", name: "Bergen", latitude: 60.39, longitude: 5.32 },
    { iso2: "DK", name: "Copenhagen", latitude: 55.68, longitude: 12.60 },
    { iso2: "DK", name: "Aarhus", latitude: 56.15, longitude: 10.25 },
  ];

  for (const expected of expectedPorts) {
    const index = MARITIME_PORTS.findIndex(
      (port) => port.iso2 === expected.iso2 && port.name === expected.name,
    );
    assert.notEqual(index, -1, `${expected.name} must be governed`);
    assert.equal(
      aisBoundingBoxContains(boxes[index], expected.latitude, expected.longitude),
      true,
      `${expected.name} must be inside its AISstream subscription box`,
    );
  }
});
