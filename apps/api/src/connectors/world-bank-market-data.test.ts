import assert from "node:assert/strict";
import test from "node:test";
import { parseWorldBankResponse } from "./world-bank-market-data";

test("World Bank parser normalizes valid country observations", () => {
  const parsed = parseWorldBankResponse([
    { lastupdated: "2026-07-13" },
    [
      { indicator: { id: "NY.GDP.MKTP.KD.ZG", value: "GDP growth" }, country: { value: "Sweden" }, countryiso3code: "SWE", date: "2025", value: 1.8, obs_status: "" },
      { indicator: { id: "NY.GDP.MKTP.KD.ZG", value: "GDP growth" }, country: { value: "Aggregate" }, countryiso3code: "1A", date: "2025", value: 3 },
      { indicator: { id: "NY.GDP.MKTP.KD.ZG", value: "GDP growth" }, country: { value: "Norway" }, countryiso3code: "NOR", date: "2025", value: null },
    ],
  ]);
  assert.equal(parsed.lastUpdated, "2026-07-13");
  assert.deepEqual(parsed.observations, [{
    indicatorCode: "NY.GDP.MKTP.KD.ZG", indicatorName: "GDP growth", countryIso3: "SWE",
    countryName: "Sweden", year: 2025, value: 1.8, observationStatus: null,
  }]);
});
