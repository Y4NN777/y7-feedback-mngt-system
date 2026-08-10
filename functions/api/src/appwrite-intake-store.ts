import { createHash } from "node:crypto";

import { Query, type TablesDB } from "node-appwrite";

import type { AcceptanceCommit, IdempotencyRecord, IntakeStore } from "./intake";

export interface AppwriteIntakeSchema {
  readonly databaseId: string;
  readonly reportersTableId: string;
  readonly feedbackTableId: string;
  readonly lifecycleTableId: string;
  readonly accessGrantsTableId: string;
  readonly notificationsTableId: string;
  readonly outboxTableId: string;
  readonly idempotencyTableId: string;
}

export interface AppwriteTablesDbPort {
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: string[];
    readonly total: boolean;
    readonly ttl: number;
  }): Promise<{
    readonly rows: readonly unknown[];
  }>;
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: string[];
    readonly transactionId: string;
  }): Promise<unknown>;
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
}

export interface AppwriteQueryPort {
  readonly equal: (attribute: string, values: readonly string[]) => string;
  readonly limit: (limit: number) => string;
}

const defaultQueries: AppwriteQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (limit) => Query.limit(limit),
};

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

function validateSchema(schema: AppwriteIntakeSchema): void {
  const tableIds = [
    schema.reportersTableId,
    schema.feedbackTableId,
    schema.lifecycleTableId,
    schema.accessGrantsTableId,
    schema.notificationsTableId,
    schema.outboxTableId,
    schema.idempotencyTableId,
  ];
  if (
    !appwriteId.test(schema.databaseId) ||
    tableIds.some((id) => !appwriteId.test(id)) ||
    new Set(tableIds).size !== tableIds.length
  ) {
    throw new Error("APPWRITE_INTAKE_SCHEMA_INVALID");
  }
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  row: Readonly<Record<string, unknown>>,
  key: keyof IdempotencyRecord,
): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim() || value.length > 10_000) {
    throw new Error("APPWRITE_IDEMPOTENCY_INVALID");
  }
  return value;
}

function parseIdempotency(value: unknown): IdempotencyRecord {
  if (!isObject(value)) throw new Error("APPWRITE_IDEMPOTENCY_INVALID");
  return {
    scopeKey: requiredString(value, "scopeKey"),
    clientOperationId: requiredString(value, "clientOperationId"),
    payloadDigest: requiredString(value, "payloadDigest"),
    feedbackId: requiredString(value, "feedbackId"),
    reference: requiredString(value, "reference"),
    protectedProof: requiredString(value, "protectedProof"),
    proofVerifier: requiredString(value, "proofVerifier"),
    createdAt: requiredString(value, "createdAt"),
  };
}

function idempotencyRowId(record: IdempotencyRecord): string {
  const digest = createHash("sha256")
    .update(record.scopeKey)
    .update("\0")
    .update(record.clientOperationId)
    .digest("hex");
  return `idem_${digest.slice(0, 31)}`;
}

function rowsForCommit(
  input: AcceptanceCommit,
  schema: AppwriteIntakeSchema,
): readonly {
  readonly tableId: string;
  readonly rowId: string;
  readonly data: Readonly<Record<string, unknown>>;
}[] {
  return [
    {
      tableId: schema.reportersTableId,
      rowId: input.reporter.id,
      data: {
        workspaceId: input.reporter.workspaceId,
        attributionJson: JSON.stringify(input.reporter.attribution),
      },
    },
    {
      tableId: schema.feedbackTableId,
      rowId: input.feedback.id,
      data: {
        projectId: input.feedback.projectId,
        workspaceId: input.feedback.workspaceId,
        reporterId: input.feedback.reporterId,
        type: input.feedback.type,
        originalSourceJson: JSON.stringify(input.feedback.originalSource),
        currentSourceJson: JSON.stringify(input.feedback.originalSource),
        contextJson: JSON.stringify(input.feedback.context),
        attachmentNamesJson: JSON.stringify(input.feedback.attachmentNames),
        state: input.feedback.state,
        acceptedAt: input.feedback.acceptedAt,
        reporterHistoryJson: "[]",
        reporterMessagesJson: "[]",
        reporterAttachmentsJson: "[]",
        sourceRevisionsJson: "[]",
        deletionRequestsJson: "[]",
        internalNotesJson: "[]",
        workspaceClassification: null,
      },
    },
    {
      tableId: schema.lifecycleTableId,
      rowId: input.lifecycle.id,
      data: { ...input.lifecycle },
    },
    {
      tableId: schema.accessGrantsTableId,
      rowId: input.accessGrant.feedbackId,
      data: { ...input.accessGrant },
    },
    {
      tableId: schema.notificationsTableId,
      rowId: input.notification.id,
      data: { ...input.notification },
    },
    {
      tableId: schema.outboxTableId,
      rowId: input.outbox.id,
      data: {
        notificationId: input.outbox.notificationId,
        channel: input.outbox.channel,
        status: input.outbox.status,
        createdAt: input.outbox.createdAt,
        payloadJson: JSON.stringify(input.outbox.payload),
      },
    },
    {
      tableId: schema.idempotencyTableId,
      rowId: idempotencyRowId(input.idempotency),
      data: { ...input.idempotency },
    },
  ];
}

export function createAppwriteIntakeStore(
  tables: AppwriteTablesDbPort,
  schema: AppwriteIntakeSchema,
  queries: AppwriteQueryPort = defaultQueries,
): IntakeStore {
  validateSchema(schema);
  return {
    async findIdempotency(scopeKey, clientOperationId) {
      const result = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.idempotencyTableId,
        queries: [
          queries.equal("scopeKey", [scopeKey]),
          queries.equal("clientOperationId", [clientOperationId]),
          queries.limit(2),
        ],
        total: false,
        ttl: 0,
      });
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) {
        throw new Error("APPWRITE_IDEMPOTENCY_INCONSISTENT");
      }
      return parseIdempotency(result.rows[0]);
    },

    async commit(input) {
      const transaction = await tables.createTransaction({ ttl: 60 });
      if (!appwriteId.test(transaction.$id)) {
        throw new Error("APPWRITE_TRANSACTION_INVALID");
      }
      let rowsStaged = false;
      try {
        for (const row of rowsForCommit(input, schema)) {
          await tables.createRow({
            databaseId: schema.databaseId,
            tableId: row.tableId,
            rowId: row.rowId,
            data: row.data,
            permissions: [],
            transactionId: transaction.$id,
          });
        }
        rowsStaged = true;
        await tables.updateTransaction({
          transactionId: transaction.$id,
          commit: true,
        });
      } catch (error: unknown) {
        if (!rowsStaged) {
          try {
            await tables.updateTransaction({
              transactionId: transaction.$id,
              rollback: true,
            });
          } catch {
            // The originating transaction error remains authoritative.
          }
        }
        throw error;
      }
    },
  };
}

export function createNodeAppwriteIntakeStore(
  tables: TablesDB,
  schema: AppwriteIntakeSchema,
): IntakeStore {
  return createAppwriteIntakeStore(
    {
      createTransaction: (input) => tables.createTransaction(input),
      listRows: async (input) => {
        const result = await tables.listRows(input);
        return { rows: result.rows };
      },
      createRow: (input) => tables.createRow(input),
      updateTransaction: (input) => tables.updateTransaction(input),
    },
    schema,
  );
}
