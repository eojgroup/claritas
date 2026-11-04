import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("image digest resolution drains manifest output and retries failed inspections", () => {
  const directory = mkdtempSync(join(tmpdir(), "claritas-image-digest-"));
  const digest = `sha256:${"a".repeat(64)}`;
  try {
    writeFileSync(join(directory, "docker"), `#!/usr/bin/env node
const fs=require("node:fs");
const file=process.env.COUNTER_FILE;
const count=fs.existsSync(file)?Number(fs.readFileSync(file,"utf8"))+1:1;
fs.writeFileSync(file,String(count));
if(process.env.SCENARIO==="retry" && count<3) process.exit(255);
if(process.env.SCENARIO==="failure") process.exit(255);
if(process.env.SCENARIO==="invalid") {console.log("Digest: invalid");process.exit(0);}
fs.writeSync(1,"Name: example/image\\nDigest: ${digest}\\n");
fs.writeSync(1,"manifest-detail".repeat(30000));
fs.writeSync(1,"\\nDigest: sha256:${"b".repeat(64)}\\n");
`, { mode: 0o755 });
    for (const [scenario, status, attempts] of [["large", 0, 1], ["retry", 0, 3], ["failure", 1, 3], ["invalid", 1, 3]] as const) {
      const counter = join(directory, scenario);
      const result = spawnSync("bash", [resolve(__dirname, "../../../infra/scripts/resolve-image-digest.sh"), "example/image:release"], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${directory}${delimiter}${process.env.PATH}`, SCENARIO: scenario,
          COUNTER_FILE: counter, IMAGE_DIGEST_ATTEMPTS: "3", IMAGE_DIGEST_RETRY_SECONDS: "0" },
      });
      assert.equal(result.status, status, result.stderr);
      assert.equal(Number(readFileSync(counter, "utf8")), attempts);
      assert.equal(result.stdout.trim(), status === 0 ? digest : "");
      if (status !== 0) assert.match(result.stderr, /Failed to resolve an immutable digest/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
