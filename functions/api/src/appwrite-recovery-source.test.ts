import { describe, expect, it } from "vitest";

import { createAppwriteRecoverySource } from "./appwrite-recovery-source";

describe("Appwrite recovery source adapter", () => {
  it("BDD-REC-014 paginates stable inventory and excludes Function secret values", async () => {
    let filePage = 0;
    const files = Array.from({ length: 101 }, (_, index) => ({
      $id: `file_${String(index).padStart(3, "0")}`,
      $updatedAt: "2026-09-03T09:00:00.000Z",
      sizeOriginal: 7,
      signature: `signature_${String(index)}`,
    }));
    const source = createAppwriteRecoverySource(
      {
        tables: {
          listTables: () => Promise.resolve({ tables: [] }),
          listRows: () => Promise.resolve({ rows: [] }),
          getRow: () => Promise.reject(new Error("unused")),
        },
        storage: {
          getBucket: () =>
            Promise.resolve({ $id: "bucket_1", fileSecurity: true, enabled: true }),
          listFiles: () => {
            const offset = filePage++ * 100;
            return Promise.resolve({ files: files.slice(offset, offset + 100) });
          },
          getFileDownload: () => Promise.resolve(new ArrayBuffer(0)),
        },
        functions: {
          get: () =>
            Promise.resolve({
              $id: "function_1",
              runtime: "node-22",
              vars: [{ key: "APPWRITE_API_KEY", value: "must-never-be-backed-up" }],
            }),
        },
      },
      {
        databaseId: "database_1",
        bucketId: "bucket_1",
        functionId: "function_1",
        now: () => "2026-09-03T09:01:00.000Z",
      },
    );
    const inventory = await source.inventory();
    expect(inventory.files).toHaveLength(101);
    expect(filePage).toBe(2);
    const configuration = JSON.stringify(inventory.configuration);
    expect(configuration).toContain("APPWRITE_API_KEY");
    expect(configuration).not.toContain("must-never-be-backed-up");
  });

  it("BDD-REC-015 reads exact rows and private bytes through scoped ports", async () => {
    const calls: string[] = [];
    const source = createAppwriteRecoverySource(
      {
        tables: {
          listTables: () => Promise.resolve({ tables: [] }),
          listRows: () => Promise.resolve({ rows: [] }),
          getRow: ({ tableId, rowId }) => {
            calls.push(`${tableId}/${rowId}`);
            return Promise.resolve({ $id: rowId });
          },
        },
        storage: {
          getBucket: () => Promise.resolve({}),
          listFiles: () => Promise.resolve({ files: [] }),
          getFileDownload: ({ fileId }) => {
            calls.push(fileId);
            return Promise.resolve(new Uint8Array([1, 2]).buffer);
          },
        },
        functions: { get: () => Promise.resolve({ vars: [] }) },
      },
      {
        databaseId: "database_1",
        bucketId: "bucket_1",
        functionId: "function_1",
        now: () => "2026-09-03T09:01:00.000Z",
      },
    );
    await expect(source.readRow("feedback", "feedback_1")).resolves.toEqual({
      $id: "feedback_1",
    });
    await expect(source.readFile("file_1")).resolves.toEqual(new Uint8Array([1, 2]));
    expect(calls).toEqual(["feedback/feedback_1", "file_1"]);
  });
});
