import { describe, expect, it, vi } from "vitest";

import { createHttpPlatformAccessGateway } from "./PlatformAccessGateway";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Platform access HTTP gateway", () => {
  it("BDD-PLAT-220 sends a trusted command with a fresh Appwrite JWT", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        response({
          status: "ok",
          result: {
            disposition: "applied",
            grantId: "grant_1",
            state: "requested",
            revision: 0,
            content: {
              kind: "feedback",
              feedback: { feedbackId: "feedback_1" },
            },
          },
        }),
      ),
    );
    const gateway = createHttpPlatformAccessGateway(
      "https://api.example/",
      () => Promise.resolve("jwt_1"),
      fetcher,
    );
    const command = { kind: "request", grantId: "grant_1" };
    await expect(gateway.execute(command)).resolves.toEqual({
      status: "ok",
      result: {
        disposition: "applied",
        grantId: "grant_1",
        state: "requested",
        revision: 0,
        content: {
          kind: "feedback",
          feedback: { feedbackId: "feedback_1" },
        },
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example/v1/platform/exceptional-access/commands",
      {
        method: "POST",
        headers: {
          authorization: "Bearer jwt_1",
          "content-type": "application/json",
        },
        body: JSON.stringify(command),
      },
    );
  });

  it("BDD-PLAT-221 maps stable failures and rejects malformed success", async () => {
    for (const [error, expected] of [
      ["ERR-PLATFORM-ACCESS-INVALID", "invalid"],
      ["ERR-PLATFORM-ACCESS-DENIED", "denied"],
      ["ERR-PLATFORM-ACCESS-CONFLICT", "conflict"],
      ["ERR-PLATFORM-ACCESS-RETRYABLE", "retryable"],
    ] as const) {
      const gateway = createHttpPlatformAccessGateway(
        "https://api.example",
        () => Promise.resolve("jwt"),
        () => Promise.resolve(response({ error }, 400)),
      );
      await expect(gateway.execute({})).resolves.toEqual({ status: expected });
    }
    for (const body of [
      {},
      { status: "ok", result: [] },
      { status: "ok", result: { disposition: "other" } },
      {
        status: "ok",
        result: { disposition: "replayed", grantId: 1, state: "active", revision: 1 },
      },
      {
        status: "ok",
        result: {
          disposition: "replayed",
          grantId: "g",
          state: "active",
          revision: 1,
          content: { kind: "messages", feedbackId: "f", items: ["invalid"] },
        },
      },
      {
        status: "ok",
        result: { disposition: "replayed", grantId: "g", state: 1, revision: 1 },
      },
      {
        status: "ok",
        result: {
          disposition: "replayed",
          grantId: "g",
          state: "active",
          revision: 1.2,
        },
      },
    ]) {
      const gateway = createHttpPlatformAccessGateway(
        "https://api.example",
        () => Promise.resolve("jwt"),
        () => Promise.resolve(response(body)),
      );
      await expect(gateway.execute({})).resolves.toEqual({ status: "retryable" });
    }
  });

  it("BDD-PLAT-222 fails closed when session, network or JSON is unavailable", async () => {
    await expect(
      createHttpPlatformAccessGateway("https://api.example", () =>
        Promise.reject(new Error("session")),
      ).execute({}),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      createHttpPlatformAccessGateway(
        "https://api.example",
        () => Promise.resolve("jwt"),
        () => Promise.reject(new Error("network")),
      ).execute({}),
    ).resolves.toEqual({ status: "retryable" });
  });
});
