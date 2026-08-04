import assert from "node:assert/strict";
import test from "node:test";
import { buildOecdRequest } from "./oecd-request";

test("OECD request explicitly negotiates SDMX CSV language and observation dimensions", () => {
  const request = buildOecdRequest("https://sdmx.oecd.org/public/rest/data/example", "2025-01");
  assert.equal(request.url.searchParams.get("dimension_at_observation"), "AllDimensions");
  assert.equal(request.url.searchParams.has("dimensionAtObservation"), false);
  assert.deepEqual(request.init.headers, { accept: "text/csv;version=2.0.0", "accept-language": "en", "user-agent": "Claritas market intelligence/1.0" });
});
