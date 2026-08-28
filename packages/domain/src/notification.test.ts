import { describe, expect, it } from "vitest";

import {
  NotificationPolicyError,
  planNotifications,
  type NotificationFact,
} from "./notification";

const fact: NotificationFact = {
  eventId: "event_1",
  feedbackId: "feedback_1",
  reference: "Y7-NOTIFY-12345678",
  kind: "clarification_requested",
  occurredAt: "2026-08-28T20:00:00.000Z",
  locale: "fr",
  audience: "both",
};

const recipients = {
  reporterId: "reporter_1",
  workspaceOwnerIds: ["owner_1"],
  assignedMaintainerIds: ["maintainer_1", "maintainer_2"],
  removedMaintainerIds: ["maintainer_2"],
  emailRecipientIds: ["reporter_1", "owner_1"],
} as const;

describe("notification recipient policy", () => {
  it("BDD-NOT-001 excludes the workspace actor and removed assignees", () => {
    expect(
      planNotifications({
        fact,
        actor: { kind: "workspace", id: "maintainer_1" },
        recipients,
      }),
    ).toEqual([
      expect.objectContaining({
        notificationKey: "event_1:reporter:reporter_1",
        recipient: { kind: "reporter", id: "reporter_1" },
        channels: ["in_product", "email"],
      }),
      expect.objectContaining({
        notificationKey: "event_1:workspace:owner_1",
        recipient: { kind: "workspace", id: "owner_1" },
        channels: ["in_product", "email"],
      }),
    ]);
  });

  it("BDD-NOT-002 excludes a Reporter from their own public event", () => {
    expect(
      planNotifications({
        fact: { ...fact, kind: "reporter_answered" },
        actor: { kind: "reporter", id: "reporter_1" },
        recipients,
      }).map((item) => item.recipient),
    ).toEqual([
      { kind: "workspace", id: "maintainer_1" },
      { kind: "workspace", id: "owner_1" },
    ]);
  });

  it("BDD-NOT-003 deduplicates Owners and assigned Maintainers deterministically", () => {
    const planned = planNotifications({
      fact: { ...fact, audience: "workspace" },
      actor: { kind: "system", id: "system_assignment" },
      recipients: {
        ...recipients,
        workspaceOwnerIds: ["owner_1", "owner_1"],
        assignedMaintainerIds: ["owner_1", "maintainer_1"],
        removedMaintainerIds: [],
      },
    });
    expect(planned.map((item) => item.notificationKey)).toEqual([
      "event_1:workspace:maintainer_1",
      "event_1:workspace:owner_1",
    ]);
  });

  it("BDD-NOT-004 keeps email opt-in capability separate from recipient selection", () => {
    const [planned] = planNotifications({
      fact: { ...fact, audience: "reporter" },
      actor: { kind: "workspace", id: "owner_1" },
      recipients: { ...recipients, emailRecipientIds: [] },
    });
    expect(planned?.channels).toEqual(["in_product"]);
  });

  it.each([
    { ...fact, eventId: "bad/id" },
    { ...fact, reference: "bad" },
    { ...fact, occurredAt: "tomorrow" },
    { ...fact, locale: "es" },
    { ...fact, audience: "everyone" },
  ])("BDD-NOT-005 rejects malformed facts before fanout", (invalid) => {
    expect(() =>
      planNotifications({
        fact: invalid,
        actor: { kind: "system", id: "system_1" },
        recipients,
      }),
    ).toThrow(NotificationPolicyError);
  });

  it("BDD-NOT-006 rejects malformed recipient authority", () => {
    expect(() =>
      planNotifications({
        fact,
        actor: { kind: "system", id: "system_1" },
        recipients: { ...recipients, assignedMaintainerIds: ["bad/id"] },
      }),
    ).toThrow("ERR-NOTIFICATION-INVALID");
  });
});
