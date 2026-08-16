import assert from "node:assert/strict";
import test from "node:test";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

const consumer = import("./consumer");

test("legacy GDELT articles stay hidden until the publisher-date quality check accepts them", async () => {
  const { isAcceptedNewsQuality } = await consumer;
  assert.equal(isAcceptedNewsQuality({}, "gdelt"), false);
  assert.equal(isAcceptedNewsQuality(null, "GDELT"), false);
  assert.equal(isAcceptedNewsQuality({ quality_status: "rejected" }, "gdelt"), false);
  assert.equal(isAcceptedNewsQuality({ quality_status: "accepted" }, "gdelt"), true);
  assert.equal(isAcceptedNewsQuality({}, "institutional_rss"), true);
});

test("podcast context requires a transcript-backed, confident concrete finding", async () => {
  const { podcastSignalQualifiesForEventContext } = await consumer;
  assert.equal(podcastSignalQualifiesForEventContext({
    signalType: "event",
    confidence: 0.72,
    evidenceCount: 2,
    entities: ["Port of Singapore"],
  }), true);

  assert.equal(podcastSignalQualifiesForEventContext({
    signalType: "topic",
    confidence: 1,
    evidenceCount: 2,
    entities: ["Port of Singapore"],
  }), false);
  assert.equal(podcastSignalQualifiesForEventContext({
    signalType: "claim",
    confidence: 0.72,
    evidenceCount: 0,
    entities: ["Port of Singapore"],
  }), false);
  assert.equal(podcastSignalQualifiesForEventContext({
    signalType: "risk",
    confidence: 0.72,
    evidenceCount: 1,
    entities: [],
  }), false);
});
