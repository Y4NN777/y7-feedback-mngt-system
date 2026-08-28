import { describe, expect, it, vi } from "vitest";

import type { AccountlessAccessCoordinator } from "./accountless-access";
import {
  AppwriteConversationLifecycleError,
  type ConversationLifecycleStore,
} from "./appwrite-conversation-lifecycle-store";
import type { WorkspaceCapabilityScopeResolver } from "./appwrite-workspace-capability-scope";
import { createConversationLifecycleCoordinator } from "./conversation-lifecycle";
import type { AppwritePrincipalVerifier } from "./workspace-attachment-download";

const message = {
  kind: "append_message",
  eventId: "message_1",
  audience: "reporter",
  content: "Version 2.1 is affected",
};
const context = {
  workspaceId: "workspace_1",
  projectId: "project_1",
  feedbackId: "feedback_1",
};

function setup() {
  const verify = vi.fn<AppwritePrincipalVerifier["verify"]>(() =>
    Promise.resolve({ status: "verified", principalId: "maintainer_1" }),
  );
  const resolve = vi.fn<WorkspaceCapabilityScopeResolver["resolve"]>(() =>
    Promise.resolve({
      status: "authorized",
      actor: {
        principalId: "maintainer_1",
        responsibility: "project_maintainer",
        workspaceIds: ["workspace_1"],
        projectIds: ["project_1"],
      },
      project: { id: "project_1", workspaceId: "workspace_1", active: true },
    }),
  );
  const authorize = vi.fn<AccountlessAccessCoordinator["authorize"]>(() =>
    Promise.resolve({ status: "ok", feedbackId: "feedback_1" }),
  );
  const execute = vi.fn<ConversationLifecycleStore["execute"]>((input) =>
    Promise.resolve({
      status: "applied",
      feedbackId: input.feedbackId,
      action: input.command.kind,
    }),
  );
  return {
    verify,
    resolve,
    authorize,
    execute,
    coordinator: createConversationLifecycleCoordinator(
      { verify },
      { resolve },
      { authorize } as unknown as AccountlessAccessCoordinator,
      { execute },
      {
        digest: (value) => `digest:${JSON.stringify(value)}`,
        now: () => "2026-08-28T12:00:00.000Z",
        reporterActorId: () => "reporter_1",
      },
    ),
  };
}

describe("trusted Conversation and lifecycle orchestration", () => {
  it("BDD-CONV-001 derives Workspace actor and Project scope before commit", async () => {
    const target = setup();
    await expect(
      target.coordinator.executeWorkspace({
        ...context,
        jwt: "valid.jwt.token",
        command: message,
      }),
    ).resolves.toMatchObject({ status: "ok" });
    expect(target.resolve).toHaveBeenCalledWith({
      principalId: "maintainer_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      capability: "feedback.write",
    });
    const committed = target.execute.mock.calls[0]?.[0];
    expect(committed?.workspaceId).toBe("workspace_1");
    expect(committed?.projectId).toBe("project_1");
    expect(committed?.feedbackId).toBe("feedback_1");
    expect(committed?.command.actorId).toBe("maintainer_1");
    expect(committed?.command.actorKind).toBe("workspace");
    expect(committed?.command.occurredAt).toBe("2026-08-28T12:00:00.000Z");
  });

  it("BDD-CONV-REPORTER-001 requires proof and binds it to the exact Feedback", async () => {
    const target = setup();
    await expect(
      target.coordinator.executeReporter({
        ...context,
        reference: "Y7-2026-ABC",
        proof: "proof",
        command: message,
      }),
    ).resolves.toMatchObject({ status: "ok" });
    expect(target.authorize).toHaveBeenCalledWith({
      reference: "Y7-2026-ABC",
      proof: "proof",
    });
    const command = target.execute.mock.calls[0]?.[0].command;
    expect(command).toMatchObject({
      actorId: "reporter_1",
      actorKind: "reporter",
      audience: "reporter",
    });

    target.authorize.mockResolvedValueOnce({ status: "ok", feedbackId: "other" });
    await expect(
      target.coordinator.executeReporter({
        ...context,
        reference: "Y7-2026-ABC",
        proof: "proof",
        command: message,
      }),
    ).resolves.toEqual({ status: "denied" });
  });

  it("denies actor-incompatible commands and validates every command family", async () => {
    const target = setup();
    for (const command of [
      null,
      {},
      { ...message, eventId: " " },
      { ...message, audience: "unknown" },
      { ...message, content: " " },
      { kind: "append_internal_note", eventId: "note_1", content: " " },
      { kind: "unknown", eventId: "event_1" },
      { kind: "resolve", eventId: "event_1", expectedVersion: 0, reason: "Done" },
      { kind: "resolve", eventId: "event_1", expectedVersion: 1, reason: " " },
    ]) {
      await expect(
        target.coordinator.executeWorkspace({
          ...context,
          jwt: "valid.jwt.token",
          command,
        }),
      ).resolves.toEqual({ status: "invalid" });
    }

    await expect(
      target.coordinator.executeReporter({
        ...context,
        reference: "ref",
        proof: "proof",
        command: null,
      }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      target.coordinator.executeWorkspace({
        ...context,
        jwt: "valid.jwt.token",
        command: {
          kind: "append_internal_note",
          eventId: "note_1",
          content: "Private workspace context",
        },
      }),
    ).resolves.toMatchObject({ status: "ok" });
    await expect(
      target.coordinator.executeWorkspace({
        ...context,
        jwt: "valid.jwt.token",
        command: {
          kind: "start_review",
          eventId: "event_1",
          expectedVersion: 1,
          reason: "Review started",
        },
      }),
    ).resolves.toMatchObject({ status: "ok" });
    await expect(
      target.coordinator.executeReporter({
        ...context,
        reference: "ref",
        proof: "proof",
        command: {
          kind: "reopen",
          eventId: "event_2",
          expectedVersion: 6,
          reason: "Still failing",
        },
      }),
    ).resolves.toMatchObject({ status: "ok" });

    await expect(
      target.coordinator.executeReporter({
        ...context,
        reference: "ref",
        proof: "proof",
        command: { ...message, audience: "workspace" },
      }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      target.coordinator.executeReporter({
        ...context,
        reference: "ref",
        proof: "proof",
        command: {
          kind: "append_internal_note",
          eventId: "note_1",
          content: "Private",
        },
      }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      target.coordinator.executeReporter({
        ...context,
        reference: "ref",
        proof: "proof",
        command: {
          kind: "resolve",
          eventId: "event_1",
          expectedVersion: 1,
          reason: "Done",
        },
      }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      target.coordinator.executeWorkspace({
        ...context,
        jwt: "valid.jwt.token",
        command: {
          kind: "reopen",
          eventId: "event_1",
          expectedVersion: 1,
          reason: "Still failing",
        },
      }),
    ).resolves.toEqual({ status: "denied" });
  });

  it("fails closed for authentication, authorization, proof and persistence outcomes", async () => {
    const target = setup();
    target.verify.mockResolvedValueOnce({ status: "denied" });
    await expect(
      target.coordinator.executeWorkspace({
        ...context,
        jwt: "bad",
        command: message,
      }),
    ).resolves.toEqual({ status: "denied" });
    target.resolve.mockResolvedValueOnce({ status: "retryable" });
    await expect(
      target.coordinator.executeWorkspace({
        ...context,
        jwt: "valid.jwt.token",
        command: message,
      }),
    ).resolves.toEqual({ status: "retryable" });
    target.authorize.mockResolvedValueOnce({
      status: "retryable",
      code: "ACCESS_UNAVAILABLE",
    });
    await expect(
      target.coordinator.executeReporter({
        ...context,
        reference: "ref",
        proof: "proof",
        command: message,
      }),
    ).resolves.toEqual({ status: "retryable" });
    target.authorize.mockResolvedValueOnce({
      status: "denied",
      code: "ACCESS_DENIED",
    });
    await expect(
      target.coordinator.executeReporter({
        ...context,
        reference: "ref",
        proof: "proof",
        command: message,
      }),
    ).resolves.toEqual({ status: "denied" });

    for (const [code, status] of [
      ["ERR-CONV-DENIED", "denied"],
      ["ERR-CONV-IDEMPOTENCY-CONFLICT", "conflict"],
      ["ERR-CONV-STALE", "stale"],
      ["ERR-CONV-INVALID", "invalid"],
      ["ERR-CONV-RETRYABLE", "retryable"],
    ] as const) {
      target.execute.mockRejectedValueOnce(
        new AppwriteConversationLifecycleError(code),
      );
      await expect(
        target.coordinator.executeWorkspace({
          ...context,
          jwt: "valid.jwt.token",
          command: message,
        }),
      ).resolves.toEqual({ status });
    }
    target.execute.mockRejectedValueOnce(new Error("adapter detail"));
    await expect(
      target.coordinator.executeWorkspace({
        ...context,
        jwt: "valid.jwt.token",
        command: message,
      }),
    ).resolves.toEqual({ status: "retryable" });
  });
});
