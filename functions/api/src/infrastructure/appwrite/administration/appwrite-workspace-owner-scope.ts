import { Query, type TablesDB } from "node-appwrite";

export interface AppwriteWorkspaceOwnerScopeSchema {
  readonly databaseId: string;
  readonly workspaceMembershipsTableId: string;
}

export interface AppwriteWorkspaceOwnerScopeTablesPort {
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
  }): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface AppwriteWorkspaceOwnerScopeQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  limit(limit: number): string;
}

export type WorkspaceOwnerScopeOutcome =
  | {
      readonly status: "authorized";
      readonly principalId: string;
      readonly workspaceId: string;
    }
  | { readonly status: "denied" | "retryable" };

export interface WorkspaceOwnerScopeResolver {
  resolve(input: {
    readonly principalId: string;
    readonly workspaceId: string;
  }): Promise<WorkspaceOwnerScopeOutcome>;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const defaultQueries: AppwriteWorkspaceOwnerScopeQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (limit) => Query.limit(limit),
};

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return isObject(error) && error.code === 404;
}

function validateSchema(schema: AppwriteWorkspaceOwnerScopeSchema): void {
  const ids = [schema.databaseId, schema.workspaceMembershipsTableId];
  if (ids.some((id) => !appwriteId.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("APPWRITE_WORKSPACE_OWNER_SCOPE_SCHEMA_INVALID");
  }
}

function exactMembership(
  value: unknown,
  principalId: string,
  workspaceId: string,
): "owner" | "denied" | "invalid" {
  if (
    !isObject(value) ||
    typeof value.$id !== "string" ||
    !appwriteId.test(value.$id) ||
    value.userId !== principalId ||
    value.workspaceId !== workspaceId ||
    typeof value.role !== "string" ||
    typeof value.status !== "string"
  ) {
    return "invalid";
  }
  return value.role === "workspace_owner" && value.status === "active"
    ? "owner"
    : "denied";
}

export function createAppwriteWorkspaceOwnerScopeResolver(
  tables: AppwriteWorkspaceOwnerScopeTablesPort,
  schema: AppwriteWorkspaceOwnerScopeSchema,
  queries: AppwriteWorkspaceOwnerScopeQueryPort,
): WorkspaceOwnerScopeResolver {
  validateSchema(schema);
  return {
    async resolve(input) {
      if (!appwriteId.test(input.principalId) || !appwriteId.test(input.workspaceId)) {
        return { status: "denied" };
      }
      try {
        const memberships = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.workspaceMembershipsTableId,
          queries: [
            queries.equal("userId", [input.principalId]),
            queries.equal("workspaceId", [input.workspaceId]),
            queries.limit(2),
          ],
          total: false,
          ttl: 0,
        });
        if (memberships.rows.length === 0) return { status: "denied" };
        if (memberships.rows.length !== 1) return { status: "retryable" };
        const membership = exactMembership(
          memberships.rows[0],
          input.principalId,
          input.workspaceId,
        );
        if (membership === "invalid") return { status: "retryable" };
        return membership === "owner"
          ? {
              status: "authorized",
              principalId: input.principalId,
              workspaceId: input.workspaceId,
            }
          : { status: "denied" };
      } catch (error: unknown) {
        return absent(error) ? { status: "denied" } : { status: "retryable" };
      }
    },
  };
}

export function createNodeAppwriteWorkspaceOwnerScopeResolver(
  tables: TablesDB,
  schema: AppwriteWorkspaceOwnerScopeSchema,
): WorkspaceOwnerScopeResolver {
  return createAppwriteWorkspaceOwnerScopeResolver(
    {
      listRows: async (input) => {
        const result = await tables.listRows({
          ...input,
          queries: [...input.queries],
        });
        return { rows: result.rows };
      },
    },
    schema,
    defaultQueries,
  );
}
