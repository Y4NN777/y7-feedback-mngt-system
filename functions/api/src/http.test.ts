import { describe, expect, it, vi } from "vitest";

import { routeRequest, type FunctionContext } from "./http";
import type { PublicApi } from "./public-api";

const correlationId = "018f4f7e-89ab-7def-8123-456789abcdef";
const dependencies = {
  createCorrelationId: () => correlationId,
  environment: "preview" as const,
  now: () => 104,
  release: "commit-123",
  startedAt: () => 100,
};

function createContext(
  method: string,
  path: string,
  request: Partial<FunctionContext["req"]> = {},
) {
  const json = vi.fn();
  const context: FunctionContext = {
    req: { method, path, ...request },
    res: { json },
    log: vi.fn(),
    error: vi.fn(),
  };

  return { context, json };
}

describe("trusted API entrypoint", () => {
  it("BDD-API-001 returns a non-cacheable health response", async () => {
    const { context, json } = createContext("GET", "/health");

    await routeRequest(context, dependencies);

    expect(json).toHaveBeenCalledOnce();
    expect(json).toHaveBeenCalledWith({ status: "ok" }, 200, {
      "cache-control": "no-store",
      "x-correlation-id": correlationId,
    });
    expect(context.log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "api.request.completed",
        correlationId,
        environment: "preview",
        release: "commit-123",
        operation: "health",
        outcome: "success",
        statusCode: 200,
        durationMs: 4,
      }),
    );
  });

  it("BDD-API-002 fails closed for an unknown operation", async () => {
    const { context, json } = createContext("POST", "/unknown");

    await routeRequest(context, dependencies);

    expect(json).toHaveBeenCalledOnce();
    expect(json).toHaveBeenCalledWith({ error: "not_found" }, 404, {
      "cache-control": "no-store",
      "x-correlation-id": correlationId,
    });
    expect(context.log).toHaveBeenCalledWith(expect.not.stringContaining("/unknown"));
  });

  it("BDD-API-003 delegates safe request fields to the public capability", async () => {
    const body = { clientOperationId: "operation" };
    const handle = vi.fn(() =>
      Promise.resolve({ statusCode: 201, body: { status: "accepted" } }),
    );
    const publicApi: PublicApi = {
      handle,
    };
    const { context, json } = createContext("POST", "/v1/projects/wisemoney/feedback", {
      headers: { Authorization: "FeedbackProof secret-proof" },
      bodyJson: body,
    });

    await routeRequest(context, { ...dependencies, publicApi });

    expect(handle).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/projects/wisemoney/feedback",
      headers: { Authorization: "FeedbackProof secret-proof" },
      body,
    });
    expect(json).toHaveBeenCalledWith({ status: "accepted" }, 201, {
      "cache-control": "no-store",
      "x-correlation-id": correlationId,
    });
    const event = vi.mocked(context.log).mock.calls[0]?.[0] ?? "";
    expect(event).toContain('"operation":"public_api"');
    expect(event).not.toContain("wisemoney");
    expect(event).not.toContain("secret-proof");
  });

  it("records a rejected public outcome without requiring headers", async () => {
    const publicApi: PublicApi = {
      handle: () =>
        Promise.resolve({
          statusCode: 400,
          body: { error: "ERR-INTAKE-INVALID" },
        }),
    };
    const { context, json } = createContext("POST", "/v1/public");

    await routeRequest(context, { ...dependencies, publicApi });

    expect(json).toHaveBeenCalledWith(
      { error: "ERR-INTAKE-INVALID" },
      400,
      expect.any(Object),
    );
    expect(context.log).toHaveBeenCalledWith(
      expect.stringContaining('"outcome":"rejected"'),
    );
  });
});
