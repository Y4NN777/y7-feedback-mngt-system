import { describe, expect, it, vi } from "vitest";

import {
  createAppwriteWorkspaceProjectOperationPorts,
  createNodeAppwriteWorkspaceProjectOperationPorts,
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
            $id: "notification-a",
            feedbackId: "feedback-alpha",
            recipientId: "user-a",
            workspaceId: "workspace-a",
            projectId: "project-a",
            kind: "lifecycle_changed",
            createdAt: "2026-08-28T12:00:00.000Z",
          },
        ],
        total: 1,
      });

    await expect(target.ports.feedback.search(scope, "alpha")).resolves.toEqual({
      ids: ["feedback-alpha"],
    });
    await expect(target.ports.feedback.aggregate(scope)).resolves.toEqual({
      count: 7,
    });
    await expect(target.ports.notifications.list(scope)).resolves.toEqual({
      notifications: [
        {
          id: "notification-a",
          feedbackId: "feedback-alpha",
          kind: "lifecycle_changed",
          createdAt: "2026-08-28T12:00:00.000Z",
          readAt: null,
        },
      ],
    });
    await expect(target.ports.realtime.authorize(scope)).resolves.toEqual({
      channel: "databases.feedback.tables.notifications.rows",
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

  it("BDD-NOT-FEED-001 marks only the current principal scoped notification read", async () => {
    const target = setup();
    target.listRows
      .mockResolvedValueOnce({
        rows: [
          {
            $id: "notification-a",
            feedbackId: "feedback-a",
            recipientId: scope.principalId,
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
          },
        ],
        total: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            $id: "feedback-a",
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
          },
        ],
        total: 1,
      });
    await expect(
      target.ports.notifications.markRead(
        scope,
        "notification-a",
        "2026-08-28T12:30:00.000Z",
      ),
    ).resolves.toEqual({
      id: "notification-a",
      readAt: "2026-08-28T12:30:00.000Z",
    });
    expect(target.updateRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "notifications",
      rowId: "notification-a",
      data: { readAt: "2026-08-28T12:30:00.000Z" },
      transactionId: "transaction-a",
    });

    const denied = setup();
    denied.listRows.mockResolvedValueOnce({ rows: [], total: 0 });
    await expect(
      denied.ports.notifications.markRead(
        scope,
        "notification-a",
        "2026-08-28T12:30:00.000Z",
      ),
    ).rejects.toThrow(new WorkspaceOperationDeniedError());
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

  it("rejects invalid schemas, scopes, commands, and identifiers", async () => {
    const tables = setup();
    for (const invalidSchema of [
      { ...schema, databaseId: "bad id" },
      { ...schema, feedbackTableId: "bad id" },
      { ...schema, notificationsTableId: "bad id" },
      { ...schema, notificationsTableId: schema.feedbackTableId },
    ]) {
      expect(() =>
        createAppwriteWorkspaceProjectOperationPorts(
          {
            createRow: tables.createRow,
            listRows: tables.listRows,
            createTransaction: tables.createTransaction,
            updateRow: tables.updateRow,
            deleteRow: tables.deleteRow,
            updateTransaction: tables.updateTransaction,
          },
          invalidSchema,
          { equal: vi.fn(), limit: vi.fn() },
          () => "feedback-a",
        ),
      ).toThrow("APPWRITE_WORKSPACE_OPERATION_SCHEMA_INVALID");
    }

    for (const invalidScope of [
      { ...scope, principalId: "bad id" },
      { ...scope, workspaceId: "bad id" },
      { ...scope, projectId: "bad id" },
    ]) {
      await expect(setup().ports.feedback.aggregate(invalidScope)).rejects.toThrow(
        "APPWRITE_WORKSPACE_OPERATION_INPUT_INVALID",
      );
    }

    const target = setup();
    await expect(target.ports.feedback.create(scope, {})).rejects.toThrow(
      "APPWRITE_WORKSPACE_OPERATION_INPUT_INVALID",
    );
    await expect(
      target.ports.feedback.create(
        scope,
        Object.fromEntries(
          Array.from({ length: 33 }, (_, index) => [`key${String(index)}`, index]),
        ),
      ),
    ).rejects.toThrow("APPWRITE_WORKSPACE_OPERATION_INPUT_INVALID");
    await expect(
      target.ports.feedback.create(scope, { $private: true }),
    ).rejects.toThrow("APPWRITE_WORKSPACE_OPERATION_INPUT_INVALID");
    await expect(target.ports.feedback.read(scope, "bad id")).rejects.toThrow(
      "APPWRITE_WORKSPACE_OPERATION_INPUT_INVALID",
    );
    await expect(target.ports.feedback.search(scope, " ")).rejects.toThrow(
      "APPWRITE_WORKSPACE_OPERATION_INPUT_INVALID",
    );
    await expect(target.ports.feedback.search(scope, "x".repeat(101))).rejects.toThrow(
      "APPWRITE_WORKSPACE_OPERATION_INPUT_INVALID",
    );
    expect(() =>
      target.ports.realtime.authorize({ ...scope, projectId: "bad id" }),
    ).toThrow("APPWRITE_WORKSPACE_OPERATION_INPUT_INVALID");
  });

  it("fails closed for malformed create, transaction, aggregate, and notification results", async () => {
    const invalidId = setup();
    const invalidIdPorts = createAppwriteWorkspaceProjectOperationPorts(
      {
        createRow: invalidId.createRow,
        listRows: invalidId.listRows,
        createTransaction: invalidId.createTransaction,
        updateRow: invalidId.updateRow,
        deleteRow: invalidId.deleteRow,
        updateTransaction: invalidId.updateTransaction,
      },
      schema,
      {
        equal: (attribute, values) => `${attribute}=${values.join(",")}`,
        limit: (value) => `limit=${String(value)}`,
      },
      () => "bad id",
    );
    await expect(
      invalidIdPorts.feedback.create(scope, { type: "bug" }),
    ).rejects.toThrow("APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE");

    for (const row of [{}, { $id: "other-id" }, { $id: "bad id" }]) {
      const target = setup();
      target.createRow.mockResolvedValueOnce(row as never);
      await expect(
        target.ports.feedback.create(scope, { type: "bug" }),
      ).rejects.toThrow("APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE");
    }
    const rejectedCreate = setup();
    rejectedCreate.createRow.mockRejectedValueOnce(new Error("private"));
    await expect(
      rejectedCreate.ports.feedback.create(scope, { type: "bug" }),
    ).rejects.toThrow("APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE");

    const transaction = setup();
    transaction.createTransaction.mockResolvedValueOnce({ $id: "bad id" });
    await expect(
      transaction.ports.feedback.update(scope, "feedback-a", { state: "closed" }),
    ).rejects.toThrow("APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE");

    const rollback = setup();
    rollback.listRows.mockResolvedValueOnce({ rows: [], total: 0 });
    rollback.updateTransaction.mockRejectedValueOnce(new Error("rollback failed"));
    await expect(rollback.ports.feedback.delete(scope, "feedback-a")).rejects.toEqual(
      new WorkspaceOperationDeniedError(),
    );

    for (const total of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const target = setup();
      target.listRows.mockResolvedValueOnce({ rows: [], total });
      await expect(target.ports.feedback.aggregate(scope)).rejects.toThrow(
        "APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE",
      );
    }

    const empty = setup();
    await expect(empty.ports.notifications.list(scope)).resolves.toEqual({
      notifications: [],
    });

    const badFeedback = setup();
    badFeedback.listRows.mockResolvedValueOnce({ rows: [{}], total: 1 });
    await expect(badFeedback.ports.notifications.list(scope)).rejects.toThrow(
      "APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE",
    );

    const validNotification = {
      $id: "notification-a",
      feedbackId: "feedback-a",
      recipientId: scope.principalId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      kind: "conversation_message",
      createdAt: "2026-08-28T12:00:00.000Z",
    };
    for (const notification of [
      {},
      { ...validNotification, $id: "bad id" },
      { ...validNotification, feedbackId: 7 },
      { ...validNotification, feedbackId: "feedback-b", recipientId: "user-b" },
    ]) {
      const target = setup();
      target.listRows.mockResolvedValueOnce({ rows: [notification], total: 1 });
      await expect(target.ports.notifications.list(scope)).rejects.toThrow(
        "APPWRITE_WORKSPACE_OPERATION_UNAVAILABLE",
      );
    }
  });

  it("adapts the Node Appwrite TablesDB surface without leaking mutable arrays", async () => {
    const createRow = vi.fn(() => Promise.resolve({ $id: "feedback-new" }));
    const listRows = vi.fn(() =>
      Promise.resolve({
        rows: [
          {
            $id: "feedback-a",
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
          },
        ],
        total: 1,
      }),
    );
    const createTransaction = vi.fn(() => Promise.resolve({ $id: "transaction-a" }));
    const updateRow = vi.fn(() => Promise.resolve({ $id: "feedback-a" }));
    const deleteRow = vi.fn(() => Promise.resolve());
    const updateTransaction = vi.fn(() => Promise.resolve({}));
    const ports = createNodeAppwriteWorkspaceProjectOperationPorts(
      {
        createRow,
        listRows,
        createTransaction,
        updateRow,
        deleteRow,
        updateTransaction,
      } as never,
      schema,
      () => "feedback-new",
    );

    await ports.feedback.create(scope, { type: "bug" });
    await ports.feedback.read(scope, "feedback-a");
    await ports.feedback.update(scope, "feedback-a", { state: "closed" });
    await ports.feedback.delete(scope, "feedback-a");
    expect(createRow).toHaveBeenCalledOnce();
    expect(listRows).toHaveBeenCalledTimes(3);
    expect(createTransaction).toHaveBeenCalledTimes(2);
    expect(updateRow).toHaveBeenCalledOnce();
    expect(deleteRow).toHaveBeenCalledOnce();
    expect(updateTransaction).toHaveBeenCalledTimes(2);
  });
});
