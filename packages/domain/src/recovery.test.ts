import { describe, expect, it } from "vitest";

import {
  buildRecoveryManifest,
  evaluateRecoveryExercise,
  planDeletionReplay,
  validateRecoveryManifest,
  type RecoveryEntry,
} from "./recovery";

const digest = (value: Uint8Array) =>
  `sha256:${Buffer.from(value).toString("hex").padEnd(64, "0").slice(0, 64)}`;

const entries: readonly RecoveryEntry[] = [
  {
    kind: "private_file",
    path: "storage/attachments/file_1",
    bytes: new TextEncoder().encode("private"),
  },
  {
    kind: "table_row",
    path: "tables/feedback/feedback_1.json",
    bytes: new TextEncoder().encode('{"id":"feedback_1"}'),
  },
  {
    kind: "deletion_event",
    path: "deletions/event_1.json",
    bytes: new TextEncoder().encode(
      '{"feedbackId":"feedback_deleted","occurredAt":"2026-09-01T10:00:00.000Z","type":"deletion_requested"}',
    ),
  },
  {
    kind: "config",
    path: "config/schema.json",
    bytes: new TextEncoder().encode('{"tables":[]}'),
  },
];
const firstEntry = entries[0];
if (!firstEntry) throw new Error("fixture");

const manifestInput = {
  recoverySetId: "recovery_1",
  sourceEnvironment: "preview" as const,
  snapshotStartedAt: "2026-09-03T09:00:00.000Z",
  snapshotCompletedAt: "2026-09-03T09:04:00.000Z",
  encryptionKeyId: "recovery-kek",
  signingKeyId: "recovery-signing",
  entries,
  digest,
};

const passingExercise = {
  backupCompletedAt: "2026-09-03T09:04:00.000Z",
  latestSourceMutationAt: "2026-09-03T08:30:00.000Z",
  restoreStartedAt: "2026-09-03T10:00:00.000Z",
  restoreCompletedAt: "2026-09-03T10:22:00.000Z",
  deletionReplayCompletedAt: "2026-09-03T10:20:00.000Z",
  exposedAt: "2026-09-03T10:21:00.000Z",
  isolated: true,
  privateFilesVerified: true,
  applicationDataVerified: true,
  deletedContentUnavailable: true,
  destroyed: true,
};

describe("recovery set policy", () => {
  it("BDD-REC-001 builds a deterministic complete manifest with 30-day expiry", () => {
    const input = {
      recoverySetId: "recovery_20260903_001",
      sourceEnvironment: "preview" as const,
      snapshotStartedAt: "2026-09-03T09:00:00.000Z",
      snapshotCompletedAt: "2026-09-03T09:04:00.000Z",
      encryptionKeyId: "recovery-kek-2026-09",
      signingKeyId: "recovery-signing-2026-09",
      entries,
      digest,
    };
    const first = buildRecoveryManifest(input);
    const second = buildRecoveryManifest({ ...input, entries: [...entries].reverse() });
    expect(first).toEqual(second);
    expect(first.expiresAt).toBe("2026-10-03T09:04:00.000Z");
    expect(first.inventory).toHaveLength(4);
    expect(first.inventory.map(({ path }) => path)).toEqual(
      [...first.inventory.map(({ path }) => path)].sort(),
    );
    expect(first.counts).toEqual({
      config: 1,
      deletion_event: 1,
      private_file: 1,
      table_row: 1,
    });
  });

  it("BDD-REC-002 rejects duplicate, unsafe, incomplete and modified inventory", () => {
    expect(() =>
      buildRecoveryManifest({
        recoverySetId: "recovery_1",
        sourceEnvironment: "preview",
        snapshotStartedAt: "2026-09-03T09:00:00.000Z",
        snapshotCompletedAt: "2026-09-03T09:04:00.000Z",
        encryptionKeyId: "recovery-kek",
        signingKeyId: "recovery-signing",
        entries: [firstEntry, firstEntry],
        digest,
      }),
    ).toThrow("RECOVERY_INVENTORY_INVALID");
    expect(() =>
      buildRecoveryManifest({
        recoverySetId: "recovery_1",
        sourceEnvironment: "preview",
        snapshotStartedAt: "2026-09-03T09:00:00.000Z",
        snapshotCompletedAt: "2026-09-03T09:04:00.000Z",
        encryptionKeyId: "recovery-kek",
        signingKeyId: "recovery-signing",
        entries: [{ ...firstEntry, path: "../secret" }],
        digest,
      }),
    ).toThrow("RECOVERY_INVENTORY_INVALID");
    const manifest = buildRecoveryManifest({
      recoverySetId: "recovery_1",
      sourceEnvironment: "preview",
      snapshotStartedAt: "2026-09-03T09:00:00.000Z",
      snapshotCompletedAt: "2026-09-03T09:04:00.000Z",
      encryptionKeyId: "recovery-kek",
      signingKeyId: "recovery-signing",
      entries,
      digest,
    });
    expect(validateRecoveryManifest(manifest, entries.slice(1), digest)).toEqual({
      status: "invalid",
      reason: "inventory_mismatch",
    });
    expect(
      validateRecoveryManifest(
        manifest,
        entries.map((entry, index) =>
          index === 0
            ? { ...entry, bytes: new TextEncoder().encode("privatf") }
            : entry,
        ),
        digest,
      ),
    ).toEqual({ status: "invalid", reason: "digest_mismatch" });
  });

  it.each([
    ["recoverySetId", "invalid/id"],
    ["encryptionKeyId", ""],
    ["signingKeyId", "invalid key"],
    ["snapshotStartedAt", "not-an-instant"],
    ["snapshotCompletedAt", "2026-09-03T09:04:00.000+00:00"],
    ["snapshotCompletedAt", "2026-09-03T08:59:59.999Z"],
    ["entries", []],
  ] as const)("BDD-REC-002 rejects an invalid %s", (field, value) => {
    expect(() => buildRecoveryManifest({ ...manifestInput, [field]: value })).toThrow(
      "RECOVERY_MANIFEST_INVALID",
    );
  });

  it("BDD-REC-002 rejects malformed digests and every inventory substitution", () => {
    expect(() =>
      buildRecoveryManifest({ ...manifestInput, digest: () => "sha256:not-a-digest" }),
    ).toThrow("RECOVERY_DIGEST_INVALID");

    const manifest = buildRecoveryManifest(manifestInput);
    expect(
      validateRecoveryManifest(
        manifest,
        [{ ...firstEntry, path: "../unsafe" }],
        digest,
      ),
    ).toEqual({ status: "invalid", reason: "inventory_mismatch" });

    const [manifestFirst, ...manifestRest] = manifest.inventory;
    if (!manifestFirst) throw new Error("manifest fixture");
    const substitutions = [
      { ...manifestFirst, path: "config/other.json" },
      { ...manifestFirst, kind: "private_file" as const },
      { ...manifestFirst, byteLength: 999 },
    ];
    for (const substituted of substitutions) {
      expect(
        validateRecoveryManifest(
          { ...manifest, inventory: [substituted, ...manifestRest] },
          entries,
          digest,
        ),
      ).toEqual({ status: "invalid", reason: "inventory_mismatch" });
    }
    expect(validateRecoveryManifest(manifest, entries, digest)).toEqual({
      status: "valid",
    });
  });

  it("BDD-REC-003 replays deletions idempotently before exposure", () => {
    const events = [
      {
        eventId: "event_1",
        feedbackId: "feedback_deleted",
        type: "deletion_requested" as const,
        occurredAt: "2026-09-01T10:00:00.000Z",
      },
      {
        eventId: "event_2",
        feedbackId: "feedback_purged",
        type: "feedback_purged" as const,
        occurredAt: "2026-09-02T10:00:00.000Z",
      },
      {
        eventId: "event_2",
        feedbackId: "feedback_purged",
        type: "feedback_purged" as const,
        occurredAt: "2026-09-02T10:00:00.000Z",
      },
    ];
    expect(
      planDeletionReplay(
        ["feedback_live", "feedback_deleted", "feedback_purged"],
        events,
      ),
    ).toEqual({
      visibleFeedbackIds: ["feedback_live"],
      hiddenFeedbackIds: ["feedback_deleted"],
      purgeFeedbackIds: ["feedback_purged"],
      appliedEventIds: ["event_1", "event_2"],
    });
  });

  it("BDD-REC-003 ignores malformed events and applies an explicit restore", () => {
    const result = planDeletionReplay(
      ["feedback_1"],
      [
        {
          eventId: "invalid/id",
          feedbackId: "feedback_1",
          type: "deletion_requested",
          occurredAt: "2026-09-01T10:00:00.000Z",
        },
        {
          eventId: "event_invalid_feedback",
          feedbackId: "invalid/id",
          type: "deletion_requested",
          occurredAt: "2026-09-01T10:00:00.000Z",
        },
        {
          eventId: "event_invalid_time",
          feedbackId: "feedback_1",
          type: "deletion_requested",
          occurredAt: "yesterday",
        },
        {
          eventId: "event_hide",
          feedbackId: "feedback_1",
          type: "deletion_requested",
          occurredAt: "2026-09-01T10:00:00.000Z",
        },
        {
          eventId: "event_restore",
          feedbackId: "feedback_1",
          type: "feedback_restored",
          occurredAt: "2026-09-02T10:00:00.000Z",
        },
      ],
    );
    expect(result.visibleFeedbackIds).toEqual(["feedback_1"]);
    expect(result.appliedEventIds).toEqual(["event_hide", "event_restore"]);
  });

  it("BDD-REC-004 proves RPO/RTO only for isolated, deletion-safe, destroyed drills", () => {
    expect(evaluateRecoveryExercise(passingExercise)).toEqual({
      status: "passed",
      rpoSeconds: 2040,
      rtoSeconds: 1320,
    });
    expect(
      evaluateRecoveryExercise({
        ...passingExercise,
        deletionReplayCompletedAt: "2026-09-03T10:22:00.000Z",
      }),
    ).toEqual({ status: "failed", reason: "deletion_replay_after_exposure" });
  });

  it.each([
    ["backupCompletedAt", "invalid"],
    ["latestSourceMutationAt", "invalid"],
    ["restoreStartedAt", "invalid"],
    ["restoreCompletedAt", "invalid"],
    ["deletionReplayCompletedAt", "invalid"],
    ["exposedAt", "invalid"],
  ] as const)("BDD-REC-004 rejects an invalid %s", (field, value) => {
    expect(evaluateRecoveryExercise({ ...passingExercise, [field]: value })).toEqual({
      status: "failed",
      reason: "invalid_timeline",
    });
  });

  it.each([
    [{ isolated: false }, "target_not_isolated"],
    [{ applicationDataVerified: false }, "restore_incomplete"],
    [{ privateFilesVerified: false }, "restore_incomplete"],
    [{ deletedContentUnavailable: false }, "deleted_content_exposed"],
    [{ destroyed: false }, "isolated_target_not_destroyed"],
    [{ latestSourceMutationAt: "2026-09-03T09:04:00.001Z" }, "rpo_exceeded"],
    [{ latestSourceMutationAt: "2026-09-02T09:03:59.000Z" }, "rpo_exceeded"],
    [{ restoreCompletedAt: "2026-09-03T09:59:59.999Z" }, "rto_exceeded"],
    [{ restoreCompletedAt: "2026-09-03T14:00:01.000Z" }, "rto_exceeded"],
  ] as const)("BDD-REC-004 rejects unsafe exercise state: %s", (override, reason) => {
    expect(evaluateRecoveryExercise({ ...passingExercise, ...override })).toEqual({
      status: "failed",
      reason,
    });
  });
});
