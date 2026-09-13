import { describe, expect, it, vi } from "vitest";

import type { AuthoritativeCommit } from "@y7-feedback/domain";

import {
  authoritativeProjectionErrorCode,
  createAuthoritativeConversationProjectionHandler,
} from "./authoritative-conversation-projector.js";
import type { ConversationLifecycleStoreInput } from "./appwrite-conversation-lifecycle-store.js";
import { createAuthoritativeProjectionRouter } from "./authoritative-projection-router.js";

const input = {
  feedbackId: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  payloadDigest: "digest_0123456789abcdef",
  locale: "fr",
  command: {
    kind: "append_message",
    eventId: "event_1",
    actorId: "user_1",
    actorKind: "workspace",
    occurredAt: "2026-09-13T04:30:00.000Z",
    audience: "reporter",
    content: "Question",
  },
} satisfies ConversationLifecycleStoreInput;
const result = {
  status: "applied" as const,
  feedbackId: "feedback_1",
  action: "append_message" as const,
};
const commit = {
  aggregateKind: "conversation",
  commandKind: "conversation.append_message",
} as AuthoritativeCommit;

describe("ADR-015 authoritative conversation projection", () => {
  it("keeps projection diagnostics bounded and non-sensitive", () => {
    expect(authoritativeProjectionErrorCode(new Error("ERR-CONV-STALE"))).toBe(
      "CONVERSATION_PROJECTION_STALE",
    );
    expect(
      authoritativeProjectionErrorCode(
        new Error("AUTHORITATIVE_CONVERSATION_ENVELOPE_INVALID"),
      ),
    ).toBe("AUTHORITATIVE_CONVERSATION_ENVELOPE_INVALID");
    expect(authoritativeProjectionErrorCode(new Error("private detail"))).toBe(
      "AUTHORITATIVE_PROJECTION_RETRYABLE",
    );
    expect(authoritativeProjectionErrorCode("private detail")).toBe(
      "AUTHORITATIVE_PROJECTION_RETRYABLE",
    );
  });
  it("BDD-SLO-497 projects the encrypted command through the normalized store", async () => {
    const execute = vi.fn(() => Promise.resolve(result));
    const project = createAuthoritativeConversationProjectionHandler(
      { open: () => ({ input, result }) },
      { execute },
    );

    await expect(project.project(commit)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith(input);
  });

  it("BDD-SLO-498 fails closed for unsupported or conflicting projections", async () => {
    const execute = vi.fn(() =>
      Promise.resolve({ ...result, action: "append_internal_note" as const }),
    );
    const project = createAuthoritativeConversationProjectionHandler(
      { open: () => ({ input, result }) },
      { execute },
    );

    await expect(
      project.project({ ...commit, aggregateKind: "feedback" }),
    ).rejects.toThrow("AUTHORITATIVE_CONVERSATION_COMMAND_UNSUPPORTED");
    await expect(project.project(commit)).rejects.toThrow(
      "AUTHORITATIVE_CONVERSATION_PROJECTION_CONFLICT",
    );
  });

  it("BDD-SLO-499 routes each aggregate to exactly one projector", async () => {
    const feedback = { project: vi.fn(() => Promise.resolve()) };
    const conversation = { project: vi.fn(() => Promise.resolve()) };
    const router = createAuthoritativeProjectionRouter({ feedback, conversation });

    await router.project({ ...commit, aggregateKind: "feedback" });
    await router.project(commit);
    expect(feedback.project).toHaveBeenCalledOnce();
    expect(conversation.project).toHaveBeenCalledOnce();
  });
});
