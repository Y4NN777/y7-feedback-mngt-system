import { createHash, createHmac, randomBytes } from "node:crypto";

import type { MalwareScanner } from "./attachment-validation.js";

export interface ClamAvHttpScannerConfig {
  readonly endpoint: string;
  readonly keyId: string;
  readonly hmacKey: Uint8Array;
  readonly timeoutMs: number;
}

export interface ClamAvHttpScannerRuntime {
  readonly fetch: typeof globalThis.fetch;
  readonly nowMs: () => number;
  readonly createNonce: () => string;
}

const keyIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u;
const noncePattern = /^[A-Za-z0-9_-]{16,64}$/u;

function scannerUrl(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("CLAMAV_SCANNER_CONFIG_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("CLAMAV_SCANNER_CONFIG_INVALID");
  }
  url.pathname = "/v1/scan";
  return url;
}

function isVerdict(value: unknown): value is { readonly status: "clean" | "infected" } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Reflect.get(value, "status") === "clean" ||
      Reflect.get(value, "status") === "infected")
  );
}

export function createClamAvHttpScanner(
  config: ClamAvHttpScannerConfig,
  runtime: ClamAvHttpScannerRuntime = {
    fetch: globalThis.fetch,
    nowMs: Date.now,
    createNonce: () => randomBytes(18).toString("base64url"),
  },
): MalwareScanner {
  const url = scannerUrl(config.endpoint);
  if (
    !keyIdPattern.test(config.keyId) ||
    config.hmacKey.byteLength !== 32 ||
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 1 ||
    config.timeoutMs > 10_000
  ) {
    throw new Error("CLAMAV_SCANNER_CONFIG_INVALID");
  }
  const key = Buffer.from(config.hmacKey);

  return {
    async scan(bytes) {
      const timestamp = String(runtime.nowMs());
      const nonce = runtime.createNonce();
      if (!noncePattern.test(nonce)) return "unavailable";
      const digest = createHash("sha256").update(bytes).digest("base64url");
      const canonical = `v1\nPOST\n/v1/scan\n${timestamp}\n${nonce}\n${digest}`;
      const signature = createHmac("sha256", key).update(canonical).digest("base64url");
      try {
        const response = await runtime.fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(bytes.byteLength),
            "x-y7-key-id": config.keyId,
            "x-y7-timestamp": timestamp,
            "x-y7-nonce": nonce,
            "x-y7-content-sha256": digest,
            "x-y7-signature": signature,
          },
          body: new Blob([Uint8Array.from(bytes)]),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
        if (response.status !== 200) return "unavailable";
        const verdict: unknown = await response.json();
        return isVerdict(verdict) ? verdict.status : "unavailable";
      } catch {
        return "unavailable";
      }
    },
  };
}
