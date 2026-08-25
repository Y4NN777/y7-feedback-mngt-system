import { describe, expect, it, vi } from "vitest";
import type { TablesDB } from "node-appwrite";

import {
  createAppwriteWorkspaceAttachmentScopeResolver,
  createNodeAppwriteWorkspaceAttachmentScopeResolver,
  type AppwriteWorkspaceScopeQueryPort,
  type AppwriteWorkspaceScopeTablesPort,
} from "./appwrite-workspace-attachment-scope";

const schema = {
  databaseId: "feedback",
  projectsTableId: "projects",
  workspaceMembershipsTableId: "workspace_memberships",
  projectAssignmentsTableId: "project_assignments",
};
const input = {
  principalId: "user-a",
  workspaceId: "workspace-a",
  projectId: "project-a",
};

function membership(role: "workspace_owner" | "project_maintainer", status = "active") {
  return {
    $id: "membership-a",
    userId: "user-a",
    workspaceId: "workspace-a",
    role,
    status,
  };
}

function assignment(status = "active") {
  return {
    $id: "assignment-a",
    userId: "user-a",
    workspaceId: "workspace-a",
    projectId: "project-a",
    status,
  };
}

function setup(
  options: {
    readonly project?: unknown;
    readonly memberships?: readonly unknown[];
    readonly assignments?: readonly unknown[];
  } = {},
) {
  const getRow = vi.fn(() =>
    Promise.resolve(
      options.project === undefined
        ? {
            $id: "project-a",
            workspaceId: "workspace-a",
            active: true,
          }
        : options.project,
    ),
  );
  const listRows = vi.fn<AppwriteWorkspaceScopeTablesPort["listRows"]>((request) =>
    Promise.resolve({
      rows:
        request.tableId === "workspace_memberships"
          ? (options.memberships ?? [membership("workspace_owner")])
          : (options.assignments ?? [assignment()]),
    }),
  );
  const tables: AppwriteWorkspaceScopeTablesPort = { getRow, listRows };
  const queries: AppwriteWorkspaceScopeQueryPort = {
    equal: (attribute, values) => `${attribute}=${values.join(",")}`,
    limit: (limit) => `limit=${String(limit)}`,
  };
  return {
    resolver: createAppwriteWorkspaceAttachmentScopeResolver(tables, schema, queries),
    getRow,
    listRows,
  };
}

describe("Appwrite Workspace Attachment scope resolution", () => {
  it("BDD-AUTH-SCOPE-001 authorizes an active Workspace Owner without assignment", async () => {
    const target = setup({ assignments: [] });
    await expect(target.resolver.resolve(input)).resolves.toEqual({
      status: "authorized",
      authorization: {
        kind: "workspace_actor",
        authorizedWorkspaceId: "workspace-a",
        authorizedProjectId: "project-a",
        canReadAttachments: true,
      },
    });
    expect(target.listRows).toHaveBeenCalledTimes(1);
  });

  it("BDD-AUTH-SCOPE-002 authorizes only an actively assigned Maintainer", async () => {
    const target = setup({
      memberships: [membership("project_maintainer")],
      assignments: [assignment()],
    });
    await expect(target.resolver.resolve(input)).resolves.toMatchObject({
      status: "authorized",
    });
    expect(target.listRows).toHaveBeenCalledTimes(2);
  });

  it.each([
    { memberships: [] },
    { memberships: [membership("workspace_owner", "removed")] },
    { memberships: [membership("project_maintainer")], assignments: [] },
    {
      memberships: [membership("project_maintainer")],
      assignments: [assignment("removed")],
    },
  ])(
    "BDD-AUTH-SCOPE-003 denies unassigned, removed, and cross-scope rows %#",
    async (options) => {
      const target = setup(options);
      await expect(target.resolver.resolve(input)).resolves.toEqual({
        status: "denied",
      });
    },
  );

  it.each([
    { $id: "project-a", workspaceId: "workspace-b", active: true },
    { $id: "project-a", workspaceId: "workspace-a", active: false },
  ])("denies cross-Workspace and inactive Projects %#", async (project) => {
    await expect(setup({ project }).resolver.resolve(input)).resolves.toEqual({
      status: "denied",
    });
  });

  it("fails closed on duplicate or malformed authoritative rows", async () => {
    for (const target of [
      setup({
        memberships: [membership("workspace_owner"), membership("workspace_owner")],
      }),
      setup({ memberships: [{ ...membership("workspace_owner"), role: "admin" }] }),
      setup({
        memberships: [{ ...membership("workspace_owner"), workspaceId: "workspace-b" }],
      }),
      setup({
        memberships: [membership("project_maintainer")],
        assignments: [assignment(), assignment()],
      }),
      setup({
        memberships: [membership("project_maintainer")],
        assignments: [{ ...assignment(), projectId: "project-b" }],
      }),
    ]) {
      await expect(target.resolver.resolve(input)).resolves.toEqual({
        status: "retryable",
      });
    }
  });

  it.each([
    null,
    { $id: "project-b", workspaceId: "workspace-a", active: true },
    { $id: "project-a", workspaceId: "bad/id", active: true },
    { $id: "project-a", workspaceId: "workspace-a", active: "yes" },
  ])("fails closed on malformed Project metadata %#", async (project) => {
    await expect(setup({ project }).resolver.resolve(input)).resolves.toEqual({
      status: "retryable",
    });
  });

  it("maps absent Project to denial and infrastructure failure to retryable", async () => {
    const absent = setup();
    absent.getRow.mockRejectedValueOnce({ code: 404 });
    await expect(absent.resolver.resolve(input)).resolves.toEqual({
      status: "denied",
    });

    const failed = setup();
    failed.listRows.mockRejectedValueOnce(new Error("private database detail"));
    await expect(failed.resolver.resolve(input)).resolves.toEqual({
      status: "retryable",
    });
  });

  it("rejects malformed schema and request identifiers before Appwrite access", async () => {
    expect(() =>
      createAppwriteWorkspaceAttachmentScopeResolver(
        setup().listRows as unknown as AppwriteWorkspaceScopeTablesPort,
        { ...schema, databaseId: "bad/id" },
        { equal: () => "", limit: () => "" },
      ),
    ).toThrow("APPWRITE_WORKSPACE_SCOPE_SCHEMA_INVALID");
    expect(() =>
      createAppwriteWorkspaceAttachmentScopeResolver(
        setup().listRows as unknown as AppwriteWorkspaceScopeTablesPort,
        { ...schema, projectsTableId: schema.databaseId },
        { equal: () => "", limit: () => "" },
      ),
    ).toThrow("APPWRITE_WORKSPACE_SCOPE_SCHEMA_INVALID");

    const target = setup();
    await expect(
      target.resolver.resolve({ ...input, principalId: "bad/id" }),
    ).resolves.toEqual({ status: "denied" });
    expect(target.getRow).not.toHaveBeenCalled();
  });

  it("adapts the Node TablesDB capability without widening it", async () => {
    const target = setup();
    const resolver = createNodeAppwriteWorkspaceAttachmentScopeResolver(
      { getRow: target.getRow, listRows: target.listRows } as unknown as TablesDB,
      schema,
    );
    await expect(resolver.resolve(input)).resolves.toMatchObject({
      status: "authorized",
    });
    expect(target.getRow).toHaveBeenCalledOnce();
    expect(target.listRows).toHaveBeenCalledOnce();
  });
});
