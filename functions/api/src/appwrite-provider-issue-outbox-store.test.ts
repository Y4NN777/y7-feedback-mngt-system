/* eslint-disable @typescript-eslint/unbound-method -- Vitest verifies Appwrite port spies by reference. */
import { describe, expect, it, vi } from "vitest";

import {
  createAppwriteProviderIssueOutboxStore,
  type AppwriteProviderIssueOutboxQueryPort,
  type AppwriteProviderIssueOutboxTablesPort,
} from "./appwrite-provider-issue-outbox-store";

const schema = {
  databaseId: "feedback",
  providerOutboxTableId: "provider_outbox",
  externalIssueLinksTableId: "external_issue_links",
  sourceConnectionsTableId: "source_connections",
};
const now = "2026-08-28T12:00:00.000Z";
const staleBefore = "2026-08-28T11:59:00.000Z";
const payload = {
  reference: "Y7-ABC123",
  protectedWorkspaceUrl: "https://feedback.example/workbench?feedbackId=feedback_1",
  feedbackType: "bug",
  origin: "y7-feedback",
};
const outbox = {
  $id: "outbox_1",
  linkId: "link_1",
  operationId: "operation_1",
  feedbackId: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  connectionId: "connection_1",
  provider: "github",
  repositoryId: "123",
  status: "pending",
  attempts: 0,
  payloadJson: JSON.stringify(payload),
  createdAt: "2026-08-28T11:00:00.000Z",
  updatedAt: "2026-08-28T11:00:00.000Z",
};
const connection = {
  $id: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  provider: "github",
  status: "active",
  encryptedGrantRef: "grant_1",
  selectedRepositoriesJson: JSON.stringify({
    kind: "selected",
    repositories: [{ provider: "github", id: "123" }],
    imports: [
      {
        connectionId: "connection_1",
        provider: "github",
        repositoryId: "123",
        owner: "Y4NN777",
        name: "feedback",
        visibility: "private",
        releases: [],
      },
    ],
  }),
};
const link = { $id: "link_1", state: "active", synchronizationState: "pending" };

const queries: AppwriteProviderIssueOutboxQueryPort = {
  equal: (field, values) => `equal:${field}:${values.join("|")}`,
  orderAsc: (field) => `asc:${field}`,
  limit: (value) => `limit:${String(value)}`,
};

interface SetupOptions {
  readonly outboxRow?: unknown;
  readonly listed?: readonly unknown[];
  readonly connection?: unknown;
  readonly link?: unknown;
  readonly transactionId?: string;
  readonly updateError?: Error;
  readonly invalidUpdateTable?: string;
  readonly invalidUpdateAfter?: number;
  readonly commitError?: Error;
  readonly rollbackError?: Error;
}

type UpdateTransactionInput = Parameters<
  AppwriteProviderIssueOutboxTablesPort["updateTransaction"]
>[0];
type UpdateRowInput = Parameters<AppwriteProviderIssueOutboxTablesPort["updateRow"]>[0];

function setup(options: SetupOptions = {}) {
  const rows = new Map<string, Readonly<Record<string, unknown>>>([
    [
      `${schema.providerOutboxTableId}:outbox_1`,
      (options.outboxRow === undefined ? outbox : options.outboxRow) as Readonly<
        Record<string, unknown>
      >,
    ],
    [
      `${schema.sourceConnectionsTableId}:connection_1`,
      (options.connection === undefined ? connection : options.connection) as Readonly<
        Record<string, unknown>
      >,
    ],
    [
      `${schema.externalIssueLinksTableId}:link_1`,
      (options.link === undefined ? link : options.link) as Readonly<
        Record<string, unknown>
      >,
    ],
  ]);
  const updates: Array<Readonly<Record<string, unknown>>> = [];
  const tables: AppwriteProviderIssueOutboxTablesPort = {
    createTransaction: vi.fn().mockResolvedValue({
      $id: options.transactionId ?? "transaction_1",
    }),
    updateTransaction: vi.fn().mockImplementation((input: UpdateTransactionInput) => {
      if (input.commit && options.commitError)
        return Promise.reject(options.commitError);
      if (input.rollback && options.rollbackError) {
        return Promise.reject(options.rollbackError);
      }
      return Promise.resolve({});
    }),
    listRows: vi.fn().mockResolvedValue({ rows: options.listed ?? [outbox] }),
    getRow: vi.fn().mockImplementation((input: { tableId: string; rowId: string }) => {
      const value = rows.get(`${input.tableId}:${input.rowId}`);
      return value === undefined
        ? Promise.reject(new Error("missing row"))
        : Promise.resolve(value);
    }),
    updateRow: vi.fn().mockImplementation((input: UpdateRowInput) => {
      if (options.updateError) return Promise.reject(options.updateError);
      updates.push(input);
      const current = rows.get(`${input.tableId}:${input.rowId}`) ?? {
        $id: input.rowId,
      };
      const next = { ...current, ...input.data };
      rows.set(`${input.tableId}:${input.rowId}`, next);
      return Promise.resolve(
        options.invalidUpdateTable === input.tableId &&
          updates.length > (options.invalidUpdateAfter ?? 0)
          ? { $id: "wrong" }
          : next,
      );
    }),
  };
  return {
    store: createAppwriteProviderIssueOutboxStore(tables, schema, queries),
    tables,
    rows,
    updates,
  };
}

const claimInput = { workerId: "worker-preview-1", now, staleBefore };

describe("Appwrite provider issue outbox store", () => {
  it("BDD-ISSUE-OUTBOX-DB-001 atomically claims a due row and resolves private grant metadata", async () => {
    const target = setup();
    await expect(target.store.claim(claimInput)).resolves.toEqual({
      outboxId: "outbox_1",
      linkId: "link_1",
      operationId: "operation_1",
      provider: "github",
      encryptedGrantRef: "grant_1",
      repository: { id: "123", owner: "Y4NN777", name: "feedback" },
      payload,
      attempt: 1,
    });
    expect(target.tables.listRows).toHaveBeenCalledWith(
      expect.objectContaining({
        queries: ["equal:status:pending|processing", "asc:createdAt", "limit:25"],
        transactionId: "transaction_1",
      }),
    );
    expect(target.rows.get("provider_outbox:outbox_1")).toMatchObject({
      status: "processing",
      attempts: 1,
      claimedBy: "worker-preview-1",
    });
    expect(target.tables.updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction_1",
      commit: true,
    });
  });

  it("BDD-ISSUE-OUTBOX-DB-002 reclaims stale processing but ignores future or fresh rows", async () => {
    await expect(
      setup({
        listed: [
          { ...outbox, status: "processing", attempts: 1, updatedAt: staleBefore },
        ],
      }).store.claim(claimInput),
    ).resolves.toMatchObject({ attempt: 2 });
    await expect(
      setup({
        listed: [{ ...outbox, nextAttemptAt: "2026-08-28T12:01:00.000Z" }],
      }).store.claim(claimInput),
    ).resolves.toBeNull();
    await expect(
      setup({
        listed: [
          { ...outbox, status: "processing", updatedAt: "2026-08-28T11:59:30.000Z" },
        ],
      }).store.claim(claimInput),
    ).resolves.toBeNull();
  });

  it("BDD-ISSUE-OUTBOX-DB-002B preserves explicitly approved Reporter content", async () => {
    await expect(
      setup({
        listed: [
          {
            ...outbox,
            payloadJson: JSON.stringify({ ...payload, reporterContent: "Approved" }),
          },
        ],
      }).store.claim(claimInput),
    ).resolves.toMatchObject({ payload: { reporterContent: "Approved" } });
  });

  it("BDD-ISSUE-OUTBOX-DB-003 treats a concurrent transaction conflict as no claim", async () => {
    const conflict = Object.assign(new Error("conflict"), { code: 409 });
    await expect(
      setup({ updateError: conflict }).store.claim(claimInput),
    ).resolves.toBeNull();
  });

  it("BDD-ISSUE-OUTBOX-DB-004 commits delivery and issue identity atomically", async () => {
    const target = setup();
    await target.store.claim(claimInput);
    await target.store.delivered({
      outboxId: "outbox_1",
      linkId: "link_1",
      attempt: 1,
      issueId: "42",
      issueUrl: "https://github.com/Y4NN777/feedback/issues/1",
      deliveredAt: "2026-08-28T12:00:01.000Z",
    });
    expect(target.rows.get("provider_outbox:outbox_1")).toMatchObject({
      status: "delivered",
    });
    expect(target.rows.get("external_issue_links:link_1")).toMatchObject({
      synchronizationState: "synchronized",
      providerIssueId: "42",
      providerIssueUrl: "https://github.com/Y4NN777/feedback/issues/1",
    });
  });

  it("BDD-ISSUE-OUTBOX-DB-005 schedules retry and records terminal failure", async () => {
    const retry = setup();
    await retry.store.claim(claimInput);
    await retry.store.retry({
      outboxId: "outbox_1",
      linkId: "link_1",
      attempt: 1,
      failedAt: "2026-08-28T12:00:01.000Z",
      nextAttemptAt: "2026-08-28T12:01:01.000Z",
      errorCode: "provider_retryable",
    });
    expect(retry.rows.get("provider_outbox:outbox_1")).toMatchObject({
      status: "pending",
      nextAttemptAt: "2026-08-28T12:01:01.000Z",
      lastErrorCode: "provider_retryable",
    });
    expect(retry.rows.get("external_issue_links:link_1")).toMatchObject({
      synchronizationState: "failed",
    });

    const failed = setup();
    await failed.store.claim(claimInput);
    await failed.store.failed({
      outboxId: "outbox_1",
      linkId: "link_1",
      attempt: 1,
      failedAt: "2026-08-28T12:00:01.000Z",
      errorCode: "provider_permanent",
    });
    expect(failed.rows.get("provider_outbox:outbox_1")).toMatchObject({
      status: "failed",
      lastErrorCode: "provider_permanent",
    });
  });

  it.each([{ workerId: "bad id" }, { now: "invalid" }, { staleBefore: "invalid" }])(
    "BDD-ISSUE-OUTBOX-DB-006 rejects malformed claim input %#",
    async (override) => {
      await expect(setup().store.claim({ ...claimInput, ...override })).rejects.toThrow(
        "PROVIDER_OUTBOX_CLAIM_INVALID",
      );
    },
  );

  it.each([
    null,
    { ...outbox, $id: "bad id" },
    { ...outbox, status: "delivered" },
    { ...outbox, attempts: -1 },
    { ...outbox, provider: "bitbucket" },
    { ...outbox, updatedAt: "invalid" },
    { ...outbox, nextAttemptAt: "invalid" },
  ])(
    "BDD-ISSUE-OUTBOX-DB-007 skips invalid or terminal candidate %#",
    async (value) => {
      await expect(
        setup({ listed: [value] }).store.claim(claimInput),
      ).resolves.toBeNull();
    },
  );

  it.each([
    { connection: null },
    { connection: { ...connection, status: "disconnected" } },
    { connection: { ...connection, selectedRepositoriesJson: "invalid" } },
    {
      connection: {
        ...connection,
        selectedRepositoriesJson: JSON.stringify(null),
      },
    },
    {
      connection: {
        ...connection,
        selectedRepositoriesJson: JSON.stringify({ kind: "authorized", imports: [] }),
      },
    },
    {
      connection: {
        ...connection,
        selectedRepositoriesJson: JSON.stringify({ kind: "selected", imports: {} }),
      },
    },
    {
      connection: {
        ...connection,
        selectedRepositoriesJson: JSON.stringify({ kind: "selected", imports: [] }),
      },
    },
    { listed: [{ ...outbox, payloadJson: "invalid" }] },
    { listed: [{ ...outbox, payloadJson: null }] },
    { listed: [{ ...outbox, payloadJson: JSON.stringify(null) }] },
    {
      listed: [
        { ...outbox, payloadJson: JSON.stringify({ ...payload, secret: "no" }) },
      ],
    },
    {
      listed: [
        { ...outbox, payloadJson: JSON.stringify({ ...payload, reference: 42 }) },
      ],
    },
    {
      listed: [
        {
          ...outbox,
          payloadJson: JSON.stringify({ ...payload, protectedWorkspaceUrl: 42 }),
        },
      ],
    },
    {
      listed: [
        {
          ...outbox,
          payloadJson: JSON.stringify({ ...payload, feedbackType: "task" }),
        },
      ],
    },
    {
      listed: [
        { ...outbox, payloadJson: JSON.stringify({ ...payload, origin: "foreign" }) },
      ],
    },
    {
      listed: [
        { ...outbox, payloadJson: JSON.stringify({ ...payload, reporterContent: 42 }) },
      ],
    },
  ])(
    "BDD-ISSUE-OUTBOX-DB-008 fails closed for corrupt authority %#",
    async (override) => {
      await expect(setup(override).store.claim(claimInput)).rejects.toThrow(
        "PROVIDER_OUTBOX_ROW_INVALID",
      );
    },
  );

  it("BDD-ISSUE-OUTBOX-DB-009 validates schema, transaction and write identity", async () => {
    expect(() =>
      createAppwriteProviderIssueOutboxStore(
        {} as AppwriteProviderIssueOutboxTablesPort,
        { ...schema, providerOutboxTableId: "bad id" },
        queries,
      ),
    ).toThrow("PROVIDER_OUTBOX_SCHEMA_INVALID");
    expect(() =>
      createAppwriteProviderIssueOutboxStore(
        {} as AppwriteProviderIssueOutboxTablesPort,
        { ...schema, externalIssueLinksTableId: schema.providerOutboxTableId },
        queries,
      ),
    ).toThrow("PROVIDER_OUTBOX_SCHEMA_INVALID");
    await expect(
      setup({ transactionId: "bad id" }).store.claim(claimInput),
    ).rejects.toThrow("PROVIDER_OUTBOX_TX_INVALID");
    await expect(
      setup({ invalidUpdateTable: schema.providerOutboxTableId }).store.claim(
        claimInput,
      ),
    ).rejects.toThrow("PROVIDER_OUTBOX_WRITE_INVALID");
  });

  it("BDD-ISSUE-OUTBOX-DB-010 rolls back original failures and preserves them", async () => {
    const failure = setup({
      updateError: new Error("write failed"),
      rollbackError: new Error("rollback"),
    });
    await expect(failure.store.claim(claimInput)).rejects.toThrow("write failed");
    expect(failure.tables.updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction_1",
      rollback: true,
    });
    await expect(
      setup({ commitError: new Error("commit failed") }).store.claim(claimInput),
    ).rejects.toThrow("commit failed");
  });

  it.each([
    ["delivered", { issueId: "bad id" }, "PROVIDER_OUTBOX_DELIVERY_INVALID"],
    ["delivered", { issueUrl: "http://bad" }, "PROVIDER_OUTBOX_DELIVERY_INVALID"],
    ["delivered", { deliveredAt: "invalid" }, "PROVIDER_OUTBOX_DELIVERY_INVALID"],
    ["retry", { failedAt: "invalid" }, "PROVIDER_OUTBOX_RETRY_INVALID"],
    ["retry", { nextAttemptAt: "invalid" }, "PROVIDER_OUTBOX_RETRY_INVALID"],
    ["failed", { failedAt: "invalid" }, "PROVIDER_OUTBOX_FAILURE_INVALID"],
  ] as const)(
    "BDD-ISSUE-OUTBOX-DB-011 rejects malformed %s transition",
    async (kind, override, error) => {
      const target = setup();
      const base = {
        outboxId: "outbox_1",
        linkId: "link_1",
        attempt: 1,
        issueId: "42",
        issueUrl: "https://github.com/Y4NN777/feedback/issues/1",
        deliveredAt: now,
        failedAt: now,
        nextAttemptAt: "2026-08-28T12:01:00.000Z",
        errorCode: "provider_retryable" as const,
      };
      await expect(
        target.store[kind]({
          ...base,
          ...override,
        } as never),
      ).rejects.toThrow(error);
    },
  );

  it("BDD-ISSUE-OUTBOX-DB-012 rejects stale link authority", async () => {
    const target = setup({ link: { ...link, state: "deleted" } });
    await target.store.claim(claimInput);
    await expect(
      target.store.failed({
        outboxId: "outbox_1",
        linkId: "link_1",
        attempt: 1,
        failedAt: now,
        errorCode: "attempts_exhausted",
      }),
    ).rejects.toThrow("PROVIDER_OUTBOX_STATE_CONFLICT");
  });

  it("BDD-ISSUE-OUTBOX-DB-012B rejects a corrupt transition row", async () => {
    await expect(
      setup({ outboxRow: null }).store.failed({
        outboxId: "outbox_1",
        linkId: "link_1",
        attempt: 1,
        failedAt: now,
        errorCode: "attempts_exhausted",
      }),
    ).rejects.toThrow("PROVIDER_OUTBOX_STATE_CONFLICT");
  });

  it.each([schema.providerOutboxTableId, schema.externalIssueLinksTableId])(
    "BDD-ISSUE-OUTBOX-DB-013 rejects invalid %s update identity",
    async (tableId) => {
      const target = setup({ invalidUpdateTable: tableId, invalidUpdateAfter: 1 });
      await target.store.claim(claimInput);
      await expect(
        target.store.failed({
          outboxId: "outbox_1",
          linkId: "link_1",
          attempt: 1,
          failedAt: now,
          errorCode: "attempts_exhausted",
        }),
      ).rejects.toThrow("PROVIDER_OUTBOX_WRITE_INVALID");
    },
  );
});
