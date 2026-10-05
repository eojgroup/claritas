import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { fetchWithTimeout } from "./llm";

test("LLM deadline includes a stalled response body after successful headers", async () => {
  let headersSent = false;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"partial":');
    headersSent = true;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(fetchWithTimeout(`http://127.0.0.1:${address.port}`, {}, 150), /abort/i);
    assert.equal(headersSent, true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("LLM response remains readable with status and headers intact", async () => {
  const response = await fetchWithTimeout('data:application/json,{"result":"ok"}', {}, 1000);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await response.json(), { result: "ok" });
});
