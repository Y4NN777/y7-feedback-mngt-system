import { describe, expect, it, vi } from "vitest";

import { createHttpFunctionPublicApi } from "./http-function-public-api";

describe("direct Function-domain public API", () => {
  it("BDD-DOMAIN-001 forwards a JSON request and returns the typed response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "accepted" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const api = createHttpFunctionPublicApi({
      baseUrl: "https://preview.example.test",
      fetch,
    });

    const response = await api.handle({
      method: "POST",
      path: "/v1/projects/wisemoney/feedback",
      headers: { authorization: "FeedbackProof private", "x-safe": undefined },
      body: { clientOperationId: "operation-1" },
    });

    expect(response).toEqual({ statusCode: 201, body: { status: "accepted" } });
    expect(fetch).toHaveBeenCalledWith(
      "https://preview.example.test/v1/projects/wisemoney/feedback",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "FeedbackProof private",
          "content-type": "application/json",
        },
        body: JSON.stringify({ clientOperationId: "operation-1" }),
        redirect: "error",
      }),
    );
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("BDD-DOMAIN-002 sends an empty body without inventing content", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      ),
    );
    const api = createHttpFunctionPublicApi({
      baseUrl: "https://preview.example.test/",
      fetch,
    });

    await api.handle({ method: "GET", path: "/health", headers: {}, body: undefined });

    expect(fetch).toHaveBeenCalledWith(
      "https://preview.example.test/health",
      expect.objectContaining({ method: "GET", headers: {} }),
    );
  });

  it.each([
    "not a URL",
    "http://preview.example.test",
    "https://preview.example.test/path",
    "https://preview.example.test/?query=true",
    "https://preview.example.test/#fragment",
    "https://user:password@preview.example.test/",
  ])("BDD-DOMAIN-003 rejects an unsafe origin", (baseUrl) => {
    expect(() => createHttpFunctionPublicApi({ baseUrl, fetch: vi.fn() })).toThrow(
      "HTTP_FUNCTION_REQUEST_INVALID",
    );
  });

  it.each([
    ["TRACE", "/v1/feedback"],
    ["POST", "https://attacker.example/path"],
    ["POST", "/../admin"],
    ["POST", "/v1/feedback?private=true"],
  ])("BDD-DOMAIN-003 rejects an unsafe request", async (method, path) => {
    const fetch = vi.fn();
    const invoke = () =>
      createHttpFunctionPublicApi({
        baseUrl: "https://preview.example.test",
        fetch,
      }).handle({
        method,
        path,
        headers: {},
        body: undefined,
      });

    await expect(invoke()).rejects.toThrow("HTTP_FUNCTION_REQUEST_INVALID");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    new Response("not-json", {
      status: 502,
      headers: { "content-type": "text/plain" },
    }),
    new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    new Response("not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ])("BDD-DOMAIN-004 rejects an invalid response", async (result) => {
    const api = createHttpFunctionPublicApi({
      baseUrl: "https://preview.example.test",
      fetch: () => Promise.resolve(result),
    });

    await expect(
      api.handle({ method: "GET", path: "/health", headers: {}, body: undefined }),
    ).rejects.toThrow("HTTP_FUNCTION_RESPONSE_INVALID");
  });

  it("BDD-DOMAIN-004 reduces a network failure to a stable unavailable error", async () => {
    const api = createHttpFunctionPublicApi({
      baseUrl: "https://preview.example.test",
      fetch: () => Promise.reject(new Error("private network detail")),
      timeoutMs: 1,
    });

    await expect(
      api.handle({ method: "GET", path: "/health", headers: {}, body: undefined }),
    ).rejects.toThrow("HTTP_FUNCTION_UNAVAILABLE");
  });
});
