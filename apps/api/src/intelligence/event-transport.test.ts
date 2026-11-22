import assert from "node:assert/strict";
import test from "node:test";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";
const anomaly = { domain: "transport", evidence_type: "rolling_baseline_anomaly", source_record_type: "transport_movement_event", source_record_id: "12",
  observed_at: "2026-11-22T14:35:00Z", metadata: { current: 3, baseline: 12 }, confidence: .8 };
test("anomaly details keep the retained comparison when its movement anchor is absent", async () => {
  const { getEventTransport } = await import("./event-transport");
  const read = async () => ({ rows: [] });
  const result = await getEventTransport({ location_name: "Port" }, [anomaly], read);
  assert.equal(result?.coverage, "summary_only");
  assert.equal(result?.current, 3);
  assert.deepEqual(result?.movements, []);
  assert.equal(await getEventTransport({}, [], read), null);
  assert.equal(await getEventTransport({}, [{ ...anomaly, metadata: { current: -1, baseline: 12 } }], read), null);
});
test("noncanonical transport identities cannot select unrelated movement records", async () => {
  const { getEventTransport } = await import("./event-transport");
  for (const source_record_id of ["01", "9223372036854775808", "invalid"]) {
    const result = await getEventTransport({}, [{ ...anomaly, source_record_id }], async () => { throw new Error("must not read"); });
    assert.equal(result?.coverage, "summary_only");
  }
  const unrelated = await getEventTransport({}, [{ ...anomaly, source_record_type: "country_aggregate" }], async () => { throw new Error("must not read unrelated movement"); });
  assert.equal(unrelated?.coverage, "summary_only");
});
