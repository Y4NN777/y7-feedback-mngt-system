import { describe, expect, it, vi } from "vitest";
import type { TablesDB } from "node-appwrite";

import {
  createAppwriteWorkspaceOwnerScopeResolver,
  createNodeAppwriteWorkspaceOwnerScopeResolver,
  type AppwriteWorkspaceOwnerScopeTablesPort,
} from "./appwrite-workspace-owner-scope";

const schema = {
  databaseId: "feedback",
  workspaceMembershipsTableId: "workspace_memberships",
};
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(",")}`,
  limit: (limit: number) => `limit:${String(limit)}`,
};

function setup(rows: readonly unknown[]) {
  const listRows = vi.fn<AppwriteWorkspaceOwnerScopeTablesPort["listRows"]>(() =>
    Promise.resolve({ rows }),
  );
  return {
    listRows,
    resolver: createAppwriteWorkspaceOwnerScopeResolver({ listRows }, schema, queries),
  };
}

const owner = {
  $id: "membership_1",
  workspaceId: "workspace_1",
  userId: "user_1",
  role: "workspace_owner",
  status: "active",
};

describe("authoritative Workspace Owner scope", () => {
  it("BDD-ADMIN-001 derives active Owner scope without reading a Project", async () => {
    const target = setup([owner]);

    await expect(
      target.resolver.resolve({ principalId: "user_1", workspaceId: "workspace_1" }),
    ).resolves.toEqual({
      status: "authorized",
      principalId: "user_1",
      workspaceId: "workspace_1",
    });
    expect(target.listRows).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "workspace_memberships",
      queries: ["equal:userId:user_1", "equal:workspaceId:workspace_1", "limit:2"],
      total: false,
      ttl: 0,
    });
  });

  it("BDD-ADMIN-002 returns the same denial for absent, inactive and non-Owner membership", async () => {
    for (const rows of [
      [],
      [{ ...owner, status: "revoked" }],
      [{ ...owner, role: "project_maintainer" }],
    ]) {
      await expect(
        setup(rows).resolver.resolve({
          principalId: "user_1",
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({ status: "denied" });
    }
  });

  it("BDD-ADMIN-002 fails closed for invalid input before data access", async () => {
    const target = setup([owner]);
    for (const input of [
      { principalId: "user/1", workspaceId: "workspace_1" },
      { principalId: "user_1", workspaceId: "workspace/1" },
    ]) {
      await expect(target.resolver.resolve(input)).resolves.toEqual({
        status: "denied",
      });
    }
    expect(target.listRows).not.toHaveBeenCalled();
  });

  it("BDD-ADMIN-002 treats ambiguous or malformed authority as retryable", async () => {
    for (const rows of [
      [owner, { ...owner, $id: "membership_2" }],
      [{ ...owner, $id: "bad/id" }],
      [{ ...owner, userId: "user_2" }],
      [{ ...owner, workspaceId: "workspace_2" }],
      [{ ...owner, role: 1 }],
      [{ ...owner, status: 1 }],
      [null],
    ]) {
      await expect(
        setup(rows).resolver.resolve({
          principalId: "user_1",
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({ status: "retryable" });
    }
  });

  it("BDD-ADMIN-002 maps missing authority to denial and infrastructure failure to retryable", async () => {
    for (const [error, status] of [
      [{ code: 404 }, "denied"],
      [new Error("unavailable"), "retryable"],
    ] as const) {
      const target = setup([]);
      target.listRows.mockRejectedValueOnce(error);
      await expect(
        target.resolver.resolve({
          principalId: "user_1",
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({ status });
    }
  });

  it("rejects malformed or overlapping schema identifiers", () => {
    for (const candidate of [
      { ...schema, databaseId: "bad/id" },
      { ...schema, workspaceMembershipsTableId: "bad/id" },
      { databaseId: "same", workspaceMembershipsTableId: "same" },
    ]) {
      expect(() =>
        createAppwriteWorkspaceOwnerScopeResolver(
          { listRows: () => Promise.resolve({ rows: [] }) },
          candidate,
          queries,
        ),
      ).toThrow(new Error("APPWRITE_WORKSPACE_OWNER_SCOPE_SCHEMA_INVALID"));
    }
  });

  it("uses the Node Appwrite adapter and SDK queries", async () => {
    const listRows = vi.fn(() => Promise.resolve({ rows: [owner] }));
    const resolver = createNodeAppwriteWorkspaceOwnerScopeResolver(
      { listRows } as unknown as TablesDB,
      schema,
    );

    await expect(
      resolver.resolve({ principalId: "user_1", workspaceId: "workspace_1" }),
    ).resolves.toMatchObject({ status: "authorized" });
    expect(listRows).toHaveBeenCalledWith(
      expect.objectContaining({
        queries: [
          expect.stringContaining('"method":"equal"'),
          expect.stringContaining('"method":"equal"'),
          expect.stringContaining('"method":"limit"'),
        ],
      }),
    );
  });
});
