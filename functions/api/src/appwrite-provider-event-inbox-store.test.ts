import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createAppwriteProviderEventInboxStore } from "./appwrite-provider-event-inbox-store.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

const schema = {
  databaseId: "feedback",
  providerEventInboxTableId: "provider_event_inbox",
};
const persistence = {
  environment: "preview",
  protector: createSensitiveDataProtector(
    "key-1",
    [{ id: "key-1", material: Buffer.alloc(32, 3) }],
    () => Buffer.alloc(12, 4),
  ),
};
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(",")}`,
  orderAsc: (attribute: string) => `order:${attribute}`,
  limit: (value: number) => `limit:${String(value)}`,
};

function envelope(rowId: string, value = '{"repository":{"id":2}}'): string {
  return persistence.protector.seal(
    {
      environment: "preview",
      tableId: schema.providerEventInboxTableId,
      rowId,
      field: "payloadEnvelope",
    },
    value,
  );
}

function row(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    $id: "inbox_1",
    provider: "github",
    deliveryId: "delivery_1",
    eventType: "issues",
    connectionId: "connection_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    repositoryId: "2",
    status: "pending",
    attempts: 0,
    payloadEnvelope: envelope("inbox_1"),
    payloadDigest: createHash("sha256").update("payload").digest("base64url"),
    receivedAt: "2026-09-01T12:00:00.000Z",
    availableAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

function harness(rows: readonly unknown[] = []) {
  interface CreateInput {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly string[];
  }
  interface UpdateInput {
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
  }
  const tables = {
    createRow: vi.fn((input: CreateInput) => Promise.resolve({ $id: input.rowId })),
    createTransaction: vi.fn(() => Promise.resolve({ $id: "transaction_1" })),
    updateTransaction: vi.fn(() => Promise.resolve({})),
    listRows: vi.fn(() => Promise.resolve({ rows })),
    getRow: vi.fn(() => Promise.resolve(row({ status: "processing", attempts: 1 }))),
    updateRow: vi.fn((input: UpdateInput) => Promise.resolve({ $id: input.rowId })),
  };
  const store = createAppwriteProviderEventInboxStore(
    tables,
    schema,
    persistence,
    { createId: () => "inbox_1" },
    queries,
  );
  return { store, tables };
}

const accepted = {
  provider: "github" as const,
  deliveryId: "delivery_1",
  eventType: "issues",
  connectionId: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  repositoryId: "2",
  payload: '{"repository":{"id":2}}',
  payloadDigest: createHash("sha256").update("payload").digest("base64url"),
  receivedAt: "2026-09-01T12:00:00.000Z",
};

describe("Appwrite provider event inbox store", () => {
  it("BDD-SYNC-017 stores one encrypted private delivery and accepts duplicate replay", async () => {
    const { store, tables } = harness();
    await expect(store.accept(accepted)).resolves.toBe("accepted");
    const create = tables.createRow.mock.calls[0]?.[0];
    expect(create).toMatchObject({
      databaseId: "feedback",
      tableId: "provider_event_inbox",
      rowId: "inbox_1",
      permissions: [],
      data: {
        provider: "github",
        deliveryId: "delivery_1",
        status: "pending",
        attempts: 0,
      },
    });
    expect(JSON.stringify(create)).not.toContain(accepted.payload);
    const payloadEnvelope = create?.data.payloadEnvelope;
    expect(typeof payloadEnvelope).toBe("string");
    expect(payloadEnvelope).toMatch(/^v1\./u);

    tables.createRow.mockRejectedValueOnce({ code: 409 });
    await expect(store.accept(accepted)).resolves.toBe("duplicate");
  });

  it("BDD-SYNC-018 claims only the oldest due event per connection", async () => {
    const blocked = row({
      $id: "inbox_blocked",
      connectionId: "connection_1",
      availableAt: "2026-09-01T13:00:00.000Z",
      payloadEnvelope: envelope("inbox_blocked"),
    });
    const sameConnection = row({
      $id: "inbox_later",
      connectionId: "connection_1",
      receivedAt: "2026-09-01T12:00:01.000Z",
      payloadEnvelope: envelope("inbox_later"),
    });
    const due = row({
      $id: "inbox_due",
      connectionId: "connection_2",
      deliveryId: "delivery_2",
      provider: "gitlab",
      receivedAt: "2026-09-01T12:00:02.000Z",
      payloadEnvelope: envelope("inbox_due"),
    });
    const { store, tables } = harness([blocked, sameConnection, due]);
    await expect(
      store.claim({
        workerId: "sync-worker-1",
        now: "2026-09-01T12:30:00.000Z",
        staleBefore: "2026-09-01T12:29:00.000Z",
      }),
    ).resolves.toEqual({
      inboxId: "inbox_due",
      provider: "gitlab",
      deliveryId: "delivery_2",
      eventType: "issues",
      connectionId: "connection_2",
      workspaceId: "workspace_1",
      projectId: "project_1",
      repositoryId: "2",
      payloadEnvelope: '{"repository":{"id":2}}',
      attempt: 1,
    });
    expect(tables.listRows).toHaveBeenCalledWith(
      expect.objectContaining({
        queries: ["equal:status:pending,processing", "order:receivedAt", "limit:100"],
      }),
    );
    const update = tables.updateRow.mock.calls[0]?.[0];
    expect(update?.rowId).toBe("inbox_due");
    expect(update?.data).toMatchObject({
      status: "processing",
      attempts: 1,
      claimedBy: "sync-worker-1",
    });
    expect(tables.updateTransaction).toHaveBeenCalledWith({
      transactionId: "transaction_1",
      commit: true,
    });
  });

  it("BDD-SYNC-019 reclaims a stale lease and stays idle behind a live lease", async () => {
    const stale = row({
      status: "processing",
      attempts: 1,
      claimedAt: "2026-09-01T11:00:00.000Z",
    });
    const staleHarness = harness([stale]);
    await expect(
      staleHarness.store.claim({
        workerId: "sync-worker-1",
        now: "2026-09-01T12:00:00.000Z",
        staleBefore: "2026-09-01T11:59:00.000Z",
      }),
    ).resolves.toMatchObject({ inboxId: "inbox_1", attempt: 2 });

    const liveHarness = harness([
      row({
        status: "processing",
        attempts: 1,
        claimedAt: "2026-09-01T11:59:30.000Z",
      }),
    ]);
    await expect(
      liveHarness.store.claim({
        workerId: "sync-worker-1",
        now: "2026-09-01T12:00:00.000Z",
        staleBefore: "2026-09-01T11:59:00.000Z",
      }),
    ).resolves.toBeNull();
  });

  it("BDD-SYNC-020 commits completion, retry and terminal failure from the exact claim", async () => {
    const { store, tables } = harness();
    await store.complete({
      inboxId: "inbox_1",
      attempt: 1,
      completedAt: "2026-09-01T12:01:00.000Z",
    });
    await store.retry({
      inboxId: "inbox_1",
      attempt: 1,
      availableAt: "2026-09-01T12:02:00.000Z",
      errorCode: "handler_retryable",
    });
    await store.fail({
      inboxId: "inbox_1",
      attempt: 1,
      failedAt: "2026-09-01T12:03:00.000Z",
      errorCode: "handler_permanent",
    });
    expect(tables.updateRow.mock.calls.map(([call]) => call.data.status)).toEqual([
      "completed",
      "pending",
      "failed",
    ]);
  });

  it("BDD-SYNC-021 rolls back corrupt rows and stale transitions", async () => {
    const corrupt = harness([{ ...row(), provider: "unknown" }]);
    await expect(
      corrupt.store.claim({
        workerId: "sync-worker-1",
        now: "2026-09-01T12:00:00.000Z",
        staleBefore: "2026-09-01T11:59:00.000Z",
      }),
    ).rejects.toThrow("PROVIDER_INBOX_ROW_INVALID");
    expect(corrupt.tables.updateTransaction).toHaveBeenCalledWith({
      transactionId: "transaction_1",
      rollback: true,
    });

    const stale = harness();
    stale.tables.getRow.mockResolvedValueOnce(
      row({ status: "completed", attempts: 1 }),
    );
    await expect(
      stale.store.complete({
        inboxId: "inbox_1",
        attempt: 1,
        completedAt: "2026-09-01T12:01:00.000Z",
      }),
    ).rejects.toThrow("PROVIDER_INBOX_STATE_CONFLICT");
  });

  it("BDD-SYNC-022 validates schema, acceptance, claim and transition inputs", async () => {
    const { tables } = harness();
    expect(() =>
      createAppwriteProviderEventInboxStore(
        tables,
        { databaseId: "same", providerEventInboxTableId: "same" },
        persistence,
        { createId: () => "inbox_1" },
        queries,
      ),
    ).toThrow("PROVIDER_INBOX_SCHEMA_INVALID");

    const invalid = harness();
    await expect(
      invalid.store.accept({ ...accepted, payloadDigest: "invalid" }),
    ).rejects.toThrow("PROVIDER_INBOX_ACCEPT_INVALID");
    await expect(
      invalid.store.claim({
        workerId: "bad",
        now: "invalid",
        staleBefore: "invalid",
      }),
    ).rejects.toThrow("PROVIDER_INBOX_CLAIM_INVALID");
    await expect(
      invalid.store.retry({
        inboxId: "inbox_1",
        attempt: 1,
        availableAt: "invalid",
        errorCode: "handler_retryable",
      }),
    ).rejects.toThrow("PROVIDER_INBOX_TRANSITION_INVALID");
  });

  it("BDD-SYNC-029 fails closed on invalid transactions and write acknowledgements", async () => {
    const invalidTransaction = harness();
    invalidTransaction.tables.createTransaction.mockResolvedValueOnce({
      $id: "bad/id",
    });
    await expect(
      invalidTransaction.store.claim({
        workerId: "sync-worker-1",
        now: "2026-09-01T12:00:00.000Z",
        staleBefore: "2026-09-01T11:59:00.000Z",
      }),
    ).rejects.toThrow("PROVIDER_INBOX_TX_INVALID");

    const invalidCreate = harness();
    invalidCreate.tables.createRow.mockResolvedValueOnce({ $id: "other" });
    await expect(invalidCreate.store.accept(accepted)).rejects.toThrow(
      "PROVIDER_INBOX_WRITE_INVALID",
    );
    invalidCreate.tables.createRow.mockRejectedValueOnce(new Error("unavailable"));
    await expect(invalidCreate.store.accept(accepted)).rejects.toThrow("unavailable");

    const invalidClaimWrite = harness([row()]);
    invalidClaimWrite.tables.updateRow.mockResolvedValueOnce({ $id: "other" });
    await expect(
      invalidClaimWrite.store.claim({
        workerId: "sync-worker-1",
        now: "2026-09-01T12:00:00.000Z",
        staleBefore: "2026-09-01T11:59:00.000Z",
      }),
    ).rejects.toThrow("PROVIDER_INBOX_WRITE_INVALID");

    const invalidTransitionWrite = harness();
    invalidTransitionWrite.tables.updateRow.mockResolvedValueOnce({ $id: "other" });
    await expect(
      invalidTransitionWrite.store.complete({
        inboxId: "inbox_1",
        attempt: 1,
        completedAt: "2026-09-01T12:01:00.000Z",
      }),
    ).rejects.toThrow("PROVIDER_INBOX_WRITE_INVALID");
  });

  it("BDD-SYNC-030 validates every transition boundary and non-string instant", async () => {
    const { store } = harness();
    await expect(
      store.claim({
        workerId: "sync-worker-1",
        now: undefined as unknown as string,
        staleBefore: "2026-09-01T11:59:00.000Z",
      }),
    ).rejects.toThrow("PROVIDER_INBOX_CLAIM_INVALID");
    await expect(
      store.complete({
        inboxId: "bad/id",
        attempt: 1,
        completedAt: "2026-09-01T12:01:00.000Z",
      }),
    ).rejects.toThrow("PROVIDER_INBOX_TRANSITION_INVALID");
    await expect(
      store.retry({
        inboxId: "inbox_1",
        attempt: Number.NaN,
        availableAt: "2026-09-01T12:02:00.000Z",
        errorCode: "handler_retryable",
      }),
    ).rejects.toThrow("PROVIDER_INBOX_TRANSITION_INVALID");
    await expect(
      store.complete({
        inboxId: "inbox_1",
        attempt: 1,
        completedAt: "invalid",
      }),
    ).rejects.toThrow("PROVIDER_INBOX_TRANSITION_INVALID");
    await expect(
      store.fail({
        inboxId: "inbox_1",
        attempt: 1,
        failedAt: "invalid",
        errorCode: "handler_permanent",
      }),
    ).rejects.toThrow("PROVIDER_INBOX_TRANSITION_INVALID");
  });
});
