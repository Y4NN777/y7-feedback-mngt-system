import { describe, expect, it, vi } from "vitest";

import { createAppwriteFunctionPublicApi } from "./appwrite-function-public-api";

describe("public Appwrite Function execution adapter", () => {
  it("BDD-DEL-APPWRITE-011 transports a public request without API-key authority", async () => {
    const execute = vi.fn().mockResolvedValue({
      status: "completed",
      responseStatusCode: 201,
      responseBody: JSON.stringify({ status: "accepted" }),
    });
    const api = createAppwriteFunctionPublicApi({ execute });

    await expect(
      api.handle({
        method: "POST",
        path: "/v1/projects/wisemoney/feedback",
        headers: { "content-type": "application/json" },
        body: { clientOperationId: "operation" },
      }),
    ).resolves.toEqual({ statusCode: 201, body: { status: "accepted" } });
    expect(execute).toHaveBeenCalledWith({
      body: JSON.stringify({ clientOperationId: "operation" }),
      method: "POST",
      path: "/v1/projects/wisemoney/feedback",
      headers: { "content-type": "application/json" },
    });
  });

  it("BDD-DEL-APPWRITE-012 rejects failed, malformed, or out-of-contract executions", async () => {
    for (const execution of [
      { status: "failed", responseStatusCode: 500, responseBody: "{}" },
      { status: "completed", responseStatusCode: 99, responseBody: "{}" },
      { status: "completed", responseStatusCode: 200, responseBody: "not-json" },
      { status: "completed", responseStatusCode: 200, responseBody: "[]" },
    ]) {
      const api = createAppwriteFunctionPublicApi({
        execute: () => Promise.resolve(execution),
      });
      await expect(
        api.handle({ method: "GET", path: "/health", headers: {}, body: null }),
      ).rejects.toThrow("APPWRITE_FUNCTION_EXECUTION_INVALID");
    }
  });

  it("BDD-DEL-APPWRITE-013 fails closed for unsupported HTTP methods", async () => {
    const api = createAppwriteFunctionPublicApi({
      execute: vi.fn(),
    });

    await expect(
      api.handle({ method: "TRACE", path: "/health", headers: {}, body: null }),
    ).rejects.toThrow("APPWRITE_FUNCTION_METHOD_INVALID");
  });

  it("BDD-DEL-APPWRITE-014 transports an absent request body as empty text", async () => {
    const execute = vi.fn().mockResolvedValue({
      status: "completed",
      responseStatusCode: 200,
      responseBody: JSON.stringify({ status: "ok" }),
    });
    const api = createAppwriteFunctionPublicApi({ execute });

    await api.handle({ method: "GET", path: "/health", headers: {}, body: undefined });

    expect(execute).toHaveBeenCalledWith({
      body: "",
      method: "GET",
      path: "/health",
      headers: {},
    });
  });
});
