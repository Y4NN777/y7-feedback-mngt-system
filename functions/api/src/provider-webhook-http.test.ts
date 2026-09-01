import { describe, expect, it, vi } from "vitest";

import { createProviderWebhookHttp } from "./provider-webhook-http.js";

describe("provider webhook HTTP", () => {
  it.each([
    ["accepted", 202, { accepted: true }],
    ["duplicate", 202, { accepted: true }],
    ["invalid", 400, { error: "ERR-SYNC-WEBHOOK-INVALID" }],
    ["denied", 401, { error: "ERR-SYNC-WEBHOOK-DENIED" }],
    ["retryable", 503, { error: "ERR-SYNC-WEBHOOK-RETRYABLE" }],
  ] as const)(
    "BDD-SYNC-029 maps %s without disclosing authority",
    async (status, statusCode, body) => {
      const accept = vi.fn(() => Promise.resolve({ status }));
      const http = createProviderWebhookHttp({ accept });
      await expect(
        http.handle({
          method: "POST",
          path: "/providers/github/webhooks/connection_1",
          headers: { "x-github-event": "issues" },
          body: new TextEncoder().encode("{}"),
        }),
      ).resolves.toEqual({ statusCode, body });
      expect(accept).toHaveBeenCalledWith({
        provider: "github",
        connectionId: "connection_1",
        headers: { "x-github-event": "issues" },
        body: new TextEncoder().encode("{}"),
      });
    },
  );

  it("BDD-SYNC-030 ignores unrelated routes and rejects malformed webhook requests", async () => {
    const accept = vi.fn(() => Promise.resolve({ status: "accepted" as const }));
    const http = createProviderWebhookHttp({ accept });
    await expect(
      http.handle({ method: "POST", path: "/health", headers: {} }),
    ).resolves.toBeNull();
    await expect(
      http.handle({
        method: "GET",
        path: "/providers/gitlab/webhooks/connection_1",
        headers: {},
      }),
    ).resolves.toEqual({
      statusCode: 400,
      body: { error: "ERR-SYNC-WEBHOOK-INVALID" },
    });
    expect(accept).not.toHaveBeenCalled();
  });
});
