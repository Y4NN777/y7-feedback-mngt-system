import { describe, expect, it, vi } from "vitest";

import { planAuthoritativeCommit } from "@y7-feedback/domain";

import { createNodeAppwriteConversationPendingCommitReader } from "./appwrite-conversation-pending-commits.js";

const commit = planAuthoritativeCommit(
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
    sealedPayload: "sealed_payload",
    acceptedAt: "2026-09-13T04:30:00.000Z",
  },
  () => "commit_a",
);

describe("ADR-015 pending conversation commit reads", () => {
  it("BDD-SLO-507 loads only ordered unprojected conversation authority", async () => {
    const listRows = vi.fn(() =>
      Promise.resolve({ rows: [{ $id: commit.id, ...commit }] }),
    );
    const reader = createNodeAppwriteConversationPendingCommitReader(
      { listRows } as never,
      { databaseId: "primary", authoritativeCommitsTableId: "commits" },
    );

    await expect(reader.list("feedback_1")).resolves.toEqual([commit]);
    expect(listRows).toHaveBeenCalledWith(
      expect.objectContaining({ databaseId: "primary", tableId: "commits" }),
    );
  });

  it("BDD-SLO-508 rejects malformed pending authority", async () => {
    const reader = createNodeAppwriteConversationPendingCommitReader(
      { listRows: () => Promise.resolve({ rows: [{ $id: "commit_a" }] }) } as never,
      { databaseId: "primary", authoritativeCommitsTableId: "commits" },
    );

    await expect(reader.list("feedback_1")).rejects.toThrow(
      "AUTHORITATIVE_CONVERSATION_PENDING_INVALID",
    );
  });
});
