import { describe, expect, it, vi } from "vitest";

import {
  createAppwriteNotificationRecipientResolver,
  createNodeAppwriteNotificationRecipientResolver,
  type NotificationRecipientTablesPort,
} from "./appwrite-notification-recipient-resolver";
import { createSensitiveDataProtector } from "./sensitive-data-protector";

const schema = {
  databaseId: "feedback",
  notificationsTableId: "notifications",
  reportersTableId: "reporters",
  feedbackTableId: "feedback",
} as const;
const sensitive = {
  environment: "production" as const,
  protector: createSensitiveDataProtector("active", [
    { id: "active", material: Buffer.alloc(32, 17) },
  ]),
};

function sealedReporter(value: string) {
  return sensitive.protector.seal(
    {
      environment: "production",
      tableId: "reporters",
      rowId: "reporter_1",
      field: "attributionJson",
    },
    JSON.stringify({ kind: "contact", value, purpose: "reply" }),
  );
}

describe("Appwrite notification recipient authority", () => {
  it("BDD-MAIL-009 resolves an encrypted Reporter email without copying it to outbox", async () => {
    const getRow = vi
      .fn()
      .mockResolvedValueOnce({
        $id: "notification_1",
        feedbackId: "feedback_1",
        reporterId: "reporter_1",
      })
      .mockResolvedValueOnce({
        $id: "feedback_1",
        workspaceId: "workspace_1",
      })
      .mockResolvedValueOnce({
        $id: "reporter_1",
        workspaceId: "workspace_1",
        attributionJson: sealedReporter("reporter@example.com"),
      });
    const resolver = createAppwriteNotificationRecipientResolver(
      { getRow },
      { get: vi.fn() },
      schema,
      sensitive,
    );

    await expect(resolver.resolve("notification_1")).resolves.toBe(
      "reporter@example.com",
    );
  });

  it("BDD-MAIL-010 resolves a workspace recipient from Appwrite Auth", async () => {
    const get = vi.fn(() =>
      Promise.resolve({ $id: "owner_1", email: "owner@example.com" }),
    );
    const getRow = vi
      .fn<NotificationRecipientTablesPort["getRow"]>()
      .mockResolvedValueOnce({
        $id: "notification_2",
        feedbackId: "feedback_1",
        recipientKind: "workspace",
        recipientId: "owner_1",
      })
      .mockResolvedValueOnce({
        $id: "feedback_1",
        workspaceId: "workspace_1",
      });
    const resolver = createAppwriteNotificationRecipientResolver(
      {
        getRow,
      },
      { get },
      schema,
      sensitive,
    );

    await expect(resolver.resolve("notification_2")).resolves.toBe("owner@example.com");
    expect(get).toHaveBeenCalledWith({ userId: "owner_1" });
  });

  it("BDD-MAIL-011 returns no address for a non-email contact", async () => {
    const value = "not-an-email";
    const resolver = createAppwriteNotificationRecipientResolver(
      {
        getRow: vi
          .fn()
          .mockResolvedValueOnce({
            $id: "notification_3",
            feedbackId: "feedback_1",
            reporterId: "reporter_1",
          })
          .mockResolvedValueOnce({
            $id: "feedback_1",
            workspaceId: "workspace_1",
          })
          .mockResolvedValueOnce({
            $id: "reporter_1",
            workspaceId: "workspace_1",
            attributionJson: sealedReporter(value),
          }),
      },
      { get: vi.fn() },
      schema,
      sensitive,
    );
    await expect(resolver.resolve("notification_3")).resolves.toBeNull();
  });

  it("BDD-MAIL-012 fails closed for cross-workspace Reporter authority", async () => {
    const resolver = createAppwriteNotificationRecipientResolver(
      {
        getRow: vi
          .fn()
          .mockResolvedValueOnce({
            $id: "notification_4",
            feedbackId: "feedback_1",
            recipientKind: "reporter",
            recipientId: "reporter_1",
            workspaceId: "workspace_2",
          })
          .mockResolvedValueOnce({
            $id: "feedback_1",
            workspaceId: "workspace_1",
          })
          .mockResolvedValueOnce({}),
      },
      { get: vi.fn() },
      schema,
      sensitive,
    );
    await expect(resolver.resolve("notification_4")).rejects.toThrow(
      "NOTIFICATION_RECIPIENT_AUTHORITY_INVALID",
    );
  });

  it.each([
    { ...schema, databaseId: "bad/id" },
    { ...schema, notificationsTableId: "bad/id" },
    { ...schema, reportersTableId: "bad/id" },
    { ...schema, feedbackTableId: "bad/id" },
    { ...schema, feedbackTableId: schema.reportersTableId },
  ])("BDD-MAIL-018 rejects malformed or overlapping schema %#", (candidate) => {
    expect(() =>
      createAppwriteNotificationRecipientResolver(
        { getRow: vi.fn() },
        { get: vi.fn() },
        candidate,
        sensitive,
      ),
    ).toThrow("NOTIFICATION_RECIPIENT_SCHEMA_INVALID");
  });

  it.each([
    ["bad delivery", null, null],
    ["notification_5", null, null],
    ["notification_5", { $id: "wrong", feedbackId: "feedback_1" }, null],
    ["notification_5", { $id: "notification_5", feedbackId: "bad/id" }, null],
    [
      "notification_5",
      { $id: "notification_5", feedbackId: "feedback_1", reporterId: "reporter_1" },
      null,
    ],
    [
      "notification_5",
      { $id: "notification_5", feedbackId: "feedback_1", reporterId: "reporter_1" },
      { $id: "wrong", workspaceId: "workspace_1" },
    ],
    [
      "notification_5",
      { $id: "notification_5", feedbackId: "feedback_1", reporterId: "bad/id" },
      { $id: "feedback_1", workspaceId: "workspace_1" },
    ],
  ] as const)(
    "BDD-MAIL-019 rejects malformed notification authority %#",
    async (deliveryId, notification, feedback) => {
      const getRow = vi
        .fn<NotificationRecipientTablesPort["getRow"]>()
        .mockResolvedValueOnce(notification)
        .mockResolvedValueOnce(feedback);
      const resolver = createAppwriteNotificationRecipientResolver(
        { getRow },
        { get: vi.fn() },
        schema,
        sensitive,
      );
      await expect(resolver.resolve(deliveryId)).rejects.toThrow(
        "NOTIFICATION_RECIPIENT_AUTHORITY_INVALID",
      );
    },
  );

  it.each([
    null,
    { $id: "wrong", workspaceId: "workspace_1", attributionJson: "value" },
    { $id: "reporter_1", workspaceId: "workspace_2", attributionJson: "value" },
    { $id: "reporter_1", workspaceId: "workspace_1", attributionJson: 7 },
    { $id: "reporter_1", workspaceId: "workspace_1", attributionJson: "broken" },
  ])("BDD-MAIL-020 rejects malformed Reporter authority %#", async (reporter) => {
    const getRow = vi
      .fn<NotificationRecipientTablesPort["getRow"]>()
      .mockResolvedValueOnce({
        $id: "notification_6",
        feedbackId: "feedback_1",
        recipientKind: "reporter",
        recipientId: "reporter_1",
        workspaceId: "workspace_1",
      })
      .mockResolvedValueOnce({ $id: "feedback_1", workspaceId: "workspace_1" })
      .mockResolvedValueOnce(reporter);
    const resolver = createAppwriteNotificationRecipientResolver(
      { getRow },
      { get: vi.fn() },
      schema,
      sensitive,
    );
    await expect(resolver.resolve("notification_6")).rejects.toThrow(
      "NOTIFICATION_RECIPIENT_AUTHORITY_INVALID",
    );
  });

  it("BDD-MAIL-021 returns no email for a non-contact Reporter", async () => {
    const getRow = vi
      .fn<NotificationRecipientTablesPort["getRow"]>()
      .mockResolvedValueOnce({
        $id: "notification_7",
        feedbackId: "feedback_1",
        reporterId: "reporter_1",
      })
      .mockResolvedValueOnce({ $id: "feedback_1", workspaceId: "workspace_1" })
      .mockResolvedValueOnce({
        $id: "reporter_1",
        workspaceId: "workspace_1",
        attributionJson: sensitive.protector.seal(
          {
            environment: "production",
            tableId: "reporters",
            rowId: "reporter_1",
            field: "attributionJson",
          },
          JSON.stringify({ kind: "unidentified" }),
        ),
      });
    const resolver = createAppwriteNotificationRecipientResolver(
      { getRow },
      { get: vi.fn() },
      schema,
      sensitive,
    );
    await expect(resolver.resolve("notification_7")).resolves.toBeNull();
  });

  it.each([
    ["other", { $id: "owner_1", email: "owner@example.com" }],
    ["workspace", null],
    ["workspace", { $id: "wrong", email: "owner@example.com" }],
    ["workspace", { $id: "owner_1", email: 7 }],
  ] as const)(
    "BDD-MAIL-022 fails closed for workspace authority %#",
    async (recipientKind, user) => {
      const resolver = createAppwriteNotificationRecipientResolver(
        {
          getRow: vi
            .fn<NotificationRecipientTablesPort["getRow"]>()
            .mockResolvedValueOnce({
              $id: "notification_8",
              feedbackId: "feedback_1",
              recipientKind,
              recipientId: "owner_1",
            })
            .mockResolvedValueOnce({
              $id: "feedback_1",
              workspaceId: "workspace_1",
            }),
        },
        { get: vi.fn(() => Promise.resolve(user)) },
        schema,
        sensitive,
      );
      if (recipientKind === "other" || user === null || user.$id === "wrong") {
        await expect(resolver.resolve("notification_8")).rejects.toThrow(
          "NOTIFICATION_RECIPIENT_AUTHORITY_INVALID",
        );
      } else {
        await expect(resolver.resolve("notification_8")).resolves.toBeNull();
      }
    },
  );

  it("BDD-MAIL-023 composes the Node Appwrite adapter", async () => {
    const getRow = vi
      .fn()
      .mockResolvedValueOnce({
        $id: "notification_9",
        feedbackId: "feedback_1",
        recipientKind: "workspace",
        recipientId: "owner_1",
      })
      .mockResolvedValueOnce({ $id: "feedback_1", workspaceId: "workspace_1" });
    const get = vi.fn(() =>
      Promise.resolve({ $id: "owner_1", email: "owner@example.com" }),
    );
    const resolver = createNodeAppwriteNotificationRecipientResolver(
      { getRow } as never,
      { get } as never,
      schema,
      sensitive,
    );
    await expect(resolver.resolve("notification_9")).resolves.toBe("owner@example.com");
  });
});
