import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";

import { probeAntivirusAuthority } from "./antivirus-authority-probe.mjs";

const authority = {
  endpoint: "https://scanner.preview.example",
  keyId: "preview_2026_09",
  hmacKey: randomBytes(32).toString("base64url"),
  timeoutMs: 4_000,
};

test("reports unavailable infrastructure before the evidence matrix starts", async () => {
  await assert.rejects(
    probeAntivirusAuthority(authority, {
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    }),
    /G5_PREVIEW_SCANNER_UNAVAILABLE/u,
  );
});

test("distinguishes a stale scanner key from a network failure", async () => {
  await assert.rejects(
    probeAntivirusAuthority(authority, {
      fetch: async (input) =>
        new Response(
          JSON.stringify(
            String(input).endsWith("/health") ? { status: "ok" } : { error: "denied" },
          ),
          {
            status: String(input).endsWith("/health") ? 200 : 401,
            headers: { "content-type": "application/json" },
          },
        ),
    }),
    /G5_PREVIEW_SCANNER_AUTHORITY_REJECTED/u,
  );
});

test("accepts a healthy scanner only after a signed clean verdict", async () => {
  let signedRequest;
  const result = await probeAntivirusAuthority(authority, {
    fetch: async (input, init) => {
      if (String(input).endsWith("/health"))
        return Response.json({ status: "ok", release: "a".repeat(40) });
      signedRequest = new Request(input, init);
      return Response.json({ status: "clean" });
    },
    nonce: () => "probe_nonce_123456",
    now: () => 1_788_777_600_000,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.release, "a".repeat(40));
  assert.equal(signedRequest.headers.get("x-y7-key-id"), authority.keyId);
  const digest = signedRequest.headers.get("x-y7-content-sha256");
  const canonical = `v1\nPOST\n/v1/scan\n1788777600000\nprobe_nonce_123456\n${digest}`;
  assert.equal(
    signedRequest.headers.get("x-y7-signature"),
    createHmac("sha256", Buffer.from(authority.hmacKey, "base64url"))
      .update(canonical)
      .digest("base64url"),
  );
});
