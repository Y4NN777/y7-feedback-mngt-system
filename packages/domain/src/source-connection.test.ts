import { describe, expect, it, vi } from "vitest";

import {
  SourcePolicyError,
  createSourceConnectionRegistry,
  type ActorAccess,
  type Project,
} from "./index";

const project: Project = {
  id: "project-alpha",
  workspaceId: "workspace-one",
  active: true,
};
const owner: ActorAccess = {
  principalId: "owner-one",
  responsibility: "workspace_owner",
  workspaceIds: ["workspace-one"],
  projectIds: [],
};

function createRegistry(now: () => number = () => 1_000) {
  const revokeGrant = vi.fn();
  const registry = createSourceConnectionRegistry({
    digestNonce: (nonce) => `digest:${nonce}`,
    nextId: () => "callback-state-one",
    now,
    revokeGrant,
  });
  return { registry, revokeGrant };
}

describe("provider-neutral Source Connection policy", () => {
  it("BDD-SRC-001 permits only the Workspace Owner and a safe return path", () => {
    const { registry } = createRegistry();

    expect(
      registry.begin({
        actor: owner,
        project,
        provider: "github",
        nonce: "nonce-one",
        returnPath: "/manage/projects/project-alpha",
        ttlMs: 300_000,
      }),
    ).toEqual({ stateId: "callback-state-one", expiresAt: 301_000 });
    expect(() =>
      registry.begin({
        actor: { ...owner, responsibility: "project_maintainer" },
        project,
        provider: "github",
        nonce: "nonce-two",
        returnPath: "/manage",
        ttlMs: 300_000,
      }),
    ).toThrow(new SourcePolicyError("SOURCE_SCOPE_DENIED"));
    expect(() => {
      registry.begin({
        actor: { ...owner, responsibility: "platform_operator" },
        project,
        provider: "github",
        nonce: "nonce-operator",
        returnPath: "/manage",
        ttlMs: 300_000,
      });
    }).toThrow(new SourcePolicyError("SOURCE_SCOPE_DENIED"));
    expect(() => {
      registry.begin({
        actor: owner,
        project: { ...project, workspaceId: "workspace-two" },
        provider: "github",
        nonce: "nonce-cross-scope",
        returnPath: "/manage",
        ttlMs: 300_000,
      });
    }).toThrow(new SourcePolicyError("SOURCE_SCOPE_DENIED"));

    for (const [returnPath, ttlMs] of [
      ["https://evil.example/callback", 300_000],
      ["//evil.example/callback", 300_000],
      ["/manage\\evil", 300_000],
      ["/manage", 0],
    ] as const) {
      expect(() => {
        registry.begin({
          actor: owner,
          project,
          provider: "github",
          nonce: "nonce-invalid-return",
          returnPath,
          ttlMs,
        });
      }).toThrow(new SourcePolicyError("RETURN_PATH_INVALID"));
    }
  });

  it("BDD-SRC-002 binds completion and denies replay", () => {
    const { registry } = createRegistry();
    const challenge = registry.begin({
      actor: owner,
      project,
      provider: "github",
      nonce: "nonce-one",
      returnPath: "/manage",
      ttlMs: 300_000,
    });

    const connection = registry.complete({
      actor: owner,
      project,
      provider: "github",
      nonce: "nonce-one",
      stateId: challenge.stateId,
      encryptedGrantRef: "grant-reference-one",
      authorizedRepositories: [
        { provider: "github", id: "repo-one" },
        { provider: "github", id: "repo-two" },
      ],
      selectedRepositoryIds: ["repo-two"],
    });

    expect(connection).toMatchObject({
      state: "active",
      projectId: "project-alpha",
      workspaceId: "workspace-one",
      selectedRepositories: [{ provider: "github", id: "repo-two" }],
    });
    expect(() =>
      registry.complete({
        actor: owner,
        project,
        provider: "github",
        nonce: "nonce-one",
        stateId: challenge.stateId,
        encryptedGrantRef: "another-reference",
        authorizedRepositories: [],
        selectedRepositoryIds: [],
      }),
    ).toThrow(new SourcePolicyError("CALLBACK_INVALID"));
  });

  it("BDD-SRC-002 denies wrong, expired, or cross-scope callback bindings", () => {
    let currentTime = 1_000;
    const invalidCommands = [
      { actor: { ...owner, principalId: "other-owner" } },
      { provider: "gitlab" as const },
      { nonce: "wrong-nonce" },
      { project: { ...project, id: "project-other" } },
      { encryptedGrantRef: "" },
    ];

    for (const override of invalidCommands) {
      const { registry } = createRegistry(() => currentTime);
      const challenge = registry.begin({
        actor: owner,
        project,
        provider: "github",
        nonce: "nonce-one",
        returnPath: "/manage",
        ttlMs: 10,
      });
      expect(() => {
        registry.complete({
          actor: owner,
          project,
          provider: "github",
          nonce: "nonce-one",
          stateId: challenge.stateId,
          encryptedGrantRef: "grant-reference-one",
          authorizedRepositories: [],
          selectedRepositoryIds: [],
          ...override,
        });
      }).toThrow(new SourcePolicyError("CALLBACK_INVALID"));
    }

    const { registry } = createRegistry(() => currentTime);
    const expired = registry.begin({
      actor: owner,
      project,
      provider: "github",
      nonce: "nonce-one",
      returnPath: "/manage",
      ttlMs: 10,
    });
    currentTime = 1_011;
    expect(() => {
      registry.complete({
        actor: owner,
        project,
        provider: "github",
        nonce: "nonce-one",
        stateId: expired.stateId,
        encryptedGrantRef: "grant-reference-one",
        authorizedRepositories: [],
        selectedRepositoryIds: [],
      });
    }).toThrow(new SourcePolicyError("CALLBACK_INVALID"));
  });

  it("BDD-SRC-003 rejects unselected and unauthorized repositories", () => {
    const { registry } = createRegistry();
    const challenge = registry.begin({
      actor: owner,
      project,
      provider: "gitlab",
      nonce: "nonce-one",
      returnPath: "/manage",
      ttlMs: 300_000,
    });

    expect(() =>
      registry.complete({
        actor: owner,
        project,
        provider: "gitlab",
        nonce: "nonce-one",
        stateId: challenge.stateId,
        encryptedGrantRef: "grant-reference-one",
        authorizedRepositories: [{ provider: "gitlab", id: "repo-one" }],
        selectedRepositoryIds: ["repo-missing"],
      }),
    ).toThrow(new SourcePolicyError("REPOSITORY_NOT_AUTHORIZED"));

    const { registry: duplicateRegistry } = createRegistry();
    const duplicateChallenge = duplicateRegistry.begin({
      actor: owner,
      project,
      provider: "github",
      nonce: "nonce-two",
      returnPath: "/manage",
      ttlMs: 300_000,
    });
    expect(() => {
      duplicateRegistry.complete({
        actor: owner,
        project,
        provider: "github",
        nonce: "nonce-two",
        stateId: duplicateChallenge.stateId,
        encryptedGrantRef: "grant-reference-two",
        authorizedRepositories: [{ provider: "github", id: "repo-one" }],
        selectedRepositoryIds: ["repo-one", "repo-one"],
      });
    }).toThrow(new SourcePolicyError("REPOSITORY_NOT_AUTHORIZED"));

    const { registry: providerRegistry } = createRegistry();
    const providerChallenge = providerRegistry.begin({
      actor: owner,
      project,
      provider: "gitlab",
      nonce: "nonce-provider",
      returnPath: "/manage",
      ttlMs: 300_000,
    });
    expect(() => {
      providerRegistry.complete({
        actor: owner,
        project,
        provider: "gitlab",
        nonce: "nonce-provider",
        stateId: providerChallenge.stateId,
        encryptedGrantRef: "grant-reference-provider",
        authorizedRepositories: [{ provider: "github", id: "repo-one" }],
        selectedRepositoryIds: ["repo-one"],
      });
    }).toThrow(new SourcePolicyError("REPOSITORY_NOT_AUTHORIZED"));
  });

  it("BDD-SRC-004 stops use on suspension and revokes once on disconnect", () => {
    const { registry, revokeGrant } = createRegistry();
    const challenge = registry.begin({
      actor: owner,
      project,
      provider: "github",
      nonce: "nonce-one",
      returnPath: "/manage",
      ttlMs: 300_000,
    });
    const connection = registry.complete({
      actor: owner,
      project,
      provider: "github",
      nonce: "nonce-one",
      stateId: challenge.stateId,
      encryptedGrantRef: "grant-reference-one",
      authorizedRepositories: [{ provider: "github", id: "repo-one" }],
      selectedRepositoryIds: ["repo-one"],
    });

    expect(registry.canUse(connection.id, { provider: "github", id: "repo-one" })).toBe(
      true,
    );
    expect(registry.canUse(connection.id, { provider: "github", id: "repo-two" })).toBe(
      false,
    );
    expect(registry.canUse(connection.id, { provider: "gitlab", id: "repo-one" })).toBe(
      false,
    );
    expect(registry.canUse("missing", { provider: "github", id: "repo-one" })).toBe(
      false,
    );
    expect(() => {
      registry.reconnect(owner, project, connection.id);
    }).toThrow(new SourcePolicyError("CONNECTION_STATE_INVALID"));
    registry.suspend(owner, project, connection.id);
    expect(registry.canUse(connection.id, { provider: "github", id: "repo-one" })).toBe(
      false,
    );
    registry.reconnect(owner, project, connection.id);
    expect(registry.canUse(connection.id, { provider: "github", id: "repo-one" })).toBe(
      true,
    );
    registry.disconnect(owner, project, connection.id);
    registry.disconnect(owner, project, connection.id);
    expect(() => {
      registry.suspend(owner, project, connection.id);
    }).toThrow(new SourcePolicyError("CONNECTION_STATE_INVALID"));
    expect(registry.canUse(connection.id, { provider: "github", id: "repo-one" })).toBe(
      false,
    );
    expect(revokeGrant).toHaveBeenCalledOnce();
    expect(JSON.stringify(revokeGrant.mock.calls)).not.toContain("token");

    const broadOwner = { ...owner, workspaceIds: ["workspace-one", "workspace-two"] };
    expect(() => {
      registry.suspend(
        broadOwner,
        { ...project, workspaceId: "workspace-two" },
        connection.id,
      );
    }).toThrow(new SourcePolicyError("SOURCE_SCOPE_DENIED"));
    expect(() => {
      registry.suspend(owner, { ...project, id: "project-sibling" }, connection.id);
    }).toThrow(new SourcePolicyError("SOURCE_SCOPE_DENIED"));
    expect(() => {
      registry.suspend(owner, project, "missing");
    }).toThrow(new SourcePolicyError("SOURCE_SCOPE_DENIED"));
    expect(() => {
      registry.suspend(
        { ...owner, responsibility: "project_maintainer" },
        project,
        connection.id,
      );
    }).toThrow(new SourcePolicyError("SOURCE_SCOPE_DENIED"));
  });
});
