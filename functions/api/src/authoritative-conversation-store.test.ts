import { describe, expect, it, vi } from "vitest";

import type { AuthoritativeCommit } from "@y7-feedback/domain";

import type {
  ConversationLifecycleStoreInput,
  ConversationLifecycleStoreResult,
} from "./appwrite-conversation-lifecycle-store.js";
import { createAuthoritativeConversationStore } from "./authoritative-conversation-store.js";

const input: ConversationLifecycleStoreInput = {
  feedbackId: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  payloadDigest: "digest_0123456789abcdef",
  locale: "fr",
  command: {
    kind: "start_review",
    eventId: "event_1",
    actorId: "user_1",
    actorKind: "workspace",
    occurredAt: "2026-09-13T04:30:00.000Z",
    expectedVersion: 1,
    reason: "Triage",
  },
};

const result: ConversationLifecycleStoreResult & { readonly status: "applied" } = {
  status: "applied" as const,
  feedbackId: "feedback_1",
  action: "start_review" as const,
  state: "under_review" as const,
  version: 2,
};

function setup(status: "applied" | "replayed" = "applied") {
  const plan = vi.fn(() =>
    Promise.resolve({ result, workspaceId: "workspace_1", projectId: "project_1" }),
  );
  const seal = vi.fn(() => "sealed_payload");
  const open = vi.fn(() => ({ input, result }));
  const accept = vi.fn((commit: AuthoritativeCommit) =>
    Promise.resolve({ status, commit }),
  );
  const find = vi.fn(() => Promise.resolve<AuthoritativeCommit | null>(null));
  const store = createAuthoritativeConversationStore(
    "preview",
    { accept, find },
    { seal, open },
    { plan },
  );
  return { store, plan, seal, open, accept, find };
}

describe("ADR-015 authoritative conversation acceptance", () => {
  it("BDD-SLO-491 persists a validated command through one immutable commit", async () => {
    const target = setup();

    await expect(target.store.execute(input)).resolves.toEqual(result);
    const committed = target.accept.mock.calls[0]?.[0];
    expect(committed).toMatchObject({
      environment: "preview",
      aggregateKind: "conversation",
      aggregateId: "feedback_1",
      operationId: "event_1",
      commandKind: "conversation.start_review",
      workspaceId: "workspace_1",
      projectId: "project_1",
      actorKind: "user",
      actorId: "user_1",
      payloadDigest: "digest_0123456789abcdef",
      acceptedAt: "2026-09-13T04:30:00.000Z",
    });
    expect(target.plan).toHaveBeenCalledWith(input);
    expect(target.seal).toHaveBeenCalledWith(committed?.id, { input, result });
  });

  it("BDD-SLO-492 returns the original planned result on deterministic replay", async () => {
    const target = setup("replayed");
    target.find.mockResolvedValueOnce({
      id: "commit_existing",
      version: 1,
      environment: "preview",
      aggregateKind: "conversation",
      aggregateId: input.feedbackId,
      operationId: input.command.eventId,
      commandKind: `conversation.${input.command.kind}`,
      workspaceId: "workspace_1",
      projectId: "project_1",
      actorKind: "user",
      actorId: input.command.actorId,
      payloadDigest: input.payloadDigest,
      sealedPayload: "sealed",
      acceptedAt: input.command.occurredAt,
      projectionState: "pending",
      projectionAttempts: 0,
    });
    target.open.mockReturnValueOnce({
      input,
      result: { ...result, state: "resolved", version: 5 },
    });

    await expect(target.store.execute(input)).resolves.toEqual({
      ...result,
      status: "replayed",
      state: "resolved",
      version: 5,
    });
    expect(target.open).toHaveBeenCalledOnce();
    expect(target.plan).not.toHaveBeenCalled();
    expect(target.accept).not.toHaveBeenCalled();
  });

  it("BDD-SLO-493 keeps Reporter authority explicit in the commit", async () => {
    const target = setup();
    await target.store.execute({
      feedbackId: input.feedbackId,
      payloadDigest: input.payloadDigest,
      locale: input.locale,
      command: {
        kind: "append_message",
        eventId: "event_2",
        actorId: "reporter_1",
        actorKind: "reporter",
        occurredAt: "2026-09-13T04:31:00.000Z",
        audience: "reporter",
        content: "More details",
      },
    });

    expect(target.accept.mock.calls[0]?.[0]).toMatchObject({
      actorKind: "reporter",
      workspaceId: "workspace_1",
      projectId: "project_1",
    });
  });

  it("BDD-SLO-494 fails closed when persistence changes the commit identity", async () => {
    const target = setup();
    target.accept.mockImplementationOnce((commit) =>
      Promise.resolve({ status: "applied", commit: { ...commit, id: "commit_other" } }),
    );

    await expect(target.store.execute(input)).rejects.toThrow(
      "AUTHORITATIVE_CONVERSATION_COMMIT_INVALID",
    );
  });

  it("BDD-SLO-494A rejects conflicting reuse before preflight", async () => {
    const target = setup();
    target.find.mockResolvedValueOnce({
      id: "commit_existing",
      version: 1,
      environment: "preview",
      aggregateKind: "conversation",
      aggregateId: input.feedbackId,
      operationId: input.command.eventId,
      commandKind: `conversation.${input.command.kind}`,
      workspaceId: "workspace_1",
      projectId: "project_1",
      actorKind: "user",
      actorId: input.command.actorId,
      payloadDigest: "different_digest_1234",
      sealedPayload: "sealed",
      acceptedAt: input.command.occurredAt,
      projectionState: "pending",
      projectionAttempts: 0,
    });

    await expect(target.store.execute(input)).rejects.toThrow(
      "AUTHORITATIVE_COMMIT_CONFLICT",
    );
    expect(target.plan).not.toHaveBeenCalled();
  });

  it("BDD-SLO-494B resolves a concurrent duplicate from persisted authority", async () => {
    const target = setup("replayed");

    await expect(target.store.execute(input)).resolves.toEqual({
      ...result,
      status: "replayed",
    });
    expect(target.plan).toHaveBeenCalledOnce();
    expect(target.open).toHaveBeenCalledOnce();
  });

  it("BDD-SLO-494C serializes competing lifecycle commands at one expected version", async () => {
    const target = setup();

    await target.store.execute(input);
    await target.store.execute({
      ...input,
      payloadDigest: "different_digest_0123456789abcdef",
      command: { ...input.command, eventId: "competing_event" },
    });

    expect(target.accept.mock.calls[0]?.[0].id).toBe(
      target.accept.mock.calls[1]?.[0].id,
    );
  });
});
