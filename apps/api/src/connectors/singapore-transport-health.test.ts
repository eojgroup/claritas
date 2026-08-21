import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSingaporeTransportHealthQuery,
  evaluateSingaporeTransportHealth,
} from "./singapore-transport-health";

const now = Date.parse("2026-08-21T18:00:00.000Z");
const freshnessMilliseconds = 15 * 60_000;

test("Singapore transport health requires current position-derived maritime coverage", () => {
  const query = buildSingaporeTransportHealthQuery();
  assert.match(query, /s\.mode = 'maritime'/);
  assert.match(query, /s\.current_country_iso2 = \$1/);
  assert.match(query, /s\.observed_at >= now\(\) - \(\$2::integer \* interval '1 second'\)/);
  assert.doesNotMatch(query, /origin_country_iso2|destination_country_iso2|registration_country_iso2/);
});

test("reports fresh Singapore vessels from the release database", () => {
  const health = evaluateSingaporeTransportHealth(
    {
      current_vessels: "14",
      latest_observed_at: new Date(now - 45_000),
      source_names: ["mpa_oceans_x", "aisstream", "aisstream"],
    },
    { now, freshnessMilliseconds },
  );

  assert.equal(health.ready, true);
  assert.equal(health.state, "current_singapore_vessel");
  assert.equal(health.current_vessels, 14);
  assert.equal(health.position_basis, "current_country_iso2");
  assert.deepEqual(health.source_names, ["aisstream", "mpa_oceans_x"]);
});

test("rejects stale or absent Singapore vessel positions", () => {
  const stale = evaluateSingaporeTransportHealth(
    {
      current_vessels: 8,
      latest_observed_at: new Date(now - freshnessMilliseconds - 1).toISOString(),
      source_names: ["aisstream"],
    },
    { now, freshnessMilliseconds },
  );
  const absent = evaluateSingaporeTransportHealth(undefined, {
    now,
    freshnessMilliseconds,
  });

  assert.equal(stale.ready, false);
  assert.equal(stale.state, "no_current_singapore_vessel");
  assert.equal(absent.ready, false);
  assert.equal(absent.current_vessels, 0);
  assert.equal(absent.latest_observed_at, null);
});

test("rejects implausibly future-dated vessel positions", () => {
  const health = evaluateSingaporeTransportHealth(
    {
      current_vessels: 1,
      latest_observed_at: new Date(now + 60_001).toISOString(),
      source_names: ["mpa_oceans_x"],
    },
    { now, freshnessMilliseconds },
  );

  assert.equal(health.ready, false);
});
