import { describe, expect, it, vi } from "vitest";

import { createAppwriteProviderIssueStateStore } from "./appwrite-provider-issue-state-store.js";

const schema = {
  databaseId: "feedback",
  externalIssueLinksTableId: "external_issue_links",
};
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(",")}`,
  limit: (value: number) => `limit:${String(value)}`,
};
const change = {
  provider: "github" as const,
  deliveryId: "delivery_1",
  connectionId: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  repositoryId: "1329343404",
  issueId: "42",
  state: "closed" as const,
  providerUpdatedAt: "2026-09-02T00:00:00.000Z",
};
const link = {
  $id: "link_1",
  state: "active",
  connectionId: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  provider: "github",
  repositoryId: "1329343404",
  providerIssueId: "42",
};

function harness(rows: readonly unknown[] = [link]) {
  type UpdateInput = {
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
  };
  const tables = {
    createTransaction: vi.fn(() => Promise.resolve({ $id: "transaction_1" })),
    updateTransaction: vi.fn(() => Promise.resolve({})),
    listRows: vi.fn(() => Promise.resolve({ rows })),
    updateRow: vi.fn((_input: UpdateInput) => {
      void _input;
      return Promise.resolve({ $id: "link_1" });
    }),
  };
  return {
    tables,
    store: createAppwriteProviderIssueStateStore(tables, schema, queries),
  };
}

describe("Appwrite provider issue state store", () => {
  it("BDD-SYNC-046 atomically applies a newer provider state", async () => {
    const { store, tables } = harness();
    await expect(store.apply(change)).resolves.toBe("applied");
    expect(tables.listRows).toHaveBeenCalledWith(
      expect.objectContaining({
        queries: [
          "equal:provider:github",
          "equal:repositoryId:1329343404",
          "equal:providerIssueId:42",
          "limit:2",
        ],
      }),
    );
    const update = tables.updateRow.mock.calls[0]?.[0];
    expect(update?.rowId).toBe("link_1");
    expect(update?.data).toMatchObject({
      providerState: "closed",
      lastProviderDeliveryId: "delivery_1",
    });
    expect(tables.updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction_1",
      commit: true,
    });
  });

  it("BDD-SYNC-047 ignores duplicates, older events and unrelated issues", async () => {
    await expect(harness([]).store.apply(change)).resolves.toBe("ignored");
    await expect(
      harness([{ ...link, lastProviderDeliveryId: "delivery_1" }]).store.apply(change),
    ).resolves.toBe("ignored");
    await expect(
      harness([{ ...link, providerUpdatedAt: "2026-09-02T00:01:00.000Z" }]).store.apply(
        change,
      ),
    ).resolves.toBe("ignored");
  });

  it.each([
    [link, { ...change, connectionId: "bad/id" }],
    [link, { ...change, providerUpdatedAt: "invalid" }],
    [null, change],
    [[link, link], change],
    [{ ...link, state: "deleted" }, change],
    [{ ...link, connectionId: "foreign" }, change],
  ])(
    "BDD-SYNC-048 fails closed on malformed or cross-scope state %#",
    async (row, input) => {
      const rows = Array.isArray(row) ? row : [row];
      await expect(harness(rows).store.apply(input)).resolves.toBe("permanent");
    },
  );

  it("BDD-SYNC-049 rolls back transaction and provider failures", async () => {
    const invalidTransaction = harness();
    invalidTransaction.tables.createTransaction.mockResolvedValueOnce({
      $id: "bad/id",
    });
    await expect(invalidTransaction.store.apply(change)).rejects.toThrow(
      "PROVIDER_ISSUE_STATE_TX_INVALID",
    );

    const badWrite = harness();
    badWrite.tables.updateRow.mockResolvedValueOnce({ $id: "other" });
    await expect(badWrite.store.apply(change)).rejects.toThrow(
      "PROVIDER_ISSUE_STATE_WRITE_INVALID",
    );
    expect(badWrite.tables.updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction_1",
      rollback: true,
    });

    const rollbackFailure = harness();
    rollbackFailure.tables.listRows.mockRejectedValueOnce(new Error("unavailable"));
    rollbackFailure.tables.updateTransaction.mockRejectedValueOnce(
      new Error("rollback unavailable"),
    );
    await expect(rollbackFailure.store.apply(change)).rejects.toThrow("unavailable");
  });

  it("BDD-SYNC-050 validates schema identity", () => {
    const { tables } = harness();
    expect(() =>
      createAppwriteProviderIssueStateStore(
        tables,
        { databaseId: "same", externalIssueLinksTableId: "same" },
        queries,
      ),
    ).toThrow("PROVIDER_ISSUE_STATE_SCHEMA_INVALID");
  });
});
