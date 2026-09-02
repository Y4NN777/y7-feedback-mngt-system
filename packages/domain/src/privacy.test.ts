import { describe, expect, it } from "vitest";

import {
  decidePrivacyDeletion,
  privacyAllowsIdentityMaterialization,
  privacyAllowsMaterialization,
  type PrivacyDeletionRecord,
  type PrivacyDependencies,
} from "./privacy";

const request = {
  type: "request_deletion",
  operationId: "operation_1",
  feedbackId: "feedback_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  requesterKind: "access_proof",
  requesterDigest: "a".repeat(64),
  reasonCode: "reporter_request",
} as const;

function dependencies(
  now = "2026-09-02T00:00:00.000Z",
  eventId = "event_1",
): PrivacyDependencies {
  return { createEventId: () => eventId, actorDigest: "b".repeat(64), now: () => now };
}

function requested() {
  const decision = decidePrivacyDeletion(undefined, request, dependencies());
  if (decision.status !== "accepted") throw new Error("fixture");
  return decision.record;
}

describe("privacy deletion policy", () => {
  it("BDD-PRIV-001 immediately hides Feedback and erases identity authority for 30 days", () => {
    const decision = decidePrivacyDeletion(undefined, request, dependencies());
    expect(decision.status).toBe("accepted");
    if (decision.status !== "accepted") throw new Error("unreachable");
    expect(decision.event.type).toBe("deletion_requested");
    expect(decision.event.revision).toBe(1);
    expect(decision.record).toMatchObject({
      state: "soft_deleted",
      identityErased: true,
      purgeEligibleAt: "2026-10-02T00:00:00.000Z",
    });
    expect(privacyAllowsMaterialization(decision.record)).toBe(false);
    expect(privacyAllowsIdentityMaterialization(decision.record)).toBe(false);
  });

  it("BDD-PRIV-002 replays an identical request and rejects key reuse", () => {
    const record = requested();
    expect(decidePrivacyDeletion(record, request, dependencies())).toMatchObject({
      status: "replayed",
      event: { eventId: "event_1" },
    });
    expect(
      decidePrivacyDeletion(
        record,
        { ...request, reasonCode: "other_request" },
        dependencies(),
      ),
    ).toEqual({ status: "conflict" });
    expect(
      decidePrivacyDeletion(
        record,
        { ...request, operationId: "operation_2" },
        dependencies(),
      ),
    ).toEqual({ status: "conflict" });
  });

  it("BDD-PRIV-003 restores before but never at the exact expiry boundary", () => {
    const record = requested();
    const command = {
      type: "restore_feedback",
      operationId: "operation_2",
      expectedRevision: 1,
    } as const;
    const restored = decidePrivacyDeletion(
      record,
      command,
      dependencies("2026-10-01T23:59:59.999Z", "event_2"),
    );
    expect(restored).toMatchObject({
      status: "accepted",
      record: { state: "restored", identityErased: true, revision: 2 },
    });
    if (restored.status !== "accepted") throw new Error("unreachable");
    expect(privacyAllowsMaterialization(restored.record)).toBe(true);
    expect(privacyAllowsIdentityMaterialization(restored.record)).toBe(false);
    expect(
      decidePrivacyDeletion(
        restored.record,
        command,
        dependencies("2026-10-01T23:59:59.999Z", "event_ignored"),
      ),
    ).toMatchObject({ status: "replayed", event: { eventId: "event_2" } });
    expect(
      decidePrivacyDeletion(
        record,
        command,
        dependencies("2026-10-02T00:00:00.000Z", "event_2"),
      ),
    ).toEqual({ status: "expired" });
  });

  it("BDD-PRIV-004 purges at the boundary, replays workers and cannot restore", () => {
    const record = requested();
    const command = {
      type: "purge_feedback",
      operationId: "operation_2",
      expectedRevision: 1,
    } as const;
    expect(
      decidePrivacyDeletion(
        record,
        command,
        dependencies("2026-10-01T23:59:59.999Z", "event_2"),
      ),
    ).toEqual({ status: "too_early" });
    const purged = decidePrivacyDeletion(
      record,
      command,
      dependencies("2026-10-02T00:00:00.000Z", "event_2"),
    );
    expect(purged).toMatchObject({
      status: "accepted",
      record: { state: "purged", revision: 2 },
    });
    if (purged.status !== "accepted") throw new Error("unreachable");
    expect(decidePrivacyDeletion(purged.record, command, dependencies())).toMatchObject(
      { status: "replayed" },
    );
    expect(
      decidePrivacyDeletion(
        purged.record,
        {
          type: "restore_feedback",
          operationId: "operation_3",
          expectedRevision: 2,
        },
        dependencies("2026-10-02T00:00:01.000Z", "event_3"),
      ),
    ).toEqual({ status: "irreversible" });
  });

  it("BDD-PRIV-005 rejects stale revisions and transitions from restored state", () => {
    const record = requested();
    expect(
      decidePrivacyDeletion(
        record,
        {
          type: "restore_feedback",
          operationId: "operation_2",
          expectedRevision: 2,
        },
        dependencies(),
      ),
    ).toEqual({ status: "conflict" });
    const restored: PrivacyDeletionRecord = {
      ...record,
      state: "restored",
      restoredAt: "2026-09-03T00:00:00.000Z",
      revision: 2,
    };
    for (const type of ["restore_feedback", "purge_feedback"] as const)
      expect(
        decidePrivacyDeletion(
          restored,
          { type, operationId: "operation_3", expectedRevision: 2 },
          dependencies("2026-10-03T00:00:00.000Z", "event_3"),
        ),
      ).toEqual({ status: "conflict" });
  });

  it("BDD-PRIV-006 rejects malformed commands, clocks, history and generated IDs", () => {
    for (const command of [
      { ...request, operationId: "bad id" },
      { ...request, feedbackId: "bad id" },
      { ...request, workspaceId: "bad id" },
      { ...request, projectId: "bad id" },
      { ...request, requesterDigest: "short" },
      { ...request, reasonCode: "BAD" },
    ])
      expect(decidePrivacyDeletion(undefined, command, dependencies())).toEqual({
        status: "invalid",
      });
    expect(
      decidePrivacyDeletion(undefined, request, {
        ...dependencies(),
        actorDigest: "short",
      }),
    ).toEqual({ status: "invalid" });
    expect(
      decidePrivacyDeletion(undefined, request, dependencies("not-a-date")),
    ).toEqual({ status: "invalid" });
    expect(
      decidePrivacyDeletion(undefined, request, dependencies(undefined, "bad id")),
    ).toEqual({ status: "invalid" });
    expect(
      decidePrivacyDeletion(
        { ...requested(), purgeEligibleAt: "invalid" },
        {
          type: "purge_feedback",
          operationId: "operation_2",
          expectedRevision: 1,
        },
        dependencies(),
      ),
    ).toEqual({ status: "invalid" });
  });

  it("BDD-PRIV-007 validates generated IDs for restore and purge events", () => {
    const record = requested();
    for (const command of [
      {
        type: "restore_feedback",
        operationId: "operation_2",
        expectedRevision: 1,
      },
      {
        type: "purge_feedback",
        operationId: "operation_2",
        expectedRevision: 1,
      },
    ] as const)
      expect(
        decidePrivacyDeletion(
          record,
          command,
          dependencies(
            command.type === "restore_feedback"
              ? "2026-09-03T00:00:00.000Z"
              : "2026-10-02T00:00:00.000Z",
            "bad id",
          ),
        ),
      ).toEqual({ status: "invalid" });
  });

  it("BDD-PRIV-008 permits ordinary materialization only without a deletion fact", () => {
    expect(privacyAllowsMaterialization(undefined)).toBe(true);
    expect(privacyAllowsIdentityMaterialization(undefined)).toBe(true);
  });
});
