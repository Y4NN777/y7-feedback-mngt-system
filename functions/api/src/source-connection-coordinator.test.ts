import { describe, expect, it, vi } from "vitest";

import type { RepositoryIdentity } from "@y7-feedback/domain";

import {
  createSourceConnectionCoordinator,
  type PendingSourceConnection,
  type SourceConnectionStore,
} from "./source-connection-coordinator";
import type { SourceProviderAdapter } from "./source-provider";

const owner = {
  principalId: "owner_1",
  responsibility: "workspace_owner" as const,
  workspaceIds: ["workspace_1"],
  projectIds: [] as readonly string[],
};
const project = { id: "project_1", workspaceId: "workspace_1", active: true };

function fixtures() {
  let pending: PendingSourceConnection | undefined;
  let authorized:
    | (PendingSourceConnection & {
        readonly encryptedGrantRef: string;
        readonly authorizedRepositories: readonly RepositoryIdentity[];
      })
    | undefined;
  const store: SourceConnectionStore = {
    begin(value) {
      pending = value;
      return Promise.resolve();
    },
    claim(input) {
      if (
        !pending ||
        pending.id !== input.stateId ||
        pending.provider !== input.provider ||
        pending.nonceDigest !== input.nonceDigest ||
        pending.expiresAt < input.now
      ) {
        return Promise.resolve(null);
      }
      const claimed = pending;
      pending = undefined;
      return Promise.resolve(claimed);
    },
    authorize(input) {
      authorized = input;
      return Promise.resolve();
    },
    select(input) {
      if (!authorized || authorized.id !== input.connectionId) {
        return Promise.resolve(null);
      }
      const allowed = new Set(authorized.authorizedRepositories.map(({ id }) => id));
      if (input.repositoryIds.some((id) => !allowed.has(id))) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        id: input.connectionId,
        provider: authorized.provider,
        selectedRepositories: authorized.authorizedRepositories.filter(({ id }) =>
          input.repositoryIds.includes(id),
        ),
      });
    },
    active(input) {
      if (!authorized || authorized.id !== input.connectionId) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        id: authorized.id,
        workspaceId: authorized.workspaceId,
        projectId: authorized.projectId,
        ownerUserId: authorized.ownerUserId,
        provider: authorized.provider,
        encryptedGrantRef: authorized.encryptedGrantRef,
      });
    },
    disconnected: () => Promise.resolve(),
  };
  const githubAuthorizationUrl = vi.fn(
    ({ state }: { readonly state: string }) =>
      `https://github.test/oauth?state=${state}`,
  );
  const githubRevokeGrant = vi.fn(() => Promise.resolve());
  const github: SourceProviderAdapter = {
    provider: "github",
    authorizationUrl: githubAuthorizationUrl,
    completeAuthorization: vi.fn(() =>
      Promise.resolve({
        encryptedGrantRef: "grant_1",
        authorizedRepositories: [{ provider: "github" as const, id: "repository_1" }],
      }),
    ),
    revokeGrant: githubRevokeGrant,
  };
  const gitlab: SourceProviderAdapter = {
    ...github,
    provider: "gitlab",
    authorizationUrl: vi.fn(
      ({ state }: { readonly state: string }) =>
        `https://gitlab.test/oauth?state=${state}`,
    ),
  };
  const dependencies = {
    principalVerifier: {
      verify: vi.fn((jwt: string) =>
        Promise.resolve(
          jwt === "valid.jwt.value"
            ? { status: "verified" as const, principalId: owner.principalId }
            : { status: "denied" as const },
        ),
      ),
    },
    scopeResolver: {
      resolve: vi.fn(({ principalId }) =>
        Promise.resolve(
          principalId === owner.principalId
            ? { status: "authorized" as const, actor: owner, project }
            : { status: "denied" as const },
        ),
      ),
    },
    store,
    providers: [github, gitlab],
    createStateId: () => "state_1",
    createNonce: () => "nonce_1",
    digestNonce: (value: string) => `digest:${value}`,
    now: () => 1_000,
    nowIso: () => "2026-08-26T10:00:00.000Z",
    ttlMs: 300_000,
  };
  const coordinator = createSourceConnectionCoordinator(dependencies);
  return {
    coordinator,
    dependencies,
    github,
    githubAuthorizationUrl,
    githubRevokeGrant,
    gitlab,
    store,
  };
}

describe("deployed source connection coordination", () => {
  it("BDD-SRC-REAL-001 binds an Owner initiation to opaque state", async () => {
    const { coordinator, githubAuthorizationUrl } = fixtures();

    const result = await coordinator.begin({
      jwt: "valid.jwt.value",
      workspaceId: "workspace_1",
      projectId: "project_1",
      provider: "github",
      returnPath: "/settings/sources",
      redirectUri:
        "https://y7-feedback-api-preview.appwrite.network/providers/github/callback",
    });

    expect(result).toEqual({
      status: "ok",
      authorizationUrl: "https://github.test/oauth?state=state_1.nonce_1",
    });
    expect(githubAuthorizationUrl).toHaveBeenCalledWith({
      state: "state_1.nonce_1",
      redirectUri:
        "https://y7-feedback-api-preview.appwrite.network/providers/github/callback",
    });
  });

  it("BDD-SRC-REAL-001 denies missing authentication without creating state", async () => {
    const { coordinator, dependencies, store } = fixtures();
    const begin = vi.spyOn(store, "begin");

    await expect(
      coordinator.begin({
        jwt: "invalid",
        workspaceId: "workspace_1",
        projectId: "project_1",
        provider: "github",
        returnPath: "/settings/sources",
        redirectUri:
          "https://y7-feedback-api-preview.appwrite.network/providers/github/callback",
      }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      coordinator.begin({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        provider: "bitbucket" as "github",
        returnPath: "/settings/sources",
        redirectUri: "https://example.test/callback",
      }),
    ).resolves.toEqual({ status: "denied" });
    const invalidState = createSourceConnectionCoordinator({
      ...dependencies,
      createStateId: () => "bad/id",
    });
    await expect(
      invalidState.begin({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        provider: "github",
        returnPath: "/settings/sources",
        redirectUri: "https://example.test/callback",
      }),
    ).resolves.toEqual({ status: "retryable" });
    expect(begin).not.toHaveBeenCalled();
  });

  it("BDD-SRC-REAL-002 consumes callback state once and stores only grant reference and repository IDs", async () => {
    const { coordinator, store } = fixtures();
    const authorize = vi.spyOn(store, "authorize");
    await coordinator.begin({
      jwt: "valid.jwt.value",
      workspaceId: "workspace_1",
      projectId: "project_1",
      provider: "github",
      returnPath: "/settings/sources",
      redirectUri:
        "https://y7-feedback-api-preview.appwrite.network/providers/github/callback",
    });

    const command = {
      provider: "github" as const,
      state: "state_1.nonce_1",
      code: "one-use-code",
      redirectUri:
        "https://y7-feedback-api-preview.appwrite.network/providers/github/callback",
    };
    await expect(coordinator.complete(command)).resolves.toEqual({
      status: "pending_selection",
      connectionId: "state_1",
      authorizedRepositories: [{ provider: "github", id: "repository_1" }],
      returnPath: "/settings/sources",
    });
    await expect(coordinator.complete(command)).resolves.toEqual({ status: "denied" });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        encryptedGrantRef: "grant_1",
        authorizedRepositories: [{ provider: "github", id: "repository_1" }],
      }),
    );
  });

  it("BDD-SRC-REAL-003 activates only an authorized explicit subset", async () => {
    const { coordinator } = fixtures();
    await coordinator.begin({
      jwt: "valid.jwt.value",
      workspaceId: "workspace_1",
      projectId: "project_1",
      provider: "github",
      returnPath: "/settings/sources",
      redirectUri:
        "https://y7-feedback-api-preview.appwrite.network/providers/github/callback",
    });
    await coordinator.complete({
      provider: "github",
      state: "state_1.nonce_1",
      code: "one-use-code",
      redirectUri:
        "https://y7-feedback-api-preview.appwrite.network/providers/github/callback",
    });

    await expect(
      coordinator.select({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "state_1",
        repositoryIds: ["repository_1"],
      }),
    ).resolves.toEqual({
      status: "active",
      connection: {
        id: "state_1",
        provider: "github",
        selectedRepositories: [{ provider: "github", id: "repository_1" }],
      },
    });
  });

  it("BDD-SRC-REAL-004 revokes the matching real provider before disconnect", async () => {
    const { coordinator, githubRevokeGrant, store } = fixtures();
    const disconnected = vi.spyOn(store, "disconnected");
    await coordinator.begin({
      jwt: "valid.jwt.value",
      workspaceId: "workspace_1",
      projectId: "project_1",
      provider: "github",
      returnPath: "/settings/sources",
      redirectUri:
        "https://y7-feedback-api-preview.appwrite.network/providers/github/callback",
    });
    await coordinator.complete({
      provider: "github",
      state: "state_1.nonce_1",
      code: "one-use-code",
      redirectUri:
        "https://y7-feedback-api-preview.appwrite.network/providers/github/callback",
    });

    await expect(
      coordinator.disconnect({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "state_1",
      }),
    ).resolves.toEqual({ status: "disconnected" });
    expect(githubRevokeGrant).toHaveBeenCalledWith("grant_1");
    expect(disconnected).toHaveBeenCalledWith("state_1");
  });

  it("BDD-SRC-REAL-005 rejects invalid configuration and command shapes", async () => {
    const { dependencies } = fixtures();
    const firstProvider = dependencies.providers[0];
    if (!firstProvider) throw new Error("test fixture provider missing");
    expect(() =>
      createSourceConnectionCoordinator({
        ...dependencies,
        providers: [firstProvider, firstProvider],
      }),
    ).toThrow(new Error("SOURCE_CONNECTION_CONFIG_INVALID"));
    const coordinator = createSourceConnectionCoordinator(dependencies);
    await expect(
      coordinator.begin({
        jwt: "x".repeat(4_097),
        workspaceId: "workspace_1",
        projectId: "project_1",
        provider: "github",
        returnPath: "/settings/sources",
        redirectUri: "https://example.test/callback",
      }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      coordinator.complete({
        provider: "bitbucket" as "github",
        state: "state_1.nonce_1",
        code: "code",
        redirectUri: "https://example.test/callback",
      }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      coordinator.begin({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        provider: "github",
        returnPath: "//unsafe",
        redirectUri: "https://example.test/callback",
      }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      coordinator.select({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "state_1",
        repositoryIds: ["repository_1"],
      }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      coordinator.complete({
        provider: "github",
        state: "malformed",
        code: "code",
        redirectUri: "https://example.test/callback",
      }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      coordinator.disconnect({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "state_1",
      }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      coordinator.select({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "bad/id",
        repositoryIds: [],
      }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      coordinator.disconnect({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "bad/id",
      }),
    ).resolves.toEqual({ status: "denied" });
  });

  it("BDD-SRC-REAL-005 maps dependency denial and failure without disclosure", async () => {
    const { dependencies } = fixtures();
    const retryableScope = createSourceConnectionCoordinator({
      ...dependencies,
      scopeResolver: {
        resolve: () => Promise.resolve({ status: "retryable" as const }),
      },
    });
    await expect(
      retryableScope.begin({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        provider: "github",
        returnPath: "/settings/sources",
        redirectUri: "https://example.test/callback",
      }),
    ).resolves.toEqual({ status: "retryable" });
    const deniedScope = createSourceConnectionCoordinator({
      ...dependencies,
      scopeResolver: {
        resolve: () => Promise.resolve({ status: "denied" as const }),
      },
    });
    await expect(
      deniedScope.begin({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        provider: "github",
        returnPath: "/settings/sources",
        redirectUri: "https://example.test/callback",
      }),
    ).resolves.toEqual({ status: "denied" });
    await expect(
      retryableScope.select({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "state_1",
        repositoryIds: ["repository_1"],
      }),
    ).resolves.toEqual({ status: "retryable" });
    await expect(
      retryableScope.disconnect({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "state_1",
      }),
    ).resolves.toEqual({ status: "retryable" });
    const unknownProvider = createSourceConnectionCoordinator({
      ...dependencies,
      store: {
        ...dependencies.store,
        active: () =>
          Promise.resolve({
            id: "state_1",
            workspaceId: "workspace_1",
            projectId: "project_1",
            ownerUserId: "owner_1",
            provider: "bitbucket" as "github",
            encryptedGrantRef: "grant_1",
          }),
      },
    });
    await expect(
      unknownProvider.disconnect({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "state_1",
      }),
    ).resolves.toEqual({ status: "retryable" });
    const failing = createSourceConnectionCoordinator({
      ...dependencies,
      store: {
        ...dependencies.store,
        begin: () => Promise.reject(new Error("unavailable")),
        claim: () => Promise.reject(new Error("unavailable")),
        select: () => Promise.reject(new Error("unavailable")),
        active: () => Promise.reject(new Error("unavailable")),
      },
    });
    await expect(
      failing.begin({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        provider: "github",
        returnPath: "/settings/sources",
        redirectUri: "https://example.test/callback",
      }),
    ).resolves.toEqual({ status: "retryable" });
    await expect(
      failing.complete({
        provider: "github",
        state: "state_1.nonce_1",
        code: "code",
        redirectUri: "https://example.test/callback",
      }),
    ).resolves.toEqual({ status: "retryable" });
    await expect(
      failing.select({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "state_1",
        repositoryIds: ["repository_1"],
      }),
    ).resolves.toEqual({ status: "retryable" });
    await expect(
      failing.disconnect({
        jwt: "valid.jwt.value",
        workspaceId: "workspace_1",
        projectId: "project_1",
        connectionId: "state_1",
      }),
    ).resolves.toEqual({ status: "retryable" });
  });
});
