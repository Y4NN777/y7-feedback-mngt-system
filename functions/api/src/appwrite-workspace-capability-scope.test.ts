import { describe, expect, it, vi } from "vitest";

import type { ProjectCapability } from "@y7-feedback/domain";

import {
  createAppwriteWorkspaceCapabilityScopeResolver,
  type AppwriteWorkspaceScopeQueryPort,
  type AppwriteWorkspaceScopeTablesPort,
} from "./appwrite-workspace-capability-scope";

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

function setup(role: "workspace_owner" | "project_maintainer") {
  const getRow = vi.fn(() =>
    Promise.resolve({
      $id: "project-a",
      workspaceId: "workspace-a",
      active: true,
    }),
  );
  const listRows = vi.fn<AppwriteWorkspaceScopeTablesPort["listRows"]>((request) =>
    Promise.resolve({
      rows:
        request.tableId === "workspace_memberships"
          ? [
              {
                $id: "membership-a",
                userId: "user-a",
                workspaceId: "workspace-a",
                role,
                status: "active",
              },
            ]
          : [
              {
                $id: "assignment-a",
                userId: "user-a",
                workspaceId: "workspace-a",
                projectId: "project-a",
                status: "active",
              },
            ],
    }),
  );
  const tables: AppwriteWorkspaceScopeTablesPort = { getRow, listRows };
  const queries: AppwriteWorkspaceScopeQueryPort = {
    equal: (attribute, values) => `${attribute}=${values.join(",")}`,
    limit: (limit) => `limit=${String(limit)}`,
  };
  return {
    resolver: createAppwriteWorkspaceCapabilityScopeResolver(tables, schema, queries),
    getRow,
    listRows,
  };
}

const maintainerCapabilities: readonly ProjectCapability[] = [
  "feedback.read",
  "feedback.write",
  "feedback.search",
  "feedback.aggregate",
  "attachment.read",
  "notification.read",
  "realtime.subscribe",
];

describe("authoritative Appwrite Workspace capability scope", () => {
  it("BDD-OWN-FUNCTION-001 authorizes an Owner only after authoritative scope derivation", async () => {
    const target = setup("workspace_owner");

    for (const capability of [...maintainerCapabilities, "project.manage"] as const) {
      await expect(
        target.resolver.resolve({ ...input, capability }),
      ).resolves.toMatchObject({
        status: "authorized",
        actor: {
          principalId: "user-a",
          responsibility: "workspace_owner",
          workspaceIds: ["workspace-a"],
        },
        project: {
          id: "project-a",
          workspaceId: "workspace-a",
          active: true,
        },
      });
    }
  });

  it("BDD-OWN-FUNCTION-003 applies the complete assigned Maintainer capability set", async () => {
    const target = setup("project_maintainer");

    for (const capability of maintainerCapabilities) {
      await expect(
        target.resolver.resolve({ ...input, capability }),
      ).resolves.toMatchObject({ status: "authorized" });
    }
    await expect(
      target.resolver.resolve({ ...input, capability: "project.manage" }),
    ).resolves.toEqual({ status: "denied" });
  });

  it("BDD-OWN-FUNCTION-002 denies cross-Workspace scope before capability data access", async () => {
    const target = setup("workspace_owner");
    target.getRow.mockResolvedValueOnce({
      $id: "project-a",
      workspaceId: "workspace-b",
      active: true,
    });

    await expect(
      target.resolver.resolve({
        ...input,
        capability: "feedback.read",
      }),
    ).resolves.toEqual({ status: "denied" });
    expect(target.listRows).not.toHaveBeenCalled();
  });
});
