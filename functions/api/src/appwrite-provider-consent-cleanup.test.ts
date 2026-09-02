import { expect, it, vi } from "vitest";
import { createAppwriteProviderConsentCleanup } from "./appwrite-provider-consent-cleanup";

it("BDD-SYNC-CONSENT-001 queues idempotent best-effort removal of Y7-controlled public comments", async () => {
  const created: Array<Readonly<Record<string, unknown>>> = [];
  const tables = {
    createTransaction: () => Promise.resolve({ $id: "transaction_1" }),
    updateTransaction: () => Promise.resolve({}),
    listRows: (input: { readonly tableId: string }) =>
      Promise.resolve({
        rows:
          input.tableId === "external_issue_links"
            ? [
                {
                  $id: "link_1",
                  workspaceId: "workspace_1",
                  projectId: "project_1",
                  visibility: "public",
                  provider: "github",
                  repositoryId: "repo_1",
                  connectionId: "connection_1",
                  providerIssueId: "41",
                },
              ]
            : [
                {
                  $id: "publish_1",
                  operationId: "message_1",
                  kind: "publish_message",
                  status: "succeeded",
                  sequence: 1,
                  providerObjectId: "91",
                },
              ],
      }),
    createRow: (input: Readonly<Record<string, unknown>>) => {
      created.push(input);
      return Promise.resolve({ $id: input.rowId });
    },
  };
  const cleanup = createAppwriteProviderConsentCleanup(
    tables,
    {
      databaseId: "feedback",
      externalIssueLinksTableId: "external_issue_links",
      providerSyncOutboxTableId: "provider_sync_outbox",
    },
    { equal: (k, v) => `${k}=${v.join(",")}`, orderDesc: (k) => k, limit: String },
    {
      environment: "preview",
      protector: { seal: (_c, value) => value, open: () => "unused" },
    },
  );
  await expect(
    cleanup.request({
      feedbackId: "feedback_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      consentOperationId: "revoke_1",
      occurredAt: "2026-09-02T03:00:00.000Z",
    }),
  ).resolves.toEqual({ queued: 1, guarantee: "best_effort" });
  expect(created[0]).toMatchObject({
    data: { kind: "remove_message", status: "pending", sequence: 2 },
  });
  expect(JSON.stringify(created[0])).not.toMatch(
    /Visible|proof|contact|attachment|internal.note/i,
  );
});

it("BDD-SYNC-CONSENT-002 does not claim deletion of uncontrolled or private copies", async () => {
  const tables = {
    createTransaction: () => Promise.resolve({ $id: "transaction_1" }),
    updateTransaction: () => Promise.resolve({}),
    listRows: () =>
      Promise.resolve({
        rows: [
          {
            $id: "link_1",
            workspaceId: "workspace_1",
            projectId: "project_1",
            visibility: "private",
          },
        ],
      }),
    createRow: () => Promise.reject(new Error("must not write")),
  };
  const cleanup = createAppwriteProviderConsentCleanup(
    tables,
    {
      databaseId: "feedback",
      externalIssueLinksTableId: "external_issue_links",
      providerSyncOutboxTableId: "provider_sync_outbox",
    },
    { equal: (k, v) => `${k}=${v.join(",")}`, orderDesc: (k) => k, limit: String },
    {
      environment: "preview",
      protector: { seal: () => "unused", open: () => "unused" },
    },
  );
  await expect(
    cleanup.request({
      feedbackId: "feedback_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      consentOperationId: "revoke_1",
      occurredAt: "2026-09-02T03:00:00.000Z",
    }),
  ).resolves.toEqual({ queued: 0, guarantee: "best_effort" });
});

it("fails closed for malformed requests and skips every ineligible link shape", async () => {
  const schema = {
    databaseId: "feedback",
    externalIssueLinksTableId: "external_issue_links",
    providerSyncOutboxTableId: "provider_sync_outbox",
  };
  const base = {
    feedbackId: "feedback_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    consentOperationId: "revoke_1",
    occurredAt: "2026-09-02T03:00:00.000Z",
  };
  const make = (links: readonly unknown[]) =>
    createAppwriteProviderConsentCleanup(
      {
        createTransaction: () => Promise.resolve({ $id: "transaction_1" }),
        updateTransaction: () => Promise.resolve({}),
        listRows: () => Promise.resolve({ rows: links }),
        createRow: () => Promise.reject(new Error("must not write")),
      },
      schema,
      { equal: vi.fn(() => "q"), orderDesc: vi.fn(() => "q"), limit: vi.fn(() => "q") },
      {
        environment: "preview",
        protector: { seal: vi.fn(), open: vi.fn() },
      },
    );
  for (const mutation of [
    { feedbackId: "bad/id" },
    { workspaceId: "bad/id" },
    { projectId: "bad/id" },
    { consentOperationId: "bad/id" },
    { occurredAt: "invalid" },
  ]) {
    await expect(make([]).request({ ...base, ...mutation })).rejects.toThrow(
      "PROVIDER_CONSENT_CLEANUP_INVALID",
    );
  }
  for (const schemaMutation of [
    { databaseId: "bad/id" },
    { externalIssueLinksTableId: "bad/id" },
    { providerSyncOutboxTableId: "bad/id" },
  ]) {
    const cleanup = createAppwriteProviderConsentCleanup(
      {
        createTransaction: vi.fn(),
        updateTransaction: vi.fn(),
        listRows: vi.fn(),
        createRow: vi.fn(),
      },
      { ...schema, ...schemaMutation },
      { equal: vi.fn(), orderDesc: vi.fn(), limit: vi.fn() },
      { environment: "preview", protector: { seal: vi.fn(), open: vi.fn() } },
    );
    await expect(cleanup.request(base)).rejects.toThrow(
      "PROVIDER_CONSENT_CLEANUP_INVALID",
    );
  }

  const valid = {
    $id: "link_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    visibility: "public",
    provider: "github",
    repositoryId: "repo_1",
    connectionId: "connection_1",
    providerIssueId: "41",
  };
  for (const link of [
    null,
    { ...valid, $id: null },
    { ...valid, workspaceId: "other" },
    { ...valid, projectId: "other" },
    { ...valid, visibility: "private" },
    { ...valid, provider: "other" },
    { ...valid, repositoryId: null },
    { ...valid, connectionId: null },
    { ...valid, providerIssueId: null },
  ]) {
    await expect(make([link]).request(base)).resolves.toEqual({
      queued: 0,
      guarantee: "best_effort",
    });
  }
});

it("deduplicates cleanup, advances sequence and rolls back write failures", async () => {
  const link = {
    $id: "link_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    visibility: "public",
    provider: "github",
    repositoryId: "repo_1",
    connectionId: "connection_1",
    providerIssueId: "41",
  };
  const publish = {
    $id: "publish_1",
    kind: "publish_message",
    status: "succeeded",
    sequence: 3,
    providerObjectId: "91",
  };
  const request = {
    feedbackId: "feedback_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    consentOperationId: "revoke_1",
    occurredAt: "2026-09-02T03:00:00.000Z",
  };
  const operationId = "cln_06012e22bcc295cd6b1a7acf52ff7e3";
  const updateTransaction = vi.fn(() => Promise.resolve({}));
  const tables = {
    createTransaction: () => Promise.resolve({ $id: "transaction_1" }),
    updateTransaction,
    listRows: (input: { tableId: string }) =>
      Promise.resolve({
        rows:
          input.tableId === "external_issue_links"
            ? [link]
            : [publish, { sequence: 7 }, null, { operationId }],
      }),
    createRow: vi.fn(() => Promise.resolve({ $id: "wrong" })),
  };
  const cleanup = createAppwriteProviderConsentCleanup(
    tables,
    {
      databaseId: "feedback",
      externalIssueLinksTableId: "external_issue_links",
      providerSyncOutboxTableId: "provider_sync_outbox",
    },
    { equal: vi.fn(() => "q"), orderDesc: vi.fn(() => "q"), limit: vi.fn(() => "q") },
    { environment: "preview", protector: { seal: vi.fn(), open: vi.fn() } },
  );
  await expect(cleanup.request(request)).resolves.toEqual({
    queued: 0,
    guarantee: "best_effort",
  });

  tables.listRows = (input: { tableId: string }) =>
    Promise.resolve({
      rows:
        input.tableId === "external_issue_links" ? [link] : [publish, { sequence: 7 }],
    });
  await expect(cleanup.request(request)).rejects.toThrow(
    "PROVIDER_CONSENT_CLEANUP_WRITE_INVALID",
  );
  expect(updateTransaction).toHaveBeenCalledWith({
    transactionId: "transaction_1",
    rollback: true,
  });

  updateTransaction.mockRejectedValueOnce(new Error("rollback unavailable"));
  await expect(cleanup.request(request)).rejects.toThrow(
    "PROVIDER_CONSENT_CLEANUP_WRITE_INVALID",
  );
});
