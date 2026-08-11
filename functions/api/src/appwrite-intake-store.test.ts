import { describe, expect, it } from "vitest";

import type { AcceptanceCommit } from "./intake";
import {
  createAppwriteIntakeStore,
  createNodeAppwriteIntakeStore,
  type AppwriteIntakeSchema,
  type AppwriteTablesDbPort,
} from "./appwrite-intake-store";

const schema: AppwriteIntakeSchema = {
  databaseId: "y7",
  reportersTableId: "reporters",
  feedbackTableId: "feedback",
  lifecycleTableId: "lifecycle",
  accessGrantsTableId: "access_grants",
  notificationsTableId: "notifications",
  outboxTableId: "outbox",
  idempotencyTableId: "idempotency",
};

function acceptance(): AcceptanceCommit {
  return {
    feedback: {
      id: "feedback-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      reporterId: "reporter-1",
      type: "bug",
      originalSource: { type: "bug", problem: "Le solde est incorrect." },
      context: [],
      attachmentNames: [],
      state: "received",
      acceptedAt: "2026-08-10T17:00:00.000Z",
    },
    reporter: {
      id: "reporter-1",
      workspaceId: "workspace-1",
      attribution: { kind: "unidentified" },
    },
    lifecycle: {
      id: "history-1",
      feedbackId: "feedback-1",
      priorState: null,
      state: "received",
      actor: "system:intake",
      occurredAt: "2026-08-10T17:00:00.000Z",
      sequence: 1,
    },
    accessGrant: {
      feedbackId: "feedback-1",
      reference: "Y7-2026-000001",
      verifier: "safe-verifier",
      generation: 1,
      status: "active",
    },
    notification: {
      id: "notification-1",
      feedbackId: "feedback-1",
      reporterId: "reporter-1",
      kind: "feedback_accepted",
      reference: "Y7-2026-000001",
      createdAt: "2026-08-10T17:00:00.000Z",
    },
    outbox: {
      id: "outbox-1",
      notificationId: "notification-1",
      channel: "in_product",
      status: "pending",
      createdAt: "2026-08-10T17:00:00.000Z",
      payload: {
        kind: "feedback_accepted",
        reference: "Y7-2026-000001",
        locale: "fr",
      },
    },
    idempotency: {
      scopeKey: "workspace-1:project-1",
      clientOperationId: "123e4567-e89b-42d3-a456-426614174000",
      payloadDigest: "payload-digest",
      feedbackId: "feedback-1",
      reference: "Y7-2026-000001",
      protectedProof: "encrypted-proof-envelope",
      proofVerifier: "safe-verifier",
      createdAt: "2026-08-10T17:00:00.000Z",
    },
  };
}

class FakeTablesDb implements AppwriteTablesDbPort {
  readonly createdRows: Array<Record<string, unknown>> = [];
  readonly transactionUpdates: Array<Record<string, unknown>> = [];
  listedRows: readonly unknown[] = [];
  failTableId: string | undefined;
  failCommit = false;
  failRollback = false;
  useSdkQueries = false;
  transactionId = "transaction-1";

  createTransaction(): Promise<{ readonly $id: string }> {
    return Promise.resolve({ $id: this.transactionId });
  }

  listRows(
    input: Parameters<AppwriteTablesDbPort["listRows"]>[0],
  ): Promise<{ readonly rows: readonly unknown[] }> {
    expect(input).toMatchObject({
      databaseId: "y7",
      tableId: "idempotency",
      total: false,
      ttl: 0,
    });
    if (this.useSdkQueries) {
      expect(input.queries).toEqual([
        expect.stringContaining('"method":"equal"'),
        expect.stringContaining('"method":"equal"'),
        expect.stringContaining('"method":"limit"'),
      ]);
    } else {
      expect(input.queries).toEqual([
        "equal:scopeKey:workspace-1:project-1",
        "equal:clientOperationId:123e4567-e89b-42d3-a456-426614174000",
        "limit:2",
      ]);
    }
    return Promise.resolve({ rows: this.listedRows });
  }

  createRow(input: Parameters<AppwriteTablesDbPort["createRow"]>[0]): Promise<unknown> {
    this.createdRows.push(input);
    return input.tableId === this.failTableId
      ? Promise.reject(new Error("row failure"))
      : Promise.resolve({ $id: input.rowId });
  }

  updateTransaction(
    input: Parameters<AppwriteTablesDbPort["updateTransaction"]>[0],
  ): Promise<unknown> {
    this.transactionUpdates.push(input);
    if (input.rollback === true && this.failRollback) {
      return Promise.reject(new Error("rollback failure"));
    }
    if (input.commit === true && this.failCommit) {
      return Promise.reject(new Error("commit uncertainty"));
    }
    return Promise.resolve({ $id: "transaction-1" });
  }
}

const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(":")}`,
  limit: (limit: number) => `limit:${String(limit)}`,
};

describe("Appwrite transactional intake adapter", () => {
  it("BDD-APPWRITE-INTAKE-001 stages every acceptance fact and commits once", async () => {
    const tables = new FakeTablesDb();
    const store = createAppwriteIntakeStore(tables, schema, queries);

    await store.commit(acceptance());

    expect(tables.createdRows).toHaveLength(7);
    expect(tables.createdRows.map((row) => row.tableId)).toEqual([
      "reporters",
      "feedback",
      "lifecycle",
      "access_grants",
      "notifications",
      "outbox",
      "idempotency",
    ]);
    expect(tables.createdRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          databaseId: "y7",
          rowId: "feedback-1",
          permissions: [],
          transactionId: "transaction-1",
        }),
      ]),
    );
    expect(tables.transactionUpdates).toEqual([
      { transactionId: "transaction-1", commit: true },
    ]);
    expect(tables.createdRows[1]?.data).toMatchObject({
      currentSourceJson: JSON.stringify(acceptance().feedback.originalSource),
      reporterHistoryJson: "[]",
      reporterMessagesJson: "[]",
      reporterAttachmentsJson: "[]",
      sourceRevisionsJson: "[]",
      deletionRequestsJson: "[]",
      internalNotesJson: "[]",
      workspaceClassification: null,
    });
    expect(JSON.stringify(tables.createdRows)).not.toContain('"accessProof"');
  });

  it("BDD-APPWRITE-INTAKE-002 rolls back an incomplete transaction", async () => {
    const tables = new FakeTablesDb();
    tables.failTableId = "lifecycle";
    const store = createAppwriteIntakeStore(tables, schema, queries);

    await expect(store.commit(acceptance())).rejects.toThrow("row failure");
    expect(tables.createdRows).toHaveLength(3);
    expect(tables.transactionUpdates).toEqual([
      { transactionId: "transaction-1", rollback: true },
    ]);
  });

  it("preserves the source failure when rollback fails and never rolls back commit uncertainty", async () => {
    const rollbackFailure = new FakeTablesDb();
    rollbackFailure.failTableId = "lifecycle";
    rollbackFailure.failRollback = true;
    const rollbackStore = createAppwriteIntakeStore(rollbackFailure, schema, queries);
    await expect(rollbackStore.commit(acceptance())).rejects.toThrow("row failure");

    const commitFailure = new FakeTablesDb();
    commitFailure.failCommit = true;
    const commitStore = createAppwriteIntakeStore(commitFailure, schema, queries);
    await expect(commitStore.commit(acceptance())).rejects.toThrow(
      "commit uncertainty",
    );
    expect(commitFailure.transactionUpdates).toEqual([
      { transactionId: "transaction-1", commit: true },
    ]);
  });

  it("BDD-APPWRITE-INTAKE-003 reads one exact idempotency result and rejects ambiguity", async () => {
    const tables = new FakeTablesDb();
    const store = createAppwriteIntakeStore(tables, schema, queries);
    const record = acceptance().idempotency;
    tables.listedRows = [{ $id: "row-1", ...record }];

    await expect(
      store.findIdempotency(record.scopeKey, record.clientOperationId),
    ).resolves.toEqual(record);

    tables.listedRows = [{ ...record }, { ...record }];
    await expect(
      store.findIdempotency(record.scopeKey, record.clientOperationId),
    ).rejects.toThrow("APPWRITE_IDEMPOTENCY_INCONSISTENT");

    tables.listedRows = [{ ...record, protectedProof: 42 }];
    await expect(
      store.findIdempotency(record.scopeKey, record.clientOperationId),
    ).rejects.toThrow("APPWRITE_IDEMPOTENCY_INVALID");

    tables.listedRows = [{ ...record, protectedProof: " " }];
    await expect(
      store.findIdempotency(record.scopeKey, record.clientOperationId),
    ).rejects.toThrow("APPWRITE_IDEMPOTENCY_INVALID");

    tables.listedRows = [{ ...record, protectedProof: "x".repeat(10_001) }];
    await expect(
      store.findIdempotency(record.scopeKey, record.clientOperationId),
    ).rejects.toThrow("APPWRITE_IDEMPOTENCY_INVALID");

    tables.listedRows = [null];
    await expect(
      store.findIdempotency(record.scopeKey, record.clientOperationId),
    ).rejects.toThrow("APPWRITE_IDEMPOTENCY_INVALID");
  });

  it("returns no idempotency record and rejects duplicate or malformed schema IDs", async () => {
    const tables = new FakeTablesDb();
    const store = createAppwriteIntakeStore(tables, schema, queries);
    await expect(
      store.findIdempotency(
        "workspace-1:project-1",
        "123e4567-e89b-42d3-a456-426614174000",
      ),
    ).resolves.toBeNull();

    expect(() =>
      createAppwriteIntakeStore(
        tables,
        { ...schema, feedbackTableId: schema.reportersTableId },
        queries,
      ),
    ).toThrow("APPWRITE_INTAKE_SCHEMA_INVALID");
    expect(() =>
      createAppwriteIntakeStore(tables, { ...schema, databaseId: " " }, queries),
    ).toThrow("APPWRITE_INTAKE_SCHEMA_INVALID");
  });

  it("uses the real Appwrite query encoder and rejects malformed transaction identity", async () => {
    const tables = new FakeTablesDb();
    tables.useSdkQueries = true;
    const store = createNodeAppwriteIntakeStore(
      tables as unknown as import("node-appwrite").TablesDB,
      schema,
    );
    await expect(
      store.findIdempotency(
        "workspace-1:project-1",
        "123e4567-e89b-42d3-a456-426614174000",
      ),
    ).resolves.toBeNull();
    await expect(store.commit(acceptance())).resolves.toBeUndefined();
    expect(tables.createdRows).toHaveLength(7);

    const invalidTables = new FakeTablesDb();
    invalidTables.transactionId = "invalid transaction id";
    const invalidStore = createNodeAppwriteIntakeStore(
      invalidTables as unknown as import("node-appwrite").TablesDB,
      schema,
    );
    await expect(invalidStore.commit(acceptance())).rejects.toThrow(
      "APPWRITE_TRANSACTION_INVALID",
    );
    expect(invalidTables.createdRows).toEqual([]);
  });
});
