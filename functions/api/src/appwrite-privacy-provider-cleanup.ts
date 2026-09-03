import { Query, type TablesDB } from "node-appwrite";

import { closeProviderIssue } from "./provider-issue-cleanup.js";
import type {
  PrivacyProviderCleanupCandidate,
  PrivacyProviderCleanupStore,
  PrivacyProviderIssueCloser,
} from "./privacy-provider-cleanup.js";

export interface AppwritePrivacyProviderCleanupSchema {
  readonly databaseId: string;
  readonly externalIssueLinksTableId: string;
  readonly sourceConnectionsTableId: string;
  readonly providerGrantsTableId: string;
}

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function candidate(value: unknown): PrivacyProviderCleanupCandidate {
  /* v8 ignore next -- malformed persisted shapes are covered table-wise at this boundary. */
  if (
    !object(value) ||
    typeof value.$id !== "string" ||
    typeof value.connectionId !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.projectId !== "string" ||
    (value.provider !== "github" && value.provider !== "gitlab") ||
    typeof value.repositoryId !== "string" ||
    typeof value.providerIssueUrl !== "string" ||
    value.state !== "privacy_deleted" ||
    value.synchronizationState !== "privacy_cleanup_pending"
  )
    throw new Error("APPWRITE_PRIVACY_PROVIDER_CLEANUP_INVALID");
  return {
    linkId: value.$id,
    connectionId: value.connectionId,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    provider: value.provider,
    repositoryId: value.repositoryId,
    issueUrl: value.providerIssueUrl,
  };
}

export function createNodeAppwritePrivacyProviderCleanup(
  tables: TablesDB,
  schema: AppwritePrivacyProviderCleanupSchema,
  options: {
    readonly providerGrantEnvelopeKey: string;
    readonly gitlabOrigin: string;
  },
): {
  readonly store: PrivacyProviderCleanupStore;
  readonly closer: PrivacyProviderIssueCloser;
} {
  return {
    store: {
      async listPending(limit) {
        const result = await tables.listRows({
          databaseId: schema.databaseId,
          tableId: schema.externalIssueLinksTableId,
          queries: [
            Query.equal("state", ["privacy_deleted"]),
            Query.equal("synchronizationState", ["privacy_cleanup_pending"]),
            Query.limit(limit),
          ],
          total: false,
          ttl: 0,
        });
        return result.rows.map(candidate);
      },
      async markCompleted(linkId, completedAt) {
        await tables.updateRow({
          databaseId: schema.databaseId,
          tableId: schema.externalIssueLinksTableId,
          rowId: linkId,
          data: {
            synchronizationState: "privacy_cleanup_completed",
            providerState: "closed",
            updatedAt: completedAt,
          },
        });
      },
    },
    closer: {
      async close(item) {
        const connection = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.sourceConnectionsTableId,
          rowId: item.connectionId,
        });
        if (
          !object(connection) ||
          connection.status !== "active" ||
          connection.provider !== item.provider ||
          connection.workspaceId !== item.workspaceId ||
          connection.projectId !== item.projectId ||
          typeof connection.selectedRepositoriesJson !== "string" ||
          typeof connection.encryptedGrantRef !== "string"
        )
          throw new Error("APPWRITE_PRIVACY_PROVIDER_CLEANUP_AUTHORITY_INVALID");
        let selected: unknown;
        try {
          selected = JSON.parse(connection.selectedRepositoriesJson) as unknown;
        } catch {
          throw new Error("APPWRITE_PRIVACY_PROVIDER_CLEANUP_AUTHORITY_INVALID");
        }
        if (
          !Array.isArray(selected) ||
          !selected.some(
            (entry) =>
              object(entry) &&
              entry.provider === item.provider &&
              entry.id === item.repositoryId,
          )
        )
          throw new Error("APPWRITE_PRIVACY_PROVIDER_CLEANUP_AUTHORITY_INVALID");
        let issue: URL;
        try {
          issue = new URL(item.issueUrl);
        } catch {
          throw new Error("APPWRITE_PRIVACY_PROVIDER_CLEANUP_URL_INVALID");
        }
        const parts = issue.pathname.split("/").filter(Boolean);
        if (parts[0] === undefined || parts[1] === undefined)
          throw new Error("APPWRITE_PRIVACY_PROVIDER_CLEANUP_URL_INVALID");
        await closeProviderIssue({
          tables,
          databaseId: schema.databaseId,
          providerGrantsTableId: schema.providerGrantsTableId,
          providerGrantEnvelopeKey: options.providerGrantEnvelopeKey,
          provider: item.provider,
          providerGrantRef: connection.encryptedGrantRef,
          repository: {
            id: item.repositoryId,
            owner: parts[0],
            name: parts[1],
          },
          issueUrl: item.issueUrl,
          gitlabOrigin: options.gitlabOrigin,
        });
      },
    },
  };
}
