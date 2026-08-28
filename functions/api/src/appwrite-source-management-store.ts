import { Query, type TablesDB } from "node-appwrite";

import {
  importRepositoryMetadata,
  type ImportedRepositoryMetadata,
  type RepositoryIdentity,
  type SourceProvider,
} from "@y7-feedback/domain";

import type {
  ActiveSourceManagementConnection,
  SourceManagementConnection,
  SourceManagementStore,
  PendingSourceSelection,
  SourceProjectSlugPort,
} from "./source-management.js";

export interface AppwriteSourceManagementSchema {
  readonly databaseId: string;
  readonly sourceConnectionsTableId: string;
}

export interface AppwriteSourceManagementTablesPort {
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
    readonly transactionId?: string;
  }): Promise<unknown>;
  updateRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly transactionId: string;
  }): Promise<unknown>;
  createTransaction(input: { readonly ttl: number }): Promise<{ readonly $id: string }>;
  updateTransaction(input: {
    readonly transactionId: string;
    readonly commit?: boolean;
    readonly rollback?: boolean;
  }): Promise<unknown>;
}

export interface AppwriteSourceManagementQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  limit(value: number): string;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const slug = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
/* v8 ignore start -- Node Query serialization is exercised by deployed evidence. */
const defaultQueries: AppwriteSourceManagementQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function provider(value: unknown): SourceProvider | undefined {
  return value === "github" || value === "gitlab" ? value : undefined;
}

function parseJson(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 500_000) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return object(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function repositories(
  value: unknown,
  expectedProvider: SourceProvider,
  allowEmpty = false,
): readonly RepositoryIdentity[] | undefined {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.length > 100
  ) {
    return undefined;
  }
  const seen = new Set<string>();
  const result: RepositoryIdentity[] = [];
  for (const entry of value) {
    if (
      !object(entry) ||
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

function imports(
  value: unknown,
  connectionId: string,
  expectedProvider: SourceProvider,
  selected: readonly RepositoryIdentity[],
): readonly ImportedRepositoryMetadata[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > selected.length) return undefined;
  const result: ImportedRepositoryMetadata[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (
      !object(entry) ||
      entry.connectionId !== connectionId ||
      entry.provider !== expectedProvider ||
      typeof entry.repositoryId !== "string" ||
      !selected.some(({ id }) => id === entry.repositoryId) ||
      seen.has(entry.repositoryId) ||
      !Array.isArray(entry.releases)
    ) {
      return undefined;
    }
    try {
      const imported = importRepositoryMetadata({
        connectionId,
        observedAt: String(entry.observedAt),
        repository: {
          provider: expectedProvider,
          id: entry.repositoryId,
          name: String(entry.name),
          owner: String(entry.owner),
          visibility: entry.visibility as "public" | "private" | "internal",
          webUrl: String(entry.webUrl),
          defaultBranch: String(entry.defaultBranch),
          releases: entry.releases.map((release) => {
            if (!object(release)) throw new Error("INVALID");
            return {
              id: String(release.providerReleaseId),
              tag: String(release.tag),
              name: String(release.name),
              publishedAt: String(release.publishedAt),
              webUrl: String(release.webUrl),
            };
          }),
        },
      });
      seen.add(imported.repositoryId);
      result.push(imported);
    } catch {
      return undefined;
    }
  }
  return result;
}

function connection(
  value: unknown,
  expected?: {
    readonly connectionId?: string;
    readonly ownerUserId: string;
    readonly workspaceId: string;
    readonly projectId: string;
  },
): ActiveSourceManagementConnection | undefined {
  if (!object(value)) return undefined;
  const id = value.$id;
  const sourceProvider = provider(value.provider);
  const state = value.status;
  const selectedState = parseJson(value.selectedRepositoriesJson);
  if (
    typeof id !== "string" ||
    !identifier.test(id) ||
    !sourceProvider ||
    (state !== "active" && state !== "disconnected") ||
    typeof value.ownerUserId !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.updatedAt !== "string" ||
    selectedState?.kind !== "selected" ||
    (expected !== undefined &&
      expected.connectionId !== undefined &&
      expected.connectionId !== id) ||
    (expected !== undefined &&
      (value.ownerUserId !== expected.ownerUserId ||
        value.workspaceId !== expected.workspaceId ||
        value.projectId !== expected.projectId))
  ) {
    return undefined;
  }
  const selected = repositories(
    selectedState.repositories,
    sourceProvider,
    state === "disconnected",
  );
  const imported = selected
    ? imports(selectedState.imports, id, sourceProvider, selected)
    : undefined;
  if (!selected || !imported) return undefined;
  const encryptedGrantRef =
    state === "active" &&
    typeof value.encryptedGrantRef === "string" &&
    identifier.test(value.encryptedGrantRef)
      ? value.encryptedGrantRef
      : state === "disconnected"
        ? "revoked"
        : undefined;
  if (!encryptedGrantRef) return undefined;
  return {
    id,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    ownerUserId: value.ownerUserId,
    provider: sourceProvider,
    state,
    encryptedGrantRef,
    selectedRepositories: selected,
    importedRepositories: imported,
    updatedAt: value.updatedAt,
  };
}

function view(value: ActiveSourceManagementConnection): SourceManagementConnection {
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    provider: value.provider,
    state: value.state,
    selectedRepositories: value.selectedRepositories,
    importedRepositories: value.importedRepositories,
    updatedAt: value.updatedAt,
  };
}

function pendingSelection(
  value: unknown,
  expected: {
    readonly ownerUserId: string;
    readonly workspaceId: string;
    readonly projectId: string;
  },
): PendingSourceSelection | undefined {
  if (!object(value)) return undefined;
  const sourceProvider = provider(value.provider);
  const state = parseJson(value.selectedRepositoriesJson);
  if (
    typeof value.$id !== "string" ||
    !identifier.test(value.$id) ||
    value.status !== "selecting" ||
    !sourceProvider ||
    value.ownerUserId !== expected.ownerUserId ||
    value.workspaceId !== expected.workspaceId ||
    value.projectId !== expected.projectId ||
    typeof value.updatedAt !== "string" ||
    state?.kind !== "authorized"
  ) {
    return undefined;
  }
  const authorizedRepositories = repositories(state.repositories, sourceProvider);
  return authorizedRepositories
    ? {
        id: value.$id,
        provider: sourceProvider,
        authorizedRepositories,
        updatedAt: value.updatedAt,
      }
    : undefined;
}

export function createAppwriteSourceManagementStore(
  tables: AppwriteSourceManagementTablesPort,
  schema: AppwriteSourceManagementSchema,
  queries: AppwriteSourceManagementQueryPort = defaultQueries,
): SourceManagementStore {
  if (
    !identifier.test(schema.databaseId) ||
    !identifier.test(schema.sourceConnectionsTableId) ||
    schema.databaseId === schema.sourceConnectionsTableId
  ) {
    throw new Error("APPWRITE_SOURCE_MANAGEMENT_SCHEMA_INVALID");
  }
  const coordinates = (rowId: string) => ({
    databaseId: schema.databaseId,
    tableId: schema.sourceConnectionsTableId,
    rowId,
  });
  return {
    async list(input) {
      const result = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.sourceConnectionsTableId,
        queries: [
          queries.equal("ownerUserId", [input.ownerUserId]),
          queries.equal("workspaceId", [input.workspaceId]),
          queries.equal("projectId", [input.projectId]),
          queries.equal("status", ["active", "disconnected"]),
          queries.limit(10),
        ],
        total: false,
        ttl: 0,
      });
      const parsed = result.rows.map((row) => connection(row, input));
      if (parsed.some((item) => item === undefined)) {
        throw new Error("APPWRITE_SOURCE_MANAGEMENT_UNAVAILABLE");
      }
      return parsed.map((item) => view(item as ActiveSourceManagementConnection));
    },
    async pending(input) {
      const result = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.sourceConnectionsTableId,
        queries: [
          queries.equal("ownerUserId", [input.ownerUserId]),
          queries.equal("workspaceId", [input.workspaceId]),
          queries.equal("projectId", [input.projectId]),
          queries.equal("status", ["selecting"]),
          queries.limit(10),
        ],
        total: false,
        ttl: 0,
      });
      const parsed = result.rows.map((row) => pendingSelection(row, input));
      if (parsed.some((item) => item === undefined)) {
        throw new Error("APPWRITE_SOURCE_MANAGEMENT_UNAVAILABLE");
      }
      return parsed as readonly PendingSourceSelection[];
    },
    async active(input) {
      try {
        const value = connection(
          await tables.getRow(coordinates(input.connectionId)),
          input,
        );
        return value?.state === "active" ? value : null;
      } catch (error: unknown) {
        return object(error) && error.code === 404
          ? null
          : Promise.reject(
              error instanceof Error
                ? error
                : new Error("APPWRITE_SOURCE_MANAGEMENT_UNAVAILABLE"),
            );
      }
    },
    async saveImport(input) {
      const transaction = await tables.createTransaction({ ttl: 60 });
      if (!identifier.test(transaction.$id)) {
        throw new Error("APPWRITE_SOURCE_MANAGEMENT_UNAVAILABLE");
      }
      try {
        const current = connection(
          await tables.getRow({
            ...coordinates(input.connectionId),
            transactionId: transaction.$id,
          }),
          input,
        );
        if (
          !current ||
          current.state !== "active" ||
          !current.selectedRepositories.some(
            ({ id }) => id === input.repository.repositoryId,
          ) ||
          input.repository.connectionId !== current.id ||
          input.repository.provider !== current.provider
        ) {
          throw new Error("APPWRITE_SOURCE_MANAGEMENT_DENIED");
        }
        const importedRepositories = [
          ...current.importedRepositories.filter(
            ({ repositoryId }) => repositoryId !== input.repository.repositoryId,
          ),
          input.repository,
        ];
        const selectedRepositoriesJson = JSON.stringify({
          kind: "selected",
          repositories: current.selectedRepositories,
          imports: importedRepositories,
        });
        if (selectedRepositoriesJson.length > 500_000) {
          throw new Error("APPWRITE_SOURCE_MANAGEMENT_UNAVAILABLE");
        }
        await tables.updateRow({
          ...coordinates(input.connectionId),
          data: { selectedRepositoriesJson, updatedAt: input.updatedAt },
          transactionId: transaction.$id,
        });
        await tables.updateTransaction({
          transactionId: transaction.$id,
          commit: true,
        });
        return {
          ...view(current),
          importedRepositories,
          updatedAt: input.updatedAt,
        };
      } catch (error: unknown) {
        try {
          await tables.updateTransaction({
            transactionId: transaction.$id,
            rollback: true,
          });
        } catch {
          // Preserve the originating stable failure.
        }
        throw error;
      }
    },
  };
}

export function createAppwriteSourceProjectSlugPort(
  getRow: (input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }) => Promise<unknown>,
  schema: { readonly databaseId: string; readonly projectsTableId: string },
): SourceProjectSlugPort {
  if (
    !identifier.test(schema.databaseId) ||
    !identifier.test(schema.projectsTableId) ||
    schema.databaseId === schema.projectsTableId
  ) {
    throw new Error("APPWRITE_SOURCE_MANAGEMENT_SCHEMA_INVALID");
  }
  return {
    async current(input) {
      const row = await getRow({
        databaseId: schema.databaseId,
        tableId: schema.projectsTableId,
        rowId: input.projectId,
      });
      if (
        !object(row) ||
        row.$id !== input.projectId ||
        row.workspaceId !== input.workspaceId ||
        typeof row.slug !== "string" ||
        !slug.test(row.slug)
      ) {
        throw new Error("APPWRITE_SOURCE_MANAGEMENT_DENIED");
      }
      return row.slug;
    },
  };
}

/* v8 ignore next -- mechanical Node facade is exercised by deployed evidence. */
export function createNodeAppwriteSourceManagementStore(
  tables: TablesDB,
  schema: AppwriteSourceManagementSchema,
): SourceManagementStore {
  /* v8 ignore start -- mechanical Node facade is exercised by deployed evidence. */
  return createAppwriteSourceManagementStore(
    {
      listRows: async (input) => {
        const result = await tables.listRows({ ...input, queries: [...input.queries] });
        return { rows: result.rows };
      },
      getRow: (input) => tables.getRow(input),
      updateRow: (input) => tables.updateRow(input),
      createTransaction: (input) => tables.createTransaction(input),
      updateTransaction: (input) => tables.updateTransaction(input),
    },
    schema,
  );
  /* v8 ignore stop */
}
