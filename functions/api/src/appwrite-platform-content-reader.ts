import { Query, type TablesDB } from "node-appwrite";

import { parseAttachmentMetadata } from "./appwrite-attachment-acceptance-store.js";
import { parseConversationProjectionMessage } from "./appwrite-conversation-projection-store.js";
import type { PlatformAccessContentReader } from "./appwrite-platform-access-store.js";
import { parseWorkbenchDetail } from "./appwrite-workbench-store.js";
import type { AppwriteSensitivePersistence } from "./sensitive-data-protector.js";

export interface AppwritePlatformContentSchema {
  readonly databaseId: string;
  readonly feedbackTableId: string;
  readonly messagesTableId: string;
  readonly internalNotesTableId: string;
  readonly attachmentsTableId: string;
  readonly attachmentStagingTableId: string;
}

export interface AppwritePlatformContentTables {
  getRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
    readonly transactionId: string;
  }): Promise<unknown>;
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: false;
    readonly ttl: 0;
    readonly transactionId: string;
  }): Promise<{ readonly rows: readonly unknown[] }>;
}

export interface AppwritePlatformContentQueries {
  equal(attribute: string, values: readonly string[]): string;
  orderAsc(attribute: string): string;
  limit(value: number): string;
}

const appwriteId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/u;
/* v8 ignore start -- Query serialization is exercised by deployed verification. */
const defaultQueries: AppwritePlatformContentQueries = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  orderAsc: (attribute) => Query.orderAsc(attribute),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAppwritePlatformContentReader(
  tables: AppwritePlatformContentTables,
  schema: AppwritePlatformContentSchema,
  queries: AppwritePlatformContentQueries,
  sensitive: AppwriteSensitivePersistence,
): PlatformAccessContentReader {
  const ids: readonly string[] = [
    schema.databaseId,
    schema.feedbackTableId,
    schema.messagesTableId,
    schema.internalNotesTableId,
    schema.attachmentsTableId,
    schema.attachmentStagingTableId,
  ];
  if (
    ids.some((id) => !appwriteId.test(id)) ||
    new Set(ids.slice(1)).size !== ids.length - 1
  )
    throw new Error("PLATFORM_CONTENT_SCHEMA_INVALID");

  return {
    async read({ command, transactionId }) {
      if (!command.projectId || !command.feedbackId)
        throw new Error("PLATFORM_CONTENT_SCOPE_INVALID");
      const feedbackRow = await tables.getRow({
        databaseId: schema.databaseId,
        tableId: schema.feedbackTableId,
        rowId: command.feedbackId,
        transactionId,
      });
      const feedback = parseWorkbenchDetail(
        feedbackRow,
        {
          actor: {
            principalId: "exceptional_access_reader",
            responsibility: "workspace_owner",
            workspaceIds: [command.workspaceId],
            projectIds: [command.projectId],
          },
          workspaceId: command.workspaceId,
          projectId: command.projectId,
          feedbackId: command.feedbackId,
        },
        { databaseId: schema.databaseId, feedbackTableId: schema.feedbackTableId },
        sensitive,
      );
      /* v8 ignore next -- parseWorkbenchDetail already rejects non-object rows. */
      if (!object(feedbackRow)) throw new Error("PLATFORM_CONTENT_SCOPE_INVALID");
      const scope = {
        workspaceId: String(feedbackRow.workspaceId),
        projectId: String(feedbackRow.projectId),
        feedbackId: command.feedbackId,
      };
      if (command.action === "feedback.read")
        return { ...scope, content: { kind: "feedback", feedback } };

      const tableId =
        command.action === "message.read"
          ? schema.messagesTableId
          : command.action === "internal_note.read"
            ? schema.internalNotesTableId
            : schema.attachmentsTableId;
      const rows = await tables.listRows({
        databaseId: schema.databaseId,
        tableId,
        queries: [
          queries.equal("feedbackId", [command.feedbackId]),
          ...(command.action === "attachment.read"
            ? []
            : [queries.orderAsc("occurredAt")]),
          queries.limit(500),
        ],
        total: false,
        ttl: 0,
        transactionId,
      });
      if (command.action === "attachment.read") {
        const items = rows.rows
          .map((row) =>
            parseAttachmentMetadata(
              row,
              {
                databaseId: schema.databaseId,
                stagingTableId: schema.attachmentStagingTableId,
                attachmentsTableId: schema.attachmentsTableId,
              },
              sensitive,
            ),
          )
          .filter((item) => item.lifecycle === "available")
          .map((item) => ({
            id: item.id,
            feedbackId: item.feedbackId,
            workspaceId: item.workspaceId,
            projectId: item.projectId,
            audience: item.audience,
            sourceEntry: item.sourceEntry,
            displayName: item.displayName,
            mediaType: item.mediaType,
            size: item.size,
            sha256: item.sha256,
            createdAt: item.createdAt,
            lifecycle: item.lifecycle,
          }));
        if (
          items.some(
            (item) =>
              item.workspaceId !== scope.workspaceId ||
              item.projectId !== scope.projectId ||
              item.feedbackId !== scope.feedbackId,
          )
        )
          throw new Error("PLATFORM_CONTENT_SCOPE_INVALID");
        return {
          ...scope,
          content: { kind: "attachments", feedbackId: scope.feedbackId, items },
        };
      }
      const items = rows.rows.map((row) =>
        parseConversationProjectionMessage(
          row,
          {
            ...scope,
            tableId,
            ...(command.action === "internal_note.read"
              ? { audience: "workspace" as const }
              : {}),
          },
          sensitive,
        ),
      );
      return {
        ...scope,
        content: {
          kind: command.action === "message.read" ? "messages" : "internal_notes",
          feedbackId: scope.feedbackId,
          items,
        },
      };
    },
  };
}

/* v8 ignore start -- Node SDK wiring is exercised by deployed verification. */
export function createNodeAppwritePlatformContentReader(
  tables: TablesDB,
  schema: AppwritePlatformContentSchema,
  sensitive: AppwriteSensitivePersistence,
): PlatformAccessContentReader {
  return createAppwritePlatformContentReader(
    {
      getRow: (input) => tables.getRow(input),
      listRows: async (input) => {
        const result = await tables.listRows({ ...input, queries: [...input.queries] });
        return { rows: result.rows };
      },
    },
    schema,
    defaultQueries,
    sensitive,
  );
}
/* v8 ignore stop */
