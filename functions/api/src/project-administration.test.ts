import { describe, expect, it, vi } from "vitest";

import {
  AppwriteProjectAdministrationError,
  type AppwriteProjectAdministrationStore,
} from "./appwrite-project-administration-store";
import type { WorkspaceOwnerScopeResolver } from "./appwrite-workspace-owner-scope";
import { createProjectAdministration } from "./project-administration";
import type { AppwritePrincipalVerifier } from "./workspace-attachment-download";

const command = {
  kind: "create_project",
  operationId: "operation_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  slug: "wise-money",
  enabledTypes: ["bug", "suggestion", "review"],
  contextDeclarations: [],
  reporterPurpose: { fr: "But français", en: "English purpose" },
};

function setup() {
  const verify = vi.fn<AppwritePrincipalVerifier["verify"]>(() =>
    Promise.resolve({ status: "verified" as const, principalId: "owner_1" }),
  );
  const resolve = vi.fn<WorkspaceOwnerScopeResolver["resolve"]>(() =>
    Promise.resolve({
      status: "authorized" as const,
      principalId: "owner_1",
      workspaceId: "workspace_1",
    }),
  );
  const create = vi.fn<AppwriteProjectAdministrationStore["create"]>(() =>
    Promise.resolve({
      status: "created",
      projectId: "project_1",
      slug: "wise-money",
    }),
  );
  const mutate = vi.fn<AppwriteProjectAdministrationStore["mutate"]>();
  return {
    verify,
    resolve,
    create,
    mutate,
    administration: createProjectAdministration(
      { verify },
      { resolve },
      { create, mutate },
      {
        createAuditId: () => "audit_1",
        digest: () => "digest_1",
        now: () => "2026-08-28T09:00:00.000Z",
      },
    ),
  };
}

describe("trusted Project administration orchestration", () => {
  it("BDD-ADMIN-001 validates, authenticates, authorizes and commits in order", async () => {
    const target = setup();

    await expect(
      target.administration.execute({ jwt: "valid-jwt", command }),
    ).resolves.toEqual({
      status: "ok",
      result: { projectId: "project_1", slug: "wise-money" },
    });
    expect(target.verify).toHaveBeenCalledWith("valid-jwt");
    expect(target.resolve).toHaveBeenCalledWith({
      principalId: "owner_1",
      workspaceId: "workspace_1",
    });
    expect(target.create).toHaveBeenCalledWith({
      command,
      actorId: "owner_1",
      auditId: "audit_1",
      occurredAt: "2026-08-28T09:00:00.000Z",
      payloadDigest: "digest_1",
    });
  });

  it("BDD-ADMIN-004 rejects invalid input before JWT verification", async () => {
    const target = setup();
    for (const invalid of [
      {},
      {
        kind: "rename_project",
        operationId: "bad operation",
        workspaceId: "workspace_1",
        projectId: "project_1",
        slug: "new-slug",
      },
    ]) {
      await expect(
        target.administration.execute({ jwt: "valid-jwt", command: invalid }),
      ).resolves.toEqual({ status: "invalid" });
    }
    expect(target.verify).not.toHaveBeenCalled();
  });

  it("BDD-ADMIN-003..008 dispatches a validated mutation after Owner authorization", async () => {
    const target = setup();
    target.mutate.mockResolvedValueOnce({
      status: "applied",
      projectId: "project_1",
      action: "rename_project",
      slug: "new-slug",
    });
    const rename = {
      kind: "rename_project",
      operationId: "operation_2",
      workspaceId: "workspace_1",
      projectId: "project_1",
      slug: "new-slug",
    };
    await expect(
      target.administration.execute({ jwt: "valid-jwt", command: rename }),
    ).resolves.toEqual({
      status: "ok",
      result: {
        projectId: "project_1",
        action: "rename_project",
        slug: "new-slug",
      },
    });
    expect(target.mutate).toHaveBeenCalledWith({
      command: rename,
      actorId: "owner_1",
      auditId: "audit_1",
      occurredAt: "2026-08-28T09:00:00.000Z",
      payloadDigest: "digest_1",
    });
    expect(target.create).not.toHaveBeenCalled();
  });

  it("BDD-ADMIN-002 returns non-disclosing denial without resolving Project data", async () => {
    for (const verification of [
      { status: "denied" as const },
      { status: "retryable" as const },
    ]) {
      const target = setup();
      target.verify.mockResolvedValueOnce(verification);
      await expect(
        target.administration.execute({ jwt: "bad-jwt", command }),
      ).resolves.toEqual(verification);
      expect(target.resolve).not.toHaveBeenCalled();
      expect(target.create).not.toHaveBeenCalled();
    }

    for (const authorization of [
      { status: "denied" as const },
      { status: "retryable" as const },
    ]) {
      const target = setup();
      target.resolve.mockResolvedValueOnce(authorization);
      await expect(
        target.administration.execute({ jwt: "valid-jwt", command }),
      ).resolves.toEqual(authorization);
      expect(target.create).not.toHaveBeenCalled();
    }
  });

  it("maps persistence outcomes to stable non-sensitive API outcomes", async () => {
    for (const [code, expected] of [
      ["ERR-ADMIN-IDEMPOTENCY-CONFLICT", { status: "conflict" }],
      ["ERR-ADMIN-SLUG-RESERVED", { status: "slug_reserved" }],
      ["ERR-ADMIN-RETRYABLE", { status: "retryable" }],
      ["ERR-ADMIN-DENIED", { status: "denied" }],
      ["ERR-ADMIN-MUTATION-INVALID", { status: "invalid" }],
    ] as const) {
      const target = setup();
      target.create.mockRejectedValueOnce(new AppwriteProjectAdministrationError(code));
      await expect(
        target.administration.execute({ jwt: "valid-jwt", command }),
      ).resolves.toEqual(expected);
    }

    const target = setup();
    target.create.mockRejectedValueOnce(new Error("raw SDK detail"));
    await expect(
      target.administration.execute({ jwt: "valid-jwt", command }),
    ).resolves.toEqual({ status: "retryable" });
  });
});
