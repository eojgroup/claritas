import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { getDefaultAutoSelectFamily, setDefaultAutoSelectFamily } from "node:net";
import { PassThrough } from "node:stream";
import test from "node:test";

process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "claritas_test";
process.env.DB_USER ||= "claritas_test";
process.env.DB_PASSWORD ||= "claritas_test";
const connector = import("./gdelt");
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function publisherNetwork() {
  const requests: Array<{ options: RequestOptions; respond: (status?: number, headers?: Record<string, string>) => PassThrough }> = [];
  return {
    requests,
    resolveAddress: async () => ({ address: "93.184.216.34", family: 4 as const }),
    request(options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest {
      const request = Object.assign(new EventEmitter(), { end() {} });
      let response: PassThrough | undefined;
      options.signal?.addEventListener("abort", () => {
        response?.destroy();
        request.emit("error", new Error("Request aborted"));
      }, { once: true });
      requests.push({
        options,
        respond(status = 200, headers = { "content-type": "text/html" }) {
          response = new PassThrough();
          Object.assign(response, { statusCode: status, headers });
          callback(response as IncomingMessage);
          return response;
        },
      });
      return request as ClientRequest;
    },
  };
}

test("publisher deadline includes DNS and prevents late sockets after expiry", async (context) => {
  const { requestVerifiedPublisherPage } = await connector;
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const network = publisherNetwork();
  let resolveDns!: (value: { address: string; family: 4 }) => void;
  const page = requestVerifiedPublisherPage("https://publisher.example/article", {
    ...network,
    resolveAddress: () => new Promise((resolve) => { resolveDns = resolve; }),
  });
  context.mock.timers.tick(8_000);
  assert.equal(await page, null);
  resolveDns({ address: "93.184.216.34", family: 4 });
  await flush();
  assert.equal(network.requests.length, 0);
});

test("trickled publisher bytes cannot extend the absolute verification deadline", async (context) => {
  const { requestVerifiedPublisherPage } = await connector;
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const network = publisherNetwork();
  const page = requestVerifiedPublisherPage("https://publisher.example/article", network);
  await flush();
  const response = network.requests[0].respond();
  response.write("<head>");
  context.mock.timers.tick(3_000);
  response.write("<meta ");
  context.mock.timers.tick(3_000);
  response.write('property="article:published_time" ');
  context.mock.timers.tick(2_000);
  assert.equal(await page, null);
  assert.equal(network.requests[0].options.signal?.aborted, true);
  assert.equal(response.destroyed, true);
});

test("publisher redirects share the original deadline and abort the current socket", async (context) => {
  const { requestVerifiedPublisherPage } = await connector;
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const network = publisherNetwork();
  const page = requestVerifiedPublisherPage("https://publisher.example/start", network);
  await flush();
  context.mock.timers.tick(6_000);
  const redirect = network.requests[0].respond(302, { location: "/final" });
  await flush();
  assert.equal(redirect.destroyed, true);
  assert.equal(network.requests[1].options.path, "/final");
  assert.equal(network.requests[1].options.signal, network.requests[0].options.signal);
  const response = network.requests[1].respond();
  response.write("<head>");
  context.mock.timers.tick(2_000);
  assert.equal(await page, null);
  assert.equal(response.destroyed, true);
});

test("successful publisher pages preserve their final URL, bytes and pinned address", async () => {
  const { requestVerifiedPublisherPage } = await connector;
  const network = publisherNetwork();
  const page = requestVerifiedPublisherPage("https://publisher.example/start", network);
  await flush();
  network.requests[0].respond(302, { location: "/final?article=1" });
  await flush();
  const request = network.requests[1];
  assert.equal(request.options.hostname, "publisher.example");
  assert.equal(request.options.agent, false);
  assert.equal(request.options.family, 4);
  request.options.lookup!("publisher.example", {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, "93.184.216.34");
    assert.equal(family, 4);
  });
  request.respond().end("<head>Publisher metadata</head>");
  assert.deepEqual(await page, { html: "<head>Publisher metadata</head>", finalUrl: "https://publisher.example/final?article=1" });
});

test("pinned publisher lookup works with Node automatic address-family selection enabled", async () => {
  const { requestVerifiedPublisherPage } = await connector;
  const previousAutoSelect = getDefaultAutoSelectFamily();
  setDefaultAutoSelectFamily(true);
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<head>Verified publisher metadata</head>");
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://publisher.example:${address.port}/article`;
    const page = await requestVerifiedPublisherPage(url, {
      // Controlled fixture bypasses external DNS. Production uses the vetted
      // public-address resolver; this exercises the actual Node HTTP socket.
      resolveAddress: async () => ({ address: "127.0.0.1", family: 4 }),
    });
    assert.deepEqual(page, { html: "<head>Verified publisher metadata</head>", finalUrl: url });
  } finally {
    setDefaultAutoSelectFamily(previousAutoSelect);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("interrupted and oversized publisher bodies cannot become verified evidence", async () => {
  const { requestVerifiedPublisherPage } = await connector;
  for (const scenario of ["aborted", "oversized"] as const) {
    const network = publisherNetwork();
    const page = requestVerifiedPublisherPage("https://publisher.example/article", network);
    await flush();
    const response = network.requests[0].respond();
    if (scenario === "aborted") response.emit("aborted");
    else response.write(Buffer.alloc(350_001));
    assert.equal(await page, null);
    assert.equal(response.destroyed, true);
  }
});

test("private publisher redirects are rejected before a second request", async () => {
  const { requestVerifiedPublisherPage } = await connector;
  const network = publisherNetwork();
  const page = requestVerifiedPublisherPage("https://publisher.example/article", network);
  await flush();
  network.requests[0].respond(302, { location: "http://169.254.169.254/metadata" });
  assert.equal(await page, null);
  assert.equal(network.requests.length, 1);
});
