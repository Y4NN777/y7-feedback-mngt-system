import { Query, type TablesDB } from "node-appwrite";

import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";
import type { ProviderMessageObservation } from "./provider-message-event.js";

export interface ProviderMessageReconciliationCandidate {
  readonly observation: ProviderMessageObservation;
}

export interface ProviderMessageReconciliationReader {
  list(): Promise<readonly ProviderMessageReconciliationCandidate[]>;
}

const object = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/* v8 ignore start -- Node SDK adaptation is covered by deployed Preview verification. */
export function createNodeAppwriteProviderMessageReconciliationReader(
  tables: TablesDB,
  schema: {
    readonly databaseId: string;
    readonly conversationMessagesTableId: string;
    readonly externalIssueLinksTableId: string;
  },
  persistence: AppwriteSensitivePersistence,
): ProviderMessageReconciliationReader {
  return {
    async list() {
      const listed = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.conversationMessagesTableId,
        queries: [
          Query.equal("origin", ["provider"]),
          Query.orderDesc("providerUpdatedAt"),
          Query.limit(100),
        ],
        total: false,
        ttl: 60,
      });
      const seen = new Set<string>();
      const result: ProviderMessageReconciliationCandidate[] = [];
      for (const rawRow of listed.rows) {
        const row: unknown = rawRow;
        if (
          !object(row) ||
          row.revisionKind === "tombstoned" ||
          typeof row.$id !== "string" ||
          typeof row.providerLinkId !== "string" ||
          !id.test(row.providerLinkId) ||
          (row.provider !== "github" && row.provider !== "gitlab") ||
          typeof row.repositoryId !== "string" ||
          typeof row.providerIssueId !== "string" ||
          typeof row.providerCommentId !== "string" ||
          typeof row.providerEventId !== "string" ||
          typeof row.providerUpdatedAt !== "string" ||
          !Number.isFinite(Date.parse(row.providerUpdatedAt)) ||
          typeof row.providerAuthorEnvelope !== "string"
        )
          continue;
        const key = `${row.provider}:${row.repositoryId}:${row.providerCommentId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const link = await tables.getRow({
          databaseId: schema.databaseId,
          tableId: schema.externalIssueLinksTableId,
          rowId: row.providerLinkId,
        });
        if (
          !object(link) ||
          link.$id !== row.providerLinkId ||
          link.state !== "active" ||
          link.provider !== row.provider ||
          link.repositoryId !== row.repositoryId ||
          link.providerIssueId !== row.providerIssueId ||
          typeof link.connectionId !== "string" ||
          typeof link.workspaceId !== "string" ||
          typeof link.projectId !== "string"
        )
          continue;
        let author: unknown;
        try {
          author = JSON.parse(
            persistence.protector.open(
              {
                environment: persistence.environment,
                tableId: schema.conversationMessagesTableId,
                rowId: row.$id,
                field: "providerAuthorEnvelope",
              },
              row.providerAuthorEnvelope,
            ),
          ) as unknown;
        } catch {
          throw new Error("PROVIDER_MESSAGE_RECONCILIATION_ROW_INVALID");
        }
        if (
          !object(author) ||
          typeof author.id !== "string" ||
          typeof author.login !== "string"
        )
          throw new Error("PROVIDER_MESSAGE_RECONCILIATION_ROW_INVALID");
        result.push({
          observation: {
            provider: row.provider,
            deliveryId: row.providerEventId,
            connectionId: link.connectionId,
            workspaceId: link.workspaceId,
            projectId: link.projectId,
            repositoryId: row.repositoryId,
            issueId: row.providerIssueId,
            commentId: row.providerCommentId,
            authorId: author.id,
            authorLogin: author.login,
            mutation: "created",
            content: "reconciliation-placeholder",
            providerUpdatedAt: new Date(
              Date.parse(row.providerUpdatedAt),
            ).toISOString(),
          },
        });
        if (result.length >= 25) break;
      }
      return result;
    },
  };
}
/* v8 ignore stop */
