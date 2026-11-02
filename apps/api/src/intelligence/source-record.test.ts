import assert from "node:assert/strict";
import test from "node:test";
import { sourceRecordBigintSql, canonicalSocialSignalBigintSql } from "./source-record";

test("source-record SQL accepts identifiers only", () => {
  assert.throws(() => sourceRecordBigintSql("evidence; DROP TABLE item"), /Invalid SQL identifier/);
  assert.throws(() => sourceRecordBigintSql("evidence", "item' OR true"), /Invalid SQL identifier/);
  assert.throws(() => canonicalSocialSignalBigintSql("event.id"), /Invalid SQL identifier/);
});
