import assert from "node:assert/strict";
import test from "node:test";
import {
  RegionalAisNmeaDecoder,
  calculateNmeaChecksum,
  decodeAisPayload,
  parseRegionalAisNmeaLine,
} from "./regional-ais-nmea";

const KYSTVERKET_POSITION =
  "\\s:2573425,c:1787299223*04\\!BSVDM,1,1,,A,13mJt9001s0HG=HRSV73K2hf0000,0*7B";
const TYPE_1_POSITION = "!BSVDM,1,1,,A,13mJt9001s0HG=HRSV73K2hf0000,0*7B";
const TYPE_5_PART_1 =
  "!BSVDM,2,1,7,A,53mJt9000000hc7;?@0pu8@T>1=@58000000,0*79";
const TYPE_5_PART_2 =
  "!BSVDM,2,2,7,A,0016000000000012hl20000000000000000,2*38";
const TYPE_18_POSITION =
  "!AIVDM,1,1,,B,B5N7L000=ml08B6kn@QhQJU00000,0*15";
const TYPE_19_POSITION =
  "!AIVDM,1,1,,A,C8I2E000F1nkwD0<H?hq0e5PVBL>2PNT;0`:V`000000N0000000,0*47";
const TYPE_24_PART_A =
  "!AIVDM,1,1,,A,H5N7L0104<THT>1A84@E8000000,2*62";
const TYPE_24_PART_B =
  "!AIVDM,1,1,,A,H5N7L05@0000000G43ijkl000000,0*5F";
const TYPE_27_POSITION = "!AIVDM,1,1,,A,K3mev<A@I<THm7hp,0*36";
const INVALID_COORDINATES =
  "!AIVDM,1,1,,A,13mJt900?w<tSF0l4Q@>4?wp0000,0*10";
const SENTINEL_FIELDS =
  "!AIVDM,1,1,,A,13mJt9?0?w0HG=HRSV7>4?wp0000,0*11";

function withTag(sentence: string, fields: string): string {
  return `\\${fields}*${calculateNmeaChecksum(fields)}\\${sentence}`;
}

test("parses a checksum-valid Kystverket IEC tag block and class-A position", () => {
  const now = Date.parse("2026-08-21T08:01:00Z");
  const parsed = parseRegionalAisNmeaLine(KYSTVERKET_POSITION);
  assert.equal(parsed?.talker, "BS");
  assert.equal(parsed?.source, "2573425");
  assert.equal(parsed?.timestampMilliseconds, Date.parse("2026-08-21T08:00:23Z"));

  const observation = new RegionalAisNmeaDecoder().consumeLine(
    KYSTVERKET_POSITION,
    now,
  );
  assert.deepEqual(observation, {
    mmsi: "257342500",
    latitude: 60.3913,
    longitude: 5.3221,
    speed: 12.3,
    course: 87.6,
    heading: 88,
    navigationStatus: 0,
    observedAt: "2026-08-21T08:00:23.000Z",
    displayName: null,
    callsign: null,
    shipType: null,
    destination: null,
  });
});

test("rejects bad sentence and IEC tag-block checksums", () => {
  const decoder = new RegionalAisNmeaDecoder();
  const now = Date.parse("2026-08-21T08:01:00Z");
  assert.equal(
    decoder.consumeLine(KYSTVERKET_POSITION.replace("*7B", "*00"), now),
    null,
  );
  assert.equal(
    decoder.consumeLine(KYSTVERKET_POSITION.replace("*04\\", "*05\\"), now),
    null,
  );
});

test("assembles multipart payloads by source and enriches the next position", () => {
  const now = Date.parse("2026-08-21T08:01:00Z");
  const decoder = new RegionalAisNmeaDecoder();
  const timestamp = "c:1787299260";
  assert.equal(decoder.consumeLine(withTag(TYPE_5_PART_1, `s:norway-a,${timestamp}`), now), null);
  assert.equal(decoder.consumeLine(withTag(TYPE_5_PART_2, `s:norway-b,${timestamp}`), now), null);
  assert.equal(decoder.consumeLine(withTag(TYPE_5_PART_2, `s:norway-a,${timestamp}`), now), null);

  const observation = decoder.consumeLine(withTag(TYPE_1_POSITION, `s:norway-a,${timestamp}`), now);
  assert.equal(observation?.displayName, "NORDIC STAR");
  assert.equal(observation?.callsign, "LJ1234");
  assert.equal(observation?.shipType, 70);
  assert.equal(observation?.destination, "DKCPH");
});

test("expires incomplete multipart messages", () => {
  const now = Date.parse("2026-08-21T08:01:00Z");
  const decoder = new RegionalAisNmeaDecoder({
    multipartTtlMilliseconds: 1_000,
    maintenanceIntervalMilliseconds: 10_000,
  });
  assert.equal(decoder.consumeLine(TYPE_5_PART_1, now), null);
  assert.equal(decoder.consumeLine(TYPE_5_PART_2, now + 1_001), null);
  const observation = decoder.consumeLine(TYPE_1_POSITION, now + 1_002);
  assert.equal(observation?.displayName, null);
});

test("expires cached static fields between maintenance sweeps", () => {
  const now = Date.parse("2026-08-21T08:01:00Z");
  const decoder = new RegionalAisNmeaDecoder({
    staticTtlMilliseconds: 1_000,
    maintenanceIntervalMilliseconds: 10_000,
  });
  assert.equal(decoder.consumeLine(TYPE_24_PART_A, now), null);
  assert.equal(decoder.consumeLine(TYPE_24_PART_B, now), null);

  const observation = decoder.consumeLine(TYPE_18_POSITION, now + 1_001);
  assert.equal(observation?.displayName, null);
  assert.equal(observation?.callsign, null);
  assert.equal(observation?.shipType, null);
});

test("runs full cache maintenance at a bounded interval instead of per line", () => {
  const now = Date.parse("2026-08-21T08:01:00Z");
  const decoder = new RegionalAisNmeaDecoder({
    maintenanceIntervalMilliseconds: 10_000,
  });
  const instrumented = decoder as unknown as {
    prune(nowMilliseconds: number): void;
  };
  const originalPrune = instrumented.prune.bind(decoder);
  let maintenanceRuns = 0;
  instrumented.prune = (nowMilliseconds) => {
    maintenanceRuns += 1;
    originalPrune(nowMilliseconds);
  };

  for (let offset = 0; offset < 1_000; offset += 1) {
    assert.ok(decoder.consumeLine(TYPE_1_POSITION, now + offset));
  }
  assert.equal(maintenanceRuns, 0);

  assert.ok(decoder.consumeLine(TYPE_1_POSITION, now + 10_000));
  assert.equal(maintenanceRuns, 1);
  assert.ok(decoder.consumeLine(TYPE_1_POSITION, now + 10_001));
  assert.equal(maintenanceRuns, 1);
});

test("merges type-24 parts and enriches a class-B position", () => {
  const now = Date.parse("2026-08-21T08:01:00Z");
  const decoder = new RegionalAisNmeaDecoder();
  assert.equal(decoder.consumeLine(TYPE_24_PART_A, now), null);
  assert.equal(decoder.consumeLine(TYPE_24_PART_B, now), null);
  const observation = decoder.consumeLine(TYPE_18_POSITION, now);
  assert.deepEqual(observation, {
    mmsi: "367123456",
    latitude: 47.6062,
    longitude: -122.3321,
    speed: 5.5,
    course: 180,
    heading: 181,
    navigationStatus: null,
    observedAt: "2026-08-21T08:01:00.000Z",
    displayName: "PACIFIC TRADER",
    callsign: "WDC1234",
    shipType: 80,
    destination: null,
  });
});

test("decodes extended class-B inline static data and long-range reports", () => {
  const now = Date.parse("2026-08-21T08:01:00Z");
  const decoder = new RegionalAisNmeaDecoder();
  const extended = decoder.consumeLine(TYPE_19_POSITION, now);
  assert.equal(extended?.mmsi, "563123456");
  assert.equal(extended?.latitude, 1.3521);
  assert.equal(extended?.longitude, 103.8198);
  assert.equal(extended?.displayName, "SINGAPORE TEST");
  assert.equal(extended?.shipType, 60);

  const longRange = decoder.consumeLine(TYPE_27_POSITION, now);
  assert.deepEqual(longRange, {
    mmsi: "257654321",
    latitude: 59.91,
    longitude: 10.75,
    speed: 15,
    course: 270,
    heading: null,
    navigationStatus: 5,
    observedAt: "2026-08-21T08:01:00.000Z",
    displayName: null,
    callsign: null,
    shipType: null,
    destination: null,
  });
});

test("uses the shared class-A layout for message types 1, 2, and 3", () => {
  const payload = "13mJt9001s0HG=HRSV73K2hf0000";
  for (const messageType of [1, 2, 3] as const) {
    const decoded = decodeAisPayload(`${messageType}${payload.slice(1)}`, 0);
    assert.equal(decoded?.kind, "position");
    assert.equal(decoded?.messageType, messageType);
    assert.equal(decoded?.mmsi, "257342500");
  }
});

test("rejects invalid coordinates and stale or future source timestamps", () => {
  const now = Date.parse("2026-08-21T08:01:00Z");
  const decoder = new RegionalAisNmeaDecoder();
  assert.equal(decoder.consumeLine(INVALID_COORDINATES, now), null);
  assert.equal(
    decoder.consumeLine(withTag(TYPE_18_POSITION, "s:us,c:1787298300"), now),
    null,
  );
  assert.equal(
    decoder.consumeLine(withTag(TYPE_18_POSITION, "s:us,c:1787299561"), now),
    null,
  );

  const sentinel = decoder.consumeLine(SENTINEL_FIELDS, now);
  assert.equal(sentinel?.speed, null);
  assert.equal(sentinel?.course, null);
  assert.equal(sentinel?.heading, null);
  assert.equal(sentinel?.navigationStatus, null);
});
