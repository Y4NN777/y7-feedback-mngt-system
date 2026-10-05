import { describe, expect, it, vi } from "vitest";

import type { ActorAccess } from "@y7-feedback/domain";

import {
  AppwriteNotificationFeedError,
  createAppwriteNotificationFeedStore,
  type AppwriteNotificationFeedTablesPort,
} from "./appwrite-notification-feed-store";

const schema = {
  databaseId: "feedback",
  feedbackTableId: "feedback_rows",
  notificationsTableId: "notifications",
};
const owner: ActorAccess = {
  principalId: "owner_1",
  responsibility: "workspace_owner",
  workspaceIds: ["workspace_1"],
  projectIds: [],
};
const maintainer: ActorAccess = {
  principalId: "maintainer_1",
  responsibility: "project_maintainer",
  workspaceIds: ["workspace_1"],
  projectIds: ["project_1"],
};
const scope = { workspaceId: "workspace_1", projectId: "project_1" };

function notification(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    $id: "notification_1",
    eventId: "event_1",
    feedbackId: "feedback_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    recipientKind: "workspace",
    recipientId: "owner_1",
    kind: "feedback_resolved",
    reference: "Y7-NOTIFY-12345678",
    locale: "fr",
    createdAt: "2026-08-28T20:00:00.000Z",
    readAt: null,
    ...overrides,
  };
}

function feedback(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    $id: "feedback_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    assignedMaintainerId: "maintainer_1",
    deletedAt: null,
    ...overrides,
  };
}

function setup() {
  const listRows = vi.fn<AppwriteNotificationFeedTablesPort["listRows"]>(() =>
    Promise.resolve({ rows: [] }),
  );
  const getRow = vi.fn<AppwriteNotificationFeedTablesPort["getRow"]>(() =>
    Promise.resolve({}),
  );
  const createTransaction = vi.fn(() => Promise.resolve({ $id: "transaction_1" }));
  const updateRow = vi.fn<AppwriteNotificationFeedTablesPort["updateRow"]>(() =>
    Promise.resolve({ $id: "notification_1" }),
  );
  const updateTransaction = vi.fn(() => Promise.resolve({}));
  const store = createAppwriteNotificationFeedStore(
    { listRows, getRow, createTransaction, updateRow, updateTransaction },
    schema,
    {
      equal: (attribute, values) => `${attribute}=${values.join(",")}`,
      limit: (value) => `limit=${String(value)}`,
    },
  );
  return {
    store,
    listRows,
    getRow,
    createTransaction,
    updateRow,
    updateTransaction,
  };
}

describe("Appwrite notification feed store", () => {
  it.each([
    { ...schema, databaseId: "bad id" },
    { ...schema, feedbackTableId: schema.notificationsTableId },
  ])("rejects an invalid schema", (invalid) => {
    expect(() =>
      createAppwriteNotificationFeedStore(
        {} as AppwriteNotificationFeedTablesPort,
        invalid,
        {} as never,
      ),
    ).toThrow("APPWRITE_NOTIFICATION_FEED_SCHEMA_INVALID");
  });

  it.each([
    { actor: { ...owner, principalId: "bad/id" }, ...scope },
    { actor: owner, workspaceId: "bad/id", projectId: "project_1" },
    { actor: owner, workspaceId: "workspace_1", projectId: "bad/id" },
    { actor: { ...owner, workspaceIds: [] }, ...scope },
    { actor: { ...maintainer, projectIds: [] }, ...scope },
    {
      actor: { ...owner, responsibility: "platform_owner" as const },
      ...scope,
    },
  ])("fails before persistence for invalid or inactive access", async (input) => {
    const target = setup();
    await expect(target.store.list(input)).rejects.toThrow("ERR-NOT-DENIED");
    expect(target.listRows).not.toHaveBeenCalled();
  });

  it("returns a stable empty feed without an unnecessary feedback query", async () => {
    const target = setup();
    await expect(target.store.list({ actor: owner, ...scope })).resolves.toEqual({
      items: [],
      unreadCount: 0,
    });
    expect(target.listRows).toHaveBeenCalledTimes(1);
  });

  it("BDD-NOT-FEED-001 returns only the principal-scoped authoritative feed", async () => {
    const target = setup();
    target.listRows
      .mockResolvedValueOnce({ rows: [notification()] })
      .mockResolvedValueOnce({ rows: [feedback()] });

    await expect(target.store.list({ actor: owner, ...scope })).resolves.toEqual({
      unreadCount: 1,
      items: [
        {
          id: "notification_1",
          eventId: "event_1",
          feedbackId: "feedback_1",
          kind: "feedback_resolved",
          reference: "Y7-NOTIFY-12345678",
          locale: "fr",
          createdAt: "2026-08-28T20:00:00.000Z",
          readAt: null,
        },
      ],
    });
    expect(target.listRows).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tableId: "notifications",
        queries: [
          "workspaceId=workspace_1",
          "projectId=project_1",
          "recipientId=owner_1",
          "limit=100",
        ],
      }),
    );
  });

  it("orders the authoritative feed newest first without a new Preview index", async () => {
    const target = setup();
    target.listRows
      .mockResolvedValueOnce({
        rows: [
          notification({
            $id: "notification_old",
            eventId: "event_old",
            createdAt: "2026-08-28T19:00:00.000Z",
          }),
          notification({ $id: "notification_new", eventId: "event_new" }),
        ],
      })
      .mockResolvedValueOnce({ rows: [feedback()] });

    const result = await target.store.list({ actor: owner, ...scope });
    expect(result.items.map((item) => item.id)).toEqual([
      "notification_new",
      "notification_old",
    ]);
  });

  it("normalizes Appwrite UTC offsets at the feed boundary", async () => {
    const target = setup();
    target.listRows
      .mockResolvedValueOnce({
        rows: [notification({ createdAt: "2026-08-28T20:00:00.000+00:00" })],
      })
      .mockResolvedValueOnce({ rows: [feedback()] });

    const result = await target.store.list({ actor: owner, ...scope });
    expect(result.items[0]?.createdAt).toBe("2026-08-28T20:00:00.000Z");
  });

  it("BDD-NOT-FEED-002 revokes a Maintainer feed immediately after assignment removal", async () => {
    const target = setup();
    target.listRows
      .mockResolvedValueOnce({
        rows: [notification({ recipientId: "maintainer_1" })],
      })
      .mockResolvedValueOnce({ rows: [feedback({ assignedMaintainerId: null })] });

    await expect(target.store.list({ actor: maintainer, ...scope })).rejects.toEqual(
      new AppwriteNotificationFeedError("ERR-NOT-DENIED"),
    );
  });

  it("counts only unread items and validates current Maintainer assignment", async () => {
    const target = setup();
    target.listRows
      .mockResolvedValueOnce({
        rows: [
          notification({
            recipientId: "maintainer_1",
            readAt: "2026-08-28T20:00:01.000Z",
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [feedback()] });
    await expect(
      target.store.list({ actor: maintainer, ...scope }),
    ).resolves.toMatchObject({ unreadCount: 0 });
  });

  it("BDD-NOT-FEED-003 marks one scoped notification read transactionally", async () => {
    const target = setup();
    target.getRow
      .mockResolvedValueOnce(notification())
      .mockResolvedValueOnce(feedback());

    await expect(
      target.store.markRead({
        actor: owner,
        ...scope,
        notificationId: "notification_1",
        readAt: "2026-08-28T20:00:02.000Z",
      }),
    ).resolves.toEqual({ status: "read" });
    expect(target.updateRow).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "notifications",
      rowId: "notification_1",
      data: { readAt: "2026-08-28T20:00:02.000Z" },
      transactionId: "transaction_1",
    });
    expect(target.updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction_1",
      commit: true,
    });
  });

  it("BDD-NOT-FEED-004 replays read idempotently without rewriting", async () => {
    const target = setup();
    target.getRow
      .mockResolvedValueOnce(notification({ readAt: "2026-08-28T20:00:01.000Z" }))
      .mockResolvedValueOnce(feedback());

    await expect(
      target.store.markRead({
        actor: owner,
        ...scope,
        notificationId: "notification_1",
        readAt: "2026-08-28T20:00:02.000Z",
      }),
    ).resolves.toEqual({ status: "already_read" });
    expect(target.updateRow).not.toHaveBeenCalled();
    expect(target.updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction_1",
      rollback: true,
    });
  });

  it.each([
    notification({ workspaceId: "workspace_2" }),
    notification({ recipientId: "other_owner" }),
    notification({ reference: "bad" }),
  ])("BDD-NOT-FEED-005 fails closed for malformed or foreign rows", async (row) => {
    const target = setup();
    target.listRows.mockResolvedValueOnce({ rows: [row] });
    await expect(target.store.list({ actor: owner, ...scope })).rejects.toThrow(
      "ERR-NOT-RETRYABLE",
    );
  });

  it.each([
    null,
    notification({ $id: 1 }),
    notification({ $id: "bad/id" }),
    notification({ eventId: "bad/id" }),
    notification({ feedbackId: 1 }),
    notification({ feedbackId: "bad/id" }),
    notification({ kind: "private_note" }),
    notification({ reference: 1 }),
    notification({ locale: "es" }),
    notification({ createdAt: "bad" }),
    notification({ readAt: "bad" }),
    notification({ readAt: "9999-99-99T20:00:00.000Z" }),
    notification({ readAt: "2026-08-28T20:00:00Z" }),
  ])("rejects a malformed notification projection", async (row) => {
    const target = setup();
    target.listRows.mockResolvedValueOnce({ rows: [row] });
    await expect(target.store.list({ actor: owner, ...scope })).rejects.toThrow(
      "ERR-NOT-RETRYABLE",
    );
  });

  it.each([
    undefined,
    feedback({ $id: "feedback_2" }),
    feedback({ workspaceId: "workspace_2" }),
    feedback({ projectId: "project_2" }),
    feedback({ deletedAt: "2026-08-28T20:00:03.000Z" }),
  ])("denies absent, foreign, or deleted feedback authority", async (row) => {
    const target = setup();
    target.listRows
      .mockResolvedValueOnce({ rows: [notification()] })
      .mockResolvedValueOnce({ rows: row === undefined ? [{}] : [row] });
    await expect(target.store.list({ actor: owner, ...scope })).rejects.toThrow(
      "ERR-NOT-DENIED",
    );
  });

  it("maps unexpected list persistence failure to retryable", async () => {
    const target = setup();
    target.listRows.mockRejectedValueOnce(new Error("private detail"));
    await expect(target.store.list({ actor: owner, ...scope })).rejects.toThrow(
      "ERR-NOT-RETRYABLE",
    );
  });

  it.each([
    { notificationId: "bad/id", readAt: "2026-08-28T20:00:02.000Z" },
    { notificationId: "notification_1", readAt: "bad" },
  ])("denies malformed read commands before opening a transaction", async (command) => {
    const target = setup();
    await expect(
      target.store.markRead({ actor: owner, ...scope, ...command }),
    ).rejects.toThrow("ERR-NOT-DENIED");
    expect(target.createTransaction).not.toHaveBeenCalled();
  });

  it("rejects an invalid transaction without attempting rollback", async () => {
    const target = setup();
    target.createTransaction.mockResolvedValueOnce({ $id: "bad/id" });
    await expect(
      target.store.markRead({
        actor: owner,
        ...scope,
        notificationId: "notification_1",
        readAt: "2026-08-28T20:00:02.000Z",
      }),
    ).rejects.toThrow("ERR-NOT-RETRYABLE");
    expect(target.updateTransaction).not.toHaveBeenCalled();
  });

  it.each([{}, { $id: "notification_2" }])(
    "rolls back an invalid notification update result",
    async (updated) => {
      const target = setup();
      target.getRow
        .mockResolvedValueOnce(notification())
        .mockResolvedValueOnce(feedback());
      target.updateRow.mockResolvedValueOnce(updated);
      await expect(
        target.store.markRead({
          actor: owner,
          ...scope,
          notificationId: "notification_1",
          readAt: "2026-08-28T20:00:02.000Z",
        }),
      ).rejects.toThrow("ERR-NOT-RETRYABLE");
      expect(target.updateTransaction).toHaveBeenLastCalledWith({
        transactionId: "transaction_1",
        rollback: true,
      });
    },
  );

  it("maps unexpected read persistence failure and preserves rollback failure", async () => {
    const target = setup();
    target.getRow.mockRejectedValueOnce(new Error("private detail"));
    target.updateTransaction.mockRejectedValueOnce(new Error("rollback unavailable"));
    await expect(
      target.store.markRead({
        actor: owner,
        ...scope,
        notificationId: "notification_1",
        readAt: "2026-08-28T20:00:02.000Z",
      }),
    ).rejects.toThrow("ERR-NOT-RETRYABLE");
  });

  it("BDD-NOT-FEED-006 rolls back a denied read mutation", async () => {
    const target = setup();
    target.getRow
      .mockResolvedValueOnce(notification({ recipientId: "other_owner" }))
      .mockResolvedValueOnce(feedback());
    await expect(
      target.store.markRead({
        actor: owner,
        ...scope,
        notificationId: "notification_1",
        readAt: "2026-08-28T20:00:02.000Z",
      }),
    ).rejects.toThrow("ERR-NOT-DENIED");
    expect(target.updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction_1",
      rollback: true,
    });
  });
});
