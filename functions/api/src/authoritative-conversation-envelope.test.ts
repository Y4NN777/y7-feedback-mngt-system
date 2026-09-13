import { describe, expect, it, vi } from "vitest";

import { planAuthoritativeCommit } from "@y7-feedback/domain";

import { createAuthoritativeConversationEnvelope } from "./authoritative-conversation-envelope.js";
import type { ConversationLifecycleStoreInput } from "./appwrite-conversation-lifecycle-store.js";

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
const result = {
  status: "applied" as const,
  feedbackId: "feedback_1",
  action: "start_review" as const,
  state: "under_review" as const,
  version: 2,
};

function setup() {
  const seal = vi.fn((_context, plaintext: string) => `sealed:${plaintext}`);
  const open = vi.fn((_context, payload: string) => payload.slice(7));
  return {
    envelope: createAuthoritativeConversationEnvelope(
      { environment: "preview", protector: { seal, open } },
      "authoritative_commits",
    ),
    seal,
    open,
  };
}

function commit(sealedPayload: string, overrides = {}) {
  return planAuthoritativeCommit(
    {
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
      sealedPayload,
      acceptedAt: "2026-09-13T04:30:00.000Z",
      ...overrides,
    },
    () => "commit_a",
  );
}

describe("ADR-015 authoritative conversation envelope", () => {
  it("BDD-SLO-495 seals and validates the complete accepted command", () => {
    const target = setup();
    const sealed = target.envelope.seal("commit_a", { input, result });

    expect(target.envelope.open(commit(sealed))).toEqual({ input, result });
    expect(target.seal).toHaveBeenCalledWith(
      {
        environment: "preview",
        tableId: "authoritative_commits",
        rowId: "commit_a",
        field: "sealedPayload",
      },
      expect.any(String),
    );
  });

  it("BDD-SLO-496 rejects malformed or cross-linked encrypted payloads", () => {
    const target = setup();
    expect(() => target.envelope.open(commit("sealed:not-json"))).toThrow(
      "AUTHORITATIVE_CONVERSATION_ENVELOPE_INVALID",
    );
    const sealed = target.envelope.seal("commit_a", { input, result });
    expect(() =>
      target.envelope.open(commit(sealed, { aggregateId: "feedback_other" })),
    ).toThrow("AUTHORITATIVE_CONVERSATION_ENVELOPE_INVALID");
  });
});
