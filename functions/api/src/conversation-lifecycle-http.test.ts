import { describe, expect, it, vi } from "vitest";

import type { ConversationLifecycleCoordinator } from "./conversation-lifecycle";
import { createConversationLifecycleHttp } from "./conversation-lifecycle-http";

const workspacePath =
  "/v1/workspaces/workspace_1/projects/project_1/feedback/feedback_1/conversation/commands";
const reporterPath = "/v1/feedback/feedback_1/conversation/commands";
const command = { kind: "append_message", eventId: "message_1" };

function setup() {
  const executeWorkspace = vi.fn<ConversationLifecycleCoordinator["executeWorkspace"]>(
    () =>
      Promise.resolve({
        status: "ok",
        result: {
          status: "applied",
          feedbackId: "feedback_1",
          action: "append_message",
        },
      }),
  );
  const executeReporter = vi.fn<ConversationLifecycleCoordinator["executeReporter"]>(
    () =>
      Promise.resolve({
        status: "ok",
        result: {
          status: "replayed",
          feedbackId: "feedback_1",
          action: "append_message",
        },
      }),
  );
  return {
    executeWorkspace,
    executeReporter,
    http: createConversationLifecycleHttp({ executeWorkspace, executeReporter }),
  };
}

describe("Conversation and lifecycle HTTP boundary", () => {
  it("routes a bearer-authenticated Workspace command from path-derived scope", async () => {
    const target = setup();
    await expect(
      target.http.handle({
        method: "POST",
        path: workspacePath,
        headers: { Authorization: "Bearer valid.jwt.token" },
        body: { command },
      }),
    ).resolves.toEqual({
      statusCode: 201,
      body: {
        status: "applied",
        result: {
          status: "applied",
          feedbackId: "feedback_1",
          action: "append_message",
        },
      },
    });
    expect(target.executeWorkspace).toHaveBeenCalledWith({
      jwt: "valid.jwt.token",
      workspaceId: "workspace_1",
      projectId: "project_1",
      feedbackId: "feedback_1",
      command,
    });
  });

  it("routes Reporter commands only with independent FeedbackProof", async () => {
    const target = setup();
    await expect(
      target.http.handle({
        method: "POST",
        path: reporterPath,
        headers: { authorization: "FeedbackProof proof-value" },
        body: { reference: "Y7-2026-ABC", command },
      }),
    ).resolves.toEqual({
      statusCode: 200,
      body: {
        status: "replayed",
        result: {
          status: "replayed",
          feedbackId: "feedback_1",
          action: "append_message",
        },
      },
    });
    expect(target.executeReporter).toHaveBeenCalledWith({
      reference: "Y7-2026-ABC",
      proof: "proof-value",
      feedbackId: "feedback_1",
      command,
    });
  });

  it("returns indistinguishable denial before calling trusted commands", async () => {
    for (const request of [
      { method: "GET", path: workspacePath, headers: {}, body: { command } },
      { method: "POST", path: workspacePath, headers: {}, body: { command } },
      {
        method: "POST",
        path: workspacePath,
        headers: {
          authorization: "Bearer valid.jwt.token",
          "x-appwrite-user-id": "spoofed",
        },
        body: { command },
      },
      { method: "POST", path: workspacePath, headers: {}, body: null },
      { method: "POST", path: reporterPath, headers: {}, body: { command } },
      {
        method: "POST",
        path: reporterPath,
        headers: { authorization: "FeedbackProof proof" },
        body: { reference: "", command },
      },
    ]) {
      const target = setup();
      const response = await target.http.handle(request);
      if (request.method === "GET") expect(response).toBeUndefined();
      else
        expect(response).toEqual({
          statusCode: 404,
          body: { error: "ERR-CONV-DENIED" },
        });
      expect(target.executeWorkspace).not.toHaveBeenCalled();
      expect(target.executeReporter).not.toHaveBeenCalled();
    }
  });

  it("maps every stable application outcome without adapter detail", async () => {
    for (const [status, statusCode, error] of [
      ["invalid", 400, "ERR-CONV-INVALID"],
      ["denied", 404, "ERR-CONV-DENIED"],
      ["conflict", 409, "ERR-CONV-IDEMPOTENCY-CONFLICT"],
      ["stale", 409, "ERR-CONV-STALE"],
      ["retryable", 503, "ERR-CONV-RETRYABLE"],
    ] as const) {
      const target = setup();
      target.executeWorkspace.mockResolvedValueOnce({ status });
      await expect(
        target.http.handle({
          method: "POST",
          path: workspacePath,
          headers: { authorization: "Bearer valid.jwt.token" },
          body: { command },
        }),
      ).resolves.toEqual({ statusCode, body: { error } });
    }
    await expect(
      setup().http.handle({
        method: "POST",
        path: "/not-conversation",
        headers: {},
      }),
    ).resolves.toBeUndefined();
  });
});
