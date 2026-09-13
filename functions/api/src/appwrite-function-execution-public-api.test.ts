import { describe, expect, it, vi } from "vitest";

import { createAppwriteFunctionExecutionPublicApi } from "./appwrite-function-execution-public-api";

function execution(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    $id: "execution_1",
    status: "completed",
    duration: 0.247,
    responseStatusCode: 200,
    responseBody: '{"status":"ok"}',
    ...overrides,
  };
}

describe("regional Appwrite Function execution transport", () => {
  it("BDD-SLO-511 measures server duration and deletes the credential-bearing execution", async () => {
    const createExecution = vi.fn().mockResolvedValue(execution());
    const deleteExecution = vi.fn().mockResolvedValue({});
    const api = createAppwriteFunctionExecutionPublicApi({
      functions: { createExecution, deleteExecution },
      functionId: "y7-feedback-api-preview",
    });

    await expect(
      api.handle({
        method: "POST",
        path: "/v1/feedback/feedback_1/conversation/commands",
        headers: { authorization: "FeedbackProof ephemeral-proof" },
        body: { command: { kind: "reopen" } },
      }),
    ).resolves.toEqual({
      statusCode: 200,
      body: { status: "ok" },
      operationalDurationMs: 247,
    });
    expect(createExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        functionId: "y7-feedback-api-preview",
        async: false,
        xpath: "/v1/feedback/feedback_1/conversation/commands",
        method: "POST",
        headers: {
          authorization: "FeedbackProof ephemeral-proof",
          "content-type": "application/json",
        },
      }),
    );
    expect(deleteExecution).toHaveBeenCalledWith({
      functionId: "y7-feedback-api-preview",
      executionId: "execution_1",
    });
  });

  it("BDD-SLO-512 deletes a completed execution even when its response is invalid", async () => {
    const createExecution = vi
      .fn()
      .mockResolvedValue(execution({ responseBody: "not-json" }));
    const deleteExecution = vi.fn().mockResolvedValue({});
    const api = createAppwriteFunctionExecutionPublicApi({
      functions: { createExecution, deleteExecution },
      functionId: "y7-feedback-api-preview",
    });

    await expect(
      api.handle({ method: "GET", path: "/health", headers: {}, body: undefined }),
    ).rejects.toThrow("APPWRITE_FUNCTION_EXECUTION_RESPONSE_INVALID");
    expect(deleteExecution).toHaveBeenCalledOnce();
  });

  it("treats an execution removed by Appwrite retention as already cleaned", async () => {
    const api = createAppwriteFunctionExecutionPublicApi({
      functions: {
        createExecution: vi.fn().mockResolvedValue(execution()),
        deleteExecution: vi.fn().mockRejectedValue({ code: 404 }),
      },
      functionId: "y7-feedback-api-preview",
    });

    await expect(
      api.handle({ method: "GET", path: "/health", headers: {}, body: undefined }),
    ).resolves.toMatchObject({ statusCode: 200 });
  });

  it("fails when execution cleanup cannot be proven", async () => {
    const api = createAppwriteFunctionExecutionPublicApi({
      functions: {
        createExecution: vi.fn().mockResolvedValue(execution()),
        deleteExecution: vi.fn().mockRejectedValue({ code: 500 }),
      },
      functionId: "y7-feedback-api-preview",
    });

    await expect(
      api.handle({ method: "GET", path: "/health", headers: {}, body: undefined }),
    ).rejects.toThrow("APPWRITE_FUNCTION_EXECUTION_CLEANUP_FAILED");
  });

  it("fails closed before execution on invalid authority, method, or path", async () => {
    const functions = {
      createExecution: vi.fn(),
      deleteExecution: vi.fn(),
    };
    expect(() =>
      createAppwriteFunctionExecutionPublicApi({ functions, functionId: "bad/id" }),
    ).toThrow("APPWRITE_FUNCTION_EXECUTION_CONFIGURATION_INVALID");
    const api = createAppwriteFunctionExecutionPublicApi({
      functions,
      functionId: "function_1",
    });
    await expect(
      api.handle({ method: "TRACE", path: "/health", headers: {}, body: undefined }),
    ).rejects.toThrow("APPWRITE_FUNCTION_EXECUTION_REQUEST_INVALID");
    await expect(
      api.handle({
        method: "GET",
        path: "/../health",
        headers: {},
        body: undefined,
      }),
    ).rejects.toThrow("APPWRITE_FUNCTION_EXECUTION_REQUEST_INVALID");
    await expect(
      api.handle({ method: "GET", path: "health", headers: {}, body: undefined }),
    ).rejects.toThrow("APPWRITE_FUNCTION_EXECUTION_REQUEST_INVALID");
    await expect(
      api.handle({ method: "GET", path: "//health", headers: {}, body: undefined }),
    ).rejects.toThrow("APPWRITE_FUNCTION_EXECUTION_REQUEST_INVALID");
    await expect(
      api.handle({ method: "GET", path: "/bad%20path", headers: {}, body: undefined }),
    ).rejects.toThrow("APPWRITE_FUNCTION_EXECUTION_REQUEST_INVALID");
    expect(functions.createExecution).not.toHaveBeenCalled();
  });

  it.each(["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])(
    "maps %s to the Appwrite execution method",
    async (method) => {
      const createExecution = vi.fn().mockResolvedValue(execution());
      const api = createAppwriteFunctionExecutionPublicApi({
        functions: {
          createExecution,
          deleteExecution: vi.fn().mockResolvedValue({}),
        },
        functionId: "function_1",
      });
      await api.handle({
        method,
        path: "/health?probe=regional",
        headers: { optional: undefined, "Content-Type": "application/custom" },
        body: { probe: true },
      });
      expect(createExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          method,
          xpath: "/health?probe=regional",
          headers: { "Content-Type": "application/custom" },
        }),
      );
    },
  );

  it.each([
    { status: "failed" },
    { duration: Number.NaN },
    { duration: -1 },
    { responseBody: "null" },
    { responseBody: "[]" },
    { responseBody: '"text"' },
  ])("rejects and cleans invalid execution result %#", async (override) => {
    const deleteExecution = vi.fn().mockResolvedValue({});
    const api = createAppwriteFunctionExecutionPublicApi({
      functions: {
        createExecution: vi.fn().mockResolvedValue(execution(override)),
        deleteExecution,
      },
      functionId: "function_1",
    });
    await expect(
      api.handle({ method: "GET", path: "/health", headers: {}, body: undefined }),
    ).rejects.toThrow("APPWRITE_FUNCTION_EXECUTION_RESPONSE_INVALID");
    expect(deleteExecution).toHaveBeenCalledOnce();
  });
});
