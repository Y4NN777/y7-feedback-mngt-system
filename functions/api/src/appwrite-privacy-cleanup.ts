import { Query, type Storage, type TablesDB } from "node-appwrite";

import type { PrivacyCleanupPort, PrivacyPurgeCandidate } from "./privacy-cleanup.js";

export interface AppwritePrivacyCleanupTables {
  listRows(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly queries: readonly string[];
    readonly total: boolean;
    readonly ttl: number;
  }): Promise<{ readonly rows: readonly unknown[] }>;
  deleteRow(input: {
    readonly databaseId: string;
    readonly tableId: string;
    readonly rowId: string;
  }): Promise<unknown>;
}

export interface AppwritePrivacyCleanupFiles {
  deleteFile(input: {
    readonly bucketId: string;
    readonly fileId: string;
  }): Promise<unknown>;
}

export interface AppwritePrivacyCleanupQueries {
  equal(attribute: string, values: readonly string[]): string;
  limit(value: number): string;
}

export interface AppwritePrivacyCleanupSchema {
  readonly databaseId: string;
  readonly attachmentBucketId: string;
  readonly feedbackTableId: string;
  readonly reportersTableId: string;
  readonly accessGrantsTableId: string;
  readonly attachmentsTableId: string;
  readonly attachmentStagingTableId: string;
  readonly lifecycleTableId: string;
  readonly notificationsTableId: string;
  readonly conversationMessagesTableId: string;
  readonly conversationInternalNotesTableId: string;
  readonly conversationIdempotencyTableId: string;
  readonly conversationLifecycleTableId: string;
  readonly publicationConsentsTableId: string;
  readonly externalIssueLinksTableId: string;
  readonly providerOutboxTableId: string;
  readonly providerSyncOutboxTableId: string;
  readonly offlineConflictProjectionsTableId: string;
  readonly intelligenceProvenanceTableId: string;
}

const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/* v8 ignore start -- SDK query serialization is covered by Preview. */
const nodeQueries: AppwritePrivacyCleanupQueries = {
  equal: (attribute, values) => Query.equal(attribute, [...values]),
  limit: (value) => Query.limit(value),
};
/* v8 ignore stop */

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowId(value: unknown): string {
  if (!object(value) || typeof value.$id !== "string" || !id.test(value.$id))
    throw new Error("APPWRITE_PRIVACY_CLEANUP_UNAVAILABLE");
  return value.$id;
}

function isAbsent(error: unknown): boolean {
  return object(error) && error.code === 404;
}

export function createAppwritePrivacyCleanup(
  tables: AppwritePrivacyCleanupTables,
  files: AppwritePrivacyCleanupFiles,
  schema: AppwritePrivacyCleanupSchema,
  queries: AppwritePrivacyCleanupQueries,
): PrivacyCleanupPort {
  const values = Object.values(schema);
  if (values.some((value) => !id.test(value)) || new Set(values).size !== values.length)
    throw new Error("APPWRITE_PRIVACY_CLEANUP_SCHEMA_INVALID");

  const list = async (tableId: string, attribute: string, value: string) =>
    tables.listRows({
      databaseId: schema.databaseId,
      tableId,
      queries: [queries.equal(attribute, [value]), queries.limit(5_000)],
      total: false,
      ttl: 0,
    });

  const removeRow = async (tableId: string, targetId: string) => {
    try {
      await tables.deleteRow({
        databaseId: schema.databaseId,
        tableId,
        rowId: targetId,
      });
    } catch (error: unknown) {
      if (!isAbsent(error)) throw error;
    }
  };

  const removeMatching = async (tableId: string, attribute: string, value: string) => {
    const result = await list(tableId, attribute, value);
    for (const row of result.rows) await removeRow(tableId, rowId(row));
  };

  const removeAttachments = async (candidate: PrivacyPurgeCandidate) => {
    const attachments = await list(
      schema.attachmentsTableId,
      "feedbackId",
      candidate.feedbackId,
    );
    for (const value of attachments.rows) {
      if (!object(value) || typeof value.objectId !== "string")
        throw new Error("APPWRITE_PRIVACY_CLEANUP_UNAVAILABLE");
      const staging = await list(
        schema.attachmentStagingTableId,
        "objectId",
        value.objectId,
      );
      for (const staged of staging.rows) {
        if (
          !object(staged) ||
          typeof staged.fileId !== "string" ||
          !id.test(staged.fileId)
        )
          throw new Error("APPWRITE_PRIVACY_CLEANUP_UNAVAILABLE");
        try {
          await files.deleteFile({
            bucketId: schema.attachmentBucketId,
            fileId: staged.fileId,
          });
        } catch (error: unknown) {
          if (!isAbsent(error)) throw error;
        }
        await removeRow(schema.attachmentStagingTableId, rowId(staged));
      }
      await removeRow(schema.attachmentsTableId, rowId(value));
    }
  };

  const feedbackTables = [
    schema.accessGrantsTableId,
    schema.lifecycleTableId,
    schema.notificationsTableId,
    schema.conversationMessagesTableId,
    schema.conversationInternalNotesTableId,
    schema.conversationIdempotencyTableId,
    schema.conversationLifecycleTableId,
    schema.publicationConsentsTableId,
    schema.externalIssueLinksTableId,
    schema.providerOutboxTableId,
    schema.providerSyncOutboxTableId,
    schema.intelligenceProvenanceTableId,
  ] as const;

  return {
    async cleanup(candidate) {
      await removeAttachments(candidate);
      for (const tableId of feedbackTables)
        await removeMatching(tableId, "feedbackId", candidate.feedbackId);
      await removeMatching(
        schema.offlineConflictProjectionsTableId,
        "entityId",
        candidate.feedbackId,
      );

      const feedback = await list(schema.feedbackTableId, "$id", candidate.feedbackId);
      const current = feedback.rows[0];
      const reporterId =
        object(current) && typeof current.reporterId === "string"
          ? current.reporterId
          : undefined;
      for (const row of feedback.rows)
        await removeRow(schema.feedbackTableId, rowId(row));

      if (reporterId !== undefined) {
        const remaining = await list(schema.feedbackTableId, "reporterId", reporterId);
        if (remaining.rows.length === 0)
          await removeRow(schema.reportersTableId, reporterId);
      }
    },
  };
}

/* v8 ignore start -- Node SDK wiring is covered by Preview. */
export function createNodeAppwritePrivacyCleanup(
  tables: TablesDB,
  storage: Storage,
  schema: AppwritePrivacyCleanupSchema,
): PrivacyCleanupPort {
  return createAppwritePrivacyCleanup(
    {
      listRows: async (input) => ({
        rows: (await tables.listRows({ ...input, queries: [...input.queries] })).rows,
      }),
      deleteRow: (input) => tables.deleteRow(input),
    },
    { deleteFile: (input) => storage.deleteFile(input) },
    schema,
    nodeQueries,
  );
}
/* v8 ignore stop */
