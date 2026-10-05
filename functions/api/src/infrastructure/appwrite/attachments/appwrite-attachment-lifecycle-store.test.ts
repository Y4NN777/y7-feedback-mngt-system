import { describe, expect, it, vi } from "vitest";
import type { TablesDB } from "node-appwrite";

import {
  createAppwriteAttachmentLifecycleStore,
  createNodeAppwriteAttachmentLifecycleStore,
  type AppwriteAttachmentLifecycleTablesPort,
} from "./appwrite-attachment-lifecycle-store";

const schema = { databaseId: "feedback", attachmentsTableId: "attachments" };

function setup(row: unknown = { $id: "attachment-1", lifecycle: "available" }) {
  const createTransaction = vi.fn(() => Promise.resolve({ $id: "transaction-1" }));
  const getRow = vi.fn(() => Promise.resolve(row));
  const updateRow = vi.fn(() => Promise.resolve({}));
  const updateTransaction = vi.fn(() => Promise.resolve({}));
  const tables: AppwriteAttachmentLifecycleTablesPort = {
    createTransaction,
    getRow,
    updateRow,
    updateTransaction,
  };
  return {
    store: createAppwriteAttachmentLifecycleStore(tables, schema),
    tables,
    createTransaction,
    getRow,
    updateRow,
    updateTransaction,
  };
}

describe("Appwrite Attachment lifecycle compare-and-set", () => {
  it("BDD-ATT-LIFECYCLE-004 commits one exact lifecycle transition transaction", async () => {
    const { store, getRow, updateRow, updateTransaction } = setup();

    await expect(
      store.compareAndSetLifecycle("attachment-1", "available", "soft_deleted"),
    ).resolves.toBe(true);
    expect(getRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "attachments",
      rowId: "attachment-1",
      transactionId: "transaction-1",
    });
    expect(updateRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "attachments",
      rowId: "attachment-1",
      data: { lifecycle: "soft_deleted" },
      transactionId: "transaction-1",
    });
    expect(updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction-1",
      commit: true,
    });
  });

  it("rolls back a stale transition without writing", async () => {
    const { store, updateRow, updateTransaction } = setup({
      $id: "attachment-1",
      lifecycle: "purged",
    });

    await expect(
      store.compareAndSetLifecycle("attachment-1", "soft_deleted", "available"),
    ).resolves.toBe(false);
    expect(updateRow).not.toHaveBeenCalled();
    expect(updateTransaction).toHaveBeenCalledWith({
      transactionId: "transaction-1",
      rollback: true,
    });
  });

  it.each([
    null,
    { $id: "wrong", lifecycle: "available" },
    { $id: "attachment-1", lifecycle: "unknown" },
  ])("fails closed and rolls back malformed metadata %#", async (row) => {
    const { store, updateTransaction } = setup(row);

    await expect(
      store.compareAndSetLifecycle("attachment-1", "available", "soft_deleted"),
    ).rejects.toThrow("APPWRITE_ATTACHMENT_LIFECYCLE_UNAVAILABLE");
    expect(updateTransaction).toHaveBeenCalledWith({
      transactionId: "transaction-1",
      rollback: true,
    });
  });

  it("rolls back write failures and preserves the originating stable error", async () => {
    const { store, updateRow, updateTransaction } = setup();
    updateRow.mockRejectedValueOnce(new Error("private database detail"));

    await expect(
      store.compareAndSetLifecycle("attachment-1", "available", "soft_deleted"),
    ).rejects.toThrow("APPWRITE_ATTACHMENT_LIFECYCLE_UNAVAILABLE");
    expect(updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction-1",
      rollback: true,
    });
  });

  it("rejects invalid schemas, identifiers, states, and transaction identities", async () => {
    expect(() =>
      createAppwriteAttachmentLifecycleStore(setup().tables, {
        databaseId: "bad/id",
        attachmentsTableId: "attachments",
      }),
    ).toThrow("APPWRITE_ATTACHMENT_LIFECYCLE_SCHEMA_INVALID");

    const target = setup();
    const invalidInputs: ReadonlyArray<readonly [string, string, string]> = [
      ["", "available", "soft_deleted"],
      ["attachment-1", "unknown", "soft_deleted"],
      ["attachment-1", "available", "unknown"],
    ];
    for (const [attachmentId, expected, next] of invalidInputs) {
      await expect(
        target.store.compareAndSetLifecycle(
          attachmentId,
          expected as "available",
          next as "soft_deleted",
        ),
      ).rejects.toThrow("APPWRITE_ATTACHMENT_LIFECYCLE_INPUT_INVALID");
    }
    expect(target.createTransaction).not.toHaveBeenCalled();

    const invalidTransaction = setup();
    invalidTransaction.createTransaction.mockResolvedValueOnce({
      $id: "bad/id",
    });
    await expect(
      invalidTransaction.store.compareAndSetLifecycle(
        "attachment-1",
        "available",
        "soft_deleted",
      ),
    ).rejects.toThrow("APPWRITE_ATTACHMENT_LIFECYCLE_UNAVAILABLE");
  });

  it("adapts the Node Appwrite client without widening the lifecycle port", async () => {
    const target = setup();
    const store = createNodeAppwriteAttachmentLifecycleStore(
      target.tables as unknown as TablesDB,
      schema,
    );

    await expect(
      store.compareAndSetLifecycle("attachment-1", "available", "soft_deleted"),
    ).resolves.toBe(true);
    expect(target.createTransaction).toHaveBeenCalledWith({ ttl: 60 });
    expect(target.getRow).toHaveBeenCalledTimes(1);
    expect(target.updateRow).toHaveBeenCalledTimes(1);
    expect(target.updateTransaction).toHaveBeenCalledTimes(1);
  });
});
