import { createPrivateKey, createSign } from "crypto";

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function normalizeApnsPrivateKey(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\\n/g, "\n") ?? "";
  if (!normalized.includes("BEGIN PRIVATE KEY") || !normalized.includes("END PRIVATE KEY")) return null;
  try {
    const key = createPrivateKey(normalized);
    if (key.asymmetricKeyType !== "ec") return null;
    const curve = key.asymmetricKeyDetails?.namedCurve;
    return curve === "prime256v1" || curve === "P-256" ? normalized : null;
  } catch {
    return null;
  }
}

/** Pure APNs ES256 signing helper, kept independent from database/runtime state. */
export function createApnsProviderToken(config: {
  keyId: string | null;
  teamId: string | null;
  privateKey: string | null;
}, now = Date.now()): string {
  if (!config.keyId || !config.teamId || !config.privateKey) throw new Error("APNs signing credentials are incomplete.");
  const header = base64UrlJson({ alg: "ES256", kid: config.keyId });
  const claims = base64UrlJson({ iss: config.teamId, iat: Math.floor(now / 1_000) });
  const input = `${header}.${claims}`;
  const signer = createSign("SHA256");
  signer.update(input);
  signer.end();
  const signature = signer.sign({ key: config.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${input}.${signature}`;
}
