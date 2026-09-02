import { describe, expect, it, vi } from "vitest";

import {
  createAppwritePrivacyCleanup,
  type AppwritePrivacyCleanupSchema,
  type AppwritePrivacyCleanupTables,
} from "./appwrite-privacy-cleanup";

const schema: AppwritePrivacyCleanupSchema = {
  databaseId: "database",
  attachmentBucketId: "attachment_bucket",
  feedbackTableId: "feedback",
  reportersTableId: "reporters",
  accessGrantsTableId: "access_grants",
  attachmentsTableId: "attachments",
  attachmentStagingTableId: "attachment_staging",
  lifecycleTableId: "lifecycle",
  notificationsTableId: "notifications",
  conversationMessagesTableId: "conversation_messages",
  conversationInternalNotesTableId: "conversation_notes",
  conversationIdempotencyTableId: "conversation_idempotency",
  conversationLifecycleTableId: "conversation_lifecycle",
  publicationConsentsTableId: "publication_consents",
  externalIssueLinksTableId: "external_links",
  providerOutboxTableId: "provider_outbox",
  providerSyncOutboxTableId: "provider_sync_outbox",
  offlineConflictProjectionsTableId: "offline_conflicts",
  intelligenceProvenanceTableId: "intelligence_provenance",
};
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(",")}`,
  limit: (value: number) => `limit:${String(value)}`,
};
const candidate = {
  deletionId: "deletion_1",
  feedbackId: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  revision: 1,
  purgeEligibleAt: "2026-10-02T00:00:00.000Z",
};

class FakeTables implements AppwritePrivacyCleanupTables {
  readonly rows = new Map<string, Array<Record<string, unknown>>>();
  readonly deleted: string[] = [];
  deleteFailure: unknown;

  listRows = vi.fn((input: Parameters<AppwritePrivacyCleanupTables["listRows"]>[0]) => {
    const equal = input.queries[0]?.split(":") ?? [];
    const attribute = equal[1];
    const expected = equal[2];
    const rows = (this.rows.get(input.tableId) ?? []).filter(
      (row) => attribute !== undefined && String(row[attribute]) === expected,
    );
    return Promise.resolve({ rows });
  });
  deleteRow = vi.fn(
    (input: Parameters<AppwritePrivacyCleanupTables["deleteRow"]>[0]) => {
      if (this.deleteFailure !== undefined) return Promise.reject(this.deleteFailure);
      this.deleted.push(`${input.tableId}/${input.rowId}`);
      const rows = this.rows.get(input.tableId) ?? [];
      this.rows.set(
        input.tableId,
        rows.filter((row) => row.$id !== input.rowId),
      );
      return Promise.resolve({});
    },
  );
}

function setup(sharedReporter = false) {
  const tables = new FakeTables();
  tables.rows.set(schema.feedbackTableId, [
    { $id: "feedback_1", reporterId: "reporter_1" },
    ...(sharedReporter ? [{ $id: "feedback_2", reporterId: "reporter_1" }] : []),
  ]);
  tables.rows.set(schema.reportersTableId, [{ $id: "reporter_1" }]);
  tables.rows.set(schema.attachmentsTableId, [
    { $id: "attachment_1", feedbackId: "feedback_1", objectId: "private/a" },
  ]);
  tables.rows.set(schema.attachmentStagingTableId, [
    { $id: "staging_1", objectId: "private/a", fileId: "file_1" },
  ]);
  for (const tableId of [
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
  ])
    tables.rows.set(tableId, [
      { $id: `${tableId}_1`, feedbackId: "feedback_1" },
      { $id: `${tableId}_sibling`, feedbackId: "feedback_2" },
    ]);
  tables.rows.set(schema.offlineConflictProjectionsTableId, [
    { $id: "offline_1", entityId: "feedback_1" },
    { $id: "offline_sibling", entityId: "feedback_2" },
  ]);
  const deleteFile = vi.fn(() => Promise.resolve({}));
  return {
    tables,
    deleteFile,
    cleanup: createAppwritePrivacyCleanup(tables, { deleteFile }, schema, queries),
  };
}

describe("Appwrite physical privacy cleanup", () => {
  it("BDD-PRIV-040 removes every feedback-owned artifact but preserves siblings", async () => {
    const { cleanup, tables, deleteFile } = setup();
    await cleanup.cleanup(candidate);

    expect(deleteFile).toHaveBeenCalledWith({
      bucketId: "attachment_bucket",
      fileId: "file_1",
    });
    expect(tables.deleted).toContain("feedback/feedback_1");
    expect(tables.deleted).toContain("reporters/reporter_1");
    expect(tables.deleted).toContain("offline_conflicts/offline_1");
    expect(tables.deleted).not.toContain("offline_conflicts/offline_sibling");
    expect(
      [...tables.rows.values()].flat().some((row) => row.feedbackId === "feedback_1"),
    ).toBe(false);
    expect(
      [...tables.rows.values()].flat().some((row) => row.feedbackId === "feedback_2"),
    ).toBe(true);
  });

  it("BDD-PRIV-041 keeps a reporter still referenced by sibling feedback", async () => {
    const { cleanup, tables } = setup(true);
    await cleanup.cleanup(candidate);
    expect(tables.deleted).not.toContain("reporters/reporter_1");
  });

  it("BDD-PRIV-042 is idempotent when files or rows are already absent", async () => {
    const { cleanup, tables, deleteFile } = setup();
    deleteFile.mockRejectedValueOnce({ code: 404 });
    tables.deleteFailure = { code: 404 };
    await expect(cleanup.cleanup(candidate)).resolves.toBeUndefined();

    tables.deleteFailure = undefined;
    tables.rows.clear();
    await expect(cleanup.cleanup(candidate)).resolves.toBeUndefined();
  });

  it("BDD-PRIV-043 exposes partial cleanup failures for worker retry", async () => {
    const fileFailure = setup();
    fileFailure.deleteFile.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(fileFailure.cleanup.cleanup(candidate)).rejects.toThrow(
      "storage unavailable",
    );

    const rowFailure = setup();
    rowFailure.tables.deleteFailure = new Error("tables unavailable");
    await expect(rowFailure.cleanup.cleanup(candidate)).rejects.toThrow(
      "tables unavailable",
    );
  });

  it("fails closed for malformed configuration and persisted rows", async () => {
    expect(() =>
      createAppwritePrivacyCleanup(
        new FakeTables(),
        { deleteFile: vi.fn() },
        { ...schema, feedbackTableId: "database" },
        queries,
      ),
    ).toThrow("APPWRITE_PRIVACY_CLEANUP_SCHEMA_INVALID");

    const attachment = setup();
    attachment.tables.rows.set(schema.attachmentsTableId, [
      { $id: "attachment_1", feedbackId: "feedback_1" },
    ]);
    await expect(attachment.cleanup.cleanup(candidate)).rejects.toThrow(
      "APPWRITE_PRIVACY_CLEANUP_UNAVAILABLE",
    );

    const staging = setup();
    staging.tables.rows.set(schema.attachmentStagingTableId, [
      { $id: "staging_1", objectId: "private/a", fileId: "bad/id" },
    ]);
    await expect(staging.cleanup.cleanup(candidate)).rejects.toThrow(
      "APPWRITE_PRIVACY_CLEANUP_UNAVAILABLE",
    );

    const row = setup();
    row.tables.rows.set(schema.accessGrantsTableId, [{ feedbackId: "feedback_1" }]);
    await expect(row.cleanup.cleanup(candidate)).rejects.toThrow(
      "APPWRITE_PRIVACY_CLEANUP_UNAVAILABLE",
    );
  });
});
