import type { TablesDB } from "node-appwrite";

import type { RepositoryIdentity, SourceProvider } from "@y7-feedback/domain";

import type {
  AuthorizedSourceConnection,
  PendingSourceConnection,
  SourceConnectionStore,
} from "./source-connection-coordinator.js";

export interface AppwriteSourceConnectionSchema {
  readonly databaseId: string;
  readonly sourceConnectionsTableId: string;
}

export interface AppwriteSourceConnectionTablesPort {
  createRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly permissions: readonly string[];
  }): Promise<unknown>;
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly transactionId?: string;
  }): Promise<unknown>;
  updateRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly transactionId?: string;
  }): Promise<unknown>;
  createTransaction?(input: {
    readonly ttl: number;
  }): Promise<{ readonly $id: string }>;
  updateTransaction?(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function provider(value: unknown): SourceProvider | undefined {
  return value === "github" || value === "gitlab" ? value : undefined;
}

function text(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    ? value
    : undefined;
}

function json(value: unknown): Readonly<Record<string, unknown>> | undefined {
  const serialized = text(value, 50_000);
  if (!serialized) return undefined;
  try {
    const parsed = JSON.parse(serialized) as unknown;
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function repositories(
  value: unknown,
  expectedProvider: SourceProvider,
): readonly RepositoryIdentity[] | undefined {
  if (!Array.isArray(value) || value.length > 100) return undefined;
  const seen = new Set<string>();
  const result: RepositoryIdentity[] = [];
  for (const entry of value) {
    if (
      !isObject(entry) ||
      entry.provider !== expectedProvider ||
      typeof entry.id !== "string" ||
      !identifier.test(entry.id) ||
      seen.has(entry.id)
    ) {
      return undefined;
    }
    seen.add(entry.id);
    result.push({ provider: expectedProvider, id: entry.id });
  }
  return result;
}

function pendingRow(value: unknown): PendingSourceConnection | undefined {
  if (!isObject(value) || value.status !== "pending") return undefined;
  const state = json(value.selectedRepositoriesJson);
  const id = text(value.$id, 36);
  const workspaceId = text(value.workspaceId, 36);
  const projectId = text(value.projectId, 36);
  const sourceProvider = provider(value.provider);
  const ownerUserId = text(value.ownerUserId, 36);
  const createdAt = text(value.createdAt, 40);
  const nonceDigest = state && text(state.nonceDigest, 500);
  const returnPath = state && text(state.returnPath, 500);
  const expiresAt = state?.expiresAt;
  if (
    !id ||
    !workspaceId ||
    !projectId ||
    !sourceProvider ||
    !ownerUserId ||
    !createdAt ||
    state?.kind !== "pending" ||
    !nonceDigest ||
    !returnPath ||
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(expiresAt)
  ) {
    return undefined;
  }
  return {
    id,
    workspaceId,
    projectId,
    provider: sourceProvider,
    ownerUserId,
    nonceDigest,
    expiresAt,
    returnPath,
    createdAt,
  };
}

function exactScope(
  value: Readonly<Record<string, unknown>>,
  input: {
    readonly connectionId: string;
    readonly ownerUserId: string;
    readonly workspaceId: string;
    readonly projectId: string;
  },
): boolean {
  return (
    value.$id === input.connectionId &&
    value.ownerUserId === input.ownerUserId &&
    value.workspaceId === input.workspaceId &&
    value.projectId === input.projectId
  );
}

function validateSchema(schema: AppwriteSourceConnectionSchema): void {
  if (
    !identifier.test(schema.databaseId) ||
    !identifier.test(schema.sourceConnectionsTableId) ||
    schema.databaseId === schema.sourceConnectionsTableId
  ) {
    throw new Error("APPWRITE_SOURCE_CONNECTION_SCHEMA_INVALID");
  }
}

export function createAppwriteSourceConnectionStore(
  tables: AppwriteSourceConnectionTablesPort,
  schema: AppwriteSourceConnectionSchema,
): SourceConnectionStore {
  validateSchema(schema);
  const coordinates = (rowId: string) => ({
    databaseId: schema.databaseId,
    tableId: schema.sourceConnectionsTableId,
    rowId,
  });

  async function transaction<T>(operation: (transactionId?: string) => Promise<T>) {
    if (!tables.createTransaction || !tables.updateTransaction) {
      return operation();
    }
    const created = await tables.createTransaction({ ttl: 60 });
    if (!identifier.test(created.$id)) {
      throw new Error("APPWRITE_SOURCE_CONNECTION_UNAVAILABLE");
    }
    try {
      const result = await operation(created.$id);
      await tables.updateTransaction({ transactionId: created.$id, commit: true });
      return result;
    } catch (error) {
      try {
        await tables.updateTransaction({ transactionId: created.$id, rollback: true });
      } catch {
        // Preserve the originating stable failure.
      }
      throw error;
    }
  }

  return {
    async begin(connection) {
      if (
        !identifier.test(connection.id) ||
        !identifier.test(connection.workspaceId) ||
        !identifier.test(connection.projectId) ||
        !identifier.test(connection.ownerUserId)
      ) {
        throw new Error("APPWRITE_SOURCE_CONNECTION_INVALID");
      }
      await tables.createRow({
        ...coordinates(connection.id),
        data: {
          workspaceId: connection.workspaceId,
          projectId: connection.projectId,
          provider: connection.provider,
          ownerUserId: connection.ownerUserId,
          status: "pending",
          encryptedGrantRef: "pending",
          selectedRepositoriesJson: JSON.stringify({
            kind: "pending",
            nonceDigest: connection.nonceDigest,
            expiresAt: connection.expiresAt,
            returnPath: connection.returnPath,
          }),
          createdAt: connection.createdAt,
          updatedAt: connection.createdAt,
        },
        permissions: [],
      });
    },

    async claim(input) {
      try {
        return await transaction(async (transactionId) => {
          const value = await tables.getRow({
            ...coordinates(input.stateId),
            ...(transactionId ? { transactionId } : {}),
          });
          const pending = pendingRow(value);
          if (
            !pending ||
            pending.provider !== input.provider ||
            pending.nonceDigest !== input.nonceDigest ||
            pending.expiresAt < input.now
          ) {
            return null;
          }
          await tables.updateRow({
            ...coordinates(input.stateId),
            data: { status: "claiming" },
            ...(transactionId ? { transactionId } : {}),
          });
          return pending;
        });
      } catch (error: unknown) {
        if (isObject(error) && error.code === 404) return null;
        throw error;
      }
    },

    async authorize(connection: AuthorizedSourceConnection) {
      await tables.updateRow({
        ...coordinates(connection.id),
        data: {
          status: "selecting",
          encryptedGrantRef: connection.encryptedGrantRef,
          selectedRepositoriesJson: JSON.stringify({
            kind: "authorized",
            repositories: connection.authorizedRepositories,
          }),
        },
      });
    },

    async select(input) {
      return transaction(async (transactionId) => {
        const value = await tables.getRow({
          ...coordinates(input.connectionId),
          ...(transactionId ? { transactionId } : {}),
        });
        if (
          !isObject(value) ||
          value.status !== "selecting" ||
          !exactScope(value, input)
        ) {
          return null;
        }
        const sourceProvider = provider(value.provider);
        const state = json(value.selectedRepositoriesJson);
        const authorized = sourceProvider
          ? repositories(state?.repositories, sourceProvider)
          : undefined;
        if (state?.kind !== "authorized" || !authorized) return null;
        const requested = new Set(input.repositoryIds);
        if (
          requested.size !== input.repositoryIds.length ||
          requested.size === 0 ||
          [...requested].some((id) => !authorized.some((item) => item.id === id))
        ) {
          return null;
        }
        const selectedRepositories = authorized.filter(({ id }) => requested.has(id));
        await tables.updateRow({
          ...coordinates(input.connectionId),
          data: {
            status: "active",
            selectedRepositoriesJson: JSON.stringify({
              kind: "selected",
              repositories: selectedRepositories,
            }),
            updatedAt: input.updatedAt,
          },
          ...(transactionId ? { transactionId } : {}),
        });
        return {
          id: input.connectionId,
          provider: sourceProvider as SourceProvider,
          selectedRepositories,
        };
      });
    },

    async active(input) {
      try {
        const value = await tables.getRow(coordinates(input.connectionId));
        if (
          !isObject(value) ||
          value.status !== "active" ||
          !exactScope(value, input)
        ) {
          return null;
        }
        const sourceProvider = provider(value.provider);
        const encryptedGrantRef = text(value.encryptedGrantRef, 36);
        return sourceProvider && encryptedGrantRef
          ? {
              id: input.connectionId,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              ownerUserId: input.ownerUserId,
              provider: sourceProvider,
              encryptedGrantRef,
            }
          : null;
      } catch (error: unknown) {
        if (isObject(error) && error.code === 404) return null;
        throw error;
      }
    },

    async disconnected(connectionId) {
      await tables.updateRow({
        ...coordinates(connectionId),
        data: {
          status: "disconnected",
          encryptedGrantRef: "revoked",
          selectedRepositoriesJson: JSON.stringify({
            kind: "selected",
            repositories: [],
          }),
        },
      });
    },
  };
}

/* v8 ignore next -- thin SDK delegation is exercised by real Preview evidence */
export function createNodeAppwriteSourceConnectionStore(
  tables: TablesDB,
  schema: AppwriteSourceConnectionSchema,
): SourceConnectionStore {
  return createAppwriteSourceConnectionStore(
    {
      createRow: (input) =>
        tables.createRow({ ...input, permissions: [...input.permissions] }),
      getRow: (input) => tables.getRow(input),
      updateRow: (input) => tables.updateRow(input),
      createTransaction: (input) => tables.createTransaction(input),
      updateTransaction: (input) => tables.updateTransaction(input),
    },
    schema,
  );
}
