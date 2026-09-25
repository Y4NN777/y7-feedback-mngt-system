import { describe, expect, it, vi } from "vitest";

import {
  dispatchHttpRouteRegistry,
  emitHttpRouteResponse,
  type HttpRoute,
  type HttpRouteRequest,
} from "./http-route-registry";

const request: HttpRouteRequest = {
  method: "GET",
  path: "/v1/example",
  headers: {},
  query: {},
};

describe("HTTP domain route registry", () => {
  it("TASK-DX-004 preserves declared route precedence and stops after the first match", async () => {
    const skipped = vi.fn(() => Promise.resolve({ statusCode: 200, body: "late" }));
    const routes: readonly HttpRoute[] = [
      {
        operation: "source_connection",
        handle: () => Promise.resolve(undefined),
      },
      {
        operation: "workbench",
        handle: () => Promise.resolve({ statusCode: 202, body: { accepted: true } }),
      },
      { operation: "public_api", handle: skipped },
    ];

    await expect(dispatchHttpRouteRegistry(routes, request)).resolves.toEqual({
      operation: "workbench",
      response: { statusCode: 202, body: { accepted: true } },
    });
    expect(skipped).not.toHaveBeenCalled();
  });

  it("TASK-DX-004 returns no match when every domain declines the request", async () => {
    await expect(
      dispatchHttpRouteRegistry(
        [
          {
            operation: "public_api",
            handle: () => Promise.resolve(null),
          },
        ],
        request,
      ),
    ).resolves.toBeUndefined();
  });

  it("TASK-DX-004 emits binary responses and maps an unavailable binary runtime", () => {
    const binary = vi.fn();
    const json = vi.fn();
    const response = {
      statusCode: 200,
      body: null,
      binary: {
        bytes: new Uint8Array([1, 2, 3]),
        displayName: "preuve écran.png",
        mediaType: "image/png",
      },
    };
    emitHttpRouteResponse({ binary, json }, response, { "cache-control": "no-store" });
    expect(binary).toHaveBeenCalledWith(
      Buffer.from([1, 2, 3]),
      200,
      expect.objectContaining({
        "content-disposition": "attachment; filename*=UTF-8''preuve%20%C3%A9cran.png",
        "content-length": "3",
        "content-type": "image/png",
      }),
    );

    emitHttpRouteResponse({ json }, response, { "cache-control": "no-store" });
    expect(json).toHaveBeenCalledWith({ error: "ERR-ATTACHMENT-UNAVAILABLE" }, 503, {
      "cache-control": "no-store",
    });
  });
});
