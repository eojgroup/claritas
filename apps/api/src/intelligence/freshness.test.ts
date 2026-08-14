import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  intelligenceEventExpiresAtSql,
  intelligenceEventFreshness,
  intelligenceEventVisibilityHours,
} from "./freshness";

describe("intelligence event freshness", () => {
  it("uses bounded event-family visibility windows", () => {
    assert.equal(intelligenceEventVisibilityHours("market_move"), 24);
    assert.equal(intelligenceEventVisibilityHours("earthquake"), 36);
    assert.equal(intelligenceEventVisibilityHours("wildfire"), 48);
    assert.equal(intelligenceEventVisibilityHours("severe_storm"), 72);
    assert.equal(intelligenceEventVisibilityHours("agricultural_stress"), 168);
    assert.equal(intelligenceEventVisibilityHours("unclassified"), 48);
  });

  it("distinguishes current, expiring and expired records", () => {
    const now = new Date("2026-08-14T12:00:00.000Z");
    assert.equal(intelligenceEventFreshness({ expiresAt: "2026-08-15T12:00:00.000Z", now }), "active");
    assert.equal(intelligenceEventFreshness({ expiresAt: "2026-08-14T14:00:00.000Z", now }), "expiring");
    assert.equal(intelligenceEventFreshness({ expiresAt: "2026-08-14T11:59:59.000Z", now }), "expired");
    assert.equal(intelligenceEventFreshness({ expiresAt: "2026-08-15T12:00:00.000Z", status: "resolved", now }), "expired");
  });

  it("keeps the SQL policy tied to last activity", () => {
    const sql = intelligenceEventExpiresAtSql("candidate");
    assert.match(sql, /candidate\.last_activity_time/);
    assert.match(sql, /candidate\.end_time/);
    assert.match(sql, /168 hours/);
    assert.match(sql, /24 hours/);
  });
});
