import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type ClamAvVerdict = "clean" | "infected" | "unavailable";

export interface ScanRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: Uint8Array;
}

export interface ScanResponse {
  readonly status: 200 | 401 | 503;
  readonly body:
    | { readonly status: "clean" | "infected" }
    | { readonly error: "SCAN_DENIED" | "SCAN_UNAVAILABLE" };
}

export interface ScanGatewayConfig {
  readonly keyId: string;
  readonly hmacKey: Uint8Array;
  readonly maximumBytes: number;
}

export interface ScanGatewayRuntime {
  readonly nowMs: () => number;
  readonly scan: (bytes: Uint8Array) => Promise<ClamAvVerdict>;
}

const authorityPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const digestPattern = /^[A-Za-z0-9_-]{43}$/u;
const maximumClockSkewMs = 60_000;

function denied(): ScanResponse {
  return { status: 401, body: { error: "SCAN_DENIED" } };
}

function safeEqual(left: string, right: string): boolean {
  if (!digestPattern.test(left) || !digestPattern.test(right)) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function createScanGateway(
  config: ScanGatewayConfig,
  runtime: ScanGatewayRuntime,
): (request: ScanRequest) => Promise<ScanResponse> {
  if (
    !authorityPattern.test(config.keyId) ||
    config.hmacKey.byteLength !== 32 ||
    config.maximumBytes < 1 ||
    config.maximumBytes > 10 * 1024 * 1024
  ) {
    throw new Error("SCAN_GATEWAY_CONFIG_INVALID");
  }
  const key = Buffer.from(config.hmacKey);
  const nonces = new Map<string, number>();

  return async (request) => {
    const timestampText = request.headers["x-y7-timestamp"] ?? "";
    const timestamp = Number(timestampText);
    const nonce = request.headers["x-y7-nonce"] ?? "";
    const digest = request.headers["x-y7-content-sha256"] ?? "";
    const signature = request.headers["x-y7-signature"] ?? "";
    const now = runtime.nowMs();
    for (const [seenNonce, expiresAt] of nonces) {
      if (expiresAt < now) nonces.delete(seenNonce);
    }
    if (
      request.method !== "POST" ||
      request.path !== "/v1/scan" ||
      request.headers["content-type"] !== "application/octet-stream" ||
      request.headers["x-y7-key-id"] !== config.keyId ||
      request.headers["content-length"] !== String(request.body.byteLength) ||
      request.body.byteLength < 1 ||
      request.body.byteLength > config.maximumBytes ||
      !Number.isSafeInteger(timestamp) ||
      Math.abs(now - timestamp) > maximumClockSkewMs ||
      !authorityPattern.test(nonce) ||
      nonces.has(nonce) ||
      !digestPattern.test(digest)
    ) {
      return denied();
    }
    const actualDigest = createHash("sha256").update(request.body).digest("base64url");
    const canonical = `v1\nPOST\n/v1/scan\n${timestampText}\n${nonce}\n${digest}`;
    const expectedSignature = createHmac("sha256", key)
      .update(canonical)
      .digest("base64url");
    if (!safeEqual(digest, actualDigest) || !safeEqual(signature, expectedSignature)) {
      return denied();
    }
    nonces.set(nonce, now + maximumClockSkewMs);
    try {
      const verdict = await runtime.scan(request.body);
      if (verdict === "clean" || verdict === "infected") {
        return { status: 200, body: { status: verdict } };
      }
    } catch {
      // The boundary intentionally exposes no daemon detail.
    }
    return { status: 503, body: { error: "SCAN_UNAVAILABLE" } };
  };
}
