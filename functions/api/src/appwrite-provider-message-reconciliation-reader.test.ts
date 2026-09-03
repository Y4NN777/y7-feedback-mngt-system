import type { TablesDB } from "node-appwrite";
import { expect, it, vi } from "vitest";

import { createNodeAppwriteProviderMessageReconciliationReader } from "./appwrite-provider-message-reconciliation-reader";

const schema = {
  databaseId: "feedback",
  conversationMessagesTableId: "conversation_messages",
  externalIssueLinksTableId: "external_issue_links",
};

function row(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    $id: "pmsg_1",
    providerLinkId: "link_1",
    provider: "github",
    repositoryId: "repo_1",
    providerIssueId: "41",
    providerCommentId: "91",
    providerEventId: "delivery_1",
    providerUpdatedAt: "2026-09-02T04:00:00.000Z",
    providerAuthorEnvelope: JSON.stringify({ id: "7", login: "maintainer" }),
    revisionKind: "created",
    ...overrides,
  };
}

function target(rows: readonly unknown[]) {
  const tables = {
    listRows: vi.fn().mockResolvedValue({ rows }),
    getRow: vi.fn().mockResolvedValue({
      $id: "link_1",
      state: "active",
      provider: "github",
      repositoryId: "repo_1",
      providerIssueId: "41",
      connectionId: "connection_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
    }),
  };
  return createNodeAppwriteProviderMessageReconciliationReader(
    tables as unknown as TablesDB,
    schema,
    {
      environment: "preview",
      protector: { seal: () => "unused", open: (_context, value) => value },
    },
  );
}

it("BDD-SYNC-READER-001 returns only the latest active non-tombstoned provider comment", async () => {
  const reader = target([
    row(),
    row({ $id: "pmsg_older", providerUpdatedAt: "2026-09-02T03:00:00.000Z" }),
    row({ $id: "pmsg_deleted", providerCommentId: "92", revisionKind: "tombstoned" }),
  ]);
  await expect(reader.list()).resolves.toEqual([
    {
      observation: {
        provider: "github",
        deliveryId: "delivery_1",
        connectionId: "connection_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        repositoryId: "repo_1",
        issueId: "41",
        commentId: "91",
        authorId: "7",
        authorLogin: "maintainer",
        mutation: "created",
        content: "reconciliation-placeholder",
        providerUpdatedAt: "2026-09-02T04:00:00.000Z",
      },
    },
  ]);
});

it("BDD-SYNC-READER-002 fails closed on corrupt encrypted author provenance", async () => {
  const reader = target([row({ providerAuthorEnvelope: "not-json" })]);
  await expect(reader.list()).rejects.toThrow(
    "PROVIDER_MESSAGE_RECONCILIATION_ROW_INVALID",
  );
});

it("BDD-SYNC-READER-003 ignores malformed, inactive and unrelated rows", async () => {
  await expect(
    target([null, {}, row({ provider: "bitbucket" })]).list(),
  ).resolves.toEqual([]);
});
