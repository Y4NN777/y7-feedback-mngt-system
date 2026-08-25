import { describe, expect, it, vi } from "vitest";

import type { WorkspaceCapabilityScopeResolver } from "./appwrite-workspace-capability-scope";
import type { AppwritePrincipalVerifier } from "./workspace-attachment-download";
import { createWorkspaceProjectOperations } from "./workspace-project-operations";

const request = {
  jwt: "header.payload.signature",
  workspaceId: "workspace-a",
  projectId: "project-a",
};

function setup(scopeStatus: "authorized" | "denied" | "retryable" = "authorized") {
  const principal = {
    verify: vi.fn<AppwritePrincipalVerifier["verify"]>(() =>
      Promise.resolve({ status: "verified" as const, principalId: "user-a" }),
    ),
  };
  const scope = {
    resolve: vi.fn<WorkspaceCapabilityScopeResolver["resolve"]>(() =>
      Promise.resolve(
        scopeStatus === "authorized"
          ? {
              status: "authorized" as const,
              actor: {
                principalId: "user-a",
                responsibility: "workspace_owner" as const,
                workspaceIds: ["workspace-a"],
                projectIds: [],
              },
              project: {
                id: "project-a",
                workspaceId: "workspace-a",
                active: true,
              },
            }
          : { status: scopeStatus },
      ),
    ),
  };
  const feedback = {
    create: vi.fn(() => Promise.resolve({ id: "feedback-a" })),
    read: vi.fn(() => Promise.resolve({ id: "feedback-a" })),
    update: vi.fn(() => Promise.resolve({ id: "feedback-a" })),
    delete: vi.fn(() => Promise.resolve()),
    search: vi.fn(() => Promise.resolve([{ id: "feedback-a" }])),
    aggregate: vi.fn(() => Promise.resolve({ count: 1 })),
  };
  const notifications = {
    list: vi.fn(() => Promise.resolve([{ id: "notification-a" }])),
  };
  const realtime = {
    authorize: vi.fn(() => Promise.resolve({ channel: "project-a" })),
  };
  return {
    operations: createWorkspaceProjectOperations(principal, scope, {
      feedback,
      notifications,
      realtime,
    }),
    principal,
    scope,
    feedback,
    notifications,
    realtime,
  };
}

describe("trusted Workspace Project operations", () => {
  it("BDD-OWN-FUNCTION-001 derives scope before every exact-scope operation", async () => {
    const target = setup();

    await expect(
      target.operations.createFeedback({ ...request, command: { type: "bug" } }),
    ).resolves.toMatchObject({ status: "ok" });
    await expect(
      target.operations.readFeedback({ ...request, feedbackId: "feedback-a" }),
    ).resolves.toMatchObject({ status: "ok" });
    await expect(
      target.operations.updateFeedback({
        ...request,
        feedbackId: "feedback-a",
        command: { state: "under_review" },
      }),
    ).resolves.toMatchObject({ status: "ok" });
    await expect(
      target.operations.deleteFeedback({ ...request, feedbackId: "feedback-a" }),
    ).resolves.toEqual({ status: "ok" });
    await expect(
      target.operations.searchFeedback({ ...request, query: "checkout" }),
    ).resolves.toMatchObject({ status: "ok" });
    await expect(target.operations.aggregateFeedback(request)).resolves.toMatchObject({
      status: "ok",
    });
    await expect(target.operations.listNotifications(request)).resolves.toMatchObject({
      status: "ok",
    });
    await expect(target.operations.authorizeRealtime(request)).resolves.toMatchObject({
      status: "ok",
    });

    expect(target.principal.verify).toHaveBeenCalledTimes(8);
    expect(target.scope.resolve).toHaveBeenCalledTimes(8);
    expect(target.scope.resolve.mock.calls.map(([input]) => input.capability)).toEqual([
      "feedback.write",
      "feedback.read",
      "feedback.write",
      "feedback.write",
      "feedback.search",
      "feedback.aggregate",
      "notification.read",
      "realtime.subscribe",
    ]);
  });

  it.each(["denied", "retryable"] as const)(
    "BDD-OWN-FUNCTION-002 returns %s without touching protected adapters",
    async (scopeStatus) => {
      const target = setup(scopeStatus);
      const outcomes = await Promise.all([
        target.operations.createFeedback({ ...request, command: { type: "bug" } }),
        target.operations.readFeedback({ ...request, feedbackId: "feedback-b" }),
        target.operations.updateFeedback({
          ...request,
          feedbackId: "feedback-b",
          command: { state: "closed" },
        }),
        target.operations.deleteFeedback({ ...request, feedbackId: "feedback-b" }),
        target.operations.searchFeedback({ ...request, query: "private" }),
        target.operations.aggregateFeedback(request),
        target.operations.listNotifications(request),
        target.operations.authorizeRealtime(request),
      ]);

      expect(outcomes).toEqual(
        Array.from({ length: 8 }, () => ({ status: scopeStatus })),
      );
      for (const operation of [
        ...Object.values(target.feedback),
        target.notifications.list,
        target.realtime.authorize,
      ]) {
        expect(operation).not.toHaveBeenCalled();
      }
    },
  );

  it("BDD-OWN-FUNCTION-004 denies a removed principal before scope or data access", async () => {
    const target = setup();
    target.principal.verify.mockResolvedValueOnce({ status: "denied" });

    await expect(target.operations.aggregateFeedback(request)).resolves.toEqual({
      status: "denied",
    });
    expect(target.scope.resolve).not.toHaveBeenCalled();
    expect(target.feedback.aggregate).not.toHaveBeenCalled();
  });

  it("BDD-OWN-FUNCTION-006 maps protected adapter failure to retryable without false success", async () => {
    const target = setup();
    target.feedback.update.mockRejectedValueOnce(
      new Error("private infrastructure detail"),
    );

    await expect(
      target.operations.updateFeedback({
        ...request,
        feedbackId: "feedback-a",
        command: { state: "closed" },
      }),
    ).resolves.toEqual({ status: "retryable" });
  });
});
