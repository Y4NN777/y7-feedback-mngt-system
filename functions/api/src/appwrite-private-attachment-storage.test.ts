import { describe, expect, it, vi } from "vitest";

import {
  createAppwritePrivateAttachmentStorage,
  createNodeAppwritePrivateAttachmentStorage,
  type AppwriteAttachmentFilesPort,
  type AppwriteAttachmentQueryPort,
  type AppwriteAttachmentStagingPort,
} from "./appwrite-private-attachment-storage";

const schema = {
  bucketId: "private_attachments",
  databaseId: "feedback",
  stagingTableId: "attachment_staging",
};
const operationId = "123e4567-e89b-42d3-a456-426614174000";
const bytes = new TextEncoder().encode("private evidence");

function setup(rows: readonly unknown[] = []) {
  const createFile = vi.fn(
    (input: Parameters<AppwriteAttachmentFilesPort["createFile"]>[0]) => {
      void input;
      return Promise.resolve();
    },
  );
  const deleteFile = vi.fn(() => Promise.resolve());
  const downloadFile = vi.fn(() => Promise.resolve(bytes));
  const files: AppwriteAttachmentFilesPort = {
    createFile,
    deleteFile,
    downloadFile,
  };
  const createRow = vi.fn(
    (input: Parameters<AppwriteAttachmentStagingPort["createRow"]>[0]) => {
      void input;
      return Promise.resolve();
    },
  );
  const deleteRow = vi.fn(() => Promise.resolve());
  const listRows = vi.fn(() => Promise.resolve({ rows }));
  const tables: AppwriteAttachmentStagingPort = {
    createRow,
    deleteRow,
    listRows,
  };
  const queries: AppwriteAttachmentQueryPort = {
    equal: (attribute, values) => `equal:${attribute}:${values.join(",")}`,
    lessThan: (attribute, value) => `less:${attribute}:${value}`,
    limit: (limit) => `limit:${String(limit)}`,
  };
  return {
    createFile,
    createRow,
    deleteFile,
    deleteRow,
    downloadFile,
    listRows,
    storage: createAppwritePrivateAttachmentStorage(files, tables, schema, queries),
  };
}

describe("private Appwrite Attachment staging adapter", () => {
  it("BDD-ATT-STORAGE-001 uploads privately before indexing operation ownership", async () => {
    const { storage, createFile, createRow } = setup();

    await storage.stage({
      objectId: "private/object-1",
      operationId,
      stagedAt: "2026-08-10T17:00:00.000Z",
      bytes,
      visibility: "private",
    });

    const createdFile = createFile.mock.calls[0]?.[0];
    expect(createdFile?.fileId).toMatch(/^att_[a-f0-9]{32}$/u);
    expect(createdFile).toEqual({
      bucketId: "private_attachments",
      fileId: createdFile?.fileId,
      bytes,
      name: "staged-attachment.bin",
      permissions: [],
    });
    const createdRow = createRow.mock.calls[0]?.[0];
    expect(createdRow?.rowId).toMatch(/^stg_[a-f0-9]{32}$/u);
    expect(createdRow).toEqual({
      databaseId: "feedback",
      tableId: "attachment_staging",
      rowId: createdRow?.rowId,
      data: {
        objectId: "private/object-1",
        operationId,
        stagedAt: "2026-08-10T17:00:00.000Z",
        fileId: createdFile?.fileId,
      },
      permissions: [],
    });
  });

  it("compensates an index failure and preserves its originating error", async () => {
    const first = setup();
    first.createRow.mockRejectedValueOnce(new Error("index unavailable"));
    await expect(
      first.storage.stage({
        objectId: "private/object-1",
        operationId,
        stagedAt: "2026-08-10T17:00:00.000Z",
        bytes,
        visibility: "private",
      }),
    ).rejects.toThrow("index unavailable");
    expect(first.deleteFile).toHaveBeenCalledOnce();

    const second = setup();
    second.createRow.mockRejectedValueOnce(new Error("index unavailable"));
    second.deleteFile.mockRejectedValueOnce(new Error("cleanup unavailable"));
    await expect(
      second.storage.stage({
        objectId: "private/object-1",
        operationId,
        stagedAt: "2026-08-10T17:00:00.000Z",
        bytes,
        visibility: "private",
      }),
    ).rejects.toThrow("index unavailable");
  });

  it("resolves private read and deletion through one exact staging row", async () => {
    const row = {
      $id: "stg_row",
      objectId: "private/object-1",
      operationId,
      stagedAt: "2026-08-10T17:00:00.000Z",
      fileId: "att_file",
    };
    const { storage, listRows, downloadFile, deleteFile, deleteRow } = setup([row]);

    await expect(storage.read("private/object-1")).resolves.toEqual(bytes);
    await storage.remove("private/object-1");

    expect(listRows).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "attachment_staging",
      queries: ["equal:objectId:private/object-1", "limit:2"],
      total: false,
      ttl: 0,
    });
    expect(downloadFile).toHaveBeenCalledWith({
      bucketId: "private_attachments",
      fileId: "att_file",
    });
    expect(deleteFile).toHaveBeenCalledWith({
      bucketId: "private_attachments",
      fileId: "att_file",
    });
    expect(deleteRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "attachment_staging",
      rowId: "stg_row",
    });
  });

  it("lists bounded stale staging facts and returns absent deletion idempotently", async () => {
    const row = {
      $id: "stg_row",
      objectId: "private/object-1",
      operationId,
      stagedAt: "2026-08-10T17:00:00.000Z",
      fileId: "att_file",
    };
    const populated = setup([row]);
    await expect(
      populated.storage.listStagedBefore("2026-08-10T18:00:00.000Z"),
    ).resolves.toEqual([
      {
        objectId: "private/object-1",
        operationId,
        stagedAt: "2026-08-10T17:00:00.000Z",
      },
    ]);
    expect(populated.listRows).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "attachment_staging",
      queries: ["less:stagedAt:2026-08-10T18:00:00.000Z", "limit:5000"],
      total: false,
      ttl: 0,
    });

    const absent = setup([]);
    await expect(absent.storage.remove("private/absent")).resolves.toBeUndefined();
    expect(absent.deleteFile).not.toHaveBeenCalled();
  });

  it("fails closed for malformed input, schema, duplicates, and rows", async () => {
    const invalidInput = setup();
    await expect(
      invalidInput.storage.stage({
        objectId: "public/object-1",
        operationId,
        stagedAt: "not-a-date",
        bytes: new Uint8Array(),
        visibility: "private",
      }),
    ).rejects.toThrow("APPWRITE_ATTACHMENT_INPUT_INVALID");

    expect(() =>
      createAppwritePrivateAttachmentStorage(
        {
          createFile: vi.fn(),
          deleteFile: vi.fn(),
          downloadFile: vi.fn(),
        },
        { createRow: vi.fn(), deleteRow: vi.fn(), listRows: vi.fn() },
        { ...schema, bucketId: "bad/id" },
        { equal: vi.fn(), lessThan: vi.fn(), limit: vi.fn() },
      ),
    ).toThrow("APPWRITE_ATTACHMENT_SCHEMA_INVALID");

    const duplicate = setup([{}, {}]);
    await expect(duplicate.storage.read("private/object-1")).rejects.toThrow(
      "APPWRITE_ATTACHMENT_STAGING_INCONSISTENT",
    );
    const malformed = setup([null]);
    await expect(
      malformed.storage.listStagedBefore("2026-08-10T18:00:00.000Z"),
    ).rejects.toThrow("APPWRITE_ATTACHMENT_STAGING_INVALID");

    const validRow = {
      $id: "stg_row",
      objectId: "private/object-1",
      operationId,
      stagedAt: "2026-08-10T17:00:00.000Z",
      fileId: "att_file",
    };
    await expect(
      setup([{ ...validRow, $id: 7 }]).storage.read(validRow.objectId),
    ).rejects.toThrow("APPWRITE_ATTACHMENT_STAGING_INVALID");
    await expect(
      setup([{ ...validRow, $id: "" }]).storage.read(validRow.objectId),
    ).rejects.toThrow("APPWRITE_ATTACHMENT_STAGING_INVALID");
    await expect(
      setup([{ ...validRow, $id: "bad/id" }]).storage.read(validRow.objectId),
    ).rejects.toThrow("APPWRITE_ATTACHMENT_STAGING_INVALID");
    await expect(
      setup([{ ...validRow, objectId: "private/object-2" }]).storage.read(
        validRow.objectId,
      ),
    ).rejects.toThrow("APPWRITE_ATTACHMENT_STAGING_INVALID");
    await expect(setup().storage.read("public/object-1")).rejects.toThrow(
      "APPWRITE_ATTACHMENT_INPUT_INVALID",
    );
    await expect(setup().storage.read("private/absent")).rejects.toThrow(
      "APPWRITE_ATTACHMENT_STAGING_NOT_FOUND",
    );
    await expect(setup().storage.listStagedBefore("yesterday")).rejects.toThrow(
      "APPWRITE_ATTACHMENT_INPUT_INVALID",
    );
  });

  it("uses real Node SDK Query and InputFile adapters", async () => {
    const createFile = vi.fn((input: { readonly file: { size(): Promise<number> } }) =>
      input.file.size().then(() => ({})),
    );
    const row = {
      $id: "stg_row",
      objectId: "private/object-1",
      operationId,
      stagedAt: "2026-08-10T17:00:00.000Z",
      fileId: "att_file",
    };
    const listRows = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [] });
    const deleteFile = vi.fn(() => Promise.resolve({}));
    const getFileDownload = vi.fn(() => Promise.resolve(bytes.buffer));
    const tables = {
      createRow: vi.fn(() => Promise.resolve({})),
      deleteRow: vi.fn(() => Promise.resolve({})),
      listRows,
    };
    const storage = createNodeAppwritePrivateAttachmentStorage(
      {
        createFile,
        deleteFile,
        getFileDownload,
      } as unknown as import("node-appwrite").Storage,
      tables as unknown as import("node-appwrite").TablesDB,
      schema,
    );
    await storage.stage({
      objectId: "private/object-1",
      operationId,
      stagedAt: "2026-08-10T17:00:00.000Z",
      bytes,
      visibility: "private",
    });
    await expect(
      storage.listStagedBefore("2026-08-10T18:00:00.000Z"),
    ).resolves.toHaveLength(1);
    await expect(storage.read("private/object-1")).resolves.toEqual(bytes);
    await storage.remove("private/object-1");
    await expect(storage.remove("private/absent")).resolves.toBeUndefined();
    expect(createFile).toHaveBeenCalledOnce();
    expect(deleteFile).toHaveBeenCalledOnce();
    expect(getFileDownload).toHaveBeenCalledOnce();
    expect(tables.deleteRow).toHaveBeenCalledOnce();
    expect(tables.listRows).toHaveBeenCalledWith(
      expect.objectContaining({ queries: [expect.any(String), expect.any(String)] }),
    );
  });
});
