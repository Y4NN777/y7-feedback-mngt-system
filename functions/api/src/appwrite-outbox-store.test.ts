/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects port mocks without invoking detached methods. */
import { describe, expect, it, vi } from "vitest";

import {
  createAppwriteOutboxStore,
  createNodeAppwriteOutboxStore,
  type AppwriteOutboxTablesPort,
} from "./appwrite-outbox-store";
import { createSensitiveDataProtector } from "./sensitive-data-protector";

const schema = { databaseId: "feedback", outboxTableId: "notification_outbox" };
const sensitive = {
  environment: "development",
  protector: createSensitiveDataProtector("test_key", [
    { id: "test_key", material: Buffer.alloc(32, 7) },
  ]),
};
const context = {
  environment: sensitive.environment,
  tableId: schema.outboxTableId,
  rowId: "outbox_1",
  field: "payloadJson",
};

function payload(value: unknown): string {
  return sensitive.protector.seal(context, JSON.stringify(value));
}

function row(
  status = "pending",
  protectedPayload = payload({ reference: "private-reference" }),
) {
  return {
    $id: "outbox_1",
    notificationId: "notification_1",
    channel: "email",
    status,
    createdAt: "2026-08-24T20:00:00.000Z",
    payloadJson: protectedPayload,
  };
}

function queries() {
  return {
    equal: (attribute: string, values: readonly string[]) =>
      `equal:${attribute}:${values.join(",")}`,
    orderAsc: (attribute: string) => `order:${attribute}`,
    limit: (value: number) => `limit:${String(value)}`,
  };
}

function setup(initial = row()) {
  let current: Readonly<Record<string, unknown>> = initial;
  let transaction = 0;
  const tables: AppwriteOutboxTablesPort = {
    createTransaction: vi.fn(() =>
      Promise.resolve({ $id: `transaction_${String(++transaction)}` }),
    ),
    listRows: vi.fn(() => Promise.resolve({ rows: [current] })),
    getRow: vi.fn(() => Promise.resolve(current)),
    updateRow: vi.fn<AppwriteOutboxTablesPort["updateRow"]>((input) => {
      current = { ...current, ...input.data };
      return Promise.resolve(current);
    }),
    updateTransaction: vi.fn(() => Promise.resolve({})),
    isConflict: vi.fn(() => false),
  };
  return {
    get current() {
      return current;
    },
    store: createAppwriteOutboxStore(tables, schema, queries(), sensitive),
    tables,
  };
}

const request = {
  workerId: "worker_preview_1",
  leaseToken: "lease_token_1234",
  now: "2026-08-24T20:01:00.000Z",
  leaseUntil: "2026-08-24T20:01:30.000Z",
};

function opened(current: Readonly<Record<string, unknown>>) {
  return JSON.parse(
    sensitive.protector.open(context, String(current.payloadJson)),
  ) as Readonly<Record<string, unknown>>;
}

describe("Appwrite durable outbox adapter", () => {
  it("BDD-OUTBOX-DB-001 claims, delivers, and deduplicates one encrypted row", async () => {
    const target = setup();
    await expect(target.store.claim(request)).resolves.toEqual({
      outboxId: "outbox_1",
      deliveryId: "notification_1",
      channel: "email",
      payload: { reference: "private-reference" },
      attempt: 1,
      leaseToken: "lease_token_1234",
    });
    expect(target.current.status).toBe("processing");
    expect(opened(target.current)).toEqual({
      version: 1,
      message: { reference: "private-reference" },
      delivery: {
        attempts: 1,
        lease: {
          token: "lease_token_1234",
          workerId: "worker_preview_1",
          until: "2026-08-24T20:01:30.000Z",
        },
      },
    });

    await target.store.markDelivered({
      outboxId: "outbox_1",
      leaseToken: "lease_token_1234",
      deliveredAt: "2026-08-24T20:01:01.000Z",
    });
    expect(target.current.status).toBe("delivered");
    await expect(target.store.claim(request)).resolves.toBeNull();
  });

  it("BDD-OUTBOX-DB-002 reschedules and reclaims only when due", async () => {
    const target = setup();
    await target.store.claim(request);
    await target.store.reschedule({
      outboxId: "outbox_1",
      leaseToken: "lease_token_1234",
      nextAttemptAt: "2026-08-24T20:02:00.000Z",
    });
    await expect(target.store.claim(request)).resolves.toBeNull();
    await expect(
      target.store.claim({
        ...request,
        leaseToken: "lease_token_5678",
        now: "2026-08-24T20:02:00.000Z",
      }),
    ).resolves.toEqual(expect.objectContaining({ attempt: 2 }));
    await target.store.markFailed({
      outboxId: "outbox_1",
      leaseToken: "lease_token_5678",
      failedAt: "2026-08-24T20:02:01.000Z",
      reason: "attempts_exhausted",
    });
    expect(target.current.status).toBe("failed");
  });

  it("BDD-OUTBOX-DB-003 recovers an expired lease", async () => {
    const target = setup(
      row(
        "processing",
        payload({
          version: 1,
          message: { kind: "feedback_accepted" },
          delivery: {
            attempts: 1,
            lease: {
              token: "lease_expired_1",
              workerId: "worker_expired_1",
              until: "2026-08-24T20:00:30.000Z",
            },
          },
        }),
      ),
    );
    await expect(target.store.claim(request)).resolves.toEqual(
      expect.objectContaining({ attempt: 2 }),
    );
  });

  it("BDD-OUTBOX-DB-004 loses a concurrent claim without duplicate delivery", async () => {
    const guarded = setup();
    const guardedStore = createAppwriteOutboxStore(
      guarded.tables,
      schema,
      queries(),
      sensitive,
      () => false,
    );
    await expect(guardedStore.claim(request)).resolves.toBeNull();

    const changed = setup();
    vi.mocked(changed.tables.getRow).mockResolvedValueOnce(
      row(
        "delivered",
        payload({
          version: 1,
          message: {},
          delivery: {
            attempts: 1,
            deliveredAt: "2026-08-24T20:00:30.000Z",
          },
        }),
      ),
    );
    await expect(changed.store.claim(request)).resolves.toBeNull();

    const conflict = setup();
    vi.mocked(conflict.tables.updateRow).mockRejectedValueOnce({ code: 409 });
    vi.mocked(conflict.tables.isConflict).mockReturnValueOnce(true);
    await expect(conflict.store.claim(request)).resolves.toBeNull();
  });

  it("BDD-OUTBOX-DB-005 preserves infrastructure and lease failures", async () => {
    const unavailable = setup();
    vi.mocked(unavailable.tables.updateRow).mockRejectedValueOnce(
      new Error("write unavailable"),
    );
    await expect(unavailable.store.claim(request)).rejects.toThrow("write unavailable");

    const rollbackUnavailable = setup();
    vi.mocked(rollbackUnavailable.tables.updateRow).mockRejectedValueOnce(
      new Error("source failure"),
    );
    vi.mocked(rollbackUnavailable.tables.updateTransaction).mockRejectedValueOnce(
      new Error("rollback failure"),
    );
    await expect(rollbackUnavailable.store.claim(request)).rejects.toThrow(
      "source failure",
    );

    const lostLease = setup();
    await expect(
      lostLease.store.markDelivered({
        outboxId: "outbox_1",
        leaseToken: "lease_wrong_123",
        deliveredAt: "2026-08-24T20:01:01.000Z",
      }),
    ).rejects.toThrow("APPWRITE_OUTBOX_LEASE_LOST");

    const invalidTransition = setup();
    await invalidTransition.store.claim(request);
    vi.mocked(invalidTransition.tables.createTransaction).mockResolvedValueOnce({
      $id: "bad transaction",
    });
    await expect(
      invalidTransition.store.markDelivered({
        outboxId: "outbox_1",
        leaseToken: "lease_token_1234",
        deliveredAt: "2026-08-24T20:01:01.000Z",
      }),
    ).rejects.toThrow("APPWRITE_OUTBOX_TRANSACTION_INVALID");
  });

  it("rejects invalid schema, transaction identity, and persisted rows", async () => {
    expect(() =>
      createAppwriteOutboxStore(
        { ...setup().tables },
        { ...schema, outboxTableId: "bad id" },
        queries(),
        sensitive,
      ),
    ).toThrow("APPWRITE_OUTBOX_SCHEMA_INVALID");

    const invalidTransaction = setup();
    vi.mocked(invalidTransaction.tables.createTransaction).mockResolvedValueOnce({
      $id: "bad transaction",
    });
    await expect(invalidTransaction.store.claim(request)).rejects.toThrow(
      "APPWRITE_OUTBOX_TRANSACTION_INVALID",
    );

    for (const invalidRow of [
      null,
      { ...row(), $id: 7 },
      { ...row(), $id: "" },
      { ...row(), $id: "a".repeat(37) },
      { ...row(), $id: "bad id" },
      { ...row(), channel: "sms" },
      { ...row(), status: "unknown" },
      { ...row(), createdAt: "yesterday" },
      { ...row(), createdAt: "2026-08-24T20:00:00+01:00" },
      { ...row(), payloadJson: "not-an-envelope" },
      row("retryable", payload({ version: 1, message: {}, delivery: null })),
      row(
        "retryable",
        payload({ version: 1, message: {}, delivery: { attempts: -1 } }),
      ),
      row(
        "processing",
        payload({ version: 1, message: {}, delivery: { attempts: 1, lease: null } }),
      ),
      row(
        "processing",
        payload({
          version: 1,
          message: {},
          delivery: {
            attempts: 1,
            lease: { token: "short", workerId: "worker_valid_1", until: request.now },
          },
        }),
      ),
      row(
        "processing",
        payload({
          version: 1,
          message: {},
          delivery: {
            attempts: 1,
            lease: { token: "lease_valid_1", workerId: "short", until: request.now },
          },
        }),
      ),
      row(
        "failed",
        payload({
          version: 1,
          message: {},
          delivery: { attempts: 1, failureReason: "wrong" },
        }),
      ),
    ]) {
      const target = setup(row());
      vi.mocked(target.tables.listRows).mockResolvedValueOnce({ rows: [invalidRow] });
      await expect(target.store.claim(request)).rejects.toThrow(
        "APPWRITE_OUTBOX_ROW_INVALID",
      );
    }

    const validTerminal = setup(
      row(
        "failed",
        payload({
          version: 1,
          message: {},
          delivery: {
            attempts: 3,
            failedAt: "2026-08-24T20:03:00.000Z",
            failureReason: "attempts_exhausted",
          },
        }),
      ),
    );
    await expect(validTerminal.store.claim(request)).resolves.toBeNull();

    const equivalentUtc = setup({
      ...row(),
      createdAt: "2026-08-24T20:00:00+00:00",
    });
    await expect(equivalentUtc.store.claim(request)).resolves.toEqual(
      expect.objectContaining({ attempt: 1 }),
    );
  });

  it("maps the Node Appwrite SDK and conflict semantics", async () => {
    expect(() =>
      createNodeAppwriteOutboxStore({} as never, schema, sensitive, new Set()),
    ).toThrow("APPWRITE_OUTBOX_CANDIDATES_INVALID");
    expect(() =>
      createNodeAppwriteOutboxStore(
        {} as never,
        schema,
        sensitive,
        new Set(["bad id"]),
      ),
    ).toThrow("APPWRITE_OUTBOX_CANDIDATES_INVALID");
    const tables = {
      createTransaction: vi.fn(() => Promise.resolve({ $id: "transaction_1" })),
      listRows: vi.fn(() => Promise.resolve({ rows: [] })),
      getRow: vi.fn(),
      updateRow: vi.fn(),
      updateTransaction: vi.fn(),
    };
    const store = createNodeAppwriteOutboxStore(tables as never, schema, sensitive);
    await expect(store.claim(request)).resolves.toBeNull();
    expect(tables.listRows).toHaveBeenCalledOnce();

    const activeTables = {
      createTransaction: vi.fn(() => Promise.resolve({ $id: "transaction_1" })),
      listRows: vi.fn(() => Promise.resolve({ rows: [row()] })),
      getRow: vi.fn(() => Promise.resolve(row())),
      updateRow: vi.fn(() => Promise.resolve(row("processing"))),
      updateTransaction: vi.fn(() => Promise.resolve({})),
    };
    const active = createNodeAppwriteOutboxStore(
      activeTables as never,
      schema,
      sensitive,
      new Set(["outbox_1"]),
    );
    await expect(active.claim(request)).resolves.toEqual(
      expect.objectContaining({ attempt: 1 }),
    );
    expect(activeTables.getRow).toHaveBeenCalledOnce();
    expect(activeTables.updateRow).toHaveBeenCalledOnce();
    expect(activeTables.updateTransaction).toHaveBeenCalledWith({
      transactionId: "transaction_1",
      commit: true,
    });

    for (const conflict of [
      Object.assign(new Error("conflict"), { code: 409 }),
      Object.assign(new Error("conflict"), { type: "row_conflict" }),
    ]) {
      const conflictingTables = {
        ...activeTables,
        createTransaction: vi.fn(() =>
          Promise.resolve({ $id: "transaction_conflict" }),
        ),
        listRows: vi.fn(() => Promise.resolve({ rows: [row()] })),
        getRow: vi.fn(() => Promise.resolve(row())),
        updateRow: vi.fn(() => Promise.reject(conflict)),
        updateTransaction: vi.fn(() => Promise.resolve({})),
      };
      const conflicting = createNodeAppwriteOutboxStore(
        conflictingTables as never,
        schema,
        sensitive,
      );
      await expect(conflicting.claim(request)).resolves.toBeNull();
    }

    const nonConflictTables = {
      ...activeTables,
      createTransaction: vi.fn(() => Promise.resolve({ $id: "transaction_error" })),
      listRows: vi.fn(() => Promise.resolve({ rows: [row()] })),
      getRow: vi.fn(() => Promise.resolve(row())),
      updateRow: vi.fn(() => Promise.reject(new Error("not a conflict"))),
      updateTransaction: vi.fn(() => Promise.resolve({})),
    };
    const nonConflict = createNodeAppwriteOutboxStore(
      nonConflictTables as never,
      schema,
      sensitive,
    );
    await expect(nonConflict.claim(request)).rejects.toThrow("not a conflict");
  });
});
