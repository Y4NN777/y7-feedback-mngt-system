import { describe, expect, it, vi } from "vitest";

import { createIntelligenceHttp } from "./intelligence-http";

function request(
  overrides: Partial<
    Parameters<ReturnType<typeof createIntelligenceHttp>["handle"]>[0]
  > = {},
) {
  return {
    method: "POST",
    path: "/v1/workspaces/workspace_1/projects/project_1/intelligence",
    headers: { authorization: "Bearer jwt_1" },
    body: { filter: {}, pageSize: 25 },
    ...overrides,
  };
}

describe("intelligence HTTP boundary", () => {
  it("BDD-INT-206 forwards a validated scoped request without trusting identity headers", async () => {
    const analyze = vi.fn().mockResolvedValue({
      status: "ok",
      result: { ids: [], nextCursor: null, aggregate: {}, trend: null },
    });
    const http = createIntelligenceHttp({ analyze });

    await expect(http.handle(request())).resolves.toEqual({
      statusCode: 200,
      body: {
        status: "ok",
        result: { ids: [], nextCursor: null, aggregate: {}, trend: null },
      },
    });
    expect(analyze).toHaveBeenCalledWith({
      jwt: "jwt_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      query: { filter: {}, pageSize: 25 },
    });
  });

  it("BDD-INT-207 denies missing bearer credentials and legacy identity headers indistinguishably", async () => {
    const analyze = vi.fn();
    const http = createIntelligenceHttp({ analyze });
    for (const candidate of [
      request({ headers: {} }),
      request({ headers: { Authorization: "Basic unsafe" } }),
      request({
        headers: {
          authorization: "Bearer jwt_1",
          "X-Appwrite-User-Id": "user_1",
        },
      }),
    ]) {
      await expect(http.handle(candidate)).resolves.toEqual({
        statusCode: 404,
        body: { error: "ERR-INTELLIGENCE-DENIED" },
      });
    }
    expect(analyze).not.toHaveBeenCalled();
  });

  it("BDD-INT-208 maps stable non-disclosing coordinator outcomes", async () => {
    const analyze = vi.fn();
    const http = createIntelligenceHttp({ analyze });
    for (const [status, expected] of [
      ["denied", [404, "ERR-INTELLIGENCE-DENIED"]],
      ["invalid", [400, "ERR-INTELLIGENCE-INVALID"]],
      ["retryable", [503, "ERR-INTELLIGENCE-RETRYABLE"]],
    ] as const) {
      analyze.mockResolvedValueOnce({ status });
      await expect(http.handle(request())).resolves.toEqual({
        statusCode: expected[0],
        body: { error: expected[1] },
      });
    }
  });

  it("BDD-INT-209 ignores unrelated paths and methods", async () => {
    const analyze = vi.fn();
    const http = createIntelligenceHttp({ analyze });
    for (const candidate of [
      request({ method: "GET" }),
      request({ path: "/v1/workspaces/bad id/projects/project_1/intelligence" }),
      request({ path: "/health" }),
    ]) {
      await expect(http.handle(candidate)).resolves.toBeUndefined();
    }
    expect(analyze).not.toHaveBeenCalled();
  });
});
