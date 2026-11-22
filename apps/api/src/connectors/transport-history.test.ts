import assert from "node:assert/strict";
import test from "node:test";
import {
  transportHistoryModeValue,
  transportHistoryComparisons,
  transportHistoryWindow,
} from "./transport-history";

type HistoryPoint = Parameters<typeof transportHistoryWindow>[0][number];

function point(
  day: number,
  values: Partial<HistoryPoint> = {},
): HistoryPoint {
  return {
    bucket: `2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    maritime_entities: null,
    aviation_entities: null,
    observed_hours: 0,
    ship_departures: null,
    ship_arrivals: null,
    cargo_vessel_departures: null,
    corridor_maritime_entities: null,
    corridor_aviation_entities: null,
    corridor_observed_hours: 0,
    corridor_observed_origins: null,
    corridor_flag_proxy_origins: null,
    ...values,
  };
}

test("country history excludes unobserved days instead of treating them as zero traffic", () => {
  const summary = transportHistoryWindow(
    [
      point(1),
      point(2, {
        maritime_entities: 8,
        aviation_entities: 12,
        observed_hours: 20,
        ship_departures: 3,
        ship_arrivals: 2,
        cargo_vessel_departures: 1,
      }),
      point(3, {
        maritime_entities: 10,
        aviation_entities: 20,
        observed_hours: 24,
        ship_departures: 4,
        ship_arrivals: 5,
        cargo_vessel_departures: 2,
      }),
    ],
    7,
    false,
  );

  assert.equal(summary.observed_days, 2);
  assert.equal(summary.average_daily_entities, 25);
  assert.deepEqual(summary.peak_daily_entities, {
    bucket: "2026-08-03T00:00:00.000Z",
    value: 30,
  });
  assert.equal(summary.ship_departures, 7);
  assert.equal(summary.cargo_vessel_departures, 3);
});

test("country history keeps retained port movement visible before daily entity history accrues", () => {
  const summary = transportHistoryWindow(
    [
      point(1),
      point(2, {
        ship_departures: 4,
        ship_arrivals: 2,
        cargo_vessel_departures: 1,
      }),
    ],
    7,
    false,
  );

  assert.equal(summary.observed_days, 1);
  assert.equal(summary.average_daily_entities, null);
  assert.equal(summary.peak_daily_entities, null);
  assert.equal(summary.ship_departures, 4);
  assert.equal(summary.ship_arrivals, 2);
});

test("corridor history reports direct-origin evidence separately from flag proxies", () => {
  const summary = transportHistoryWindow(
    [
      point(1, {
        corridor_maritime_entities: 10,
        corridor_aviation_entities: 5,
        corridor_observed_hours: 18,
        corridor_observed_origins: 12,
        corridor_flag_proxy_origins: 3,
      }),
      point(2),
    ],
    30,
    true,
  );

  assert.equal(summary.observed_days, 1);
  assert.equal(summary.average_daily_entities, 15);
  assert.equal(summary.observed_origin_share, 80);
  assert.equal(summary.ship_departures, null);
});

test("mode-filtered history leaves the excluded mode absent rather than reporting zero", () => {
  assert.equal(transportHistoryModeValue("maritime", "maritime", 12), 12);
  assert.equal(transportHistoryModeValue("maritime", "aviation", 0), null);
  assert.equal(transportHistoryModeValue("aviation", "maritime", 0), null);
  assert.equal(transportHistoryModeValue(null, "aviation", 0), 0);
});

test("long-range comparisons use completed observed UTC windows and retain coverage", () => {
  const end = new Date("2026-11-22T00:00:00Z");
  const daily = (offset: number, value: number) => {
    const date = new Date(end); date.setUTCDate(date.getUTCDate() - offset);
    return { ...point(1), bucket: date.toISOString(), maritime_entities: value, observed_hours: 24 };
  };
  const series = Array.from({ length: 60 }, (_, i) => daily(i + 1, i < 30 ? 20 : 10));
  const annual = Array.from({ length: 30 }, (_, i) => daily(366 + i, 5));
  const comparisons = transportHistoryComparisons([...annual, ...series, daily(0, 99999)], new Date("2026-11-22T23:50:00Z"));
  assert.equal(comparisons[0].change_percent, 100);
  assert.equal(comparisons[0].current.average_daily_entities, 20);
  assert.equal(comparisons[0].current.observation_hours, 720);
  assert.equal(comparisons[1].change_percent, 300);
  assert.equal(comparisons[1].previous.start, "2025-10-23T00:00:00.000Z");
});

test("missing history and zero baselines cannot manufacture a month or year percentage", () => {
  const incomplete = transportHistoryComparisons([point(1, { observed_hours: 24, maritime_entities: 10 })], new Date("2026-08-03T00:00:00Z"));
  assert.equal(incomplete[0].comparable, false);
  assert.equal(incomplete[0].change_percent, null);
  assert.equal(incomplete[1].previous.average_daily_entities, null);
  const end = new Date("2026-11-22T00:00:00Z");
  const zero = Array.from({ length: 60 }, (_, i) => {
    const date = new Date(end); date.setUTCDate(date.getUTCDate() - i - 1);
    return { ...point(1), bucket: date.toISOString(), maritime_entities: 0, observed_hours: 24 };
  });
  assert.equal(transportHistoryComparisons(zero, end)[0].change_percent, null);
});
