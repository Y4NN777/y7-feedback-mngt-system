import { describe, expect, it } from "vitest";

import {
  DomainPolicyError,
  assertOwnershipUnchanged,
  assertSameWorkspace,
  createAuthorizationPolicy,
  createSlugRegistry,
  type ActorAccess,
  type Project,
} from "./index";

const alpha: Project = {
  id: "project-alpha",
  workspaceId: "workspace-one",
  active: true,
};
const beta: Project = {
  id: "project-beta",
  workspaceId: "workspace-two",
  active: true,
};

const owner: ActorAccess = {
  principalId: "owner-one",
  responsibility: "workspace_owner",
  workspaceIds: ["workspace-one"],
  projectIds: [],
};
const maintainer: ActorAccess = {
  principalId: "maintainer-one",
  responsibility: "project_maintainer",
  workspaceIds: ["workspace-one"],
  projectIds: ["project-alpha"],
};

describe("authoritative ownership and authorization", () => {
  it("BDD-OWN-001 rejects cross-Workspace association", () => {
    expect(() => {
      assertSameWorkspace(alpha, { workspaceId: "workspace-two" });
    }).toThrow(new DomainPolicyError("SCOPE_DENIED"));
  });

  it("BDD-OWN-001 preserves accepted ownership on ordinary updates", () => {
    expect(() => {
      assertSameWorkspace(alpha, { workspaceId: "workspace-one" });
      assertOwnershipUnchanged(
        { workspaceId: "workspace-one", projectId: "project-alpha" },
        { workspaceId: "workspace-one", projectId: "project-alpha" },
      );
    }).not.toThrow();
    expect(() => {
      assertOwnershipUnchanged(
        { workspaceId: "workspace-one", projectId: "project-alpha" },
        { workspaceId: "workspace-two", projectId: "project-alpha" },
      );
    }).toThrow(new DomainPolicyError("OWNERSHIP_IMMUTABLE"));
    expect(() => {
      assertOwnershipUnchanged(
        { workspaceId: "workspace-one", projectId: "project-alpha" },
        { workspaceId: "workspace-one", projectId: "project-beta" },
      );
    }).toThrow(new DomainPolicyError("OWNERSHIP_IMMUTABLE"));
  });

  it("BDD-AUTH-001 applies fixed Owner/Maintainer scope", () => {
    const policy = createAuthorizationPolicy();

    expect(policy.can(owner, "feedback.read", alpha)).toBe(true);
    expect(policy.can(owner, "feedback.read", beta)).toBe(false);
    expect(policy.can(maintainer, "feedback.write", alpha)).toBe(true);
    expect(policy.can(maintainer, "project.manage", alpha)).toBe(false);
    expect(policy.can({ ...maintainer, projectIds: [] }, "feedback.read", alpha)).toBe(
      false,
    );
    expect(
      policy.can(
        {
          principalId: "operator",
          responsibility: "platform_operator",
          workspaceIds: [],
          projectIds: [],
        },
        "feedback.read",
        alpha,
      ),
    ).toBe(false);
    expect(
      policy.can(
        {
          principalId: "operator",
          responsibility: "platform_operator",
          workspaceIds: ["workspace-one"],
          projectIds: ["project-alpha"],
        },
        "feedback.read",
        alpha,
      ),
    ).toBe(false);
  });

  it("BDD-AUTH-002 removes all protected Project capabilities immediately", () => {
    const policy = createAuthorizationPolicy();
    const removed = { ...maintainer, projectIds: [] };

    for (const capability of [
      "feedback.read",
      "feedback.write",
      "feedback.search",
      "feedback.aggregate",
      "attachment.read",
      "notification.read",
      "realtime.subscribe",
    ] as const) {
      expect(policy.can(removed, capability, alpha)).toBe(false);
    }
  });
});

describe("permanent Project slug registry", () => {
  it("BDD-PROJ-001 prevents current and historical reassignment", () => {
    const registry = createSlugRegistry();
    registry.create(alpha, "alpha");
    registry.rename(alpha.id, "alpha-next");

    expect(() => {
      registry.create(beta, "alpha");
    }).toThrow(new DomainPolicyError("SLUG_RESERVED"));
    expect(() => {
      registry.create(beta, "alpha-next");
    }).toThrow(new DomainPolicyError("SLUG_RESERVED"));
  });

  it("BDD-PROJ-002 resolves current and historical slugs canonically", () => {
    const registry = createSlugRegistry();
    registry.create(alpha, "alpha");
    registry.rename(alpha.id, "alpha-two");
    registry.rename(alpha.id, "alpha-three");

    expect(registry.resolve("alpha-three")).toEqual({
      kind: "current",
      project: alpha,
      slug: "alpha-three",
    });
    expect(registry.resolve("alpha")).toEqual({
      kind: "redirect",
      project: alpha,
      canonicalSlug: "alpha-three",
    });
  });

  it("BDD-PROJ-003 returns one neutral unavailable outcome", () => {
    const registry = createSlugRegistry();
    registry.create({ ...alpha, active: false }, "inactive");

    expect(registry.resolveForIntake("unknown")).toEqual({ kind: "unavailable" });
    expect(registry.resolveForIntake("inactive")).toEqual({ kind: "unavailable" });
  });

  it("BDD-PROJ-001 reserves system routes and validates registry commands", () => {
    const registry = createSlugRegistry();

    expect(() => {
      registry.create(alpha, "Not Valid");
    }).toThrow(new DomainPolicyError("SLUG_INVALID"));
    expect(() => {
      registry.create(alpha, "manage");
    }).toThrow(new DomainPolicyError("SLUG_RESERVED"));
    expect(() => {
      registry.rename("missing", "available");
    }).toThrow(new DomainPolicyError("PROJECT_NOT_FOUND"));

    registry.create(alpha, "alpha");
    expect(() => {
      registry.create(alpha, "alpha-copy");
    }).toThrow(new DomainPolicyError("PROJECT_EXISTS"));
    registry.rename(alpha.id, "alpha-next");
    registry.rename(alpha.id, "alpha");

    expect(registry.resolveForIntake("alpha")).toEqual({
      kind: "current",
      project: alpha,
      slug: "alpha",
    });
    expect(registry.resolveForIntake("alpha-next")).toEqual({
      kind: "redirect",
      project: alpha,
      canonicalSlug: "alpha",
    });
  });
});
