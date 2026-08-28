import { Query, type TablesDB } from "node-appwrite";

import {
  WorkspaceOperationDeniedError,
  type ScopedProjectIdentity,
  type WorkspaceProjectOperationPorts,
} from "./workspace-project-operations.js";

export interface AppwriteWorkspaceProjectOperationSchema {
  readonly databaseId: string;
  readonly feedbackTableId: string;
  readonly notificationsTableId: string;
}

export interface AppwriteWorkspaceProjectTablesPort {
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly [];
  }): Promise<unknown>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
    readonly transactionId?: string;
  }): Promise<{ readonly rows: readonly unknown[]; readonly total: number }>;
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
  updateRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly transactionId: string;
  }): Promise<unknown>;
  deleteRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly transactionId: string;
  }): Promise<void>;
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
}

export interface AppwriteWorkspaceProjectQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  limit(limit: number): string;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const forbiddenCommandKeys = new Set(["$id", "workspaceId", "projectId"]);
const defaultQueries: AppwriteWorkspaceProjectQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (limit) => Query.limit(limit),
};

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSchema(schema: AppwriteWorkspaceProjectOperationSchema): void {
  const ids = [schema.databaseId, schema.feedbackTableId, schema.notificationsTableId];
  if (
    ids.some((id) => !appwriteId.test(id)) ||
    schema.feedbackTableId === schema.notificationsTableId
  ) {
    throw new Error("APPWRITE_WORKSPACE_OPERATION_SCHEMA_INVALID");
  }
}

function validateScope(scope: ScopedProjectIdentity): void {
  if (
    !appwriteId.test(scope.principalId) ||
    !appwriteId.test(scope.workspaceId) ||
    !appwriteId.test(scope.projectId)
  ) {
    throw new Error("APPWRITE_WORKSPACE_OPERATION_INPUT_INVALID");
  }
}

function validateCommand(command: Readonly<Record<string, unknown>>): void {
  const keys = Object.keys(command);
  if (
    keys.length === 0 ||
    keys.length > 32 ||
    keys.some((key) => forbiddenCommandKeys.has(key) || key.startsWith("$"))
  ) {
    throw new Error("APPWRITE_WORKSPACE_OPERATION_INPUT_INVALID");
  }
}

function exactFeedback(
  value: unknown,
  feedbackId: string,
  scope: ScopedProjectIdentity,
): boolean {
  return (
    isObject(value) &&
    value.$id === feedbackId &&
    value.workspaceId === scope.workspaceId &&
    value.projectId === scope.projectId
  );
}

function exactId(value: unknown): string | undefined {
  return isObject(value) && typeof value.$id === "string" && appwriteId.test(value.$id)
    ? value.$id
    : undefined;
}

function exactScopedFeedbackId(
  value: unknown,
  scope: ScopedProjectIdentity,
): string | undefined {
  const id = exactId(value);
  return id !== undefined && exactFeedback(value, id, scope) ? id : undefined;
}

function scopeQueries(
  scope: ScopedProjectIdentity,
  queries: AppwriteWorkspaceProjectQueryPort,
): readonly string[] {
  return [
    queries.equal("workspaceId", [scope.workspaceId]),
    queries.equal("projectId", [scope.projectId]),
  ];
}

export function createAppwriteWorkspaceProjectOperationPorts(
  tables: AppwriteWorkspaceProjectTablesPort,
  schema: AppwriteWorkspaceProjectOperationSchema,
  queries: AppwriteWorkspaceProjectQueryPort,
  createId: () => string,
): WorkspaceProjectOperationPorts {
  validateSchema(schema);

  async function scopedFeedback(
    scope: ScopedProjectIdentity,
    feedbackId: string,
    transactionId?: string,
  ): Promise<void> {
    validateScope(scope);
    if (!appwriteId.test(feedbackId)) {
      throw new Error("APPWRITE_WORKSPACE_OPERATION_INPUT_INVALID");
    }
    const result = await tables.listRows({
      databaseId: schema.databaseId,
      tableId: schema.feedbackTableId,
      queries: [
        queries.equal("$id", [feedbackId]),
        ...scopeQueries(scope, queries),
        queries.limit(2),
      ],
      total: false,
      ttl: 0,
      ...(transactionId === undefined ? {} : { transactionId }),
    });
    if (result.rows.length !== 1 || !exactFeedback(result.rows[0], feedbackId, scope)) {
      throw new WorkspaceOperationDeniedError();
    }
  }

  async function mutate(
    scope: ScopedProjectIdentity,
    feedbackId: string,
    operation: (transactionId: string) => Promise<unknown>,
  ): Promise<void> {
    let transactionId: string | undefined;
    let closed = false;
    try {
      const transaction = await tables.createTransaction({ ttl: 60 });
      if (!appwriteId.test(transaction.$id)) {
        throw new Error("APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE");
      }
      transactionId = transaction.$id;
      await scopedFeedback(scope, feedbackId, transactionId);
      await operation(transactionId);
      await tables.updateTransaction({ transactionId, commit: true });
      closed = true;
    } catch (error: unknown) {
      if (transactionId !== undefined && !closed) {
        try {
          await tables.updateTransaction({ transactionId, rollback: true });
        } catch {
          // Preserve the stable originating outcome.
        }
      }
      if (error instanceof WorkspaceOperationDeniedError) throw error;
      throw new Error("APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE");
    }
  }

  return {
    feedback: {
      async create(scope, command) {
        validateScope(scope);
        validateCommand(command);
        const rowId = createId();
        if (!appwriteId.test(rowId)) {
          throw new Error("APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE");
        }
        try {
          const row = await tables.createRow({
            databaseId: schema.databaseId,
            tableId: schema.feedbackTableId,
            rowId,
            data: {
              ...command,
              workspaceId: scope.workspaceId,
              projectId: scope.projectId,
            },
            permissions: [],
          });
          if (exactId(row) !== rowId) {
            throw new Error("APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE");
          }
          return { id: rowId };
        } catch {
          throw new Error("APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE");
        }
      },
      async read(scope, feedbackId) {
        await scopedFeedback(scope, feedbackId);
        return { id: feedbackId };
      },
      async update(scope, feedbackId, command) {
        validateCommand(command);
        await mutate(scope, feedbackId, (transactionId) =>
          tables.updateRow({
            databaseId: schema.databaseId,
            tableId: schema.feedbackTableId,
            rowId: feedbackId,
            data: command,
            transactionId,
          }),
        );
        return { id: feedbackId };
      },
      async delete(scope, feedbackId) {
        await mutate(scope, feedbackId, (transactionId) =>
          tables.deleteRow({
            databaseId: schema.databaseId,
            tableId: schema.feedbackTableId,
            rowId: feedbackId,
            transactionId,
          }),
        );
      },
      async search(scope, query) {
        validateScope(scope);
        const normalized = query.trim().toLowerCase();
        if (!normalized || normalized.length > 100) {
          throw new Error("APPWRITE_WORKSPACE_OPERATION_INPUT_INVALID");
        }
        const result = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.feedbackTableId,
          queries: [...scopeQueries(scope, queries), queries.limit(100)],
          total: false,
          ttl: 0,
        });
        const ids = result.rows.map((row) => exactScopedFeedbackId(row, scope));
        if (ids.some((id) => id === undefined)) {
          throw new Error("APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE");
        }
        return {
          ids: ids
            .filter((id): id is string => id !== undefined)
            .filter((id) => id.toLowerCase().includes(normalized)),
        };
      },
      async aggregate(scope) {
        validateScope(scope);
        const result = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.feedbackTableId,
          queries: [...scopeQueries(scope, queries), queries.limit(1)],
          total: true,
          ttl: 0,
        });
        if (!Number.isSafeInteger(result.total) || result.total < 0) {
          throw new Error("APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE");
        }
        return { count: result.total };
      },
    },
    notifications: {
      async list(scope) {
        validateScope(scope);
        const result = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.notificationsTableId,
          queries: [
            queries.equal("recipientId", [scope.principalId]),
            ...scopeQueries(scope, queries),
            queries.limit(100),
          ],
          total: false,
          ttl: 0,
        });
        const notifications = result.rows.map((row) => {
          const id = exactId(row);
          const readAt = isObject(row) ? row.readAt : undefined;
          return isObject(row) &&
            id !== undefined &&
            typeof row.feedbackId === "string" &&
            appwriteId.test(row.feedbackId) &&
            row.recipientId === scope.principalId &&
            row.workspaceId === scope.workspaceId &&
            row.projectId === scope.projectId &&
            typeof row.kind === "string" &&
            typeof row.createdAt === "string" &&
            (readAt === undefined || typeof readAt === "string")
            ? {
                id,
                feedbackId: row.feedbackId,
                kind: row.kind,
                createdAt: row.createdAt,
                readAt: typeof readAt === "string" ? readAt : null,
              }
            : undefined;
        });
        if (notifications.some((notification) => notification === undefined)) {
          throw new Error("APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE");
        }
        return {
          notifications: notifications.filter(
            (notification): notification is NonNullable<typeof notification> =>
              notification !== undefined,
          ),
        };
      },
      async markRead(scope, notificationId, readAt) {
        validateScope(scope);
        if (
          !appwriteId.test(notificationId) ||
          !Number.isFinite(Date.parse(readAt)) ||
          new Date(Date.parse(readAt)).toISOString() !== readAt
        ) {
          throw new Error("APPWRITE_WORKSPACE_OPERATION_INPUT_INVALID");
        }
        const matches = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.notificationsTableId,
          queries: [
            queries.equal("$id", [notificationId]),
            queries.equal("recipientId", [scope.principalId]),
            ...scopeQueries(scope, queries),
            queries.limit(2),
          ],
          total: false,
          ttl: 0,
        });
        if (matches.rows.length !== 1) throw new WorkspaceOperationDeniedError();
        const row = matches.rows[0];
        if (
          !isObject(row) ||
          exactId(row) !== notificationId ||
          row.recipientId !== scope.principalId ||
          row.workspaceId !== scope.workspaceId ||
          row.projectId !== scope.projectId ||
          typeof row.feedbackId !== "string" ||
          !appwriteId.test(row.feedbackId)
        ) {
          throw new WorkspaceOperationDeniedError();
        }
        await mutate(scope, row.feedbackId, (transactionId) =>
          tables.updateRow({
            databaseId: schema.databaseId,
            tableId: schema.notificationsTableId,
            rowId: notificationId,
            data: { readAt },
            transactionId,
          }),
        );
        return { id: notificationId, readAt };
      },
    },
    realtime: {
      authorize(scope) {
        validateScope(scope);
        return Promise.resolve({
          channel: `workspace.${scope.workspaceId}.project.${scope.projectId}`,
        });
      },
    },
  };
}

export function createNodeAppwriteWorkspaceProjectOperationPorts(
  tables: TablesDB,
  schema: AppwriteWorkspaceProjectOperationSchema,
  createId: () => string,
): WorkspaceProjectOperationPorts {
  return createAppwriteWorkspaceProjectOperationPorts(
    {
      createRow: (input) =>
        tables.createRow({ ...input, permissions: [...input.permissions] }),
      listRows: async (input) => {
        const result = await tables.listRows({
          ...input,
          queries: [...input.queries],
        });
        return { rows: result.rows, total: result.total };
      },
      createTransaction: (input) => tables.createTransaction(input),
      updateRow: (input) => tables.updateRow(input),
      deleteRow: async (input) => {
        await tables.deleteRow(input);
      },
      updateTransaction: (input) => tables.updateTransaction(input),
    },
    schema,
    defaultQueries,
    createId,
  );
}
