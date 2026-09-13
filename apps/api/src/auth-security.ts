import crypto from "node:crypto";

export type ResolvedAuthRedirect = {
  url: string;
  kind: "web" | "native";
};

const UNSAFE_CUSTOM_PROTOCOLS = new Set(["data:", "file:", "javascript:", "vbscript:"]);
const PKCE_BASE64URL_RE = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

function parseSafeAbsoluteUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return null;
    if (UNSAFE_CUSTOM_PROTOCOLS.has(parsed.protocol.toLowerCase())) return null;
    if (!parsed.host) return null;
    return parsed;
  } catch {
    return null;
  }
}

function redirectKind(url: URL): "web" | "native" {
  return url.protocol === "http:" || url.protocol === "https:" ? "web" : "native";
}

function isAllowlisted(candidate: URL, allowlist: URL[]): boolean {
  const kind = redirectKind(candidate);
  return allowlist.some((allowed) => {
    if (redirectKind(allowed) !== kind) return false;
    if (kind === "web") return candidate.origin === allowed.origin;
    return (
      candidate.protocol === allowed.protocol &&
      candidate.host === allowed.host &&
      candidate.pathname === allowed.pathname
    );
  });
}

function normalizeAcceptedRedirect(url: URL): ResolvedAuthRedirect {
  const kind = redirectKind(url);
  if (kind === "native") {
    // The native callback is a fixed rendezvous point. Caller-controlled query
    // parameters and fragments must not survive into the credential handoff.
    url.search = "";
    url.hash = "";
  }
  return { url: url.toString(), kind };
}

/**
 * Resolve a post-login redirect without string-prefix or scheme-only matching.
 * Web destinations match an allowlisted origin. Native destinations match an
 * explicitly allowlisted protocol, host, and path tuple.
 */
export function resolveAllowedAuthRedirect(
  candidate: string | undefined,
  fallback: string | undefined,
  configuredAllowlist: string[]
): ResolvedAuthRedirect | undefined {
  const allowlist = configuredAllowlist
    .map((entry) => parseSafeAbsoluteUrl(entry))
    .filter((entry): entry is URL => entry !== null);

  const fallbackUrl = parseSafeAbsoluteUrl(fallback);
  const acceptedFallback = fallbackUrl && isAllowlisted(fallbackUrl, allowlist)
    ? normalizeAcceptedRedirect(fallbackUrl)
    : undefined;

  if (!candidate) return acceptedFallback;

  let candidateUrl: URL | null = null;
  if (candidate.startsWith("/") && !candidate.startsWith("//")) {
    if (fallbackUrl && redirectKind(fallbackUrl) === "web") {
      try {
        candidateUrl = new URL(candidate, fallbackUrl.origin);
      } catch {
        candidateUrl = null;
      }
    }
  } else {
    candidateUrl = parseSafeAbsoluteUrl(candidate);
  }

  if (!candidateUrl || !isAllowlisted(candidateUrl, allowlist)) return acceptedFallback;
  return normalizeAcceptedRedirect(candidateUrl);
}

export function isValidNativeCodeChallenge(value: string): boolean {
  return PKCE_BASE64URL_RE.test(value);
}

export function isValidNativeCodeVerifier(value: string): boolean {
  return PKCE_VERIFIER_RE.test(value);
}

export function isValidNativeHandoffCode(value: string): boolean {
  return PKCE_BASE64URL_RE.test(value);
}

export function deriveS256CodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function buildNativeHandoffRedirect(redirectUrl: string, code: string): string {
  const url = parseSafeAbsoluteUrl(redirectUrl);
  if (!url || redirectKind(url) !== "native") {
    throw new Error("Native handoff requires an absolute custom redirect URL.");
  }
  url.search = "";
  url.hash = "";
  url.searchParams.set("code", code);
  // An absent fragment inherits the browser's previous fragment on a 303
  // (RFC 9110 section 10.2.2). Explicitly empty it before crossing into the app.
  url.hash = "#";
  return url.toString();
}
