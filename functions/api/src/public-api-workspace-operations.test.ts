import { describe, expect, it, vi } from "vitest";

import { createPublicApi } from "./public-api";
import type { WorkspaceProjectOperations } from "./workspace-project-operations";

const unavailable = () =>
  Promise.resolve({
    status: "retryable" as const,
    code: "ACCESS_UNAVAILABLE" as const,
  });

function setup(outcome: "ok" | "denied" | "retryable" = "ok") {
  const method = vi.fn(() =>
    Promise.resolve(
      outcome === "ok"
        ? { status: "ok" as const, data: { marker: "bounded" } }
        : { status: outcome },
    ),
  );
  const operations: WorkspaceProjectOperations = {
    createFeedback: method,
    readFeedback: method,
    updateFeedback: method,
    deleteFeedback: method,
    searchFeedback: method,
    aggregateFeedback: method,
    listNotifications: method,
    markNotificationRead: method,
    authorizeRealtime: method,
  };
  const api = createPublicApi(
    {
      findBySlug: () => Promise.resolve(null),
      resolve: () => Promise.resolve({ kind: "unavailable" }),
    },
    {
      accept: () =>
        Promise.resolve({
          status: "retryable" as const,
          code: "INTAKE_UNAVAILABLE" as const,
        }),
    },
    {
      retrieve: unavailable,
      authorize: unavailable,
      rotate: unavailable,
      revoke: unavailable,
      act: unavailable,
    },
    undefined,
    undefined,
    operations,
  );
  return { api, method };
}

const base = "/v1/workspaces/workspace-a/projects/project-a/operations";
const headers = { authorization: "Bearer header.payload.signature" };

describe("trusted Workspace operation HTTP boundary", () => {
  it.each([
    ["feedback/read", { feedbackId: "feedback-a" }],
    ["feedback/search", { query: "feedback" }],
    ["feedback/aggregate", {}],
    ["notifications/list", {}],
    [
      "notifications/read",
      {
        notificationId: "notification-a",
        readAt: "2026-08-28T12:00:00.000Z",
      },
    ],
    ["realtime/authorize", {}],
  ])(
    "BDD-OWN-FUNCTION-001 dispatches %s with bearer and route scope",
    async (path, body) => {
      const target = setup();
      await expect(
        target.api.handle({
          method: "POST",
          path: `${base}/${path}`,
          headers,
          body,
        }),
      ).resolves.toEqual({
        statusCode: 200,
        body: { status: "ok", data: { marker: "bounded" } },
      });
      expect(target.method).toHaveBeenCalledWith(
        expect.objectContaining({
          jwt: "header.payload.signature",
          workspaceId: "workspace-a",
          projectId: "project-a",
        }),
      );
    },
  );

  it.each([
    ["denied", 404, "ERR-WORKSPACE-DENIED"],
    ["retryable", 503, "ERR-WORKSPACE-UNAVAILABLE"],
  ] as const)(
    "BDD-OWN-FUNCTION-002 maps %s without disclosure",
    async (outcome, statusCode, error) => {
      const target = setup(outcome);
      await expect(
        target.api.handle({
          method: "POST",
          path: `${base}/feedback/read`,
          headers,
          body: { feedbackId: "feedback-b" },
        }),
      ).resolves.toEqual({ statusCode, body: { error } });
    },
  );

  it("BDD-OWN-FUNCTION-005 rejects missing bearer, forged principal header, and malformed action input", async () => {
    const target = setup();
    for (const request of [
      { headers: {}, body: { feedbackId: "feedback-a" } },
      {
        headers: { ...headers, "x-appwrite-user-id": "user-b" },
        body: { feedbackId: "feedback-a" },
      },
      { headers, body: { feedbackId: "bad/id" } },
    ]) {
      await expect(
        target.api.handle({
          method: "POST",
          path: `${base}/feedback/read`,
          ...request,
        }),
      ).resolves.toEqual({
        statusCode: 404,
        body: { error: "ERR-WORKSPACE-DENIED" },
      });
    }
    expect(target.method).not.toHaveBeenCalled();
  });

  it("does not expose raw persistence create, update, or delete commands", async () => {
    const target = setup();
    for (const path of ["feedback/create", "feedback/update", "feedback/delete"]) {
      await expect(
        target.api.handle({
          method: "POST",
          path: `${base}/${path}`,
          headers,
          body: { command: { internalNotesJson: "plaintext" } },
        }),
      ).resolves.toBeNull();
    }
    expect(target.method).not.toHaveBeenCalled();
  });

  it("returns a successful operation response without inventing result data", async () => {
    const target = setup();
    target.method.mockResolvedValueOnce({ status: "ok" } as never);
    await expect(
      target.api.handle({
        method: "POST",
        path: `${base}/realtime/authorize`,
        headers,
        body: {},
      }),
    ).resolves.toEqual({ statusCode: 200, body: { status: "ok" } });
  });

  it("fails closed when the operation body or dependency is unavailable", async () => {
    const target = setup();
    await expect(
      target.api.handle({
        method: "POST",
        path: `${base}/feedback/read`,
        headers,
        body: null,
      }),
    ).resolves.toEqual({
      statusCode: 404,
      body: { error: "ERR-WORKSPACE-DENIED" },
    });

    const withoutOperations = createPublicApi(
      {
        findBySlug: () => Promise.resolve(null),
        resolve: () => Promise.resolve({ kind: "unavailable" }),
      },
      {
        accept: () =>
          Promise.resolve({
            status: "retryable" as const,
            code: "INTAKE_UNAVAILABLE" as const,
          }),
      },
      {
        retrieve: unavailable,
        authorize: unavailable,
        rotate: unavailable,
        revoke: unavailable,
        act: unavailable,
      },
    );
    await expect(
      withoutOperations.handle({
        method: "POST",
        path: `${base}/feedback/read`,
        headers,
        body: { feedbackId: "feedback-a" },
      }),
    ).resolves.toEqual({
      statusCode: 503,
      body: { error: "ERR-WORKSPACE-UNAVAILABLE" },
    });
  });
});
