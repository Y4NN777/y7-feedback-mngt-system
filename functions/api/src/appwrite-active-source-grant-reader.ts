import { Query, type TablesDB } from "node-appwrite";

import type { RepositoryIdentity, SourceProvider } from "@y7-feedback/domain";

import type { AppwriteSourceConnectionSchema } from "./appwrite-source-connection-store.js";
import type { ActiveSourceGrantReader } from "./provider-webhook-reconciliation.js";
import type { ActiveSourceGrant } from "./source-connection-coordinator.js";

export interface ActiveSourceGrantTablesPort {
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: false;
  }): Promise<{ readonly rows: readonly unknown[] }>;
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function id(value: unknown): string | undefined {
  return typeof value === "string" && identifier.test(value) ? value : undefined;
}

function parseRepositories(
  serialized: unknown,
  provider: SourceProvider,
): readonly RepositoryIdentity[] | undefined {
  if (typeof serialized !== "string" || serialized.length > 50_000) return undefined;
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (
      !object(parsed) ||
      parsed.kind !== "selected" ||
      !Array.isArray(parsed.repositories)
    )
      return undefined;
    const seen = new Set<string>();
    const repositories: RepositoryIdentity[] = [];
    for (const value of parsed.repositories) {
      const repositoryId = object(value) ? id(value.id) : undefined;
      if (
        !object(value) ||
        value.provider !== provider ||
        !repositoryId ||
        seen.has(repositoryId)
      )
        return undefined;
      seen.add(repositoryId);
      repositories.push({ provider, id: repositoryId });
    }
    return repositories.length > 0 ? repositories : undefined;
  } catch {
    return undefined;
  }
}

function parse(value: unknown): ActiveSourceGrant | undefined {
  if (!object(value) || value.status !== "active") return undefined;
  const provider =
    value.provider === "github" || value.provider === "gitlab"
      ? value.provider
      : undefined;
  if (!provider) return undefined;
  const repositories = parseRepositories(value.selectedRepositoriesJson, provider);
  const connectionId = id(value.$id);
  const workspaceId = id(value.workspaceId);
  const projectId = id(value.projectId);
  const ownerUserId = id(value.ownerUserId);
  const encryptedGrantRef = id(value.encryptedGrantRef);
  return connectionId &&
    workspaceId &&
    projectId &&
    ownerUserId &&
    encryptedGrantRef &&
    repositories
    ? {
        id: connectionId,
        workspaceId,
        projectId,
        ownerUserId,
        provider,
        encryptedGrantRef,
        selectedRepositories: repositories,
      }
    : undefined;
}

export function createAppwriteActiveSourceGrantReader(
  tables: ActiveSourceGrantTablesPort,
  schema: AppwriteSourceConnectionSchema,
): ActiveSourceGrantReader {
  if (!id(schema.databaseId) || !id(schema.sourceConnectionsTableId))
    throw new Error("APPWRITE_ACTIVE_SOURCE_GRANT_CONFIG_INVALID");
  return {
    async list(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        throw new Error("APPWRITE_ACTIVE_SOURCE_GRANT_CONFIG_INVALID");
      const result = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.sourceConnectionsTableId,
        queries: [Query.equal("status", ["active"]), Query.limit(limit)],
        total: false,
      });
      const grants = result.rows.map(parse);
      if (grants.some((grant) => grant === undefined))
        throw new Error("APPWRITE_ACTIVE_SOURCE_GRANT_INVALID");
      return grants as readonly ActiveSourceGrant[];
    },
  };
}

/* v8 ignore next -- thin SDK delegation is covered by Preview reconciliation */
export function createNodeAppwriteActiveSourceGrantReader(
  tables: TablesDB,
  schema: AppwriteSourceConnectionSchema,
): ActiveSourceGrantReader {
  return createAppwriteActiveSourceGrantReader(
    { listRows: (input) => tables.listRows({ ...input, queries: [...input.queries] }) },
    schema,
  );
}
