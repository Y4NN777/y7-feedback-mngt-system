import { describe, expect, it, vi } from "vitest";

import type { ActorAccess } from "@y7-feedback/domain";

import type { WorkbenchStore } from "./appwrite-workbench-store";
import { createWorkbenchCoordinator } from "./workbench";

const actor: ActorAccess = {
  principalId: "owner_1",
  responsibility: "workspace_owner",
  workspaceIds: ["workspace_1"],
  projectIds: [],
};

describe("Workbench coordinator", () => {
  it("BDD-WORK-007 verifies identity and authoritative scope before listing", async () => {
    const list = vi.fn<WorkbenchStore["list"]>().mockResolvedValue([]);
    const coordinator = createWorkbenchCoordinator(
      {
        verify: vi
          .fn()
          .mockResolvedValue({ status: "verified", principalId: "owner_1" }),
      },
      {
        resolve: vi.fn().mockResolvedValue({
          status: "authorized",
          actor,
          project: { id: "project_1", workspaceId: "workspace_1", active: true },
        }),
      },
      { list, read: vi.fn() },
    );

    await expect(
      coordinator.list({
        jwt: "jwt_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        filter: { types: [], states: [], assignment: "all" },
      }),
    ).resolves.toEqual({ status: "ok", result: [] });
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ actor }));
  });

  it("BDD-WORK-008 returns no data when verification is denied", async () => {
    const list = vi.fn<WorkbenchStore["list"]>();
    const coordinator = createWorkbenchCoordinator(
      { verify: vi.fn().mockResolvedValue({ status: "denied" }) },
      { resolve: vi.fn() },
      { list, read: vi.fn() },
    );

    await expect(
      coordinator.list({
        jwt: "forged",
        workspaceId: "workspace_1",
        projectId: "project_1",
        filter: { types: [], states: [], assignment: "all" },
      }),
    ).resolves.toEqual({ status: "denied" });
    expect(list).not.toHaveBeenCalled();
  });
});
