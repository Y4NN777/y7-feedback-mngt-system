import { describe, expect, it, vi } from "vitest";

import {
  createAppwriteNotificationRecipientResolver,
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
            reporterId: "reporter_1",
          })
          .mockResolvedValueOnce({
            $id: "feedback_1",
            workspaceId: "workspace_1",
          })
          .mockResolvedValueOnce({
            $id: "reporter_1",
            workspaceId: "workspace_2",
            attributionJson: sealedReporter("reporter@example.com"),
          }),
      },
      { get: vi.fn() },
      schema,
      sensitive,
    );
    await expect(resolver.resolve("notification_4")).rejects.toThrow(
      "NOTIFICATION_RECIPIENT_AUTHORITY_INVALID",
    );
  });
});
