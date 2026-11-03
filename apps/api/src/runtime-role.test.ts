import assert from "node:assert/strict";
import test from "node:test";
import { parseRuntimeRole } from "./runtime-role";

test("runtime role preserves combined development and rejects silent production misconfiguration", () => {
  assert.equal(parseRuntimeRole(""), "all");
  assert.equal(parseRuntimeRole(" API "), "api");
  assert.equal(parseRuntimeRole("worker"), "worker");
  assert.equal(parseRuntimeRole("all"), "all");
  assert.throws(() => parseRuntimeRole("background"), /must be api, worker, or all/);
});
