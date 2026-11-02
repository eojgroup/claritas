import assert from "node:assert/strict";
import test from "node:test";
import { newsImageRetentionDays } from "./news-image-policy";

test("publisher preview retention stays bounded without changing existing immutable expiries", () => {
  assert.equal(newsImageRetentionDays(""), 14);
  assert.equal(newsImageRetentionDays("invalid"), 14);
  assert.equal(newsImageRetentionDays("Infinity"), 14);
  assert.equal(newsImageRetentionDays("0"), 14);
  assert.equal(newsImageRetentionDays("-4"), 14);
  assert.equal(newsImageRetentionDays("7"), 7);
  assert.equal(newsImageRetentionDays("30"), 30);
  assert.equal(newsImageRetentionDays("3000"), 30);
});
