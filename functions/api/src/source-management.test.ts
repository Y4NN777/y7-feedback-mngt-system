/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects capability mocks without invoking detached methods. */
import { describe, expect, it, vi } from "vitest";

import type { SourceProviderAdapter } from "./source-provider";
import {
  createSourceManagementCoordinator,
  type SourceManagementDependencies,
  type SourceManagementConnection,
  type SourceManagementStore,
} from "./source-management";

const connection = {
  id: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  provider: "github" as const,
  state: "active" as const,
  selectedRepositories: [{ provider: "github" as const, id: "1329343404" }],
  importedRepositories: [],
  updatedAt: "2026-08-28T12:00:00.000Z",
};

function setup() {
  let current: SourceManagementConnection = connection;
  const store: SourceManagementStore = {
    list: vi.fn(() => Promise.resolve([current])),
    pending: vi.fn(() => Promise.resolve([])),
    active: vi.fn(() =>
      Promise.resolve({
        ...current,
        ownerUserId: "owner_1",
        encryptedGrantRef: "grant_1",
      }),
    ),
    saveImport: vi.fn((input: Parameters<SourceManagementStore["saveImport"]>[0]) => {
      current = {
        ...current,
        importedRepositories: [input.repository],
        updatedAt: input.updatedAt,
      };
      return Promise.resolve(current);
    }),
  };
  const github: SourceProviderAdapter = {
    provider: "github",
    authorizationUrl: vi.fn(() => "https://github.test"),
    completeAuthorization: vi.fn(() => Promise.reject(new Error("unused"))),
    revokeGrant: vi.fn(() => Promise.resolve()),
    importRepository: vi.fn(() =>
      Promise.resolve({
        provider: "github" as const,
        id: "1329343404",
        name: "y7-feedback-mngt-system",
        owner: "Y4NN777",
        visibility: "private" as const,
        webUrl: "https://github.com/Y4NN777/y7-feedback-mngt-system",
        defaultBranch: "main",
        releases: [],
      }),
    ),
  };
  const gitlab: SourceProviderAdapter = {
    ...github,
    provider: "gitlab",
    importRepository: vi.fn(() => Promise.reject(new Error("unused"))),
  };
  const projectSlug = vi.fn(() => Promise.resolve("wise-money"));
  const dependencies: SourceManagementDependencies = {
    principalVerifier: {
      verify: vi.fn((jwt: string) =>
        Promise.resolve(
          jwt === "valid.jwt.value"
            ? { status: "verified" as const, principalId: "owner_1" }
            : { status: "denied" as const },
        ),
      ),
    },
    scopeResolver: {
      resolve: vi.fn(() =>
        Promise.resolve({
          status: "authorized" as const,
          actor: {
            principalId: "owner_1",
            responsibility: "workspace_owner" as const,
            workspaceIds: ["workspace_1"],
            projectIds: [],
          },
          project: { id: "project_1", workspaceId: "workspace_1", active: true },
        }),
      ),
    },
    store,
    providers: [github, gitlab],
    projectSlug: { current: projectSlug },
    nowIso: () => "2026-08-28T16:00:00.000Z",
  };
  const coordinator = createSourceManagementCoordinator(dependencies);
  const scoped = {
    jwt: "valid.jwt.value",
    workspaceId: "workspace_1",
    projectId: "project_1",
  };
  return { coordinator, dependencies, github, projectSlug, scoped, store };
}

describe("source management coordinator", () => {
  it("BDD-SRC-204 lists scoped health and the authoritative current slug", async () => {
    const { coordinator, projectSlug, scoped } = setup();
    await expect(coordinator.list(scoped)).resolves.toEqual({
      status: "ok",
      projectSlug: "wise-money",
      connections: [connection],
      pendingSelections: [],
    });
    expect(projectSlug).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      projectId: "project_1",
    });
  });

  it("BDD-SRC-205 refreshes only a selected repository and preserves provenance", async () => {
    const { coordinator, github, scoped, store } = setup();
    await expect(
      coordinator.refresh({
        ...scoped,
        connectionId: "connection_1",
        repositoryId: "1329343404",
      }),
    ).resolves.toMatchObject({
      status: "ok",
      connection: {
        id: "connection_1",
        importedRepositories: [
          {
            connectionId: "connection_1",
            provider: "github",
            repositoryId: "1329343404",
            owner: "Y4NN777",
            observedAt: "2026-08-28T16:00:00.000Z",
          },
        ],
      },
    });
    expect(github.importRepository).toHaveBeenCalledWith({
      encryptedGrantRef: "grant_1",
      repositoryId: "1329343404",
    });
    expect(store.saveImport).toHaveBeenCalledOnce();
  });

  it("BDD-SRC-206 denies wrong scope, unselected repository and revoked connection", async () => {
    const { coordinator, scoped, store } = setup();
    await expect(
      coordinator.list({ ...scoped, jwt: "forged.jwt.value" }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      coordinator.refresh({
        ...scoped,
        connectionId: "connection_1",
        repositoryId: "unselected_1",
      }),
    ).resolves.toEqual({ status: "denied" });
    vi.mocked(store.active).mockResolvedValueOnce(null);
    await expect(
      coordinator.refresh({
        ...scoped,
        connectionId: "connection_1",
        repositoryId: "1329343404",
      }),
    ).resolves.toEqual({ status: "denied" });
  });

  it("BDD-SRC-207 leaves the previous import unchanged on provider failure", async () => {
    const { coordinator, github, scoped, store } = setup();
    vi.mocked(github.importRepository).mockRejectedValueOnce(new Error("revoked"));
    await expect(
      coordinator.refresh({
        ...scoped,
        connectionId: "connection_1",
        repositoryId: "1329343404",
      }),
    ).resolves.toEqual({ status: "retryable" });
    expect(store.saveImport).not.toHaveBeenCalled();
  });

  it("fails closed for invalid configuration, scope, slug and storage", async () => {
    const valid = setup();
    expect(() =>
      createSourceManagementCoordinator({
        ...valid.dependencies,
        providers: [valid.github, valid.github],
      }),
    ).toThrow("SOURCE_MANAGEMENT_CONFIG_INVALID");
    expect(() =>
      createSourceManagementCoordinator({
        ...valid.dependencies,
        providers: [valid.github],
      }),
    ).toThrow("SOURCE_MANAGEMENT_CONFIG_INVALID");

    await expect(
      valid.coordinator.list({ ...valid.scoped, workspaceId: "bad scope" }),
    ).resolves.toEqual({ status: "denied" });
    vi.mocked(valid.dependencies.scopeResolver.resolve).mockResolvedValueOnce({
      status: "retryable",
    });
    await expect(valid.coordinator.list(valid.scoped)).resolves.toEqual({
      status: "retryable",
    });
    vi.mocked(valid.dependencies.scopeResolver.resolve).mockResolvedValueOnce({
      status: "authorized",
      actor: {
        principalId: "owner_1",
        responsibility: "project_maintainer",
        workspaceIds: ["workspace_1"],
        projectIds: ["project_1"],
      },
      project: { id: "project_1", workspaceId: "workspace_1", active: true },
    });
    await expect(valid.coordinator.list(valid.scoped)).resolves.toEqual({
      status: "denied",
    });

    vi.mocked(valid.projectSlug).mockResolvedValueOnce("../wrong");
    await expect(valid.coordinator.list(valid.scoped)).resolves.toEqual({
      status: "retryable",
    });
    vi.mocked(valid.store.list).mockRejectedValueOnce(new Error("unavailable"));
    await expect(valid.coordinator.list(valid.scoped)).resolves.toEqual({
      status: "retryable",
    });
  });

  it("rejects malformed refresh coordinates and non-active state", async () => {
    const { coordinator, scoped, store } = setup();
    await expect(
      coordinator.refresh({
        ...scoped,
        jwt: "forged.jwt.value",
        connectionId: "connection_1",
        repositoryId: "1329343404",
      }),
    ).resolves.toEqual({ status: "denied" });
    for (const input of [
      { connectionId: "bad id", repositoryId: "1329343404" },
      { connectionId: "connection_1", repositoryId: "bad id" },
    ]) {
      await expect(coordinator.refresh({ ...scoped, ...input })).resolves.toEqual({
        status: "denied",
      });
    }
    vi.mocked(store.active).mockResolvedValueOnce({
      ...connection,
      state: "disconnected",
      ownerUserId: "owner_1",
      encryptedGrantRef: "grant_1",
    });
    await expect(
      coordinator.refresh({
        ...scoped,
        connectionId: "connection_1",
        repositoryId: "1329343404",
      }),
    ).resolves.toEqual({ status: "denied" });
    vi.mocked(store.active).mockResolvedValueOnce({
      ...connection,
      provider: "unknown" as "github",
      ownerUserId: "owner_1",
      encryptedGrantRef: "grant_1",
    });
    await expect(
      coordinator.refresh({
        ...scoped,
        connectionId: "connection_1",
        repositoryId: "1329343404",
      }),
    ).resolves.toEqual({ status: "retryable" });
  });
});
