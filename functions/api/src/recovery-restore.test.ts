import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildRecoveryManifest, type RecoveryEntry } from "@y7-feedback/domain";

import { createRecoveryArtifact } from "./recovery-artifact";
import {
  restoreRecoveryArtifact,
  type RecoveryRestoreTarget,
} from "./recovery-restore";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const digest = (value: Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const encryptionKey = Buffer.alloc(32, 1);
const signingKey = Buffer.alloc(32, 2);

const entries: readonly RecoveryEntry[] = [
  {
    kind: "config",
    path: "config/appwrite.json",
    bytes: encode({ databaseId: "source", bucketId: "attachments", tables: [] }),
  },
  {
    kind: "table_row",
    path: "tables/feedback/feedback_live.json",
    bytes: encode({ $id: "feedback_live", title: "Live" }),
  },
  {
    kind: "table_row",
    path: "tables/feedback/feedback_deleted.json",
    bytes: encode({ $id: "feedback_deleted", title: "Deleted" }),
  },
  {
    kind: "table_row",
    path: "tables/feedback/feedback_purged.json",
    bytes: encode({ $id: "feedback_purged", title: "Purged" }),
  },
  {
    kind: "deletion_event",
    path: "deletions/privacy/event_1.json",
    bytes: encode({
      eventId: "event_1",
      feedbackId: "feedback_deleted",
      type: "deletion_requested",
      occurredAt: "2026-09-03T09:00:00.000Z",
    }),
  },
  {
    kind: "deletion_event",
    path: "deletions/privacy/event_2.json",
    bytes: encode({
      eventId: "event_2",
      feedbackId: "feedback_purged",
      type: "feedback_purged",
      occurredAt: "2026-09-03T09:01:00.000Z",
    }),
  },
  {
    kind: "private_file",
    path: "storage/attachments/file_1",
    bytes: new Uint8Array([1, 2, 3]),
  },
];

function artifact() {
  const manifest = buildRecoveryManifest({
    recoverySetId: "recovery_1",
    sourceEnvironment: "preview",
    snapshotStartedAt: "2026-09-03T09:00:00.000Z",
    snapshotCompletedAt: "2026-09-03T09:02:00.000Z",
    encryptionKeyId: "recovery-kek-1",
    signingKeyId: "recovery-sign-1",
    entries,
    digest,
  });
  return createRecoveryArtifact({ manifest, entries, encryptionKey, signingKey });
}

function target(overrides: Partial<RecoveryRestoreTarget> = {}): {
  readonly target: RecoveryRestoreTarget;
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    target: {
      assertIsolation: () => Promise.resolve({ isolated: true, exposed: false }),
      restoreConfiguration: () => {
        calls.push("config");
        return Promise.resolve();
      },
      restoreRow: (tableId, rowId) => {
        calls.push(`row:${tableId}/${rowId}`);
        return Promise.resolve();
      },
      restorePrivateFile: (bucketId, fileId) => {
        calls.push(`file:${bucketId}/${fileId}`);
        return Promise.resolve();
      },
      hideFeedback: (feedbackId) => {
        calls.push(`hide:${feedbackId}`);
        return Promise.resolve();
      },
      purgeFeedback: (feedbackId) => {
        calls.push(`purge:${feedbackId}`);
        return Promise.resolve();
      },
      verifyApplicationData: () => Promise.resolve(true),
      verifyPrivateFiles: () => Promise.resolve(true),
      verifyDeletedContentUnavailable: () => Promise.resolve(true),
      expose: () => {
        calls.push("expose");
        return Promise.resolve("2026-09-03T10:10:00.000Z");
      },
      ...overrides,
    },
  };
}

describe("isolated recovery restore", () => {
  it("BDD-REC-016 restores data and files, replays deletion, then exposes", async () => {
    const candidate = target();
    await expect(
      restoreRecoveryArtifact({
        artifact: artifact(),
        encryptionKey,
        signingKey,
        target: candidate.target,
        feedbackTableId: "feedback",
      }),
    ).resolves.toMatchObject({
      status: "restored",
      rows: 3,
      privateFiles: 1,
      hidden: 1,
      purged: 1,
    });
    expect(candidate.calls.indexOf("hide:feedback_deleted")).toBeLessThan(
      candidate.calls.indexOf("expose"),
    );
    expect(candidate.calls.indexOf("purge:feedback_purged")).toBeLessThan(
      candidate.calls.indexOf("expose"),
    );
  });

  it("BDD-REC-017 rejects non-isolated or already exposed targets", async () => {
    for (const isolation of [
      { isolated: false, exposed: false },
      { isolated: true, exposed: true },
    ]) {
      const candidate = target({ assertIsolation: () => Promise.resolve(isolation) });
      await expect(
        restoreRecoveryArtifact({
          artifact: artifact(),
          encryptionKey,
          signingKey,
          target: candidate.target,
          feedbackTableId: "feedback",
        }),
      ).rejects.toThrow("RECOVERY_TARGET_NOT_ISOLATED");
      expect(candidate.calls).not.toContain("expose");
    }
  });

  it("BDD-REC-018 never exposes an incomplete or deletion-unsafe restore", async () => {
    for (const overrides of [
      { verifyApplicationData: () => Promise.resolve(false) },
      { verifyPrivateFiles: () => Promise.resolve(false) },
      { verifyDeletedContentUnavailable: () => Promise.resolve(false) },
      { hideFeedback: () => Promise.reject(new Error("failure")) },
    ]) {
      const candidate = target(overrides);
      await expect(
        restoreRecoveryArtifact({
          artifact: artifact(),
          encryptionKey,
          signingKey,
          target: candidate.target,
          feedbackTableId: "feedback",
        }),
      ).rejects.toThrow();
      expect(candidate.calls).not.toContain("expose");
    }
  });
});
