import { describe, expect, it, vi } from "vitest";

import {
  createAppwriteSourceManagementStore,
  createAppwriteSourceProjectSlugPort,
  type AppwriteSourceManagementTablesPort,
} from "./appwrite-source-management-store";

const selected = {
  $id: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  provider: "github",
  ownerUserId: "owner_1",
  status: "active",
  encryptedGrantRef: "grant_1",
  selectedRepositoriesJson: JSON.stringify({
    kind: "selected",
    repositories: [{ provider: "github", id: "1329343404" }],
  }),
  updatedAt: "2026-08-28T12:00:00.000Z",
};

function setup() {
  let row: Record<string, unknown> = selected;
  const listRows = vi.fn(
    (input: Parameters<AppwriteSourceManagementTablesPort["listRows"]>[0]) => {
      void input;
      return Promise.resolve<{ readonly rows: readonly unknown[] }>({ rows: [row] });
    },
  );
  const getRow = vi.fn(() => Promise.resolve(row));
  const updateRow = vi.fn(
    (input: Parameters<AppwriteSourceManagementTablesPort["updateRow"]>[0]) => {
      row = { ...row, ...input.data };
      return Promise.resolve(row);
    },
  );
  const createTransaction = vi.fn(() => Promise.resolve({ $id: "transaction_1" }));
  const updateTransaction = vi.fn(() => Promise.resolve({}));
  const store = createAppwriteSourceManagementStore(
    { listRows, getRow, updateRow, createTransaction, updateTransaction },
    { databaseId: "feedback", sourceConnectionsTableId: "source_connections" },
    {
      equal: (attribute, values) => `equal:${attribute}:${values.join(",")}`,
      limit: (value) => `limit:${String(value)}`,
    },
  );
  return {
    createTransaction,
    getRow,
    listRows,
    store,
    updateRow,
    updateTransaction,
  };
}

describe("Appwrite source management store", () => {
  it("BDD-SRC-208 lists only exact scoped connection health without grants", async () => {
    const { listRows, store } = setup();
    await expect(
      store.list({
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).resolves.toEqual([
      {
        id: "connection_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        provider: "github",
        state: "active",
        selectedRepositories: [{ provider: "github", id: "1329343404" }],
        importedRepositories: [],
        updatedAt: "2026-08-28T12:00:00.000Z",
      },
    ]);
    expect(listRows).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "source_connections",
      queries: [
        "equal:ownerUserId:owner_1",
        "equal:workspaceId:workspace_1",
        "equal:projectId:project_1",
        "equal:status:active,disconnected",
        "limit:10",
      ],
      total: false,
      ttl: 0,
    });
  });

  it("BDD-SRC-213 exposes authorized repositories for first-party selection", async () => {
    const target = setup();
    target.listRows.mockResolvedValueOnce({
      rows: [
        {
          ...selected,
          status: "selecting",
          selectedRepositoriesJson: JSON.stringify({
            kind: "authorized",
            repositories: [
              { provider: "github", id: "1329343404" },
              { provider: "github", id: "repo_2" },
            ],
          }),
        },
      ],
    });
    await expect(
      target.store.pending({
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).resolves.toEqual([
      {
        id: "connection_1",
        provider: "github",
        authorizedRepositories: [
          { provider: "github", id: "1329343404" },
          { provider: "github", id: "repo_2" },
        ],
        updatedAt: "2026-08-28T12:00:00.000Z",
      },
    ]);
    expect(target.listRows).toHaveBeenCalledWith(expect.anything());
    expect(target.listRows.mock.calls[0]?.[0].queries).toContain(
      "equal:status:selecting",
    );
  });

  it("fails closed for malformed pending selections", async () => {
    const authorized = JSON.stringify({
      kind: "authorized",
      repositories: [{ provider: "github", id: "1329343404" }],
    });
    const base = {
      ...selected,
      status: "selecting",
      selectedRepositoriesJson: authorized,
    };
    for (const row of [
      null,
      { ...base, $id: 7 },
      { ...base, $id: "bad id" },
      { ...base, status: "active" },
      { ...base, provider: "unknown" },
      { ...base, ownerUserId: "owner_2" },
      { ...base, workspaceId: "workspace_2" },
      { ...base, projectId: "project_2" },
      { ...base, updatedAt: 7 },
      { ...base, selectedRepositoriesJson: JSON.stringify({ kind: "pending" }) },
      {
        ...base,
        selectedRepositoriesJson: JSON.stringify({
          kind: "authorized",
          repositories: [],
        }),
      },
    ]) {
      const target = setup();
      target.listRows.mockResolvedValueOnce({ rows: [row] });
      await expect(
        target.store.pending({
          ownerUserId: "owner_1",
          workspaceId: "workspace_1",
          projectId: "project_1",
        }),
      ).rejects.toThrow("APPWRITE_SOURCE_MANAGEMENT_UNAVAILABLE");
    }
  });

  it("BDD-SRC-209 atomically saves one validated import and replays as replacement", async () => {
    const { store, updateRow, updateTransaction } = setup();
    const repository = {
      connectionId: "connection_1",
      provider: "github" as const,
      repositoryId: "1329343404",
      name: "feedback",
      owner: "Y4NN777",
      visibility: "private" as const,
      webUrl: "https://github.com/Y4NN777/feedback",
      defaultBranch: "main",
      observedAt: "2026-08-28T16:00:00.000Z",
      releases: [],
    };
    const command = {
      connectionId: "connection_1",
      ownerUserId: "owner_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      repository,
      updatedAt: repository.observedAt,
    };
    await expect(store.saveImport(command)).resolves.toMatchObject({
      importedRepositories: [repository],
    });
    await expect(store.saveImport(command)).resolves.toMatchObject({
      importedRepositories: [repository],
    });
    const update = updateRow.mock.calls.at(-1)?.[0];
    expect(update?.transactionId).toBe("transaction_1");
    expect(update?.data.updatedAt).toBe(repository.observedAt);
    expect(updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction_1",
      commit: true,
    });
  });

  it("BDD-SRC-210 fails closed on cross-scope, disconnected or malformed state", async () => {
    const repository = {
      connectionId: "connection_1",
      provider: "github" as const,
      repositoryId: "1329343404",
      name: "feedback",
      owner: "Y4NN777",
      visibility: "private" as const,
      webUrl: "https://github.com/Y4NN777/feedback",
      defaultBranch: "main",
      observedAt: "2026-08-28T16:00:00.000Z",
      releases: [],
    };
    for (const row of [
      { ...selected, workspaceId: "workspace_2" },
      { ...selected, status: "disconnected" },
      { ...selected, selectedRepositoriesJson: "invalid" },
    ]) {
      const target = setup();
      target.getRow.mockResolvedValueOnce(row);
      await expect(
        target.store.saveImport({
          connectionId: "connection_1",
          ownerUserId: "owner_1",
          workspaceId: "workspace_1",
          projectId: "project_1",
          repository,
          updatedAt: repository.observedAt,
        }),
      ).rejects.toThrow("APPWRITE_SOURCE_MANAGEMENT_DENIED");
      expect(target.updateRow).not.toHaveBeenCalled();
    }
  });

  it("parses imported release provenance and disconnected health", async () => {
    const target = setup();
    const imported = {
      connectionId: "connection_1",
      provider: "github",
      repositoryId: "1329343404",
      name: "feedback",
      owner: "Y4NN777",
      visibility: "private",
      webUrl: "https://github.com/Y4NN777/feedback",
      defaultBranch: "main",
      observedAt: "2026-08-28T16:00:00.000Z",
      releases: [
        {
          providerReleaseId: "release_1",
          tag: "v1",
          name: "One",
          publishedAt: "2026-08-28T15:00:00.000Z",
          webUrl: "https://github.com/Y4NN777/feedback/releases/tag/v1",
          observedAt: "2026-08-28T16:00:00.000Z",
        },
      ],
    };
    target.listRows.mockResolvedValueOnce({
      rows: [
        {
          ...selected,
          status: "disconnected",
          encryptedGrantRef: "revoked",
          selectedRepositoriesJson: JSON.stringify({
            kind: "selected",
            repositories: [{ provider: "github", id: "1329343404" }],
            imports: [imported],
          }),
        },
      ],
    });
    await expect(
      target.store.list({
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).resolves.toMatchObject([
      { state: "disconnected", importedRepositories: [imported] },
    ]);
  });

  it("BDD-SRC-210 projects provider-cleared disconnected health", async () => {
    const target = setup();
    target.listRows.mockResolvedValueOnce({
      rows: [
        {
          ...selected,
          status: "disconnected",
          encryptedGrantRef: "revoked",
          selectedRepositoriesJson: JSON.stringify({
            kind: "selected",
            repositories: [],
          }),
        },
      ],
    });
    await expect(
      target.store.list({
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).resolves.toMatchObject([
      {
        state: "disconnected",
        selectedRepositories: [],
        importedRepositories: [],
      },
    ]);
  });

  it("rejects every malformed persisted source connection shape", async () => {
    const validState = JSON.parse(selected.selectedRepositoriesJson) as Record<
      string,
      unknown
    >;
    const invalidRows: readonly unknown[] = [
      null,
      { ...selected, $id: 7 },
      { ...selected, $id: "bad id" },
      { ...selected, provider: "unknown" },
      { ...selected, status: "pending" },
      { ...selected, ownerUserId: 7 },
      { ...selected, projectId: 7 },
      { ...selected, updatedAt: 7 },
      { ...selected, selectedRepositoriesJson: "" },
      { ...selected, selectedRepositoriesJson: "x".repeat(500_001) },
      { ...selected, selectedRepositoriesJson: "null" },
      { ...selected, selectedRepositoriesJson: "{" },
      { ...selected, selectedRepositoriesJson: JSON.stringify({ kind: "wrong" }) },
      {
        ...selected,
        selectedRepositoriesJson: JSON.stringify({
          ...validState,
          repositories: [],
        }),
      },
      {
        ...selected,
        selectedRepositoriesJson: JSON.stringify({
          ...validState,
          repositories: [null],
        }),
      },
      {
        ...selected,
        selectedRepositoriesJson: JSON.stringify({
          ...validState,
          repositories: [{ provider: "gitlab", id: "1329343404" }],
        }),
      },
      {
        ...selected,
        selectedRepositoriesJson: JSON.stringify({
          ...validState,
          repositories: [
            { provider: "github", id: "1329343404" },
            { provider: "github", id: "1329343404" },
          ],
        }),
      },
      {
        ...selected,
        selectedRepositoriesJson: JSON.stringify({
          ...validState,
          imports: [null],
        }),
      },
      {
        ...selected,
        selectedRepositoriesJson: JSON.stringify({
          ...validState,
          imports: "wrong",
        }),
      },
      {
        ...selected,
        selectedRepositoriesJson: JSON.stringify({
          ...validState,
          imports: [{}, {}],
        }),
      },
      {
        ...selected,
        selectedRepositoriesJson: JSON.stringify({
          ...validState,
          imports: [
            {
              connectionId: "connection_1",
              provider: "github",
              repositoryId: "1329343404",
              releases: [null],
            },
          ],
        }),
      },
      {
        ...selected,
        selectedRepositoriesJson: JSON.stringify({
          ...validState,
          imports: [
            {
              connectionId: "connection_1",
              provider: "github",
              repositoryId: "unselected_1",
              name: "Other",
              owner: "Y4NN777",
              visibility: "private",
              webUrl: "https://github.com/Y4NN777/other",
              defaultBranch: "main",
              observedAt: "2026-08-28T16:00:00.000Z",
              releases: [],
            },
          ],
        }),
      },
      { ...selected, encryptedGrantRef: "bad grant" },
    ];
    for (const row of invalidRows) {
      const target = setup();
      target.listRows.mockResolvedValueOnce({
        rows: [row],
      });
      await expect(
        target.store.list({
          ownerUserId: "owner_1",
          workspaceId: "workspace_1",
          projectId: "project_1",
        }),
      ).rejects.toThrow("APPWRITE_SOURCE_MANAGEMENT_UNAVAILABLE");
    }
  });

  it("handles active absence, SDK failure and transaction rollback", async () => {
    const active = setup();
    await expect(
      active.store.active({
        connectionId: "connection_1",
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).resolves.toMatchObject({ id: "connection_1", state: "active" });
    const absent = setup();
    absent.getRow.mockRejectedValueOnce(
      Object.assign(new Error("absent"), { code: 404 }),
    );
    await expect(
      absent.store.active({
        connectionId: "connection_1",
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).resolves.toBeNull();
    const unavailable = setup();
    unavailable.getRow.mockRejectedValueOnce(new Error("unavailable"));
    await expect(
      unavailable.store.active({
        connectionId: "connection_1",
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).rejects.toThrow("unavailable");

    const invalidFailure = setup();
    invalidFailure.getRow.mockRejectedValueOnce("unavailable");
    await expect(
      invalidFailure.store.active({
        connectionId: "connection_1",
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).rejects.toThrow("APPWRITE_SOURCE_MANAGEMENT_UNAVAILABLE");

    const disconnected = setup();
    disconnected.getRow.mockResolvedValueOnce({
      ...selected,
      status: "disconnected",
      encryptedGrantRef: "revoked",
    });
    await expect(
      disconnected.store.active({
        connectionId: "connection_1",
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
      }),
    ).resolves.toBeNull();

    const invalidTransaction = setup();
    invalidTransaction.createTransaction.mockResolvedValueOnce({ $id: "bad id" });
    await expect(
      invalidTransaction.store.saveImport({
        connectionId: "connection_1",
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        repository: {
          connectionId: "connection_1",
          provider: "github",
          repositoryId: "1329343404",
          name: "feedback",
          owner: "Y4NN777",
          visibility: "private",
          webUrl: "https://github.com/Y4NN777/feedback",
          defaultBranch: "main",
          observedAt: "2026-08-28T16:00:00.000Z",
          releases: [],
        },
        updatedAt: "2026-08-28T16:00:00.000Z",
      }),
    ).rejects.toThrow("APPWRITE_SOURCE_MANAGEMENT_UNAVAILABLE");

    const oversized = setup();
    oversized.updateTransaction.mockRejectedValueOnce(new Error("rollback failed"));
    await expect(
      oversized.store.saveImport({
        connectionId: "connection_1",
        ownerUserId: "owner_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        repository: {
          connectionId: "connection_1",
          provider: "github",
          repositoryId: "1329343404",
          name: "x".repeat(500_001),
          owner: "Y4NN777",
          visibility: "private",
          webUrl: "https://github.com/Y4NN777/feedback",
          defaultBranch: "main",
          observedAt: "2026-08-28T16:00:00.000Z",
          releases: [],
        },
        updatedAt: "2026-08-28T16:00:00.000Z",
      }),
    ).rejects.toThrow("APPWRITE_SOURCE_MANAGEMENT_UNAVAILABLE");
  });

  it("reads the canonical Project slug only inside the exact scope", async () => {
    const getRow = vi.fn(() =>
      Promise.resolve({
        $id: "project_1",
        workspaceId: "workspace_1",
        slug: "wise-money",
      }),
    );
    const port = createAppwriteSourceProjectSlugPort(getRow, {
      databaseId: "feedback",
      projectsTableId: "projects",
    });
    await expect(
      port.current({ workspaceId: "workspace_1", projectId: "project_1" }),
    ).resolves.toBe("wise-money");
    expect(getRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "projects",
      rowId: "project_1",
    });
    getRow.mockResolvedValueOnce({
      $id: "project_1",
      workspaceId: "workspace_2",
      slug: "wise-money",
    });
    await expect(
      port.current({ workspaceId: "workspace_1", projectId: "project_1" }),
    ).rejects.toThrow("APPWRITE_SOURCE_MANAGEMENT_DENIED");
  });

  it("rejects invalid store and Project slug schemas", () => {
    const target = setup();
    for (const schema of [
      { databaseId: "bad id", sourceConnectionsTableId: "source_connections" },
      { databaseId: "same", sourceConnectionsTableId: "same" },
    ]) {
      expect(() =>
        createAppwriteSourceManagementStore(target, schema, {
          equal: () => "equal",
          limit: () => "limit",
        }),
      ).toThrow("APPWRITE_SOURCE_MANAGEMENT_SCHEMA_INVALID");
    }
    expect(() =>
      createAppwriteSourceProjectSlugPort(vi.fn(), {
        databaseId: "same",
        projectsTableId: "same",
      }),
    ).toThrow("APPWRITE_SOURCE_MANAGEMENT_SCHEMA_INVALID");
  });
});
