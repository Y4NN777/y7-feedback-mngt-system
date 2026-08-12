import { describe, expect, it, vi } from "vitest";

import { createNodeAppwriteG1FixtureStore } from "./appwrite-g1-fixtures-node";

function client() {
  return {
    getRow: vi.fn(),
    createTransaction: vi.fn(),
    createRow: vi.fn(),
    updateTransaction: vi.fn(),
  };
}

describe("Node Appwrite G1 fixture adapter", () => {
  it("BDD-G1-FIX-004 maps only an Appwrite 404 to an absent row", async () => {
    const tables = client();
    tables.getRow.mockRejectedValueOnce({ code: 404 });
    tables.getRow.mockRejectedValueOnce(new Error("transport failed"));
    const store = createNodeAppwriteG1FixtureStore(tables, "feedback");

    await expect(store.getRow("workspaces", "workspace_alpha")).resolves.toBeNull();
    await expect(store.getRow("workspaces", "workspace_alpha")).rejects.toThrow(
      "transport failed",
    );
  });

  it("BDD-G1-FIX-005 strips Appwrite metadata and keeps fixture data exact", async () => {
    const tables = client();
    tables.getRow.mockResolvedValue({
      $id: "workspace_alpha",
      $createdAt: "ignored",
      $permissions: [],
      name: "Alpha Workspace",
      active: true,
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    const store = createNodeAppwriteG1FixtureStore(tables, "feedback");

    await expect(store.getRow("workspaces", "workspace_alpha")).resolves.toEqual({
      name: "Alpha Workspace",
      active: true,
      createdAt: "2026-08-10T00:00:00.000Z",
    });
  });

  it("BDD-G1-FIX-005A rejects malformed row and transaction metadata", async () => {
    const tables = client();
    tables.getRow.mockResolvedValueOnce([]);
    tables.createTransaction.mockResolvedValueOnce(null);
    tables.createTransaction.mockResolvedValueOnce({ $id: 7 });
    tables.createTransaction.mockResolvedValueOnce({ $id: "   " });
    const store = createNodeAppwriteG1FixtureStore(tables, "feedback");

    await expect(store.getRow("workspaces", "workspace_alpha")).rejects.toThrow(
      "APPWRITE_G1_FIXTURE_INVALID",
    );
    await expect(store.createTransaction()).rejects.toThrow(
      "APPWRITE_G1_TRANSACTION_INVALID",
    );
    await expect(store.createTransaction()).rejects.toThrow(
      "APPWRITE_G1_TRANSACTION_INVALID",
    );
    await expect(store.createTransaction()).rejects.toThrow(
      "APPWRITE_G1_TRANSACTION_INVALID",
    );
  });

  it("BDD-G1-FIX-006 maps transaction and private row operations exactly", async () => {
    const tables = client();
    tables.createTransaction.mockResolvedValue({ $id: "transaction_1" });
    tables.createRow.mockResolvedValue({});
    tables.updateTransaction.mockResolvedValue({});
    const store = createNodeAppwriteG1FixtureStore(tables, "feedback");

    await expect(store.createTransaction()).resolves.toBe("transaction_1");
    await store.createRow({
      tableId: "workspaces",
      rowId: "workspace_alpha",
      data: { name: "Alpha Workspace" },
      permissions: [],
      transactionId: "transaction_1",
    });
    await store.commitTransaction("transaction_1");
    await store.rollbackTransaction("transaction_2");

    expect(tables.createTransaction).toHaveBeenCalledWith({ ttl: 60 });
    expect(tables.createRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "workspaces",
      rowId: "workspace_alpha",
      data: { name: "Alpha Workspace" },
      permissions: [],
      transactionId: "transaction_1",
    });
    expect(tables.updateTransaction).toHaveBeenNthCalledWith(1, {
      transactionId: "transaction_1",
      commit: true,
    });
    expect(tables.updateTransaction).toHaveBeenNthCalledWith(2, {
      transactionId: "transaction_2",
      rollback: true,
    });
  });
});
