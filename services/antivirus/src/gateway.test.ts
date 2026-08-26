import { createHash, createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createScanGateway, type ScanRequest } from "./gateway.js";

const key = Buffer.alloc(32, 9);
const now = 1_787_745_600_000;
const body = new TextEncoder().encode("probe bytes");

function request(overrides: Partial<ScanRequest> = {}): ScanRequest {
  const timestamp = String(now);
  const nonce = "nonce_1234567890";
  const digest = createHash("sha256").update(body).digest("base64url");
  const canonical = `v1\nPOST\n/v1/scan\n${timestamp}\n${nonce}\n${digest}`;
  return {
    method: "POST",
    path: "/v1/scan",
    body,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(body.byteLength),
      "x-y7-key-id": "preview-v1",
      "x-y7-timestamp": timestamp,
      "x-y7-nonce": nonce,
      "x-y7-content-sha256": digest,
      "x-y7-signature": createHmac("sha256", key).update(canonical).digest("base64url"),
    },
    ...overrides,
  };
}

describe("private antivirus gateway", () => {
  it.each(["clean", "infected"] as const)(
    "BDD-ATT-AV-020 returns the exact ClamAV %s verdict",
    async (verdict) => {
      const scan = vi.fn(() => Promise.resolve(verdict));
      const gateway = createScanGateway(
        { keyId: "preview-v1", hmacKey: key, maximumBytes: 10 * 1024 * 1024 },
        { nowMs: () => now, scan },
      );
      await expect(gateway(request())).resolves.toEqual({
        status: 200,
        body: { status: verdict },
      });
      expect(scan).toHaveBeenCalledWith(body);
    },
  );

  it("BDD-ATT-AV-021 rejects replay before scanning", async () => {
    const scan = vi.fn(() => Promise.resolve<"clean">("clean"));
    const gateway = createScanGateway(
      { keyId: "preview-v1", hmacKey: key, maximumBytes: 10 * 1024 * 1024 },
      { nowMs: () => now, scan },
    );
    await expect(gateway(request())).resolves.toMatchObject({ status: 200 });
    await expect(gateway(request())).resolves.toEqual({
      status: 401,
      body: { error: "SCAN_DENIED" },
    });
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it.each([
    { headers: {} },
    { headers: { ...request().headers, "x-y7-signature": "invalid" } },
    { headers: { ...request().headers, "x-y7-timestamp": String(now - 61_000) } },
    { headers: { ...request().headers, "x-y7-content-sha256": "invalid" } },
    { headers: { ...request().headers, "content-type": "text/plain" } },
    { headers: { ...request().headers, "content-length": "999" } },
    { headers: { ...request().headers, "x-y7-key-id": "unknown" } },
    { headers: { ...request().headers, "x-y7-nonce": "short" } },
    { method: "GET" },
    { path: "/health" },
    { body: new TextEncoder().encode("other bytes") },
    { body: new Uint8Array(10 * 1024 * 1024 + 1) },
  ])("BDD-ATT-AV-022 denies malformed authority or input %#", async (override) => {
    const scan = vi.fn(() => Promise.resolve<"clean">("clean"));
    const gateway = createScanGateway(
      { keyId: "preview-v1", hmacKey: key, maximumBytes: 10 * 1024 * 1024 },
      { nowMs: () => now, scan },
    );
    await expect(gateway(request(override))).resolves.toMatchObject({ status: 401 });
    expect(scan).not.toHaveBeenCalled();
  });

  it("BDD-ATT-AV-023 maps daemon failure to unavailable without detail", async () => {
    const gateway = createScanGateway(
      { keyId: "preview-v1", hmacKey: key, maximumBytes: 10 * 1024 * 1024 },
      { nowMs: () => now, scan: () => Promise.resolve("unavailable") },
    );
    await expect(gateway(request())).resolves.toEqual({
      status: 503,
      body: { error: "SCAN_UNAVAILABLE" },
    });
  });

  it("maps a thrown daemon failure to the same unavailable response", async () => {
    const gateway = createScanGateway(
      { keyId: "preview-v1", hmacKey: key, maximumBytes: 10 * 1024 * 1024 },
      { nowMs: () => now, scan: () => Promise.reject(new Error("daemon detail")) },
    );
    await expect(gateway(request())).resolves.toEqual({
      status: 503,
      body: { error: "SCAN_UNAVAILABLE" },
    });
  });

  it("rejects invalid gateway configuration", () => {
    expect(() =>
      createScanGateway(
        { keyId: "bad key", hmacKey: Buffer.alloc(31), maximumBytes: 0 },
        { nowMs: () => now, scan: () => Promise.resolve("clean") },
      ),
    ).toThrow("SCAN_GATEWAY_CONFIG_INVALID");
  });
});
