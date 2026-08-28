import { Query, type TablesDB } from "node-appwrite";

import type {
  NotificationMaterializationCommit,
  NotificationMaterializationStore,
} from "./notification-materializer.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface AppwriteNotificationMaterializationSchema {
  readonly databaseId: string;
  readonly notificationsTableId: string;
  readonly outboxTableId: string;
}

export interface AppwriteNotificationMaterializationTables {
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
  }): Promise<{ readonly rows: readonly unknown[] }>;
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly [];
    readonly transactionId: string;
  }): Promise<unknown>;
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
}

export interface AppwriteNotificationMaterializationQueries {
  equal(attribute: string, values: readonly string[]): string;
  limit(value: number): string;
}

const defaultQueries: AppwriteNotificationMaterializationQueries = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (value) => Query.limit(value),
};
const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

function validSchema(schema: AppwriteNotificationMaterializationSchema): boolean {
  const ids = [schema.databaseId, schema.notificationsTableId, schema.outboxTableId];
  return ids.every((id) => appwriteId.test(id)) && new Set(ids).size === ids.length;
}

function acknowledged(value: unknown, rowId: string): boolean {
  return (
    typeof value === "object" && value !== null && "$id" in value && value.$id === rowId
  );
}

export function createAppwriteNotificationMaterializationStore(
  tables: AppwriteNotificationMaterializationTables,
  schema: AppwriteNotificationMaterializationSchema,
  sensitive: AppwriteSensitivePersistence,
  queries: AppwriteNotificationMaterializationQueries = defaultQueries,
): NotificationMaterializationStore {
  if (!validSchema(schema)) {
    throw new Error("APPWRITE_NOTIFICATION_SCHEMA_INVALID");
  }
  return {
    async hasEventRecipient(eventId, recipientId) {
      const result = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.notificationsTableId,
        queries: [
          queries.equal("eventId", [eventId]),
          queries.equal("recipientId", [recipientId]),
          queries.limit(2),
        ],
        total: false,
        ttl: 0,
      });
      if (result.rows.length > 1) {
        throw new Error("APPWRITE_NOTIFICATION_DUPLICATE");
      }
      return result.rows.length === 1;
    },
    async commit(input: NotificationMaterializationCommit) {
      const transaction = await tables.createTransaction({ ttl: 60 });
      if (!appwriteId.test(transaction.$id)) {
        throw new Error("APPWRITE_NOTIFICATION_TRANSACTION_INVALID");
      }
      try {
        const notification = input.notification;
        const created = await tables.createRow({
          databaseId: schema.databaseId,
          tableId: schema.notificationsTableId,
          rowId: notification.id,
          data: {
            eventId: notification.eventId,
            feedbackId: notification.feedbackId,
            reporterId: notification.reporterId,
            workspaceId: notification.workspaceId,
            projectId: notification.projectId,
            recipientId: notification.recipientId,
            recipientKind: notification.recipientKind,
            kind: notification.kind,
            reference: notification.reference,
            createdAt: notification.createdAt,
          },
          permissions: [],
          transactionId: transaction.$id,
        });
        if (!acknowledged(created, notification.id)) {
          throw new Error("APPWRITE_NOTIFICATION_WRITE_INVALID");
        }
        for (const delivery of input.deliveries) {
          const payloadJson = sensitive.protector.seal(
            {
              environment: sensitive.environment,
              tableId: schema.outboxTableId,
              rowId: delivery.id,
              field: "payloadJson",
            },
            JSON.stringify(delivery.payload),
          );
          const outbox = await tables.createRow({
            databaseId: schema.databaseId,
            tableId: schema.outboxTableId,
            rowId: delivery.id,
            data: {
              notificationId: delivery.notificationId,
              channel: delivery.channel,
              status: delivery.status,
              createdAt: delivery.createdAt,
              payloadJson,
            },
            permissions: [],
            transactionId: transaction.$id,
          });
          if (!acknowledged(outbox, delivery.id)) {
            throw new Error("APPWRITE_NOTIFICATION_WRITE_INVALID");
          }
        }
        await tables.updateTransaction({
          transactionId: transaction.$id,
          commit: true,
        });
      } catch (error: unknown) {
        try {
          await tables.updateTransaction({
            transactionId: transaction.$id,
            rollback: true,
          });
        } catch {
          // Preserve the originating write failure.
        }
        throw new Error("APPWRITE_NOTIFICATION_WRITE_UNAVAILABLE", {
          cause: error,
        });
      }
    },
  };
}

export function createNodeAppwriteNotificationMaterializationStore(
  tables: TablesDB,
  schema: AppwriteNotificationMaterializationSchema,
  sensitive: AppwriteSensitivePersistence,
): NotificationMaterializationStore {
  return createAppwriteNotificationMaterializationStore(
    {
      listRows: async (input) => {
        const result = await tables.listRows({
          ...input,
          queries: [...input.queries],
        });
        return { rows: result.rows };
      },
      createTransaction: (input) => tables.createTransaction(input),
      createRow: (input) => tables.createRow({ ...input, permissions: [] }),
      updateTransaction: (input) => tables.updateTransaction(input),
    },
    schema,
    sensitive,
  );
}
