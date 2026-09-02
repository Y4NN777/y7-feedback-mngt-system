import { expect, it } from "vitest";

import { createAppwriteProviderMessageOutboxStore } from "./appwrite-provider-message-outbox-store";

const schema = {
  databaseId: "feedback",
  providerSyncOutboxTableId: "provider_sync_outbox",
  externalIssueLinksTableId: "external_issue_links",
  sourceConnectionsTableId: "source_connections",
};

class FakeTables {
  readonly updates: Array<Readonly<Record<string, unknown>>> = [];
  outbox: readonly unknown[] = [
    {
      $id: "outbox_1",
      operationId: "message_1",
      linkId: "link_1",
      feedbackId: "feedback_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      connectionId: "connection_1",
      provider: "github",
      repositoryId: "repo_1",
      kind: "publish_message",
      status: "pending",
      sequence: 1,
      attempts: 0,
      payloadEnvelope: JSON.stringify({
        kind: "publish_message",
        messageId: "message_1",
        issueId: "41",
        content: "Visible",
      }),
      payloadDigest: "digest",
      originMarker: "y7msg:message_1",
      createdAt: "2026-09-02T02:00:00.000Z",
      updatedAt: "2026-09-02T02:00:00.000Z",
    },
  ];
  readonly rows = new Map<string, unknown>([
    [
      "external_issue_links:link_1",
      {
        $id: "link_1",
        feedbackId: "feedback_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "connection_1",
        provider: "github",
        repositoryId: "repo_1",
        providerIssueId: "41",
        state: "active",
      },
    ],
    [
      "source_connections:connection_1",
      {
        $id: "connection_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        provider: "github",
        status: "active",
        encryptedGrantRef: "grant_1",
        selectedRepositoriesJson: JSON.stringify({
          kind: "selected",
          imports: [
            {
              connectionId: "connection_1",
              provider: "github",
              repositoryId: "repo_1",
              owner: "owner",
              name: "repo",
            },
          ],
        }),
      },
    ],
  ]);
  createTransaction() {
    return Promise.resolve({ $id: "transaction_1" });
  }
  updateTransaction() {
    return Promise.resolve({});
  }
  listRows() {
    return Promise.resolve({ rows: this.outbox });
  }
  getRow(input: { readonly tableId: string; readonly rowId: string }) {
    if (input.tableId === "provider_sync_outbox")
      return Promise.resolve(this.outbox[0]);
    const row = this.rows.get(`${input.tableId}:${input.rowId}`);
    return row ? Promise.resolve(row) : Promise.reject(new Error("missing"));
  }
  updateRow(input: Readonly<Record<string, unknown>>) {
    this.updates.push(input);
    return Promise.resolve({ $id: input.rowId });
  }
}

function target(tables = new FakeTables()) {
  return {
    tables,
    store: createAppwriteProviderMessageOutboxStore(
      tables,
      schema,
      {
        equal: (k, v) => `${k}=${v.join(",")}`,
        orderAsc: (k) => k,
        limit: (v) => String(v),
      },
      {
        environment: "preview",
        protector: { seal: () => "unused", open: (_c, value) => value },
      },
    ),
  };
}

function processingTarget() {
  const tables = new FakeTables();
  tables.outbox = [
    { ...(tables.outbox[0] as object), status: "processing", attempts: 1 },
  ];
  return target(tables);
}

it("BDD-SYNC-OUTBOX-001 claims and decrypts the oldest due publish operation", async () => {
  const x = target();
  await expect(
    x.store.claim({
      workerId: "preview-message-worker",
      now: "2026-09-02T02:01:00.000Z",
      staleBefore: "2026-09-02T01:56:00.000Z",
    }),
  ).resolves.toEqual({
    outboxId: "outbox_1",
    linkId: "link_1",
    operationId: "message_1",
    provider: "github",
    encryptedGrantRef: "grant_1",
    repository: { id: "repo_1", owner: "owner", name: "repo" },
    issueId: "41",
    attempt: 1,
    kind: "publish_message",
    content: "Visible",
  });
  expect(x.tables.updates[0]).toMatchObject({
    data: { status: "processing", attempts: 1 },
  });
});

it("BDD-SYNC-OUTBOX-002 claims consent-cleanup removal operations", async () => {
  const tables = new FakeTables();
  tables.outbox = [
    {
      ...(tables.outbox[0] as object),
      operationId: "cleanup_1",
      kind: "remove_message",
      payloadEnvelope: JSON.stringify({
        kind: "remove_message",
        issueId: "41",
        commentId: "91",
      }),
    },
  ];
  await expect(
    target(tables).store.claim({
      workerId: "preview-message-worker",
      now: "2026-09-02T02:01:00.000Z",
      staleBefore: "2026-09-02T01:56:00.000Z",
    }),
  ).resolves.toMatchObject({ kind: "remove_message", commentId: "91" });
});

it("BDD-SYNC-OUTBOX-003 records success, retry and failure with compare-and-set", async () => {
  const delivered = processingTarget();
  await delivered.store.delivered({
    outboxId: "outbox_1",
    linkId: "link_1",
    attempt: 1,
    deliveredAt: "2026-09-02T02:01:00.000Z",
    providerObjectId: "91",
  });
  expect(delivered.tables.updates[0]).toMatchObject({
    data: { status: "succeeded", providerObjectId: "91" },
  });

  const retry = processingTarget();
  await retry.store.retry({
    outboxId: "outbox_1",
    linkId: "link_1",
    attempt: 1,
    failedAt: "2026-09-02T02:01:00.000Z",
    nextAttemptAt: "2026-09-02T02:02:00.000Z",
    errorCode: "provider_retryable",
  });
  expect(retry.tables.updates[0]).toMatchObject({
    data: { status: "pending", lastErrorCode: "provider_retryable" },
  });

  const failed = processingTarget();
  await failed.store.failed({
    outboxId: "outbox_1",
    linkId: "link_1",
    attempt: 1,
    failedAt: "2026-09-02T02:01:00.000Z",
    errorCode: "provider_permanent",
  });
  expect(failed.tables.updates[0]).toMatchObject({
    data: { status: "failed", lastErrorCode: "provider_permanent" },
  });
});

it("BDD-SYNC-OUTBOX-004 fails closed for malformed or disconnected authority", async () => {
  const tables = new FakeTables();
  tables.rows.set("source_connections:connection_1", { status: "suspended" });
  await expect(
    target(tables).store.claim({
      workerId: "preview-message-worker",
      now: "2026-09-02T02:01:00.000Z",
      staleBefore: "2026-09-02T01:56:00.000Z",
    }),
  ).rejects.toThrow("PROVIDER_MESSAGE_OUTBOX_ROW_INVALID");
});
