import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fetchPublicImage, ImageProxyError, isPublicImageAddress } from "./image-proxy";

function imageServer(responses: Array<{ status?: number; headers?: Record<string, string>; chunks?: Buffer[]; abort?: boolean }>) {
  const requests: RequestOptions[] = [];
  const streams: PassThrough[] = [];
  let writes = 0;
  return {
    requests, streams, get writes() { return writes; },
    lookup: async (_hostname: string) => [{ address: "93.184.216.34", family: 4 }],
    request: (options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      requests.push(options);
      const next = responses.shift();
      assert.ok(next, "unexpected network request");
      const response = new PassThrough();
      streams.push(response);
      Object.assign(response, { statusCode: next.status ?? 200, headers: next.headers ?? { "content-type": "image/png" } });
      const request = new EventEmitter();
      Object.assign(request, { end() {
        queueMicrotask(() => {
          callback(response as IncomingMessage);
          if (next.abort) { response.emit("aborted"); return; }
          for (const chunk of next.chunks ?? [Buffer.from("image bytes")]) {
            if (response.destroyed) break;
            writes += 1;
            response.write(chunk);
          }
          if (!response.destroyed) response.end();
        });
      } });
      return request as ClientRequest;
    },
  };
}

test("image addresses reject local, reserved and IPv4-encoded IPv6 destinations", () => {
  for (const address of ["127.0.0.1", "10.1.1.1", "169.254.169.254", "100.64.0.1", "172.16.1.1", "192.168.0.1", "224.0.0.1", "198.51.100.1", "203.0.113.1", "::1", "::ffff:7f00:1", "::ffff:127.0.0.1", "fd00::1", "fe80::1", "2001:0db8::1", "2002:7f00:1::", "3fff::1", "not an address"]) {
    assert.equal(isPublicImageAddress(address), false, address);
  }
  for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPublicImageAddress(address), true, address);
  }
});

test("image requests pin vetted DNS while preserving the TLS hostname", async () => {
  const server = imageServer([{}]);
  let lookups = 0;
  const result = await fetchPublicImage("https://publisher.example/image.png?size=small", {
    ...server,
    lookup: async () => [{ address: ++lookups === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }],
  });
  assert.equal(result.body.toString(), "image bytes");
  assert.equal(result.contentType, "image/png");
  assert.equal(lookups, 1);
  const options = server.requests[0];
  assert.equal(options.hostname, "publisher.example");
  assert.equal(options.path, "/image.png?size=small");
  assert.equal(options.agent, false);
  assert.ok(options.lookup);
  options.lookup("publisher.example", {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, "93.184.216.34");
    assert.equal(family, 4);
  });
});

test("every image redirect is validated before another socket opens", async () => {
  for (const destination of ["http://publisher.example/image.png", "https://user:secret@publisher.example/image.png", "https://127.0.0.1/image.png", "https://[::ffff:7f00:1]/image.png", "https://metadata.example/image.png", "https://publisher.example:8443/image.png"]) {
    const server = imageServer([{ status: 302, headers: { location: destination } }]);
    await assert.rejects(fetchPublicImage("https://publisher.example/image.png", {
      ...server,
      lookup: async (hostname) => [{ address: hostname === "metadata.example" ? "169.254.169.254" : "93.184.216.34", family: 4 }],
    }), (error: unknown) => error instanceof ImageProxyError && error.status === 400);
    assert.equal(server.requests.length, 1);
    assert.equal(server.streams[0].destroyed, true);
  }
});

test("safe relative redirects work and redirect loops stop after four requests", async () => {
  const server = imageServer([{ status: 302, headers: { location: "/final.png" } }, {}]);
  await fetchPublicImage("https://publisher.example/start", server);
  assert.equal(server.requests[1].path, "/final.png");
  const loop = imageServer(Array.from({ length: 4 }, () => ({ status: 302, headers: { location: "/loop" } })));
  await assert.rejects(fetchPublicImage("https://publisher.example/loop", loop), /redirect limit/);
  assert.equal(loop.requests.length, 4);
});

test("image downloads stop at the streaming bound even without Content-Length", async () => {
  const server = imageServer([{ chunks: Array.from({ length: 8 }, () => Buffer.alloc(1_000_000)) }]);
  await assert.rejects(fetchPublicImage("https://publisher.example/large.png", server), (error: unknown) => error instanceof ImageProxyError && error.status === 413);
  assert.equal(server.writes, 6);
  assert.equal(server.streams[0].destroyed, true);
});

test("active content, oversized headers and interrupted images are rejected", async () => {
  for (const [response, status] of [
    [{ headers: { "content-type": "image/svg+xml" } }, 415],
    [{ headers: { "content-type": "text/html" } }, 415],
    [{ headers: { "content-type": "image/png", "content-length": "5000001" } }, 413],
    [{ abort: true }, 502],
  ] as const) {
    const server = imageServer([response]);
    await assert.rejects(fetchPublicImage("https://publisher.example/image", server), (error: unknown) => error instanceof ImageProxyError && error.status === status);
  }
});

test("mixed public/private DNS answers fail closed without issuing a request", async () => {
  const server = imageServer([]);
  await assert.rejects(fetchPublicImage("https://publisher.example/image", {
    ...server,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }],
  }), /not permitted/);
  assert.equal(server.requests.length, 0);
});

test("the total image deadline includes DNS and cannot open a socket after timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const server = imageServer([]);
  let resolveDns!: (addresses: Array<{ address: string; family: number }>) => void;
  const result = fetchPublicImage("https://publisher.example/image", {
    ...server,
    lookup: () => new Promise((resolve) => { resolveDns = resolve; }),
  });
  context.mock.timers.tick(10_000);
  await assert.rejects(result, (error: unknown) => error instanceof ImageProxyError && error.status === 504);
  resolveDns([{ address: "93.184.216.34", family: 4 }]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(server.requests.length, 0);
});
