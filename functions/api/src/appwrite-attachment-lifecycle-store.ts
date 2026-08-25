import type { TablesDB } from "node-appwrite";

import type { AttachmentLifecycle } from "@y7-feedback/domain";

import type { AttachmentLifecycleRepository } from "./attachment-lifecycle.js";

export interface AppwriteAttachmentLifecycleSchema {
  readonly databaseId: string;
  readonly attachmentsTableId: string;
}

export interface AppwriteAttachmentLifecycleTablesPort {
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly transactionId: string;
  }): Promise<unknown>;
  updateRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly transactionId: string;
  }): Promise<unknown>;
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
}

export type AppwriteAttachmentLifecycleStore = Pick<
  AttachmentLifecycleRepository,
  "compareAndSetLifecycle"
>;

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const lifecycles = new Set<AttachmentLifecycle>([
  "available",
  "soft_deleted",
  "purged",
]);

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSchema(schema: AppwriteAttachmentLifecycleSchema): void {
  if (
    !appwriteId.test(schema.databaseId) ||
    !appwriteId.test(schema.attachmentsTableId)
  ) {
    throw new Error("APPWRITE_ATTACHMENT_LIFECYCLE_SCHEMA_INVALID");
  }
}

function validLifecycle(value: unknown): value is AttachmentLifecycle {
  return typeof value === "string" && lifecycles.has(value as AttachmentLifecycle);
}

export function createAppwriteAttachmentLifecycleStore(
  tables: AppwriteAttachmentLifecycleTablesPort,
  schema: AppwriteAttachmentLifecycleSchema,
): AppwriteAttachmentLifecycleStore {
  validateSchema(schema);

  return {
    async compareAndSetLifecycle(attachmentId, expected, next) {
      if (
        !appwriteId.test(attachmentId) ||
        !validLifecycle(expected) ||
        !validLifecycle(next)
      ) {
        throw new Error("APPWRITE_ATTACHMENT_LIFECYCLE_INPUT_INVALID");
      }

      let transactionId: string | undefined;
      let closed = false;
      try {
        const transaction = await tables.createTransaction({ ttl: 60 });
        if (!appwriteId.test(transaction.$id)) {
          throw new Error("APPWRITE_ATTACHMENT_LIFECYCLE_UNAVAILABLE");
        }
        transactionId = transaction.$id;

        const row = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.attachmentsTableId,
          rowId: attachmentId,
          transactionId,
        });
        if (
          !isObject(row) ||
          row.$id !== attachmentId ||
          !validLifecycle(row.lifecycle)
        ) {
          throw new Error("APPWRITE_ATTACHMENT_LIFECYCLE_UNAVAILABLE");
        }

        if (row.lifecycle !== expected) {
          await tables.updateTransaction({ transactionId, rollback: true });
          closed = true;
          return false;
        }

        await tables.updateRow({
          databaseId: schema.databaseId,
          tableId: schema.attachmentsTableId,
          rowId: attachmentId,
          data: { lifecycle: next },
          transactionId,
        });
        await tables.updateTransaction({ transactionId, commit: true });
        closed = true;
        return true;
      } catch {
        if (transactionId !== undefined && !closed) {
          try {
            await tables.updateTransaction({ transactionId, rollback: true });
          } catch {
            // Preserve the stable lifecycle error rather than rollback details.
          }
        }
        throw new Error("APPWRITE_ATTACHMENT_LIFECYCLE_UNAVAILABLE");
      }
    },
  };
}

export function createNodeAppwriteAttachmentLifecycleStore(
  tables: TablesDB,
  schema: AppwriteAttachmentLifecycleSchema,
): AppwriteAttachmentLifecycleStore {
  return createAppwriteAttachmentLifecycleStore(
    {
      createTransaction: (input) => tables.createTransaction(input),
      getRow: (input) => tables.getRow(input),
      updateRow: (input) => tables.updateRow(input),
      updateTransaction: (input) => tables.updateTransaction(input),
    },
    schema,
  );
}
