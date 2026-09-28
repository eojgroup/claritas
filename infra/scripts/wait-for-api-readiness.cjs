"use strict";

async function waitForApiReadiness({
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
  attempts = 6,
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl("http://127.0.0.1:8080/readyz", { signal: AbortSignal.timeout(5_000) });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`readiness returned ${response.status}`);
      log(`API readiness verified on attempt ${attempt}/${attempts}.`);
      return;
    } catch {
      log(`API readiness attempt ${attempt}/${attempts} did not pass.`);
      if (attempt === attempts) throw new Error(`API readiness failed after ${attempts} attempts.`);
      await sleep(5_000);
    }
  }
}

module.exports = { waitForApiReadiness };
if (require.main === module || module.id === "[stdin]") {
  waitForApiReadiness().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
