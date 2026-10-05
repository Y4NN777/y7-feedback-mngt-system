import { describe, expect, it, vi } from "vitest";

import { createPrivacyHttp } from "./privacy-http";

const command = {
  kind: "request_deletion",
  operationId: "operation_1",
  feedbackId: "feedback_1",
  reasonCode: "reporter_request",
};
const request = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  method: "POST",
  path: "/v1/workspaces/workspace_1/projects/project_1/privacy",
  headers: { authorization: "Bearer jwt_1" },
  body: { command },
  ...overrides,
});

describe("privacy HTTP boundary", () => {
  it("BDD-PRIV-031 forwards a JWT authority without trusting identity headers", async () => {
    const execute = vi.fn().mockResolvedValue({
      status: "ok",
      result: {
        disposition: "applied",
        feedbackId: "feedback_1",
        revision: 1,
        purgeEligibleAt: "2026-10-02T00:00:00.000Z",
      },
    });
    const http = createPrivacyHttp({ execute });
    await expect(http.handle(request())).resolves.toEqual({
      statusCode: 200,
      body: {
        status: "ok",
        result: {
          disposition: "applied",
          feedbackId: "feedback_1",
          revision: 1,
          purgeEligibleAt: "2026-10-02T00:00:00.000Z",
        },
      },
    });
    expect(execute).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      projectId: "project_1",
      authority: { kind: "principal", jwt: "jwt_1" },
      command,
    });
  });

  it("BDD-PRIV-032 accepts an Access Proof only in the protected request body", async () => {
    const execute = vi.fn().mockResolvedValue({ status: "denied" });
    const http = createPrivacyHttp({ execute });
    await expect(
      http.handle(
        request({
          headers: {},
          body: { reference: "reference_1", proof: "proof_1", command },
        }),
      ),
    ).resolves.toEqual({
      statusCode: 404,
      body: { error: "ERR-PRIVACY-DENIED" },
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: {
          kind: "access_proof",
          reference: "reference_1",
          proof: "proof_1",
        },
      }),
    );
  });

  it("BDD-PRIV-033 maps all stable privacy outcomes", async () => {
    const execute = vi.fn();
    const http = createPrivacyHttp({ execute });
    for (const [status, statusCode, error] of [
      ["invalid", 400, "ERR-PRIVACY-INVALID"],
      ["conflict", 409, "ERR-PRIVACY-CONFLICT"],
      ["expired", 410, "ERR-PRIVACY-EXPIRED"],
      ["retryable", 503, "ERR-PRIVACY-RETRYABLE"],
    ] as const) {
      execute.mockResolvedValueOnce({ status });
      await expect(http.handle(request())).resolves.toEqual({
        statusCode,
        body: { error },
      });
    }
  });

  it("BDD-PRIV-034 denies missing credentials, malformed bodies and legacy identity", async () => {
    const execute = vi.fn();
    const http = createPrivacyHttp({ execute });
    for (const candidate of [
      request({ headers: {}, body: { command } }),
      request({ body: null }),
      request({ headers: { "x-appwrite-user-id": "user_1" } }),
    ])
      await expect(http.handle(candidate)).resolves.toEqual({
        statusCode: 404,
        body: { error: "ERR-PRIVACY-DENIED" },
      });
    expect(execute).not.toHaveBeenCalled();
  });

  it("BDD-PRIV-035 ignores unrelated methods and paths", async () => {
    const execute = vi.fn();
    const http = createPrivacyHttp({ execute });
    for (const candidate of [request({ method: "GET" }), request({ path: "/health" })])
      await expect(http.handle(candidate)).resolves.toBeUndefined();
  });

  it("BDD-PRIV-045 exposes scope-derived privacy only to an Access Proof", async () => {
    const execute = vi.fn().mockResolvedValue({ status: "ok", result: {} });
    const http = createPrivacyHttp({ execute });
    await expect(
      http.handle(
        request({
          path: "/v1/feedback/privacy",
          headers: {},
          body: { reference: "reference_1", proof: "proof_1", command },
        }),
      ),
    ).resolves.toEqual({ statusCode: 200, body: { status: "ok", result: {} } });
    expect(execute).toHaveBeenCalledWith({
      authority: {
        kind: "access_proof",
        reference: "reference_1",
        proof: "proof_1",
      },
      command,
    });
    await expect(
      http.handle(
        request({
          path: "/v1/feedback/privacy",
          headers: { authorization: "Bearer jwt" },
        }),
      ),
    ).resolves.toEqual({
      statusCode: 404,
      body: { error: "ERR-PRIVACY-DENIED" },
    });
  });
});
