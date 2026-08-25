import { Query, type TablesDB } from "node-appwrite";

import {
  createAuthorizationPolicy,
  type ActorAccess,
  type Project,
} from "@y7-feedback/domain";

import type { WorkspaceAttachmentScopeResolver } from "./workspace-attachment-download.js";

export interface AppwriteWorkspaceAttachmentScopeSchema {
  readonly databaseId: string;
  readonly projectsTableId: string;
  readonly workspaceMembershipsTableId: string;
  readonly projectAssignmentsTableId: string;
}

export interface AppwriteWorkspaceScopeTablesPort {
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
  }): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface AppwriteWorkspaceScopeQueryPort {
  equal(attribute: string, values: readonly string[]): string;
  limit(limit: number): string;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
const defaultQueries: AppwriteWorkspaceScopeQueryPort = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (limit) => Query.limit(limit),
};

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return isObject(error) && error.code === 404;
}

function validateSchema(schema: AppwriteWorkspaceAttachmentScopeSchema): void {
  const ids = [
    schema.databaseId,
    schema.projectsTableId,
    schema.workspaceMembershipsTableId,
    schema.projectAssignmentsTableId,
  ];
  if (ids.some((id) => !appwriteId.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("APPWRITE_WORKSPACE_SCOPE_SCHEMA_INVALID");
  }
}

function exactProject(value: unknown, projectId: string): Project | undefined {
  if (
    !isObject(value) ||
    value.$id !== projectId ||
    typeof value.workspaceId !== "string" ||
    !appwriteId.test(value.workspaceId) ||
    typeof value.active !== "boolean"
  ) {
    return undefined;
  }
  return { id: projectId, workspaceId: value.workspaceId, active: value.active };
}

function exactMembership(
  value: unknown,
  principalId: string,
  workspaceId: string,
): ActorAccess | undefined {
  if (
    !isObject(value) ||
    typeof value.$id !== "string" ||
    !appwriteId.test(value.$id) ||
    value.userId !== principalId ||
    value.workspaceId !== workspaceId ||
    (value.role !== "workspace_owner" && value.role !== "project_maintainer") ||
    typeof value.status !== "string"
  ) {
    return undefined;
  }
  return {
    principalId,
    responsibility: value.role,
    workspaceIds: value.status === "active" ? [workspaceId] : [],
    projectIds: [],
  };
}

function exactAssignment(
  value: unknown,
  principalId: string,
  workspaceId: string,
  projectId: string,
): boolean | undefined {
  if (
    !isObject(value) ||
    typeof value.$id !== "string" ||
    !appwriteId.test(value.$id) ||
    value.userId !== principalId ||
    value.workspaceId !== workspaceId ||
    value.projectId !== projectId ||
    typeof value.status !== "string"
  ) {
    return undefined;
  }
  return value.status === "active";
}

export function createAppwriteWorkspaceAttachmentScopeResolver(
  tables: AppwriteWorkspaceScopeTablesPort,
  schema: AppwriteWorkspaceAttachmentScopeSchema,
  queries: AppwriteWorkspaceScopeQueryPort,
): WorkspaceAttachmentScopeResolver {
  validateSchema(schema);
  const policy = createAuthorizationPolicy();

  return {
    async resolve(input) {
      if (
        !appwriteId.test(input.principalId) ||
        !appwriteId.test(input.workspaceId) ||
        !appwriteId.test(input.projectId)
      ) {
        return { status: "denied" };
      }
      try {
        const rawProject = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.projectsTableId,
          rowId: input.projectId,
        });
        const project = exactProject(rawProject, input.projectId);
        if (!project) return { status: "retryable" };
        if (!project.active || project.workspaceId !== input.workspaceId) {
          return { status: "denied" };
        }

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
        let actor = exactMembership(
          memberships.rows[0],
          input.principalId,
          input.workspaceId,
        );
        if (!actor) return { status: "retryable" };

        if (actor.responsibility === "project_maintainer") {
          const assignments = await tables.listRows({
            databaseId: schema.databaseId,
            tableId: schema.projectAssignmentsTableId,
            queries: [
              queries.equal("userId", [input.principalId]),
              queries.equal("workspaceId", [input.workspaceId]),
              queries.equal("projectId", [input.projectId]),
              queries.limit(2),
            ],
            total: false,
            ttl: 0,
          });
          if (assignments.rows.length === 0) return { status: "denied" };
          if (assignments.rows.length !== 1) return { status: "retryable" };
          const active = exactAssignment(
            assignments.rows[0],
            input.principalId,
            input.workspaceId,
            input.projectId,
          );
          if (active === undefined) return { status: "retryable" };
          actor = { ...actor, projectIds: active ? [input.projectId] : [] };
        }

        if (!policy.can(actor, "attachment.read", project)) {
          return { status: "denied" };
        }
        return {
          status: "authorized",
          authorization: {
            kind: "workspace_actor",
            authorizedWorkspaceId: input.workspaceId,
            authorizedProjectId: input.projectId,
            canReadAttachments: true,
          },
        };
      } catch (error: unknown) {
        return absent(error) ? { status: "denied" } : { status: "retryable" };
      }
    },
  };
}

export function createNodeAppwriteWorkspaceAttachmentScopeResolver(
  tables: TablesDB,
  schema: AppwriteWorkspaceAttachmentScopeSchema,
): WorkspaceAttachmentScopeResolver {
  return createAppwriteWorkspaceAttachmentScopeResolver(
    {
      getRow: (input) => tables.getRow(input),
      listRows: async (input) => {
        const rows = await tables.listRows({
          ...input,
          queries: [...input.queries],
        });
        return { rows: rows.rows };
      },
    },
    schema,
    defaultQueries,
  );
}
