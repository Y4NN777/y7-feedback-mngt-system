import { Query, type TablesDB } from "node-appwrite";

import { type ActorAccess, type NotificationEventKind } from "@y7-feedback/domain";

export interface NotificationFeedItem {
  readonly id: string;
  readonly eventId: string;
  readonly feedbackId: string;
  readonly kind: NotificationEventKind;
  readonly reference: string;
  readonly locale: "fr" | "en";
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface NotificationFeed {
  readonly items: readonly NotificationFeedItem[];
  readonly unreadCount: number;
}

export class AppwriteNotificationFeedError extends Error {
  readonly code: "ERR-NOT-DENIED" | "ERR-NOT-RETRYABLE";

  constructor(code: AppwriteNotificationFeedError["code"]) {
    super(code);
    this.name = "AppwriteNotificationFeedError";
    this.code = code;
  }
}

export interface AppwriteNotificationFeedSchema {
  readonly databaseId: string;
  readonly feedbackTableId: string;
  readonly notificationsTableId: string;
}

export interface AppwriteNotificationFeedTablesPort {
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
  }): Promise<{ readonly rows: readonly unknown[] }>;
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly transactionId: string;
  }): Promise<unknown>;
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
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

export interface AppwriteNotificationFeedQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  limit(value: number): string;
  orderDesc(attribute: string): string;
}

export interface NotificationFeedStore {
  list(input: {
    readonly actor: ActorAccess;
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<NotificationFeed>;
  markRead(input: {
    readonly actor: ActorAccess;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly notificationId: string;
    readonly readAt: string;
  }): Promise<{ readonly status: "read" | "already_read" }>;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const eventId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;
const reference = /^Y7-[A-Z0-9][A-Z0-9-]{6,78}[A-Z0-9]$/u;
const eventKinds = new Set<NotificationEventKind>([
  "feedback_received",
  "clarification_requested",
  "reporter_answered",
  "feedback_resolved",
  "feedback_closed",
  "feedback_reopened",
  "assignment_changed",
]);
/* v8 ignore start -- Query serialization and Node SDK wiring are deployed evidence */
const defaultQueries: AppwriteNotificationFeedQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (value) => Query.limit(value),
  orderDesc: (attribute) => Query.orderDesc(attribute),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function instant(value: unknown): string | undefined {
  if (typeof value !== "string" || !/(?:Z|[+]00:00)$/u.test(value)) return undefined;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return undefined;
  const normalized = new Date(milliseconds).toISOString();
  return normalized === value ? value : undefined;
}

function validateSchema(schema: AppwriteNotificationFeedSchema): void {
  const ids = [schema.databaseId, schema.feedbackTableId, schema.notificationsTableId];
  if (ids.some((id) => !appwriteId.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("APPWRITE_NOTIFICATION_FEED_SCHEMA_INVALID");
  }
}

function validateAccess(
  actor: ActorAccess,
  workspaceId: string,
  projectId: string,
): void {
  const workspace = actor.workspaceIds.includes(workspaceId);
  const project =
    actor.responsibility === "workspace_owner" ||
    (actor.responsibility === "project_maintainer" &&
      actor.projectIds.includes(projectId));
  if (
    !appwriteId.test(actor.principalId) ||
    !appwriteId.test(workspaceId) ||
    !appwriteId.test(projectId) ||
    !workspace ||
    !project
  ) {
    throw new AppwriteNotificationFeedError("ERR-NOT-DENIED");
  }
}

function parseNotification(
  value: unknown,
  expected: {
    readonly actor: ActorAccess;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly notificationId?: string;
  },
  mismatch: AppwriteNotificationFeedError["code"],
): NotificationFeedItem {
  const createdAt = object(value) ? instant(value.createdAt) : undefined;
  const readAt = object(value)
    ? value.readAt === null || value.readAt === undefined
      ? null
      : instant(value.readAt)
    : undefined;
  if (
    !object(value) ||
    typeof value.$id !== "string" ||
    !appwriteId.test(value.$id) ||
    (expected.notificationId !== undefined && value.$id !== expected.notificationId) ||
    value.workspaceId !== expected.workspaceId ||
    value.projectId !== expected.projectId ||
    value.recipientKind !== "workspace" ||
    value.recipientId !== expected.actor.principalId
  ) {
    throw new AppwriteNotificationFeedError(mismatch);
  }
  if (
    typeof value.eventId !== "string" ||
    !eventId.test(value.eventId) ||
    typeof value.feedbackId !== "string" ||
    !appwriteId.test(value.feedbackId) ||
    !eventKinds.has(value.kind as NotificationEventKind) ||
    typeof value.reference !== "string" ||
    !reference.test(value.reference) ||
    (value.locale !== "fr" && value.locale !== "en") ||
    createdAt === undefined ||
    readAt === undefined
  ) {
    throw new AppwriteNotificationFeedError("ERR-NOT-RETRYABLE");
  }
  return {
    id: value.$id,
    eventId: value.eventId,
    feedbackId: value.feedbackId,
    kind: value.kind as NotificationEventKind,
    reference: value.reference,
    locale: value.locale,
    createdAt,
    readAt,
  };
}

function authorizeFeedback(
  value: unknown,
  feedbackId: string,
  input: {
    readonly actor: ActorAccess;
    readonly workspaceId: string;
    readonly projectId: string;
  },
): void {
  if (
    !object(value) ||
    value.$id !== feedbackId ||
    value.workspaceId !== input.workspaceId ||
    value.projectId !== input.projectId ||
    (value.deletedAt !== null && value.deletedAt !== undefined) ||
    (input.actor.responsibility === "project_maintainer" &&
      value.assignedMaintainerId !== input.actor.principalId)
  ) {
    throw new AppwriteNotificationFeedError("ERR-NOT-DENIED");
  }
}

async function rollback(
  tables: AppwriteNotificationFeedTablesPort,
  transactionId: string,
): Promise<void> {
  try {
    await tables.updateTransaction({ transactionId, rollback: true });
  } catch {
    // Preserve the stable originating outcome.
  }
}

export function createAppwriteNotificationFeedStore(
  tables: AppwriteNotificationFeedTablesPort,
  schema: AppwriteNotificationFeedSchema,
  queries: AppwriteNotificationFeedQueryPort,
): NotificationFeedStore {
  validateSchema(schema);
  return {
    async list(input) {
      validateAccess(input.actor, input.workspaceId, input.projectId);
      try {
        const result = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.notificationsTableId,
          queries: [
            queries.equal("workspaceId", [input.workspaceId]),
            queries.equal("projectId", [input.projectId]),
            queries.equal("recipientKind", ["workspace"]),
            queries.equal("recipientId", [input.actor.principalId]),
            queries.orderDesc("createdAt"),
            queries.limit(100),
          ],
          total: false,
          ttl: 0,
        });
        const items = result.rows.map((row) =>
          parseNotification(row, input, "ERR-NOT-RETRYABLE"),
        );
        if (items.length === 0) return { items: [], unreadCount: 0 };
        const feedback = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.feedbackTableId,
          queries: [
            queries.equal("$id", [...new Set(items.map((item) => item.feedbackId))]),
            queries.equal("workspaceId", [input.workspaceId]),
            queries.equal("projectId", [input.projectId]),
            queries.limit(100),
          ],
          total: false,
          ttl: 0,
        });
        const byId = new Map(
          feedback.rows.flatMap((row) =>
            object(row) && typeof row.$id === "string" ? [[row.$id, row]] : [],
          ),
        );
        for (const item of items) {
          authorizeFeedback(byId.get(item.feedbackId), item.feedbackId, input);
        }
        return {
          items,
          unreadCount: items.filter((item) => item.readAt === null).length,
        };
      } catch (error: unknown) {
        if (error instanceof AppwriteNotificationFeedError) throw error;
        throw new AppwriteNotificationFeedError("ERR-NOT-RETRYABLE");
      }
    },

    async markRead(input) {
      validateAccess(input.actor, input.workspaceId, input.projectId);
      if (
        !appwriteId.test(input.notificationId) ||
        instant(input.readAt) === undefined
      ) {
        throw new AppwriteNotificationFeedError("ERR-NOT-DENIED");
      }
      let transactionId: string | undefined;
      let closed = false;
      try {
        const transaction = await tables.createTransaction({ ttl: 60 });
        if (!appwriteId.test(transaction.$id)) {
          throw new AppwriteNotificationFeedError("ERR-NOT-RETRYABLE");
        }
        transactionId = transaction.$id;
        const notification = parseNotification(
          await tables.getRow({
            databaseId: schema.databaseId,
            tableId: schema.notificationsTableId,
            rowId: input.notificationId,
            transactionId,
          }),
          input,
          "ERR-NOT-DENIED",
        );
        authorizeFeedback(
          await tables.getRow({
            databaseId: schema.databaseId,
            tableId: schema.feedbackTableId,
            rowId: notification.feedbackId,
            transactionId,
          }),
          notification.feedbackId,
          input,
        );
        if (notification.readAt !== null) {
          await rollback(tables, transactionId);
          closed = true;
          return { status: "already_read" };
        }
        const updated = await tables.updateRow({
          databaseId: schema.databaseId,
          tableId: schema.notificationsTableId,
          rowId: notification.id,
          data: { readAt: input.readAt },
          transactionId,
        });
        if (!object(updated) || updated.$id !== notification.id) {
          throw new AppwriteNotificationFeedError("ERR-NOT-RETRYABLE");
        }
        await tables.updateTransaction({ transactionId, commit: true });
        closed = true;
        return { status: "read" };
      } catch (error: unknown) {
        if (transactionId !== undefined && !closed)
          await rollback(tables, transactionId);
        if (error instanceof AppwriteNotificationFeedError) throw error;
        throw new AppwriteNotificationFeedError("ERR-NOT-RETRYABLE");
      }
    },
  };
}

/* v8 ignore start -- Node SDK composition is exercised by the deployed matrix */
export function createNodeAppwriteNotificationFeedStore(
  tables: TablesDB,
  schema: AppwriteNotificationFeedSchema,
): NotificationFeedStore {
  return createAppwriteNotificationFeedStore(
    {
      listRows: async (input) => {
        const result = await tables.listRows({ ...input, queries: [...input.queries] });
        return { rows: result.rows };
      },
      getRow: (input) => tables.getRow(input),
      createTransaction: (input) => tables.createTransaction(input),
      updateRow: (input) => tables.updateRow(input),
      updateTransaction: (input) => tables.updateTransaction(input),
    },
    schema,
    defaultQueries,
  );
}
/* v8 ignore stop */
