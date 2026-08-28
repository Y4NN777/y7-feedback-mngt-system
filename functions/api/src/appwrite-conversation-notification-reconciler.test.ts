import { describe, expect, it, vi } from "vitest";

import {
  createAppwriteConversationNotificationReconciler,
  type ConversationNotificationTablesPort,
} from "./appwrite-conversation-notification-reconciler";
import type { NotificationMaterializationStore } from "./notification-materializer";

const schema = {
  databaseId: "feedback",
  feedbackTableId: "feedback_items",
  workspaceMembershipsTableId: "workspace_memberships",
  accessGrantsTableId: "access_grants",
};

function setup() {
  const commit = vi.fn<NotificationMaterializationStore["commit"]>(() =>
    Promise.resolve(),
  );
  const listRows = vi
    .fn<ConversationNotificationTablesPort["listRows"]>()
    .mockResolvedValueOnce({
      rows: [
        {
          $id: "membership_1",
          workspaceId: "workspace_1",
          userId: "owner_1",
          role: "workspace_owner",
          status: "active",
        },
      ],
    })
    .mockResolvedValueOnce({
      rows: [
        {
          $id: "grant_1",
          feedbackId: "feedback_1",
          reference: "Y7-REF-12345678",
        },
      ],
    });
  const tables: ConversationNotificationTablesPort = {
    getRow: vi.fn(() =>
      Promise.resolve({
        $id: "feedback_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        reporterId: "reporter_1",
        assignedMaintainerId: "maintainer_1",
      }),
    ),
    listRows,
  };
  let notificationId = 0;
  let deliveryId = 0;
  return {
    commit,
    reconciler: createAppwriteConversationNotificationReconciler(
      tables,
      schema,
      {
        hasEventRecipient: () => Promise.resolve(false),
        commit,
      },
      {
        createNotificationId: () => `notification_${String(++notificationId)}`,
        createDeliveryId: () => `delivery_${String(++deliveryId)}`,
        localeFor: () => "fr",
      },
      {
        equal: (attribute, values) => `equal:${attribute}:${values.join(",")}`,
        limit: (value) => `limit:${String(value)}`,
      },
    ),
    listRows,
    tables,
  };
}

describe("Appwrite conversation notification reconciliation", () => {
  it("BDD-NOT-RECON-001 derives current scope, owners, assignment and reference", async () => {
    const target = setup();
    await expect(
      target.reconciler.reconcile({
        feedbackId: "feedback_1",
        actorId: "maintainer_1",
        actorKind: "workspace",
        command: {
          kind: "resolve",
          eventId: "event_1",
          expectedVersion: 2,
          actorId: "maintainer_1",
          actorKind: "workspace",
          occurredAt: "2026-08-28T12:00:00.000Z",
          reason: "Resolved",
        },
      }),
    ).resolves.toEqual({ status: "materialized", count: 2 });
    expect(target.commit).toHaveBeenCalledTimes(2);
    expect(
      target.commit.mock.calls.map(([value]) => value.notification.recipientId),
    ).toEqual(["reporter_1", "owner_1"]);
  });

  it("BDD-NOT-RECON-002 keeps workspace-only conversation content out of payloads", async () => {
    const target = setup();
    await target.reconciler.reconcile({
      feedbackId: "feedback_1",
      actorId: "owner_1",
      actorKind: "workspace",
      command: {
        kind: "append_internal_note",
        eventId: "event_2",
        actorId: "owner_1",
        actorKind: "workspace",
        occurredAt: "2026-08-28T12:01:00.000Z",
        content: "private sentinel",
      },
    });
    expect(JSON.stringify(target.commit.mock.calls)).not.toContain("private sentinel");
    expect(target.commit.mock.calls[0]?.[0].deliveries).toEqual([
      expect.objectContaining({ channel: "in_product" }),
    ]);
  });

  it("BDD-NOT-RECON-003 fails closed for missing owner or ambiguous grant", async () => {
    const target = setup();
    target.listRows.mockReset();
    target.listRows
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      target.reconciler.reconcile({
        feedbackId: "feedback_1",
        actorId: "maintainer_1",
        actorKind: "workspace",
        command: {
          kind: "append_message",
          eventId: "event_3",
          actorId: "maintainer_1",
          actorKind: "workspace",
          audience: "reporter",
          occurredAt: "2026-08-28T12:02:00.000Z",
          content: "public message",
        },
      }),
    ).rejects.toThrow("APPWRITE_NOTIFICATION_CONTEXT_INVALID");
  });
});
