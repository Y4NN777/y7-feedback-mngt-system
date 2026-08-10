import { describe, expect, it, vi } from "vitest";

import { routeRequest, type FunctionContext } from "./http";

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

    routeRequest(context);

    expect(json).toHaveBeenCalledOnce();
    expect(json).toHaveBeenCalledWith({ status: "ok" }, 200, {
      "cache-control": "no-store",
    });
  });

  it("BDD-API-002 fails closed for an unknown operation", () => {
    const { context, json } = createContext("POST", "/unknown");

    routeRequest(context);

    expect(json).toHaveBeenCalledOnce();
    expect(json).toHaveBeenCalledWith({ error: "not_found" }, 404, {
      "cache-control": "no-store",
    });
  });
});
