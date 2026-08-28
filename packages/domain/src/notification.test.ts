import { describe, expect, it } from "vitest";

import {
  NotificationPolicyError,
  planNotificationRecipients,
  type NotificationSourceFact,
} from "./notification";

const publicFact: NotificationSourceFact = {
  eventId: "event-notification-1",
  kind: "lifecycle_changed",
  actorId: "maintainer-one",
  actorKind: "workspace",
  feedbackId: "feedback-one",
  workspaceId: "workspace-one",
  projectId: "project-one",
  occurredAt: "2026-08-28T12:00:00.000Z",
  visibility: "public",
};

const participants = {
  reporterId: "reporter-one",
  ownerId: "owner-one",
  assignedMaintainerId: "maintainer-one",
} as const;

describe("Day 3 notification recipient policy", () => {
  it("BDD-NOT-001 notifies Reporter and Owner while excluding the acting Maintainer", () => {
    expect(planNotificationRecipients(publicFact, participants)).toEqual([
      {
        principalId: "reporter-one",
        kind: "reporter",
        channels: ["email"],
      },
      {
        principalId: "owner-one",
        kind: "workspace_owner",
        channels: ["in_product", "email"],
      },
    ]);
  });

  it("BDD-NOT-002 derives recipients from the current assignment and removes prior access", () => {
    const unassigned = planNotificationRecipients(
      { ...publicFact, actorId: "reporter-one", actorKind: "reporter" },
      { reporterId: "reporter-one", ownerId: "owner-one" },
    );

    expect(unassigned.map(({ principalId }) => principalId)).toEqual(["owner-one"]);
    expect(JSON.stringify(unassigned)).not.toContain("maintainer-one");
  });

  it("BDD-NOT-003 keeps Internal Notes workspace-only and excludes their actor", () => {
    expect(
      planNotificationRecipients(
        {
          ...publicFact,
          kind: "internal_note",
          visibility: "workspace",
          actorId: "owner-one",
        },
        participants,
      ),
    ).toEqual([
      {
        principalId: "maintainer-one",
        kind: "assigned_maintainer",
        channels: ["in_product"],
      },
    ]);
  });

  it("BDD-NOT-004 deduplicates Owner and assigned Maintainer identities", () => {
    const recipients = planNotificationRecipients(publicFact, {
      ...participants,
      ownerId: "maintainer-one",
    });
    expect(recipients).toEqual([
      {
        principalId: "reporter-one",
        kind: "reporter",
        channels: ["email"],
      },
    ]);
  });

  it("BDD-NOT-005 fails closed for mismatched visibility and malformed facts", () => {
    expect(() =>
      planNotificationRecipients(
        { ...publicFact, kind: "internal_note", visibility: "public" },
        participants,
      ),
    ).toThrow(new NotificationPolicyError("ERR-NOTIFICATION-VISIBILITY-INVALID"));
    expect(() =>
      planNotificationRecipients(
        { ...publicFact, occurredAt: "not-an-instant" },
        participants,
      ),
    ).toThrow(new NotificationPolicyError("ERR-NOTIFICATION-FACT-INVALID"));
  });
});
