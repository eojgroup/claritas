import assert from "node:assert/strict";
import test from "node:test";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";

test("nearby reporting uses a bounded event-time window, including historical investigations", async () => {
  const { regionalReportingWindow } = await import("./regional-reporting");
  assert.deepEqual(regionalReportingWindow("2026-09-23T12:00:00Z"), {
    start: "2026-09-22T12:00:00.000Z", end: "2026-09-24T12:00:00.000Z",
  });
  assert.equal(regionalReportingWindow(null), null);
  assert.equal(regionalReportingWindow("not a date"), null);
});

test("named-place discovery works for airports worldwide without substring geography", async () => {
  const { mentionsNamedLocation } = await import("./regional-reporting");
  for (const airport of ["Bristol Airport", "Heathrow", "Dubai International Airport", "Singapore Changi Airport"]) {
    assert.equal(mentionsNamedLocation(`Updates from ${airport}`, null, [airport]), true);
  }
  assert.equal(mentionsNamedLocation("Flights cancelled", null, ["CAN"]), false);
  assert.equal(mentionsNamedLocation("Viral report", null, ["Iran"]), false);
  assert.equal(mentionsNamedLocation("São Paulo airport", null, ["Sao Paulo"]), true);
});

test("headline overlap requires two distinctive terms rather than a shared country", async () => {
  const { sharedHeadlineTerms } = await import("./regional-reporting");
  assert.deepEqual(sharedHeadlineTerms("Shark stranded in South Korean canal", "Rescue of stranded shark draws visitors to canal"), ["stranded", "shark", "canal"]);
  assert.deepEqual(sharedHeadlineTerms("Shark stranded in South Korean canal", "Court decision in South Korea"), []);
});
