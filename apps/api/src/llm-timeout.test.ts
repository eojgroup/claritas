import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithTimeout } from "./llm";

test("LLM deadline includes a stalled response body after successful headers", async () => {
  const originalFetch = globalThis.fetch;
  let bodyReadStarted = false;
  // Deliver headers immediately. A real loopback server can fail to accept
  // the connection before the deadline on a busy host, testing the connection
  // timeout instead of the stalled-body regression this case must cover.
  globalThis.fetch = async (_url, init) => {
    const response = new Response(null, { headers: { "content-type": "application/json" } });
    response.text = () => {
      bodyReadStarted = true;
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException("The operation was aborted", "AbortError"));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      });
    };
    return response;
  };
  try {
    await assert.rejects(fetchWithTimeout("https://provider.example/response", {}, 25), /abort/i);
    assert.equal(bodyReadStarted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM response remains readable with status and headers intact", async () => {
  const response = await fetchWithTimeout('data:application/json,{"result":"ok"}', {}, 1000);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await response.json(), { result: "ok" });
});
