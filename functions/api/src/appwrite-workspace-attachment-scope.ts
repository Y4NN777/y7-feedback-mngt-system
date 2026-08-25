import type { TablesDB } from "node-appwrite";

import type { WorkspaceAttachmentScopeResolver } from "./workspace-attachment-download.js";
import {
  createAppwriteWorkspaceCapabilityScopeResolver,
  createNodeAppwriteWorkspaceCapabilityScopeResolver,
  type AppwriteWorkspaceCapabilityScopeSchema,
  type AppwriteWorkspaceScopeQueryPort,
  type AppwriteWorkspaceScopeTablesPort,
  type WorkspaceCapabilityScopeResolver,
} from "./appwrite-workspace-capability-scope.js";

export type AppwriteWorkspaceAttachmentScopeSchema =
  AppwriteWorkspaceCapabilityScopeSchema;
export type { AppwriteWorkspaceScopeQueryPort, AppwriteWorkspaceScopeTablesPort };

function attachmentResolver(
  capabilityScope: WorkspaceCapabilityScopeResolver,
): WorkspaceAttachmentScopeResolver {
  return {
    async resolve(input) {
      const outcome = await capabilityScope.resolve({
        ...input,
        capability: "attachment.read",
      });
      if (outcome.status !== "authorized") return outcome;
      return {
        status: "authorized",
        authorization: {
          kind: "workspace_actor",
          authorizedWorkspaceId: outcome.project.workspaceId,
          authorizedProjectId: outcome.project.id,
          canReadAttachments: true,
        },
      };
    },
  };
}

export function createAppwriteWorkspaceAttachmentScopeResolver(
  tables: AppwriteWorkspaceScopeTablesPort,
  schema: AppwriteWorkspaceAttachmentScopeSchema,
  queries: AppwriteWorkspaceScopeQueryPort,
): WorkspaceAttachmentScopeResolver {
  return attachmentResolver(
    createAppwriteWorkspaceCapabilityScopeResolver(tables, schema, queries),
  );
}

export function createNodeAppwriteWorkspaceAttachmentScopeResolver(
  tables: TablesDB,
  schema: AppwriteWorkspaceAttachmentScopeSchema,
): WorkspaceAttachmentScopeResolver {
  return attachmentResolver(
    createNodeAppwriteWorkspaceCapabilityScopeResolver(tables, schema),
  );
}
