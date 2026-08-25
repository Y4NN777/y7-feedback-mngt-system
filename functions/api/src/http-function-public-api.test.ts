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

  it("BDD-ATT-DEPLOYED-006 accepts a bounded private binary download response", async () => {
    const bytes = new TextEncoder().encode("private evidence");
    const api = createHttpFunctionPublicApi({
      baseUrl: "https://preview.example.test",
      fetch: () =>
        Promise.resolve(
          new Response(bytes, {
            status: 200,
            headers: {
              "cache-control": "no-store",
              "content-disposition":
                "attachment; filename*=UTF-8''preuve%20%C3%A9pargne.txt",
              "content-length": String(bytes.byteLength),
              "content-type": "text/plain; charset=utf-8",
            },
          }),
        ),
    });

    await expect(
      api.handle({
        method: "POST",
        path: "/v1/feedback/attachments/download",
        headers: { authorization: "FeedbackProof private" },
        body: { reference: "Y7-2026-000001", attachmentId: "attachment-1" },
      }),
    ).resolves.toEqual({
      statusCode: 200,
      binary: {
        bytes,
        displayName: "preuve épargne.txt",
        mediaType: "text/plain; charset=utf-8",
      },
    });
  });

  it.each([
    {
      name: "malformed filename encoding",
      headers: {
        "cache-control": "no-store",
        "content-disposition": "attachment; filename*=UTF-8''%ZZ",
        "content-length": "1",
        "content-type": "text/plain; charset=utf-8",
      },
      body: new Uint8Array([1]),
      status: 200,
    },
    {
      name: "missing filename",
      headers: {
        "cache-control": "no-store",
        "content-disposition": "attachment",
        "content-length": "1",
        "content-type": "text/plain; charset=utf-8",
      },
      body: new Uint8Array([1]),
      status: 200,
    },
    {
      name: "wrong status",
      headers: {
        "cache-control": "no-store",
        "content-disposition": "attachment; filename*=UTF-8''evidence.txt",
        "content-length": "1",
        "content-type": "text/plain; charset=utf-8",
      },
      body: new Uint8Array([1]),
      status: 404,
    },
    {
      name: "cacheable response",
      headers: {
        "cache-control": "public",
        "content-disposition": "attachment; filename*=UTF-8''evidence.txt",
        "content-length": "1",
        "content-type": "text/plain; charset=utf-8",
      },
      body: new Uint8Array([1]),
      status: 200,
    },
    {
      name: "undeclared media type",
      headers: {
        "cache-control": "no-store",
        "content-disposition": "attachment; filename*=UTF-8''evidence.txt",
        "content-length": "1",
        "content-type": "application/octet-stream",
      },
      body: new Uint8Array([1]),
      status: 200,
    },
    {
      name: "missing media type",
      headers: {
        "cache-control": "no-store",
        "content-disposition": "attachment; filename*=UTF-8''evidence.txt",
        "content-length": "1",
      },
      body: new Uint8Array([1]),
      status: 200,
    },
    {
      name: "fractional length",
      headers: {
        "cache-control": "no-store",
        "content-disposition": "attachment; filename*=UTF-8''evidence.txt",
        "content-length": "1.5",
        "content-type": "text/plain; charset=utf-8",
      },
      body: new Uint8Array([1]),
      status: 200,
    },
    {
      name: "empty body",
      headers: {
        "cache-control": "no-store",
        "content-disposition": "attachment; filename*=UTF-8''evidence.txt",
        "content-length": "0",
        "content-type": "text/plain; charset=utf-8",
      },
      body: new Uint8Array(),
      status: 200,
    },
    {
      name: "oversized declaration",
      headers: {
        "cache-control": "no-store",
        "content-disposition": "attachment; filename*=UTF-8''evidence.txt",
        "content-length": String(10 * 1024 * 1024 + 1),
        "content-type": "text/plain; charset=utf-8",
      },
      body: new Uint8Array([1]),
      status: 200,
    },
    {
      name: "overlong filename",
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename*=UTF-8''${"a".repeat(256)}`,
        "content-length": "1",
        "content-type": "text/plain; charset=utf-8",
      },
      body: new Uint8Array([1]),
      status: 200,
    },
    {
      name: "unsafe filename",
      headers: {
        "cache-control": "no-store",
        "content-disposition": "attachment; filename*=UTF-8''folder%2Fevidence.txt",
        "content-length": "1",
        "content-type": "text/plain; charset=utf-8",
      },
      body: new Uint8Array([1]),
      status: 200,
    },
    {
      name: "control filename",
      headers: {
        "cache-control": "no-store",
        "content-disposition": "attachment; filename*=UTF-8''evidence%00.txt",
        "content-length": "1",
        "content-type": "text/plain; charset=utf-8",
      },
      body: new Uint8Array([1]),
      status: 200,
    },
    {
      name: "delete-control filename",
      headers: {
        "cache-control": "no-store",
        "content-disposition": "attachment; filename*=UTF-8''evidence%7F.txt",
        "content-length": "1",
        "content-type": "text/plain; charset=utf-8",
      },
      body: new Uint8Array([1]),
      status: 200,
    },
    {
      name: "length mismatch",
      headers: {
        "cache-control": "no-store",
        "content-disposition": "attachment; filename*=UTF-8''evidence.txt",
        "content-length": "2",
        "content-type": "text/plain; charset=utf-8",
      },
      body: new Uint8Array([1]),
      status: 200,
    },
  ])("rejects a $name binary response", async ({ body, headers, status }) => {
    const api = createHttpFunctionPublicApi({
      baseUrl: "https://preview.example.test",
      fetch: () => Promise.resolve(new Response(body, { status, headers })),
    });

    await expect(
      api.handle({
        method: "POST",
        path: "/v1/feedback/attachments/download",
        headers: {},
        body: {},
      }),
    ).rejects.toThrow("HTTP_FUNCTION_RESPONSE_INVALID");
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
