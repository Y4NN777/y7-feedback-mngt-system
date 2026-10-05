import { describe, expect, it, vi } from "vitest";

import { createProviderIssueOutboxHttp } from "./provider-issue-outbox-http";

const secret = "trigger-secret-with-at-least-32-characters";

describe("Provider issue outbox operational HTTP", () => {
  it("BDD-ISSUE-OUTBOX-HTTP-001 runs one authenticated empty command", async () => {
    const runner = { runOnce: vi.fn().mockResolvedValue({ status: "delivered" }) };
    await expect(
      createProviderIssueOutboxHttp(runner, secret).handle({
        method: "POST",
        path: "/operational/provider-issue-outbox",
        headers: { authorization: `Bearer ${secret}` },
        body: {},
      }),
    ).resolves.toEqual({ statusCode: 200, body: { status: "delivered" } });
    expect(runner.runOnce).toHaveBeenCalledOnce();
  });

  it.each([
    { method: "GET", headers: { authorization: `Bearer ${secret}` }, body: {} },
    { method: "POST", headers: {}, body: {} },
    { method: "POST", headers: { authorization: "Basic wrong" }, body: {} },
    { method: "POST", headers: { authorization: "Bearer wrong" }, body: {} },
    {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "x-appwrite-user-id": "forged" },
      body: {},
    },
    { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: null },
    { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: [] },
    {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body: { extra: 1 },
    },
  ])("BDD-ISSUE-OUTBOX-HTTP-002 denies malformed authority %#", async (override) => {
    const runner = { runOnce: vi.fn() };
    await expect(
      createProviderIssueOutboxHttp(runner, secret).handle({
        path: "/operational/provider-issue-outbox",
        ...override,
      }),
    ).resolves.toEqual({
      statusCode: 404,
      body: { error: "ERR-PROVIDER-OUTBOX-DENIED" },
    });
    expect(runner.runOnce).not.toHaveBeenCalled();
  });

  it("BDD-ISSUE-OUTBOX-HTTP-003 maps private worker failure without disclosure", async () => {
    const runner = { runOnce: vi.fn().mockRejectedValue(new Error("private")) };
    await expect(
      createProviderIssueOutboxHttp(runner, secret).handle({
        method: "POST",
        path: "/operational/provider-issue-outbox",
        headers: { authorization: `Bearer ${secret}` },
        body: {},
      }),
    ).resolves.toEqual({
      statusCode: 503,
      body: { error: "ERR-PROVIDER-OUTBOX-RETRYABLE" },
    });
  });

  it("BDD-ISSUE-OUTBOX-HTTP-004 ignores unrelated paths and rejects weak config", async () => {
    const runner = { runOnce: vi.fn() };
    await expect(
      createProviderIssueOutboxHttp(runner, secret).handle({
        method: "POST",
        path: "/unrelated",
        headers: {},
        body: {},
      }),
    ).resolves.toBeUndefined();
    expect(() => createProviderIssueOutboxHttp(runner, "short")).toThrow(
      "PROVIDER_OUTBOX_HTTP_CONFIG_INVALID",
    );
    expect(() => createProviderIssueOutboxHttp(runner, "x".repeat(501))).toThrow(
      "PROVIDER_OUTBOX_HTTP_CONFIG_INVALID",
    );
  });
});
