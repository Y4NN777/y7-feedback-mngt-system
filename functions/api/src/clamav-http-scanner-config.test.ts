import { describe, expect, it } from "vitest";

import { parseClamAvHttpScannerConfig } from "./clamav-http-scanner-config.js";

const valid = {
  ANTIVIRUS_SCANNER_ENDPOINT: "https://scanner.preview.example",
  ANTIVIRUS_SCANNER_KEY_ID: "preview_2026_08",
  ANTIVIRUS_SCANNER_HMAC_KEY: Buffer.alloc(32, 7).toString("base64url"),
  ANTIVIRUS_SCANNER_TIMEOUT_MS: "8000",
};

describe("ClamAV HTTP scanner environment", () => {
  it("BDD-ATT-AV-024 parses server-only scanner authority", () => {
    expect(parseClamAvHttpScannerConfig(valid)).toEqual({
      endpoint: "https://scanner.preview.example",
      keyId: "preview_2026_08",
      hmacKey: Buffer.alloc(32, 7),
      timeoutMs: 8000,
    });
  });

  it.each([
    ["absent endpoint", { ANTIVIRUS_SCANNER_ENDPOINT: undefined }],
    ["missing endpoint", { ANTIVIRUS_SCANNER_ENDPOINT: "" }],
    ["invalid key id", { ANTIVIRUS_SCANNER_KEY_ID: "bad/key" }],
    ["short key", { ANTIVIRUS_SCANNER_HMAC_KEY: "c2hvcnQ" }],
    [
      "padded key",
      { ANTIVIRUS_SCANNER_HMAC_KEY: `${valid.ANTIVIRUS_SCANNER_HMAC_KEY}=` },
    ],
    ["fractional timeout", { ANTIVIRUS_SCANNER_TIMEOUT_MS: "1.5" }],
    ["excessive timeout", { ANTIVIRUS_SCANNER_TIMEOUT_MS: "10001" }],
  ])("BDD-ATT-AV-025 rejects %s", (_name, override) => {
    expect(() => parseClamAvHttpScannerConfig({ ...valid, ...override })).toThrow(
      "CLAMAV_SCANNER_CONFIG_INVALID",
    );
  });
});
