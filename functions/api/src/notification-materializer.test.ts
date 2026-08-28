import { describe, expect, it, vi } from "vitest";

import {
  createNotificationMaterializer,
  type NotificationMaterializationCommit,
  type NotificationMaterializationStore,
} from "./notification-materializer";

function setup(
  existing = false,
  ids: {
    readonly notification?: () => string;
    readonly delivery?: () => string;
  } = {},
) {
  const commits: NotificationMaterializationCommit[] = [];
  const commit = vi.fn((input: NotificationMaterializationCommit) => {
    commits.push(input);
    return Promise.resolve();
  });
  const store: NotificationMaterializationStore = {
    hasEventRecipient: vi.fn(() => Promise.resolve(existing)),
    commit,
  };
  let notification = 0;
  let delivery = 0;
  return {
    commits,
    commit,
    store,
    materializer: createNotificationMaterializer(store, {
      createNotificationId:
        ids.notification ?? (() => `notification_${String(++notification)}`),
      createDeliveryId: ids.delivery ?? (() => `delivery_${String(++delivery)}`),
      localeFor: (principalId) => (principalId === "reporter_1" ? "fr" : "en"),
    }),
  };
}

const command = {
  fact: {
    eventId: "event_1",
    kind: "lifecycle_changed",
    actorId: "maintainer_1",
    actorKind: "workspace",
    feedbackId: "feedback_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    occurredAt: "2026-08-28T12:00:00.000Z",
    visibility: "public",
  },
  participants: {
    reporterId: "reporter_1",
    ownerIds: ["owner_1"],
    assignedMaintainerId: "maintainer_1",
  },
  reference: "Y7-REF-12345678",
} as const;

describe("notification reconciliation", () => {
  it("BDD-NOT-006 atomically plans each recipient and its channel deliveries", async () => {
    const target = setup();
    await expect(target.materializer.reconcile(command)).resolves.toEqual({
      status: "materialized",
      count: 2,
    });
    expect(target.commits).toHaveLength(2);
    expect(target.commits[0]?.notification.eventId).toBe("event_1");
    expect(target.commits[0]?.notification.recipientId).toBe("reporter_1");
    expect(target.commits[0]?.notification.readAt).toBeNull();
    expect(target.commits[0]?.deliveries).toEqual([
      {
        id: "delivery_1",
        notificationId: "notification_1",
        channel: "email",
        status: "pending",
        createdAt: "2026-08-28T12:00:00.000Z",
        payload: {
          kind: "notification_event",
          event: "lifecycle_changed",
          locale: "fr",
          reference: "Y7-REF-12345678",
        },
      },
    ]);
    expect(target.commits[1]?.deliveries.map(({ channel }) => channel)).toEqual([
      "in_product",
      "email",
    ]);
  });

  it("BDD-NOT-007 makes reconciliation idempotent per event and recipient", async () => {
    const target = setup(true);
    await expect(target.materializer.reconcile(command)).resolves.toEqual({
      status: "materialized",
      count: 0,
    });
    expect(target.commit).not.toHaveBeenCalled();
  });

  it("BDD-NOT-008 preserves the source fact when materialization fails", async () => {
    const target = setup();
    target.commit.mockRejectedValueOnce(new Error("unavailable"));
    const immutableFact = structuredClone(command.fact);
    await expect(target.materializer.reconcile(command)).resolves.toEqual({
      status: "retryable",
    });
    expect(command.fact).toEqual(immutableFact);
  });

  it("BDD-NOT-009 emits no email delivery for an Internal Note", async () => {
    const target = setup();
    await target.materializer.reconcile({
      ...command,
      fact: {
        ...command.fact,
        kind: "internal_note",
        visibility: "workspace",
        actorId: "owner_1",
      },
    });
    expect(target.commits).toHaveLength(1);
    expect(target.commits[0]?.deliveries).toEqual([
      expect.objectContaining({ channel: "in_product" }),
    ]);
    expect(JSON.stringify(target.commits[0]?.deliveries)).not.toContain(
      "internal_note",
    );
  });

  it("BDD-NOT-010 fails closed for invalid reference, identifiers, and locale", async () => {
    const badReference = setup();
    await expect(
      badReference.materializer.reconcile({ ...command, reference: "bad" }),
    ).resolves.toEqual({ status: "retryable" });

    const badId = setup();
    await expect(
      badId.materializer.reconcile({
        ...command,
        fact: { ...command.fact, eventId: "invalid id" },
      }),
    ).resolves.toEqual({ status: "retryable" });

    const invalidVisibility = setup();
    await expect(
      invalidVisibility.materializer.reconcile({
        ...command,
        fact: { ...command.fact, visibility: "workspace" },
      }),
    ).resolves.toEqual({ status: "retryable" });

    const unsupportedEmailEvent = setup();
    await expect(
      unsupportedEmailEvent.materializer.reconcile({
        ...command,
        fact: { ...command.fact, kind: "feedback_received" },
      }),
    ).resolves.toEqual({ status: "retryable" });

    await expect(
      setup(false, { notification: () => "bad id" }).materializer.reconcile(command),
    ).resolves.toEqual({ status: "retryable" });
    await expect(
      setup(false, { delivery: () => "bad id" }).materializer.reconcile(command),
    ).resolves.toEqual({ status: "retryable" });
  });
});
