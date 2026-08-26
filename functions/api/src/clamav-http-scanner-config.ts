import type { ClamAvHttpScannerConfig } from "./clamav-http-scanner.js";

const keyIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;

function required(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error("CLAMAV_SCANNER_CONFIG_INVALID");
  return normalized;
}

export function parseClamAvHttpScannerConfig(
  input: Readonly<Record<string, string | undefined>>,
): ClamAvHttpScannerConfig {
  const endpoint = required(input.ANTIVIRUS_SCANNER_ENDPOINT);
  const keyId = required(input.ANTIVIRUS_SCANNER_KEY_ID);
  const encodedKey = required(input.ANTIVIRUS_SCANNER_HMAC_KEY);
  const timeout = required(input.ANTIVIRUS_SCANNER_TIMEOUT_MS);
  const timeoutMs = Number(timeout);

  if (!keyIdPattern.test(keyId) || !base64UrlPattern.test(encodedKey)) {
    throw new Error("CLAMAV_SCANNER_CONFIG_INVALID");
  }

  const hmacKey = Buffer.from(encodedKey, "base64url");
  if (
    hmacKey.byteLength !== 32 ||
    hmacKey.toString("base64url") !== encodedKey ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 10_000
  ) {
    throw new Error("CLAMAV_SCANNER_CONFIG_INVALID");
  }

  return { endpoint, keyId, hmacKey, timeoutMs };
}
