import { Query, type TablesDB } from "node-appwrite";

import type { AuthoritativeCommit } from "@y7-feedback/domain";

import { parseAuthoritativeCommitRow } from "./appwrite-authoritative-commit-store.js";

export interface ConversationPendingCommitReader {
  list(feedbackId: string): Promise<readonly AuthoritativeCommit[]>;
}

export function createNodeAppwriteConversationPendingCommitReader(
  tables: TablesDB,
  schema: {
    readonly databaseId: string;
    readonly authoritativeCommitsTableId: string;
  },
): ConversationPendingCommitReader {
  return {
    async list(feedbackId) {
      const rows = await tables.listRows({
        databaseId: schema.databaseId,
        tableId: schema.authoritativeCommitsTableId,
        queries: [
          Query.equal("aggregateKind", ["conversation"]),
          Query.equal("aggregateId", [feedbackId]),
          Query.equal("projectionState", ["pending", "processing", "failed"]),
          Query.orderAsc("acceptedAt"),
          Query.limit(100),
        ],
        total: false,
      });
      return rows.rows.map((row) => {
        const parsed = parseAuthoritativeCommitRow(row, row.$id);
        if (parsed === null) {
          throw new Error("AUTHORITATIVE_CONVERSATION_PENDING_INVALID");
        }
        return parsed;
      });
    },
  };
}
