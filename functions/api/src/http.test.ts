import { describe, expect, it, vi } from "vitest";

import { routeRequest, type FunctionContext } from "./http";

const correlationId = "018f4f7e-89ab-7def-8123-456789abcdef";
const dependencies = {
  createCorrelationId: () => correlationId,
  environment: "preview" as const,
  now: () => 104,
  release: "commit-123",
  startedAt: () => 100,
};

function createContext(method: string, path: string) {
  const json = vi.fn();
  const context: FunctionContext = {
    req: { method, path },
    res: { json },
    log: vi.fn(),
    error: vi.fn(),
  };

  return { context, json };
}

describe("trusted API entrypoint", () => {
  it("BDD-API-001 returns a non-cacheable health response", () => {
    const { context, json } = createContext("GET", "/health");

    routeRequest(context, dependencies);

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

  it("BDD-API-002 fails closed for an unknown operation", () => {
    const { context, json } = createContext("POST", "/unknown");

    routeRequest(context, dependencies);

    expect(json).toHaveBeenCalledOnce();
    expect(json).toHaveBeenCalledWith({ error: "not_found" }, 404, {
      "cache-control": "no-store",
      "x-correlation-id": correlationId,
    });
    expect(context.log).toHaveBeenCalledWith(expect.not.stringContaining("/unknown"));
  });
});
