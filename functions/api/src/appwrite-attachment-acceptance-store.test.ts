import { describe, expect, it, vi } from "vitest";

import { createAttachmentRecord, type AttachmentRecord } from "@y7-feedback/domain";

import {
  createAppwriteAttachmentAcceptanceStore,
  createNodeAppwriteAttachmentAcceptanceStore,
  type AppwriteAttachmentAcceptanceQueryPort,
  type AppwriteAttachmentAcceptanceTablesPort,
} from "./appwrite-attachment-acceptance-store";

const schema = {
  databaseId: "feedback",
  stagingTableId: "attachment_staging",
  attachmentsTableId: "attachments",
};
const operationId = "123e4567-e89b-42d3-a456-426614174000";

function attachment(
  overrides: Partial<Omit<AttachmentRecord, "lifecycle">> = {},
): AttachmentRecord {
  return createAttachmentRecord({
    id: "attachment-1",
    objectId: "private/object-1",
    feedbackId: "feedback-1",
    workspaceId: "workspace-a",
    projectId: "project-a",
    audience: "reporter",
    sourceEntry: { kind: "source_submission", id: "source-1" },
    displayName: "capture.png",
    mediaType: "image/png",
    size: 128,
    sha256: "sha256digestvalue",
    createdAt: "2026-08-10T17:00:00.000Z",
    ...overrides,
  });
}

function metadataRow(record = attachment()): Readonly<Record<string, unknown>> {
  return {
    $id: record.id,
    objectId: record.objectId,
    feedbackId: record.feedbackId,
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    audience: record.audience,
    sourceKind: record.sourceEntry.kind,
    sourceEntryId: record.sourceEntry.id,
    displayName: record.displayName,
    mediaType: record.mediaType,
    size: record.size,
    sha256: record.sha256,
    createdAt: record.createdAt,
    lifecycle: record.lifecycle,
    operationId,
  };
}

function setup(rows: readonly unknown[] = []) {
  const createTransaction = vi.fn(() => Promise.resolve({ $id: "tx_1" }));
  const updateTransaction = vi.fn(() => Promise.resolve());
  const createRow = vi.fn(
    (input: Parameters<AppwriteAttachmentAcceptanceTablesPort["createRow"]>[0]) => {
      void input;
      return Promise.resolve();
    },
  );
  const listRows = vi.fn(() => Promise.resolve({ rows }));
  const tables: AppwriteAttachmentAcceptanceTablesPort = {
    createTransaction,
    updateTransaction,
    createRow,
    listRows,
  };
  const queries: AppwriteAttachmentAcceptanceQueryPort = {
    equal: (attribute, values) => `equal:${attribute}:${values.join(",")}`,
    limit: (limit) => `limit:${String(limit)}`,
  };
  return {
    createRow,
    createTransaction,
    listRows,
    store: createAppwriteAttachmentAcceptanceStore(tables, schema, queries),
    updateTransaction,
  };
}

describe("Appwrite Attachment acceptance store", () => {
  it("BDD-ATT-ACCEPT-001 verifies staging ownership and commits private metadata atomically", async () => {
    const first = attachment();
    const second = attachment({
      id: "attachment-2",
      objectId: "private/object-2",
      sourceEntry: { kind: "visible_message", id: "message-1" },
      displayName: "context.txt",
      mediaType: "text/plain; charset=utf-8",
    });
    const { store, listRows, createTransaction, createRow, updateTransaction } =
      setup();
    listRows
      .mockResolvedValueOnce({ rows: [{ objectId: first.objectId, operationId }] })
      .mockResolvedValueOnce({ rows: [{ objectId: second.objectId, operationId }] });

    await store.commit({
      operationId,
      feedbackId: "feedback-1",
      attachments: [first, second],
    });

    expect(listRows).toHaveBeenCalledTimes(2);
    expect(listRows).toHaveBeenNthCalledWith(1, {
      databaseId: "feedback",
      tableId: "attachment_staging",
      queries: [
        "equal:objectId:private/object-1",
        `equal:operationId:${operationId}`,
        "limit:2",
      ],
      total: false,
      ttl: 0,
    });
    expect(createTransaction).toHaveBeenCalledWith({ ttl: 60 });
    expect(createRow).toHaveBeenCalledTimes(2);
    const { $id: metadataId, ...expectedData } = metadataRow(first);
    expect(metadataId).toBe(first.id);
    expect(createRow.mock.calls[0]?.[0]).toEqual({
      databaseId: "feedback",
      tableId: "attachments",
      rowId: "attachment-1",
      data: expectedData,
      permissions: [],
      transactionId: "tx_1",
    });
    expect(updateTransaction).toHaveBeenCalledWith({
      transactionId: "tx_1",
      commit: true,
    });
  });

  it("rolls back a partially staged transaction and preserves the originating error", async () => {
    const first = setup([{ objectId: "private/object-1", operationId }]);
    first.createRow.mockRejectedValueOnce(new Error("metadata unavailable"));
    await expect(
      first.store.commit({
        operationId,
        feedbackId: "feedback-1",
        attachments: [attachment()],
      }),
    ).rejects.toThrow("metadata unavailable");
    expect(first.updateTransaction).toHaveBeenCalledWith({
      transactionId: "tx_1",
      rollback: true,
    });

    const second = setup([{ objectId: "private/object-1", operationId }]);
    second.createRow.mockRejectedValueOnce(new Error("metadata unavailable"));
    second.updateTransaction.mockRejectedValueOnce(new Error("rollback unavailable"));
    await expect(
      second.store.commit({
        operationId,
        feedbackId: "feedback-1",
        attachments: [attachment()],
      }),
    ).rejects.toThrow("metadata unavailable");

    const ambiguousCommit = setup([{ objectId: "private/object-1", operationId }]);
    ambiguousCommit.updateTransaction.mockRejectedValueOnce(
      new Error("commit outcome unavailable"),
    );
    await expect(
      ambiguousCommit.store.commit({
        operationId,
        feedbackId: "feedback-1",
        attachments: [attachment()],
      }),
    ).rejects.toThrow("commit outcome unavailable");
    expect(ambiguousCommit.updateTransaction).toHaveBeenCalledOnce();
  });

  it("does not open a transaction for absent, duplicate, or mismatched staging ownership", async () => {
    for (const rows of [
      [],
      [
        { objectId: "private/object-1", operationId },
        { objectId: "private/object-1", operationId },
      ],
      [{ objectId: "private/object-2", operationId }],
      [{ objectId: "private/object-1", operationId: "wrong-operation" }],
    ]) {
      const current = setup(rows);
      await expect(
        current.store.commit({
          operationId,
          feedbackId: "feedback-1",
          attachments: [attachment()],
        }),
      ).rejects.toThrow("APPWRITE_ATTACHMENT_STAGING_INCONSISTENT");
      expect(current.createTransaction).not.toHaveBeenCalled();
    }
  });

  it("reads strict metadata and resolves exact object association", async () => {
    const row = metadataRow();
    const current = setup([row]);
    await expect(current.store.findById("attachment-1")).resolves.toEqual(attachment());
    await expect(current.store.isObjectAssociated("private/object-1")).resolves.toBe(
      true,
    );
    expect(current.listRows).toHaveBeenNthCalledWith(1, {
      databaseId: "feedback",
      tableId: "attachments",
      queries: ["equal:$id:attachment-1", "limit:2"],
      total: false,
      ttl: 0,
    });

    const visible = attachment({
      sourceEntry: { kind: "visible_message", id: "message-1" },
    });
    await expect(
      setup([metadataRow(visible)]).store.findById(visible.id),
    ).resolves.toEqual(visible);
    const internal = attachment({
      audience: "workspace",
      sourceEntry: { kind: "internal_note", id: "note-1" },
    });
    await expect(
      setup([metadataRow(internal)]).store.findById(internal.id),
    ).resolves.toEqual(internal);
    for (const attachmentLifecycle of ["soft_deleted", "purged"] as const) {
      await expect(
        setup([{ ...metadataRow(), lifecycle: attachmentLifecycle }]).store.findById(
          "attachment-1",
        ),
      ).resolves.toEqual({ ...attachment(), lifecycle: attachmentLifecycle });
    }
  });

  it("returns absence but fails closed for invalid identifiers, duplicate rows, and metadata", async () => {
    await expect(setup([]).store.findById("attachment-1")).resolves.toBeUndefined();
    await expect(setup([]).store.isObjectAssociated("private/object-1")).resolves.toBe(
      false,
    );
    await expect(setup([]).store.findById(" ")).rejects.toThrow(
      "APPWRITE_ATTACHMENT_INPUT_INVALID",
    );
    await expect(setup([{}, {}]).store.findById("attachment-1")).rejects.toThrow(
      "APPWRITE_ATTACHMENT_METADATA_INCONSISTENT",
    );
    await expect(setup([null]).store.findById("attachment-1")).rejects.toThrow(
      "APPWRITE_ATTACHMENT_METADATA_INVALID",
    );
    for (const row of [
      { ...metadataRow(), $id: 7 },
      { ...metadataRow(), $id: "" },
      { ...metadataRow(), sourceKind: "unknown" },
      { ...metadataRow(), lifecycle: "deleted" },
      { ...metadataRow(), audience: "public" },
      { ...metadataRow(), size: "128" },
    ]) {
      await expect(setup([row]).store.findById("attachment-1")).rejects.toThrow(
        "APPWRITE_ATTACHMENT_METADATA_INVALID",
      );
    }
    await expect(
      setup([{ ...metadataRow(), $id: "attachment-2" }]).store.findById("attachment-1"),
    ).rejects.toThrow("APPWRITE_ATTACHMENT_METADATA_INVALID");
    await expect(
      setup([{ ...metadataRow(), objectId: "private/other" }]).store.isObjectAssociated(
        "private/object-1",
      ),
    ).rejects.toThrow("APPWRITE_ATTACHMENT_METADATA_INVALID");
  });

  it("rejects malformed schema, commands, and transaction identifiers", async () => {
    expect(() =>
      createAppwriteAttachmentAcceptanceStore(
        {
          createTransaction: vi.fn(),
          updateTransaction: vi.fn(),
          createRow: vi.fn(),
          listRows: vi.fn(),
        },
        { ...schema, attachmentsTableId: "attachment_staging" },
        { equal: vi.fn(), limit: vi.fn() },
      ),
    ).toThrow("APPWRITE_ATTACHMENT_SCHEMA_INVALID");

    const invalid = setup([{ objectId: "private/object-1", operationId }]);
    for (const input of [
      { operationId: "bad", feedbackId: "feedback-1", attachments: [attachment()] },
      { operationId, feedbackId: " ", attachments: [attachment()] },
      { operationId, feedbackId: "feedback-1", attachments: [] },
      {
        operationId,
        feedbackId: "feedback-2",
        attachments: [attachment()],
      },
      {
        operationId,
        feedbackId: "feedback-1",
        attachments: [attachment(), attachment()],
      },
    ]) {
      await expect(invalid.store.commit(input)).rejects.toThrow(
        "APPWRITE_ATTACHMENT_INPUT_INVALID",
      );
    }

    invalid.createTransaction.mockResolvedValueOnce({ $id: "bad/id" });
    await expect(
      invalid.store.commit({
        operationId,
        feedbackId: "feedback-1",
        attachments: [attachment()],
      }),
    ).rejects.toThrow("APPWRITE_ATTACHMENT_TRANSACTION_INVALID");
  });

  it("uses the real Node SDK transaction and Query adapters", async () => {
    const row = metadataRow();
    const tables = {
      createTransaction: vi.fn(() => Promise.resolve({ $id: "tx_1" })),
      updateTransaction: vi.fn(() => Promise.resolve({})),
      createRow: vi.fn(() => Promise.resolve({})),
      listRows: vi.fn(() => Promise.resolve({ rows: [row] })),
    };
    const store = createNodeAppwriteAttachmentAcceptanceStore(
      tables as unknown as import("node-appwrite").TablesDB,
      schema,
    );
    await store.commit({
      operationId,
      feedbackId: "feedback-1",
      attachments: [attachment()],
    });
    await expect(store.findById("attachment-1")).resolves.toEqual(attachment());
    expect(tables.createRow).toHaveBeenCalledOnce();
    expect(tables.listRows).toHaveBeenCalledWith(
      expect.objectContaining({ queries: [expect.any(String), expect.any(String)] }),
    );
  });
});
