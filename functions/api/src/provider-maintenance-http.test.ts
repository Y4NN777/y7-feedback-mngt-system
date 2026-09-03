import { describe, expect, it, vi } from "vitest";

import { createProviderMaintenanceHttp } from "./provider-maintenance-http.js";

const secret = "provider-trigger-secret-with-32-characters";

describe("Provider maintenance operational HTTP", () => {
  it("runs the complete maintenance cycle only for a server bearer", async () => {
    const runOnce = vi.fn(() => Promise.resolve({ processed: 4 }));
    const http = createProviderMaintenanceHttp({ runOnce }, secret);
    await expect(
      http.handle({
        method: "POST",
        path: "/operational/provider-maintenance",
        headers: { authorization: `Bearer ${secret}` },
        body: {},
      }),
    ).resolves.toEqual({ statusCode: 200, body: { processed: 4 } });
    expect(runOnce).toHaveBeenCalledOnce();
    await expect(
      http.handle({ method: "GET", path: "/other", headers: {}, body: {} }),
    ).resolves.toBeUndefined();
  });

  it.each([
    { method: "GET", headers: { authorization: `Bearer ${secret}` }, body: {} },
    { method: "POST", headers: {}, body: {} },
    { method: "POST", headers: { authorization: "Bearer wrong" }, body: {} },
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-appwrite-user-id": "user_1",
      },
      body: {},
    },
    { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: [] },
    {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body: { action: "run" },
    },
  ])("fails closed without disclosing the maintenance endpoint", async (request) => {
    const runOnce = vi.fn(() => Promise.resolve({}));
    const http = createProviderMaintenanceHttp({ runOnce }, secret);
    await expect(
      http.handle({
        ...request,
        path: "/operational/provider-maintenance",
      }),
    ).resolves.toEqual({
      statusCode: 404,
      body: { error: "ERR-PROVIDER-MAINTENANCE-DENIED" },
    });
    expect(runOnce).not.toHaveBeenCalled();
  });

  it("maps worker failures without leaking adapter detail and validates config", async () => {
    const http = createProviderMaintenanceHttp(
      { runOnce: () => Promise.reject(new Error("provider token")) },
      secret,
    );
    await expect(
      http.handle({
        method: "POST",
        path: "/operational/provider-maintenance",
        headers: { authorization: `Bearer ${secret}` },
        body: {},
      }),
    ).resolves.toEqual({
      statusCode: 503,
      body: { error: "ERR-PROVIDER-MAINTENANCE-RETRYABLE" },
    });
    expect(() => createProviderMaintenanceHttp({ runOnce: vi.fn() }, "short")).toThrow(
      "PROVIDER_MAINTENANCE_HTTP_CONFIG_INVALID",
    );
  });
});
