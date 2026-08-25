import { describe, expect, it, vi } from "vitest";

import {
  createAppwriteWorkspaceProjectOperationPorts,
  type AppwriteWorkspaceProjectTablesPort,
} from "./appwrite-workspace-project-ports";
import { WorkspaceOperationDeniedError } from "./workspace-project-operations";

const schema = {
  databaseId: "feedback",
  feedbackTableId: "feedback_rows",
  notificationsTableId: "notifications",
};
const scope = {
  principalId: "user-a",
  workspaceId: "workspace-a",
  projectId: "project-a",
};

function setup() {
  const createRow = vi.fn(() => Promise.resolve({ $id: "feedback-new" }));
  const listRows = vi.fn<AppwriteWorkspaceProjectTablesPort["listRows"]>(() =>
    Promise.resolve({ rows: [], total: 0 }),
  );
  const createTransaction = vi.fn(() => Promise.resolve({ $id: "transaction-a" }));
  const updateRow = vi.fn(() => Promise.resolve({ $id: "feedback-a" }));
  const deleteRow = vi.fn(() => Promise.resolve());
  const updateTransaction = vi.fn(() => Promise.resolve({}));
  const tables: AppwriteWorkspaceProjectTablesPort = {
    createRow,
    listRows,
    createTransaction,
    updateRow,
    deleteRow,
    updateTransaction,
  };
  const ports = createAppwriteWorkspaceProjectOperationPorts(
    tables,
    schema,
    {
      equal: (attribute, values) => `${attribute}=${values.join(",")}`,
      limit: (value) => `limit=${String(value)}`,
    },
    () => "feedback-new",
  );
  return {
    ports,
    createRow,
    listRows,
    createTransaction,
    updateRow,
    deleteRow,
    updateTransaction,
  };
}

describe("Appwrite Workspace Project operation ports", () => {
  it("BDD-OWN-FUNCTION-001 seals create and read to authoritative scope", async () => {
    const target = setup();
    await expect(
      target.ports.feedback.create(scope, {
        reporterId: "reporter-a",
        type: "bug",
      }),
    ).resolves.toEqual({ id: "feedback-new" });
    expect(target.createRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "feedback_rows",
      rowId: "feedback-new",
      data: {
        reporterId: "reporter-a",
        type: "bug",
        workspaceId: "workspace-a",
        projectId: "project-a",
      },
      permissions: [],
    });

    target.listRows.mockResolvedValueOnce({
      rows: [
        {
          $id: "feedback-a",
          workspaceId: "workspace-a",
          projectId: "project-a",
        },
      ],
      total: 1,
    });
    await expect(target.ports.feedback.read(scope, "feedback-a")).resolves.toEqual({
      id: "feedback-a",
    });
    expect(target.listRows).toHaveBeenLastCalledWith({
      databaseId: "feedback",
      tableId: "feedback_rows",
      queries: [
        "$id=feedback-a",
        "workspaceId=workspace-a",
        "projectId=project-a",
        "limit=2",
      ],
      total: false,
      ttl: 0,
    });
  });

  it("BDD-OWN-FUNCTION-002 returns one denial for missing, duplicate, and foreign rows", async () => {
    for (const rows of [
      [],
      [
        { $id: "feedback-a", workspaceId: "workspace-a", projectId: "project-a" },
        { $id: "feedback-a", workspaceId: "workspace-a", projectId: "project-a" },
      ],
      [{ $id: "feedback-a", workspaceId: "workspace-b", projectId: "project-b" }],
    ]) {
      const target = setup();
      target.listRows.mockResolvedValueOnce({ rows, total: rows.length });
      await expect(target.ports.feedback.read(scope, "feedback-a")).rejects.toEqual(
        new WorkspaceOperationDeniedError(),
      );
    }
  });

  it("BDD-OWN-FUNCTION-001 commits update and delete only after scoped transactional lookup", async () => {
    const update = setup();
    update.listRows.mockResolvedValueOnce({
      rows: [
        {
          $id: "feedback-a",
          workspaceId: "workspace-a",
          projectId: "project-a",
        },
      ],
      total: 1,
    });
    await expect(
      update.ports.feedback.update(scope, "feedback-a", {
        state: "under_review",
      }),
    ).resolves.toEqual({ id: "feedback-a" });
    expect(update.updateRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "feedback_rows",
      rowId: "feedback-a",
      data: { state: "under_review" },
      transactionId: "transaction-a",
    });
    expect(update.updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction-a",
      commit: true,
    });

    const remove = setup();
    remove.listRows.mockResolvedValueOnce({
      rows: [
        {
          $id: "feedback-a",
          workspaceId: "workspace-a",
          projectId: "project-a",
        },
      ],
      total: 1,
    });
    await remove.ports.feedback.delete(scope, "feedback-a");
    expect(remove.deleteRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "feedback_rows",
      rowId: "feedback-a",
      transactionId: "transaction-a",
    });
  });

  it("BDD-OWN-FUNCTION-001 scopes search, aggregate, notifications, and Realtime", async () => {
    const target = setup();
    target.listRows
      .mockResolvedValueOnce({
        rows: [
          {
            $id: "feedback-alpha",
            workspaceId: "workspace-a",
            projectId: "project-a",
          },
          {
            $id: "feedback-beta",
            workspaceId: "workspace-a",
            projectId: "project-a",
          },
        ],
        total: 2,
      })
      .mockResolvedValueOnce({ rows: [], total: 7 })
      .mockResolvedValueOnce({
        rows: [
          {
            $id: "feedback-alpha",
            workspaceId: "workspace-a",
            projectId: "project-a",
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ $id: "notification-a", feedbackId: "feedback-alpha" }],
        total: 1,
      });

    await expect(target.ports.feedback.search(scope, "alpha")).resolves.toEqual({
      ids: ["feedback-alpha"],
    });
    await expect(target.ports.feedback.aggregate(scope)).resolves.toEqual({
      count: 7,
    });
    await expect(target.ports.notifications.list(scope)).resolves.toEqual({
      ids: ["notification-a"],
    });
    await expect(target.ports.realtime.authorize(scope)).resolves.toEqual({
      channel: "workspace.workspace-a.project.project-a",
    });
  });

  it("BDD-OWN-FUNCTION-006 rolls back mutation failure and rejects client scope keys", async () => {
    const target = setup();
    await expect(
      target.ports.feedback.create(scope, { workspaceId: "workspace-b" }),
    ).rejects.toThrow("APPWRITE_WORKSPACE_OPERATION_INPUT_INVALID");
    expect(target.createRow).not.toHaveBeenCalled();

    target.listRows.mockResolvedValueOnce({
      rows: [
        {
          $id: "feedback-a",
          workspaceId: "workspace-a",
          projectId: "project-a",
        },
      ],
      total: 1,
    });
    target.updateRow.mockRejectedValueOnce(new Error("private detail"));
    await expect(
      target.ports.feedback.update(scope, "feedback-a", { state: "closed" }),
    ).rejects.toThrow("APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE");
    expect(target.updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction-a",
      rollback: true,
    });
  });

  it("BDD-OWN-FUNCTION-002 fails closed if a scoped query returns a foreign row", async () => {
    const target = setup();
    target.listRows.mockResolvedValueOnce({
      rows: [
        {
          $id: "feedback-foreign",
          workspaceId: "workspace-b",
          projectId: "project-b",
        },
      ],
      total: 1,
    });

    await expect(target.ports.feedback.search(scope, "foreign")).rejects.toThrow(
      "APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE",
    );
  });
});
