import { describe, expect, it, vi } from "vitest";

import { createHttpSourceManagementGateway } from "./SourceManagementGateway";

const managed = {
  status: "ok",
  projectSlug: "wise-money",
  connections: [
    {
      id: "connection_1",
      provider: "github",
      state: "active",
      selectedRepositories: [{ provider: "github", id: "repo_1" }],
      importedRepositories: [
        {
          connectionId: "connection_1",
          provider: "github",
          repositoryId: "repo_1",
          name: "feedback",
          owner: "Y4NN777",
          visibility: "private",
          webUrl: "https://github.com/Y4NN777/feedback",
          defaultBranch: "main",
          observedAt: "2026-08-28T16:00:00.000Z",
          releases: [],
        },
      ],
      updatedAt: "2026-08-28T16:00:00.000Z",
    },
  ],
  pendingSelections: [
    {
      id: "connection_2",
      provider: "gitlab",
      authorizedRepositories: [{ provider: "gitlab", id: "repo_2" }],
      updatedAt: "2026-08-28T16:00:00.000Z",
    },
  ],
};

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("source management HTTP gateway", () => {
  it("BDD-SRC-214 parses scoped health, imports and pending selections", async () => {
    const fetcher = vi.fn((...input: [string, RequestInit]) => {
      void input;
      return response(managed);
    });
    const gateway = createHttpSourceManagementGateway(
      "https://api.example.test/",
      () => Promise.resolve("jwt.value"),
      fetcher,
    );
    await expect(
      gateway.list({ workspaceId: "workspace_1", projectId: "project_1" }),
    ).resolves.toEqual({
      status: "ok",
      result: {
        projectSlug: managed.projectSlug,
        connections: managed.connections,
        pendingSelections: managed.pendingSelections,
      },
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/v1/workspaces/workspace_1/projects/project_1/source-connections/manage/list",
    );
    expect(fetcher.mock.calls[0]?.[1].method).toBe("POST");
    expect(fetcher.mock.calls[0]?.[1].headers).toMatchObject({
      authorization: "Bearer jwt.value",
    });
  });

  it("BDD-SRC-215 starts OAuth and executes selection, refresh and disconnect", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() =>
        response({ status: "ok", authorizationUrl: "https://github.com/login/oauth" }),
      )
      .mockImplementation(() => response({ status: "ok" }));
    const gateway = createHttpSourceManagementGateway(
      "https://api.example.test/",
      () => Promise.resolve("jwt.value"),
      fetcher,
    );
    await expect(
      gateway.begin({
        workspaceId: "workspace_1",
        projectId: "project_1",
        provider: "github",
      }),
    ).resolves.toEqual({
      status: "ok",
      result: { authorizationUrl: "https://github.com/login/oauth" },
    });
    await expect(
      gateway.select({
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "connection_1",
        repositoryIds: ["repo_1"],
      }),
    ).resolves.toEqual({ status: "ok", result: undefined });
    await expect(
      gateway.refresh({
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "connection_1",
        repositoryId: "repo_1",
      }),
    ).resolves.toEqual({ status: "ok", result: undefined });
    await expect(
      gateway.disconnect({
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "connection_1",
      }),
    ).resolves.toEqual({ status: "ok", result: undefined });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("fails closed for malformed, denied and unavailable responses", async () => {
    const connection = managed.connections[0];
    const imported = connection?.importedRepositories[0];
    if (!connection || !imported) throw new Error("FIXTURE_INVALID");
    for (const value of [
      null,
      { ...managed, status: "wrong" },
      { ...managed, projectSlug: 7 },
      { ...managed, connections: "wrong" },
      { ...managed, pendingSelections: "wrong" },
      { ...managed, connections: [null] },
      {
        ...managed,
        connections: [{ ...managed.connections[0], selectedRepositories: [] }],
      },
      {
        ...managed,
        connections: [{ ...connection, importedRepositories: [null] }],
      },
      {
        ...managed,
        connections: [
          { ...connection, importedRepositories: [{ ...imported, connectionId: 7 }] },
        ],
      },
      {
        ...managed,
        connections: [
          { ...connection, importedRepositories: [{ ...imported, provider: "wrong" }] },
        ],
      },
      {
        ...managed,
        connections: [
          {
            ...connection,
            importedRepositories: [{ ...imported, visibility: "wrong" }],
          },
        ],
      },
      {
        ...managed,
        connections: [
          { ...connection, importedRepositories: [{ ...imported, releases: null }] },
        ],
      },
      {
        ...managed,
        connections: [
          { ...connection, importedRepositories: [{ ...imported, releases: [null] }] },
        ],
      },
      {
        ...managed,
        connections: [
          {
            ...connection,
            importedRepositories: [
              {
                ...imported,
                releases: [
                  {
                    providerReleaseId: "release_1",
                    tag: 7,
                    name: "One",
                    publishedAt: "2026-08-28T15:00:00.000Z",
                    webUrl: "https://github.com/release/1",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        ...managed,
        connections: [
          { ...connection, importedRepositories: [{ ...imported, observedAt: "bad" }] },
        ],
      },
      { ...managed, pendingSelections: [null] },
      {
        ...managed,
        pendingSelections: [{ ...managed.pendingSelections[0], provider: "wrong" }],
      },
      {
        ...managed,
        pendingSelections: [
          { ...managed.pendingSelections[0], authorizedRepositories: [] },
        ],
      },
    ]) {
      const gateway = createHttpSourceManagementGateway(
        "https://api.example.test/",
        () => Promise.resolve("jwt.value"),
        () => response(value),
      );
      await expect(
        gateway.list({ workspaceId: "workspace_1", projectId: "project_1" }),
      ).resolves.toEqual({ status: "retryable" });
    }
    const denied = createHttpSourceManagementGateway(
      "https://api.example.test/",
      () => Promise.resolve("jwt.value"),
      () => response({ error: "ERR-SOURCE-DENIED" }, 404),
    );
    await expect(
      denied.list({ workspaceId: "workspace_1", projectId: "project_1" }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      denied.begin({
        workspaceId: "workspace_1",
        projectId: "project_1",
        provider: "gitlab",
      }),
    ).resolves.toEqual({ status: "denied" });

    const unavailable = createHttpSourceManagementGateway(
      "https://api.example.test/",
      () => Promise.reject(new Error("offline")),
      vi.fn(),
    );
    await expect(
      unavailable.list({ workspaceId: "w", projectId: "p" }),
    ).resolves.toEqual({ status: "retryable" });
    await expect(
      unavailable.begin({ workspaceId: "w", projectId: "p", provider: "github" }),
    ).resolves.toEqual({ status: "retryable" });
    await expect(
      unavailable.select({
        workspaceId: "w",
        projectId: "p",
        connectionId: "c",
        repositoryIds: ["r"],
      }),
    ).resolves.toEqual({ status: "retryable" });
    await expect(
      unavailable.refresh({
        workspaceId: "w",
        projectId: "p",
        connectionId: "c",
        repositoryId: "r",
      }),
    ).resolves.toEqual({ status: "retryable" });
    await expect(
      unavailable.disconnect({ workspaceId: "w", projectId: "p", connectionId: "c" }),
    ).resolves.toEqual({ status: "retryable" });
  });
});
