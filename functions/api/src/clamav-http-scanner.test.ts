import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createClamAvHttpScanner } from "./clamav-http-scanner.js";

const bytes = new TextEncoder().encode("attachment bytes");
const key = Buffer.alloc(32, 7);

describe("ClamAV HTTP scanner", () => {
  it("BDD-ATT-AV-010 signs exact bytes and accepts a clean verdict", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      expect(url instanceof URL ? url.href : url).toBe(
        "https://scanner.example.test/v1/scan",
      );
      expect(init?.method).toBe("POST");
      expect(new Uint8Array(await new Response(init?.body).arrayBuffer())).toEqual(
        bytes,
      );
      const headers = new Headers(init?.headers);
      const digest = headers.get("x-y7-content-sha256");
      const timestamp = headers.get("x-y7-timestamp");
      const nonce = headers.get("x-y7-nonce");
      if (!digest || !timestamp || !nonce) throw new Error("signed headers missing");
      expect(headers.get("x-y7-key-id")).toBe("preview-v1");
      expect(timestamp).toBe("1787745600000");
      expect(nonce).toBe("nonce_1234567890");
      const canonical = `v1\nPOST\n/v1/scan\n${timestamp}\n${nonce}\n${digest}`;
      expect(headers.get("x-y7-signature")).toBe(
        createHmac("sha256", key).update(canonical).digest("base64url"),
      );
      return new Response(JSON.stringify({ status: "clean" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const scanner = createClamAvHttpScanner(
      {
        endpoint: "https://scanner.example.test",
        keyId: "preview-v1",
        hmacKey: key,
        timeoutMs: 4_000,
      },
      { fetch, nowMs: () => 1_787_745_600_000, createNonce: () => "nonce_1234567890" },
    );

    await expect(scanner.scan(bytes)).resolves.toBe("clean");
  });

  it.each([
    [{ status: "infected" }, "infected"],
    [{ status: "unknown" }, "unavailable"],
    [null, "unavailable"],
    [[], "unavailable"],
    ["clean", "unavailable"],
  ] as const)("maps the scanner verdict %#", async (body, expected) => {
    const scanner = createClamAvHttpScanner(
      {
        endpoint: "https://scanner.example.test/",
        keyId: "preview-v1",
        hmacKey: key,
        timeoutMs: 4_000,
      },
      {
        fetch: () =>
          Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
        nowMs: () => 1_787_745_600_000,
        createNonce: () => "nonce_1234567890",
      },
    );
    await expect(scanner.scan(bytes)).resolves.toBe(expected);
  });

  it.each([
    () => Promise.resolve(new Response("unavailable", { status: 503 })),
    () => Promise.resolve(new Response("not-json", { status: 200 })),
    () => Promise.reject(new Error("network unavailable")),
  ])("fails closed on transport or response failure %#", async (fetch) => {
    const scanner = createClamAvHttpScanner(
      {
        endpoint: "https://scanner.example.test",
        keyId: "preview-v1",
        hmacKey: key,
        timeoutMs: 4_000,
      },
      {
        fetch,
        nowMs: () => 1_787_745_600_000,
        createNonce: () => "nonce_1234567890",
      },
    );
    await expect(scanner.scan(bytes)).resolves.toBe("unavailable");
  });

  it("rejects invalid configuration before sending content", () => {
    expect(() =>
      createClamAvHttpScanner({
        endpoint: "http://scanner.example.test",
        keyId: "bad key",
        hmacKey: Buffer.alloc(31),
        timeoutMs: 0,
      }),
    ).toThrow("CLAMAV_SCANNER_CONFIG_INVALID");
  });

  it.each([
    "not-a-url",
    "ftp://scanner.example.test",
    "https://user@scanner.example.test",
    "https://scanner.example.test?query=yes",
    "https://scanner.example.test#fragment",
    "https://scanner.example.test/already/path",
  ])("rejects unsafe scanner endpoint %s", (endpoint) => {
    expect(() =>
      createClamAvHttpScanner({
        endpoint,
        keyId: "preview-v1",
        hmacKey: key,
        timeoutMs: 4_000,
      }),
    ).toThrow("CLAMAV_SCANNER_CONFIG_INVALID");
  });

  it.each([
    { keyId: "bad key", hmacKey: key, timeoutMs: 4_000 },
    { keyId: "preview-v1", hmacKey: Buffer.alloc(31), timeoutMs: 4_000 },
    { keyId: "preview-v1", hmacKey: key, timeoutMs: 1.5 },
    { keyId: "preview-v1", hmacKey: key, timeoutMs: 0 },
    { keyId: "preview-v1", hmacKey: key, timeoutMs: 10_001 },
  ])("rejects invalid scanner authority %#", (override) => {
    expect(() =>
      createClamAvHttpScanner({
        endpoint: "https://scanner.example.test",
        ...override,
      }),
    ).toThrow("CLAMAV_SCANNER_CONFIG_INVALID");
  });

  it("fails closed when the nonce source violates its contract", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const scanner = createClamAvHttpScanner(
      {
        endpoint: "https://scanner.example.test",
        keyId: "preview-v1",
        hmacKey: key,
        timeoutMs: 4_000,
      },
      { fetch, nowMs: () => 1_787_745_600_000, createNonce: () => "short" },
    );
    await expect(scanner.scan(bytes)).resolves.toBe("unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses secure default clock, nonce, and fetch dependencies", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "clean" }), { status: 200 }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      const scanner = createClamAvHttpScanner({
        endpoint: "https://scanner.example.test",
        keyId: "preview-v1",
        hmacKey: key,
        timeoutMs: 4_000,
      });
      await expect(scanner.scan(bytes)).resolves.toBe("clean");
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
