import assert from "node:assert/strict";
import test from "node:test";
import { matchSocialEvent } from "./social-matching";

const event = { title: "Sweden refinery outage disrupts regional fuel supply", countryName: "Sweden", startTime: "2026-09-13T10:00:00Z", lastActivityTime: "2026-09-13T14:00:00Z" };
test("social context requires substantive topic overlap within the event window", () => {
  assert.ok(matchSocialEvent({ text: "Sweden refinery outage disrupts regional fuel supply today", postedAt: "2026-09-13T12:00:00Z" }, event).length >= 3);
  for (const text of ["Sweden is beautiful", "Markets and fuel supply", "A regional event update", "Sweden refinery refinery refinery", "Norway refinery outage disrupts regional fuel supply"]) {
    assert.deepEqual(matchSocialEvent({ text, postedAt: "2026-09-13T12:00:00Z" }, event), []);
  }
  for (const postedAt of ["2020-01-01", "invalid", "2026-09-20T12:00:00Z"]) {
    assert.deepEqual(matchSocialEvent({ text: event.title, postedAt }, event), []);
  }
});
test("generic short titles cannot link social claims", () => {
  assert.deepEqual(matchSocialEvent({ text: "Sweden news update", postedAt: event.startTime }, { ...event, title: "Sweden news update" }), []);
});
