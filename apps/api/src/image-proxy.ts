import { lookup } from "node:dns/promises";
import https from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";

const MAX_IMAGE_BYTES = 5_000_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon", "image/vnd.microsoft.icon"]);
const blockedAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blockedAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv6");
}

export class ImageProxyError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function isPublicImageAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, "ipv4");
  if (family !== 6 || address.includes("%")) return false;
  // Restrict IPv6 to global unicast. Canonicalization also closes alternate
  // spellings of mapped IPv4, documentation and transition addresses.
  const canonical = new URL(`https://[${address}]`).hostname.slice(1, -1);
  return /^[23][0-9a-f]{3}:/.test(canonical) && !blockedAddresses.check(canonical, "ipv6");
}

type ResolvedAddress = { address: string; family: number };
type ImageProxyDependencies = {
  lookup: (hostname: string) => Promise<ResolvedAddress[]>;
  request: (options: https.RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
};
const defaultDependencies: ImageProxyDependencies = {
  lookup: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  request: (options, callback) => https.request(options, callback),
};

async function resolveImageAddress(value: string, dependencies: ImageProxyDependencies): Promise<{ url: URL; address: ResolvedAddress }> {
  let url: URL;
  try { url = new URL(value); } catch { throw new ImageProxyError(400, "invalid url"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new ImageProxyError(400, "image host is not permitted");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new ImageProxyError(400, "image host is not permitted");
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await dependencies.lookup(hostname);
  if (!addresses.length || addresses.some((entry) => !isPublicImageAddress(entry.address))) {
    throw new ImageProxyError(400, "image host is not permitted");
  }
  return { url, address: addresses[0] };
}

type ImageResult = { contentType: string; body: Buffer };
type ImageHop = ImageResult | { redirect: string };

function requestImage(url: URL, address: ResolvedAddress, signal: AbortSignal, dependencies: ImageProxyDependencies, allowedTypes = IMAGE_TYPES, maxBytes = MAX_IMAGE_BYTES): Promise<ImageHop> {
  return new Promise((resolve, reject) => {
    const request = dependencies.request({
      protocol: "https:", hostname: url.hostname.replace(/^\[|\]$/g, ""),
      path: `${url.pathname}${url.search}`, method: "GET", agent: false, signal,
      // Use this exact vetted result for the socket, retaining the original
      // hostname for Host/SNI and TLS verification. Never resolve it again.
      family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      headers: { accept: Array.from(allowedTypes).join(", "), "accept-encoding": "identity" },
    }, (response) => {
      const status = response.statusCode ?? 502;
      const fail = (error: ImageProxyError) => { response.destroy(); reject(error); };
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.destroy();
        if (!location) { reject(new ImageProxyError(502, "invalid image redirect")); return; }
        try { resolve({ redirect: new URL(location, url).toString() }); }
        catch { reject(new ImageProxyError(502, "invalid image redirect")); }
        return;
      }
      if (status < 200 || status >= 300) { fail(new ImageProxyError(502, "upstream error")); return; }
      const contentType = String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      // SVG can execute script when opened directly under the app origin.
      if (!allowedTypes.has(contentType)) { fail(new ImageProxyError(415, "upstream is not a supported image")); return; }
      if (Number(response.headers["content-length"]) > maxBytes) { fail(new ImageProxyError(413, "image too large")); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { fail(new ImageProxyError(413, "image too large")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ contentType, body: Buffer.concat(chunks, size) }));
      response.on("error", reject);
      response.on("aborted", () => reject(new ImageProxyError(502, "upstream image interrupted")));
    });
    request.on("error", reject);
    request.end();
  });
}

async function fetchPublicResource(value: string, dependencies: ImageProxyDependencies, allowedTypes: Set<string>, maxBytes: number): Promise<ImageResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ImageProxyError(504, "image request timed out"));
    }, 10_000);
  });
  const fetchImage = async () => {
    let target = value;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const { url, address } = await resolveImageAddress(target, dependencies);
      // DNS resolution itself cannot be cancelled, so check before opening a
      // socket after the overall timeout has already returned to the caller.
      controller.signal.throwIfAborted();
      const result = await requestImage(url, address, controller.signal, dependencies, allowedTypes, maxBytes);
      if (!("redirect" in result)) return result;
      target = result.redirect;
    }
    throw new ImageProxyError(502, "image redirect limit exceeded");
  };
  try { return await Promise.race([fetchImage(), timeout]); }
  finally { clearTimeout(timer); }
}

export async function fetchPublicImage(value: string, dependencies = defaultDependencies): Promise<ImageResult> {
  return fetchPublicResource(value, dependencies, IMAGE_TYPES, MAX_IMAGE_BYTES);
}

/** Bounded public HTTPS article metadata fetch, with the image proxy's DNS pinning. */
export async function fetchPublicHtml(value: string): Promise<string> {
  const response = await fetchPublicResource(value, defaultDependencies, new Set(["text/html", "application/xhtml+xml"]), 1_000_000);
  return response.body.toString("utf8");
}
