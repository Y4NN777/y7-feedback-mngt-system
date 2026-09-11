import { describe, expect, it, vi } from "vitest";

import { failCreateForTable } from "./appwrite-operation-failure-injection.js";

describe("Appwrite transaction failure injection", () => {
  it("BDD-G1-REAL-008 rejects a batched create targeting the forced-failure table", async () => {
    const createOperations = vi.fn().mockResolvedValue({
      $id: "transaction_1",
      operations: 2,
    });
    const tables = failCreateForTable({ createOperations }, "lifecycle");

    await expect(
      tables.createOperations({
        transactionId: "transaction_1",
        operations: [
          { action: "create", tableId: "feedback" },
          { action: "create", tableId: "lifecycle" },
        ],
      }),
    ).rejects.toThrow("APPWRITE_G1_FORCED_ROW_FAILURE");
    expect(createOperations).not.toHaveBeenCalled();
  });

  it("preserves unrelated SDK properties and operations", async () => {
    const listRows = vi.fn().mockResolvedValue({ rows: [] });
    const createRow = vi.fn().mockResolvedValue({ $id: "feedback_1" });
    const createOperations = vi.fn().mockResolvedValue({
      $id: "transaction_1",
      operations: 1,
    });
    const tables = failCreateForTable(
      { sdk: "appwrite", listRows, createRow, createOperations },
      "lifecycle",
    );

    expect(tables.sdk).toBe("appwrite");
    await expect(tables.listRows({ tableId: "feedback" })).resolves.toEqual({
      rows: [],
    });
    await expect(tables.createRow({ tableId: "feedback" })).resolves.toEqual({
      $id: "feedback_1",
    });
    await expect(
      tables.createOperations({
        operations: [null, { action: "create", tableId: "feedback" }],
      }),
    ).resolves.toEqual({ $id: "transaction_1", operations: 1 });
  });

  it("rejects the legacy single-row create path for the target table", async () => {
    const createRow = vi.fn().mockResolvedValue({ $id: "lifecycle_1" });
    const tables = failCreateForTable({ createRow }, "lifecycle");

    await expect(tables.createRow({ tableId: "lifecycle" })).rejects.toThrow(
      "APPWRITE_G1_FORCED_ROW_FAILURE",
    );
    expect(createRow).not.toHaveBeenCalled();
  });
});
