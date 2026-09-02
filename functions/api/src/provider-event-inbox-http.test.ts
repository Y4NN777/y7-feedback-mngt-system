import { describe, expect, it, vi } from "vitest";

import { createProviderEventInboxHttp } from "./provider-event-inbox-http.js";

const secret = "provider-inbox-trigger-secret-with-at-least-32-bytes";

describe("provider event inbox operational HTTP", () => {
  it("BDD-SYNC-051 runs one authorized empty-body cycle", async () => {
    const runOnce = vi.fn(() => Promise.resolve({ status: "completed" }));
    const http = createProviderEventInboxHttp({ runOnce }, secret);
    await expect(
      http.handle({
        method: "POST",
        path: "/operational/provider-event-inbox",
        headers: { authorization: `Bearer ${secret}` },
        body: {},
      }),
    ).resolves.toEqual({ statusCode: 200, body: { status: "completed" } });
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it.each([
    { method: "GET", headers: { authorization: `Bearer ${secret}` }, body: {} },
    { method: "POST", headers: {}, body: {} },
    { method: "POST", headers: { authorization: "Bearer wrong" }, body: {} },
    {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "x-appwrite-user-id": "user" },
      body: {},
    },
    { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: null },
    { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: [] },
    {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body: { extra: true },
    },
  ])("BDD-SYNC-052 hides unauthorized worker invocation %#", async (input) => {
    const runOnce = vi.fn(() => Promise.resolve({ status: "idle" }));
    const http = createProviderEventInboxHttp({ runOnce }, secret);
    await expect(
      http.handle({
        path: "/operational/provider-event-inbox",
        ...input,
      }),
    ).resolves.toEqual({
      statusCode: 404,
      body: { error: "ERR-PROVIDER-INBOX-DENIED" },
    });
    expect(runOnce).not.toHaveBeenCalled();
  });

  it("BDD-SYNC-053 maps worker outage and unrelated routes", async () => {
    const runOnce = vi.fn(() => Promise.reject(new Error("unavailable")));
    const http = createProviderEventInboxHttp({ runOnce }, secret);
    await expect(
      http.handle({ method: "POST", path: "/other", headers: {}, body: {} }),
    ).resolves.toBeUndefined();
    await expect(
      http.handle({
        method: "POST",
        path: "/operational/provider-event-inbox",
        headers: { authorization: `Bearer ${secret}` },
        body: {},
      }),
    ).resolves.toEqual({
      statusCode: 503,
      body: { error: "ERR-PROVIDER-INBOX-RETRYABLE" },
    });
  });

  it("BDD-SYNC-054 rejects unsafe trigger configuration", () => {
    expect(() => createProviderEventInboxHttp({ runOnce: vi.fn() }, "short")).toThrow(
      "PROVIDER_INBOX_HTTP_CONFIG_INVALID",
    );
    expect(() =>
      createProviderEventInboxHttp({ runOnce: vi.fn() }, "x".repeat(501)),
    ).toThrow("PROVIDER_INBOX_HTTP_CONFIG_INVALID");
  });
});
