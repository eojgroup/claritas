import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";

test("OpenCode startup registers the complete free router model and disables tools", () => {
  const script = readFileSync(path.resolve(process.cwd(), "../opencode/entrypoint.sh"), "utf8");
  const blocks = [...script.matchAll(/node <<'NODE'\n([\s\S]*?)\nNODE/g)];
  let config: any;
  runInNewContext(blocks[1][1], {
    require: (name: string) => name === "fs" ? { writeFileSync: (_target: string, value: string) => { config = JSON.parse(value); } }
      : name === "os" ? { homedir: () => "/tmp/opencode-test" } : path,
    process: { env: { OPENCODE_MODEL: "openrouter/free" }, exit: () => { throw new Error("Unexpected configuration failure"); } },
    console: { log() {}, error() {} },
  });
  assert.equal(config.model, "openrouter/openrouter/free");
  assert.deepEqual(Object.keys(config.provider.openrouter.models), ["openrouter/free"]);
  assert.equal(config.tools.StructuredOutput, false);
  assert.equal(config.tools.bash, false);
});
