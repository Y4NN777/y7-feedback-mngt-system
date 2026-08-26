import { describe, expect, it } from "vitest";

import {
  createAppwriteSourceConnectionStore,
  type AppwriteSourceConnectionTablesPort,
} from "./appwrite-source-connection-store";

function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const transactionTtls: number[] = [];
  const tables: AppwriteSourceConnectionTablesPort = {
    createRow(input) {
      if (rows.has(input.rowId)) throw new Error("duplicate");
      const row = { $id: input.rowId, ...input.data };
      rows.set(input.rowId, row);
      return Promise.resolve(row);
    },
    getRow(input) {
      const row = rows.get(input.rowId);
      if (!row) throw Object.assign(new Error("absent"), { code: 404 });
      return Promise.resolve(row);
    },
    updateRow(input) {
      const row = rows.get(input.rowId);
      if (!row) throw new Error("absent");
      const updated = { ...row, ...input.data };
      rows.set(input.rowId, updated);
      return Promise.resolve(updated);
    },
    createTransaction(input) {
      transactionTtls.push(input.ttl);
      return Promise.resolve({ $id: "transaction_1" });
    },
    updateTransaction: () => Promise.resolve(),
  };
  return {
    rows,
    tables,
    transactionTtls,
    store: createAppwriteSourceConnectionStore(tables, {
      databaseId: "database_1",
      sourceConnectionsTableId: "source_connections",
    }),
  };
}

const pending = {
  id: "state_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  provider: "github" as const,
  ownerUserId: "owner_1",
  nonceDigest: "digest_1",
  expiresAt: 20_000,
  returnPath: "/settings/sources",
  createdAt: "2026-08-26T10:00:00.000Z",
};

describe("private Appwrite source connection store", () => {
  it("BDD-SRC-REAL-001 persists a private pending challenge without the raw nonce", async () => {
    const { rows, store } = fixture();
    await store.begin(pending);

    expect(rows.get("state_1")).toEqual({
      $id: "state_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      provider: "github",
      ownerUserId: "owner_1",
      status: "pending",
      encryptedGrantRef: "pending",
      selectedRepositoriesJson: JSON.stringify({
        kind: "pending",
        nonceDigest: "digest_1",
        expiresAt: 20_000,
        returnPath: "/settings/sources",
      }),
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
    });
  });

  it("BDD-SRC-REAL-002 claims the exact pending state only once", async () => {
    const { store, transactionTtls } = fixture();
    await store.begin(pending);

    await expect(
      store.claim({
        stateId: "state_1",
        provider: "github",
        nonceDigest: "digest_1",
        now: 10_000,
      }),
    ).resolves.toEqual(pending);
    await expect(
      store.claim({
        stateId: "state_1",
        provider: "github",
        nonceDigest: "digest_1",
        now: 10_000,
      }),
    ).resolves.toBeNull();
    expect(transactionTtls).toEqual([60, 60]);
  });

  it("BDD-SRC-REAL-003 activates only a provider-authorized repository subset", async () => {
    const { store } = fixture();
    await store.begin(pending);
    await store.claim({
      stateId: "state_1",
      provider: "github",
      nonceDigest: "digest_1",
      now: 10_000,
    });
    await store.authorize({
      ...pending,
      encryptedGrantRef: "grant_1",
      authorizedRepositories: [
        { provider: "github", id: "repository_1" },
        { provider: "github", id: "repository_2" },
      ],
    });

    await expect(
      store.select({
        connectionId: "state_1",
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        repositoryIds: ["repository_2"],
        updatedAt: "2026-08-26T10:01:00.000Z",
      }),
    ).resolves.toEqual({
      id: "state_1",
      provider: "github",
      selectedRepositories: [{ provider: "github", id: "repository_2" }],
    });
  });

  it("BDD-SRC-REAL-004 exposes only the opaque grant reference for revocation", async () => {
    const { store } = fixture();
    await store.begin(pending);
    await store.claim({
      stateId: "state_1",
      provider: "github",
      nonceDigest: "digest_1",
      now: 10_000,
    });
    await store.authorize({
      ...pending,
      encryptedGrantRef: "grant_1",
      authorizedRepositories: [{ provider: "github", id: "repository_1" }],
    });
    await store.select({
      connectionId: "state_1",
      ownerUserId: "owner_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      repositoryIds: ["repository_1"],
      updatedAt: "2026-08-26T10:01:00.000Z",
    });

    await expect(
      store.active({
        connectionId: "state_1",
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).resolves.toEqual({
      id: "state_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      ownerUserId: "owner_1",
      provider: "github",
      encryptedGrantRef: "grant_1",
    });
  });

  it("BDD-SRC-REAL-005 rejects invalid schema, identifiers, and unavailable transactions", async () => {
    const { tables } = fixture();
    expect(() =>
      createAppwriteSourceConnectionStore(tables, {
        databaseId: "same",
        sourceConnectionsTableId: "same",
      }),
    ).toThrow(new Error("APPWRITE_SOURCE_CONNECTION_SCHEMA_INVALID"));
    const store = createAppwriteSourceConnectionStore(
      {
        createRow: (input) => tables.createRow(input),
        getRow: (input) => tables.getRow(input),
        updateRow: (input) => tables.updateRow(input),
      },
      { databaseId: "database_1", sourceConnectionsTableId: "source_connections" },
    );
    await expect(store.begin({ ...pending, id: "invalid/id" })).rejects.toThrow(
      "APPWRITE_SOURCE_CONNECTION_INVALID",
    );
    await store.begin(pending);
    await expect(
      store.claim({
        stateId: "state_1",
        provider: "github",
        nonceDigest: "digest_1",
        now: 10_000,
      }),
    ).resolves.toEqual(pending);
    await store.authorize({
      ...pending,
      encryptedGrantRef: "grant_1",
      authorizedRepositories: [{ provider: "github", id: "repository_1" }],
    });
    await expect(
      store.select({
        connectionId: "state_1",
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        repositoryIds: ["repository_1"],
        updatedAt: "2026-08-26T10:01:00.000Z",
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "state_1" }));
    const badTransaction = {
      ...tables,
      createTransaction: () => Promise.resolve({ $id: "bad/id" }),
    };
    await expect(
      createAppwriteSourceConnectionStore(badTransaction, {
        databaseId: "database_1",
        sourceConnectionsTableId: "source_connections",
      }).claim({
        stateId: "state_1",
        provider: "github",
        nonceDigest: "digest_1",
        now: 10_000,
      }),
    ).rejects.toThrow("APPWRITE_SOURCE_CONNECTION_UNAVAILABLE");
  });

  it("BDD-SRC-REAL-005 fails closed for malformed persisted state", async () => {
    const { rows, store } = fixture();
    await store.begin(pending);
    const original = { ...rows.get("state_1") };
    const invalidRows: ReadonlyArray<Record<string, unknown>> = [
      { ...original, status: "claiming" },
      { ...original, selectedRepositoriesJson: "" },
      { ...original, selectedRepositoriesJson: "{" },
      { ...original, selectedRepositoriesJson: "[]" },
      { ...original, $id: "" },
      { ...original, provider: "other" },
      { ...original, selectedRepositoriesJson: JSON.stringify({ kind: "pending" }) },
      {
        ...original,
        selectedRepositoriesJson: JSON.stringify({
          kind: "pending",
          nonceDigest: "d",
          returnPath: "/",
          expiresAt: 1.5,
        }),
      },
    ];
    for (const row of invalidRows) {
      rows.set("state_1", row);
      await expect(
        store.claim({
          stateId: "state_1",
          provider: "github",
          nonceDigest: "digest_1",
          now: 10_000,
        }),
      ).resolves.toBeNull();
    }
    rows.delete("state_1");
    await expect(
      store.claim({
        stateId: "state_1",
        provider: "github",
        nonceDigest: "digest_1",
        now: 10_000,
      }),
    ).resolves.toBeNull();
    await expect(
      store.active({
        connectionId: "state_1",
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).resolves.toBeNull();
  });

  it("BDD-SRC-REAL-005 denies malformed selection and disconnects valid state", async () => {
    const { rows, store } = fixture();
    await store.begin(pending);
    await store.claim({
      stateId: "state_1",
      provider: "github",
      nonceDigest: "digest_1",
      now: 10_000,
    });
    await store.authorize({
      ...pending,
      encryptedGrantRef: "grant_1",
      authorizedRepositories: [{ provider: "github", id: "repository_1" }],
    });
    const command = {
      connectionId: "state_1",
      ownerUserId: "owner_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      updatedAt: "2026-08-26T10:01:00.000Z",
    };
    for (const repositoryIds of [[], ["repository_1", "repository_1"], ["other"]]) {
      await expect(store.select({ ...command, repositoryIds })).resolves.toBeNull();
    }
    rows.set("state_1", { ...rows.get("state_1"), status: "pending" });
    await expect(
      store.select({ ...command, repositoryIds: ["repository_1"] }),
    ).resolves.toBeNull();
    rows.set("state_1", {
      ...rows.get("state_1"),
      status: "selecting",
      provider: "github",
      selectedRepositoriesJson: "{",
    });
    await expect(
      store.select({ ...command, repositoryIds: ["repository_1"] }),
    ).resolves.toBeNull();
    rows.set("state_1", {
      ...rows.get("state_1"),
      provider: "other",
      selectedRepositoriesJson: JSON.stringify({
        kind: "authorized",
        repositories: [],
      }),
    });
    await expect(
      store.select({ ...command, repositoryIds: ["repository_1"] }),
    ).resolves.toBeNull();
    rows.set("state_1", {
      ...rows.get("state_1"),
      status: "selecting",
      provider: "github",
      selectedRepositoriesJson: JSON.stringify({
        kind: "authorized",
        repositories: Array.from({ length: 101 }, (_, index) => ({
          provider: "github",
          id: `repo_${String(index)}`,
        })),
      }),
    });
    await expect(
      store.select({ ...command, repositoryIds: ["repository_1"] }),
    ).resolves.toBeNull();
    rows.set("state_1", {
      ...rows.get("state_1"),
      selectedRepositoriesJson: JSON.stringify({
        kind: "authorized",
        repositories: [{ provider: "gitlab", id: "repository_1" }],
      }),
    });
    await expect(
      store.select({ ...command, repositoryIds: ["repository_1"] }),
    ).resolves.toBeNull();
    rows.set("state_1", {
      ...rows.get("state_1"),
      status: "active",
      provider: "github",
      encryptedGrantRef: "grant_1",
    });
    await expect(
      store.active({
        connectionId: "state_1",
        ownerUserId: "wrong",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).resolves.toBeNull();
    rows.set("state_1", {
      ...rows.get("state_1"),
      status: "active",
      provider: "other",
      encryptedGrantRef: "grant_1",
      ownerUserId: "owner_1",
    });
    await expect(
      store.active({
        connectionId: "state_1",
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).resolves.toBeNull();
    await store.disconnected("state_1");
    expect(rows.get("state_1")).toEqual(
      expect.objectContaining({ status: "disconnected", encryptedGrantRef: "revoked" }),
    );
    const unavailable = createAppwriteSourceConnectionStore(
      {
        ...fixture().tables,
        getRow: () => Promise.reject(new Error("unavailable")),
      },
      { databaseId: "database_1", sourceConnectionsTableId: "source_connections" },
    );
    await expect(
      unavailable.active({
        connectionId: "state_1",
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).rejects.toThrow("unavailable");
  });
});
