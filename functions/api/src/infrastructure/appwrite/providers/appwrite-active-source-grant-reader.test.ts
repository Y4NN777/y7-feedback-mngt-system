import { describe, expect, it, vi } from "vitest";

import { createAppwriteActiveSourceGrantReader } from "./appwrite-active-source-grant-reader.js";

describe("Appwrite active source grant reader", () => {
  it("BDD-SYNC-065 returns only exact active grants from the bounded query", async () => {
    const listRows = vi.fn(() =>
      Promise.resolve({
        rows: [
          {
            $id: "connection_1",
            workspaceId: "workspace_1",
            projectId: "project_1",
            ownerUserId: "owner_1",
            provider: "github",
            status: "active",
            encryptedGrantRef: "grant_1",
            selectedRepositoriesJson: JSON.stringify({
              kind: "selected",
              repositories: [{ provider: "github", id: "repository_1" }],
            }),
          },
        ],
      }),
    );
    const updateRow = vi.fn(() => Promise.resolve({}));
    const reader = createAppwriteActiveSourceGrantReader(
      { listRows, updateRow },
      { databaseId: "database_1", sourceConnectionsTableId: "connections_1" },
    );

    await expect(reader.list(25)).resolves.toEqual([
      {
        id: "connection_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        ownerUserId: "owner_1",
        provider: "github",
        encryptedGrantRef: "grant_1",
        selectedRepositories: [{ provider: "github", id: "repository_1" }],
      },
    ]);
    expect(listRows).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseId: "database_1",
        tableId: "connections_1",
      }),
    );
    await reader.suspend("connection_1", "2026-09-02T01:00:00.000Z");
    expect(updateRow).toHaveBeenCalledWith({
      databaseId: "database_1",
      tableId: "connections_1",
      rowId: "connection_1",
      data: { status: "suspended", updatedAt: "2026-09-02T01:00:00.000Z" },
    });
  });

  it("BDD-SYNC-066 fails closed on malformed active authority", async () => {
    const valid = {
      $id: "connection_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      ownerUserId: "owner_1",
      provider: "github",
      status: "active",
      encryptedGrantRef: "grant_1",
      selectedRepositoriesJson: JSON.stringify({
        kind: "selected",
        repositories: [{ provider: "github", id: "repository_1" }],
      }),
    };
    const malformed = [
      null,
      { ...valid, status: "disconnected" },
      { ...valid, provider: "bitbucket" },
      { ...valid, $id: "../invalid" },
      { ...valid, workspaceId: "" },
      { ...valid, projectId: "" },
      { ...valid, ownerUserId: "" },
      { ...valid, encryptedGrantRef: "" },
      { ...valid, selectedRepositoriesJson: 42 },
      { ...valid, selectedRepositoriesJson: "{" },
      { ...valid, selectedRepositoriesJson: JSON.stringify([]) },
      { ...valid, selectedRepositoriesJson: JSON.stringify({ kind: "other" }) },
      {
        ...valid,
        selectedRepositoriesJson: JSON.stringify({
          kind: "selected",
          repositories: [],
        }),
      },
      {
        ...valid,
        selectedRepositoriesJson: JSON.stringify({
          kind: "selected",
          repositories: [null],
        }),
      },
      {
        ...valid,
        selectedRepositoriesJson: JSON.stringify({
          kind: "selected",
          repositories: [{ provider: "gitlab", id: "repository_1" }],
        }),
      },
      {
        ...valid,
        selectedRepositoriesJson: JSON.stringify({
          kind: "selected",
          repositories: [{ provider: "github", id: "../invalid" }],
        }),
      },
      {
        ...valid,
        selectedRepositoriesJson: JSON.stringify({
          kind: "selected",
          repositories: [
            { provider: "github", id: "repository_1" },
            { provider: "github", id: "repository_1" },
          ],
        }),
      },
    ];
    for (const row of malformed) {
      const reader = createAppwriteActiveSourceGrantReader(
        {
          listRows: vi.fn(() => Promise.resolve({ rows: [row] })),
          updateRow: vi.fn(),
        },
        { databaseId: "database_1", sourceConnectionsTableId: "connections_1" },
      );
      await expect(reader.list(25)).rejects.toThrow(
        "APPWRITE_ACTIVE_SOURCE_GRANT_INVALID",
      );
    }
  });

  it("BDD-SYNC-070 rejects invalid schema and batch limits", async () => {
    expect(() =>
      createAppwriteActiveSourceGrantReader(
        { listRows: vi.fn(), updateRow: vi.fn() },
        { databaseId: "", sourceConnectionsTableId: "connections_1" },
      ),
    ).toThrow("APPWRITE_ACTIVE_SOURCE_GRANT_CONFIG_INVALID");
    expect(() =>
      createAppwriteActiveSourceGrantReader(
        { listRows: vi.fn(), updateRow: vi.fn() },
        { databaseId: "database_1", sourceConnectionsTableId: "" },
      ),
    ).toThrow("APPWRITE_ACTIVE_SOURCE_GRANT_CONFIG_INVALID");
    const reader = createAppwriteActiveSourceGrantReader(
      { listRows: vi.fn(), updateRow: vi.fn() },
      { databaseId: "database_1", sourceConnectionsTableId: "connections_1" },
    );
    await expect(reader.list(0)).rejects.toThrow(
      "APPWRITE_ACTIVE_SOURCE_GRANT_CONFIG_INVALID",
    );
    await expect(reader.list(101)).rejects.toThrow(
      "APPWRITE_ACTIVE_SOURCE_GRANT_CONFIG_INVALID",
    );
    await expect(reader.suspend("../invalid", "invalid-date")).rejects.toThrow(
      "APPWRITE_ACTIVE_SOURCE_GRANT_INVALID",
    );
  });
});
