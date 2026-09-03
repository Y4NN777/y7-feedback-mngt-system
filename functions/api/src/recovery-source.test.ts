import { describe, expect, it } from "vitest";

import {
  collectRecoveryEntries,
  type RecoverySource,
  type RecoverySourceInventory,
} from "./recovery-source";

const inventory: RecoverySourceInventory = {
  capturedAt: "2026-09-03T09:00:04.000Z",
  databaseId: "database_1",
  bucketId: "bucket_1",
  tables: [
    {
      id: "feedback",
      schema: { name: "Feedback", rowSecurity: true },
      rows: [
        { id: "feedback_1", updatedAt: "2026-09-03T09:00:00.000Z" },
        { id: "feedback_2", updatedAt: "2026-09-03T09:00:01.000Z" },
      ],
    },
    {
      id: "privacy_deletions",
      schema: { name: "Privacy deletions", rowSecurity: false },
      rows: [{ id: "event_1", updatedAt: "2026-09-03T09:00:02.000Z" }],
    },
  ],
  files: [
    {
      id: "file_1",
      updatedAt: "2026-09-03T09:00:03.000Z",
      size: 7,
      signature: "signature_1",
    },
  ],
  configuration: {
    functionId: "y7-feedback-api-preview",
    runtime: "node-22",
    variableNames: ["APPWRITE_DATABASE_ID"],
  },
};

function source(overrides: Partial<RecoverySource> = {}): RecoverySource {
  return {
    inventory: () => Promise.resolve(inventory),
    readRow: (_tableId, rowId) =>
      Promise.resolve({ $id: rowId, value: `value-${rowId}` }),
    readFile: () => Promise.resolve(new TextEncoder().encode("private")),
    ...overrides,
  };
}

describe("stable Appwrite recovery collection", () => {
  it("BDD-REC-011 collects configuration, rows, deletions and private files", async () => {
    const result = await collectRecoveryEntries({
      source: source(),
      deletionTableIds: ["privacy_deletions"],
    });
    expect(result.latestSourceMutationAt).toBe("2026-09-03T09:00:03.000Z");
    expect(result.entries.map(({ kind, path }) => ({ kind, path }))).toEqual([
      { kind: "config", path: "config/appwrite.json" },
      {
        kind: "table_row",
        path: "tables/feedback/feedback_1.json",
      },
      {
        kind: "table_row",
        path: "tables/feedback/feedback_2.json",
      },
      {
        kind: "deletion_event",
        path: "deletions/privacy_deletions/event_1.json",
      },
      { kind: "private_file", path: "storage/bucket_1/file_1" },
    ]);
    expect(new TextDecoder().decode(result.entries[0]?.bytes)).not.toContain("secret");
  });

  it("BDD-REC-012 aborts when source inventory changes during collection", async () => {
    let call = 0;
    const firstFile = inventory.files[0];
    if (!firstFile) throw new Error("fixture");
    const changed: RecoverySourceInventory = {
      ...inventory,
      files: [{ ...firstFile, signature: "changed" }],
    };
    await expect(
      collectRecoveryEntries({
        source: source({
          inventory: () => Promise.resolve(call++ === 0 ? inventory : changed),
        }),
        deletionTableIds: ["privacy_deletions"],
      }),
    ).rejects.toThrow("RECOVERY_SOURCE_CHANGED");
  });

  it("BDD-REC-013 aborts on missing or changed row and file payload", async () => {
    await expect(
      collectRecoveryEntries({
        source: source({ readRow: () => Promise.reject(new Error("missing")) }),
        deletionTableIds: ["privacy_deletions"],
      }),
    ).rejects.toThrow("RECOVERY_SOURCE_READ_FAILED");
    await expect(
      collectRecoveryEntries({
        source: source({
          readFile: () => Promise.resolve(new TextEncoder().encode("wrong-size")),
        }),
        deletionTableIds: ["privacy_deletions"],
      }),
    ).rejects.toThrow("RECOVERY_SOURCE_READ_FAILED");
  });
});
