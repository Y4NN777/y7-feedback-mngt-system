import { describe, expect, it, vi } from "vitest";

import type { AccountlessAccessCoordinator } from "./accountless-access";
import {
  AppwriteConversationProjectionError,
  type ConversationProjectionStore,
} from "./appwrite-conversation-projection-store";
import {
  AppwriteConversationLifecycleError,
  type ConversationLifecycleStore,
} from "./appwrite-conversation-lifecycle-store";
import type { WorkspaceCapabilityScopeResolver } from "./appwrite-workspace-capability-scope";
import {
  createConversationLifecycleCoordinator,
  type ConversationLifecycleDependencies,
} from "./conversation-lifecycle";
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
  const readWorkspace = vi.fn<ConversationProjectionStore["readWorkspace"]>(() =>
    Promise.resolve({
      feedbackId: "feedback_1",
      state: "under_review",
      messages: [],
      internalNotes: [],
      lifecycle: [],
    }),
  );
  const readReporter = vi.fn<ConversationProjectionStore["readReporter"]>(() =>
    Promise.resolve({
      feedbackId: "feedback_1",
      state: "under_review",
      messages: [],
      lifecycle: [],
    }),
  );
  const notifyCommitted = vi.fn<
    NonNullable<ConversationLifecycleDependencies["notifyCommitted"]>
  >(() => Promise.resolve());
  return {
    verify,
    resolve,
    authorize,
    execute,
    readWorkspace,
    readReporter,
    notifyCommitted,
    coordinator: createConversationLifecycleCoordinator(
      { verify },
      { resolve },
      { authorize } as unknown as AccountlessAccessCoordinator,
      { execute },
      { readWorkspace, readReporter },
      {
        digest: (value) => `digest:${JSON.stringify(value)}`,
        now: () => "2026-08-28T12:00:00.000Z",
        reporterActorId: () => "reporter_1",
        notifyCommitted,
      },
    ),
  };
}

describe("trusted Conversation and lifecycle orchestration", () => {
  it("BDD-NOT-RECON-004 reconciles after commit without changing a committed fact", async () => {
    const target = setup();
    await expect(
      target.coordinator.executeWorkspace({
        ...context,
        jwt: "valid.jwt.token",
        command: message,
      }),
    ).resolves.toMatchObject({ status: "ok" });
    const notified = target.notifyCommitted.mock.calls[0]?.[0];
    expect(notified).toMatchObject({
      feedbackId: "feedback_1",
      actorId: "maintainer_1",
      actorKind: "workspace",
    });
    expect(notified?.command.eventId).toBe("message_1");

    target.notifyCommitted.mockRejectedValueOnce(new Error("delivery unavailable"));
    await expect(
      target.coordinator.executeWorkspace({
        ...context,
        jwt: "valid.jwt.token",
        command: { ...message, eventId: "message_2" },
      }),
    ).resolves.toMatchObject({ status: "ok" });
  });

  it("derives read scope and keeps Reporter projection proof-bound", async () => {
    const target = setup();
    await expect(
      target.coordinator.readWorkspace({
        ...context,
        jwt: "valid.jwt.token",
      }),
    ).resolves.toMatchObject({
      status: "ok",
      projection: { internalNotes: [] },
    });
    expect(target.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "feedback.read" }),
    );

    await expect(
      target.coordinator.readReporter({
        feedbackId: "feedback_1",
        reference: "Y7-2026-ABC",
        proof: "proof",
      }),
    ).resolves.toEqual({
      status: "ok",
      projection: {
        feedbackId: "feedback_1",
        state: "under_review",
        messages: [],
        lifecycle: [],
      },
    });
    expect(target.readReporter).toHaveBeenCalledWith({
      feedbackId: "feedback_1",
    });
  });

  it("fails closed for read authentication, proof, scope and projection errors", async () => {
    const target = setup();
    target.verify.mockResolvedValueOnce({ status: "denied" });
    await expect(
      target.coordinator.readWorkspace({ ...context, jwt: "bad" }),
    ).resolves.toEqual({ status: "denied" });
    target.resolve.mockResolvedValueOnce({ status: "retryable" });
    await expect(
      target.coordinator.readWorkspace({ ...context, jwt: "valid.jwt.token" }),
    ).resolves.toEqual({ status: "retryable" });
    target.readWorkspace.mockRejectedValueOnce(
      new AppwriteConversationProjectionError("ERR-CONV-DENIED"),
    );
    await expect(
      target.coordinator.readWorkspace({ ...context, jwt: "valid.jwt.token" }),
    ).resolves.toEqual({ status: "denied" });
    target.readWorkspace.mockRejectedValueOnce(new Error("adapter"));
    await expect(
      target.coordinator.readWorkspace({ ...context, jwt: "valid.jwt.token" }),
    ).resolves.toEqual({ status: "retryable" });
    target.readWorkspace.mockRejectedValueOnce(
      new AppwriteConversationProjectionError("ERR-CONV-RETRYABLE"),
    );
    await expect(
      target.coordinator.readWorkspace({ ...context, jwt: "valid.jwt.token" }),
    ).resolves.toEqual({ status: "retryable" });

    target.authorize.mockResolvedValueOnce({
      status: "denied",
      code: "ACCESS_DENIED",
    });
    await expect(
      target.coordinator.readReporter({
        feedbackId: "feedback_1",
        reference: "ref",
        proof: "proof",
      }),
    ).resolves.toEqual({ status: "denied" });
    target.authorize.mockResolvedValueOnce({
      status: "retryable",
      code: "ACCESS_UNAVAILABLE",
    });
    await expect(
      target.coordinator.readReporter({
        feedbackId: "feedback_1",
        reference: "ref",
        proof: "proof",
      }),
    ).resolves.toEqual({ status: "retryable" });
    target.authorize.mockResolvedValueOnce({ status: "ok", feedbackId: "other" });
    await expect(
      target.coordinator.readReporter({
        feedbackId: "feedback_1",
        reference: "ref",
        proof: "proof",
      }),
    ).resolves.toEqual({ status: "denied" });
    target.readReporter.mockRejectedValueOnce(new Error("adapter"));
    await expect(
      target.coordinator.readReporter({
        feedbackId: "feedback_1",
        reference: "ref",
        proof: "proof",
      }),
    ).resolves.toEqual({ status: "retryable" });
    target.readReporter.mockRejectedValueOnce(
      new AppwriteConversationProjectionError("ERR-CONV-DENIED"),
    );
    await expect(
      target.coordinator.readReporter({
        feedbackId: "feedback_1",
        reference: "ref",
        proof: "proof",
      }),
    ).resolves.toEqual({ status: "denied" });
    target.readReporter.mockRejectedValueOnce(
      new AppwriteConversationProjectionError("ERR-CONV-RETRYABLE"),
    );
    await expect(
      target.coordinator.readReporter({
        feedbackId: "feedback_1",
        reference: "ref",
        proof: "proof",
      }),
    ).resolves.toEqual({ status: "retryable" });
  });
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

  it("keeps the idempotency digest stable when a response-loss retry gets a new server time", async () => {
    const target = setup();
    const now = vi
      .fn()
      .mockReturnValueOnce("2026-08-28T12:00:00.000Z")
      .mockReturnValueOnce("2026-08-28T12:01:00.000Z");
    const coordinator = createConversationLifecycleCoordinator(
      { verify: target.verify },
      { resolve: target.resolve },
      { authorize: target.authorize } as unknown as AccountlessAccessCoordinator,
      { execute: target.execute },
      { readWorkspace: target.readWorkspace, readReporter: target.readReporter },
      {
        digest: (value) => `digest:${JSON.stringify(value)}`,
        now,
        reporterActorId: () => "reporter_1",
      },
    );
    const input = { ...context, jwt: "valid.jwt.token", command: message };
    await coordinator.executeWorkspace(input);
    await coordinator.executeWorkspace(input);
    const first = target.execute.mock.calls[0]?.[0];
    const second = target.execute.mock.calls[1]?.[0];
    expect(first?.command.occurredAt).not.toBe(second?.command.occurredAt);
    expect(first?.payloadDigest).toBe(second?.payloadDigest);
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
