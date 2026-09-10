import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildRecoveryManifest, type RecoveryEntry } from "@y7-feedback/domain";

import {
  createRecoveryArtifact,
  expireRecoveryArtifact,
  openRecoveryArtifact,
  publishRecoveryArtifact,
  type RecoveryObjectRepository,
} from "./recovery-artifact";

const digest = (value: Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const entries: readonly RecoveryEntry[] = [
  {
    kind: "table_row",
    path: "tables/feedback/feedback_1.json",
    bytes: new TextEncoder().encode('{"feedbackId":"feedback_1"}'),
  },
  {
    kind: "private_file",
    path: "storage/attachments/file_1",
    bytes: new TextEncoder().encode("secret file content"),
  },
];

const manifest = buildRecoveryManifest({
  recoverySetId: "recovery_1",
  sourceEnvironment: "preview",
  snapshotStartedAt: "2026-09-03T09:00:00.000Z",
  snapshotCompletedAt: "2026-09-03T09:01:00.000Z",
  encryptionKeyId: "recovery-kek-1",
  signingKeyId: "recovery-sign-1",
  entries,
  digest,
});

const encryptionKey = Buffer.alloc(32, 1);
const signingKey = Buffer.alloc(32, 2);
const recoveryArtifact = () =>
  createRecoveryArtifact({ manifest, entries, encryptionKey, signingKey });

describe("encrypted recovery artifact", () => {
  it("BDD-REC-005 encrypts the full set with a wrapped random data key", () => {
    let byte = 3;
    const artifact = createRecoveryArtifact({
      manifest,
      entries,
      encryptionKey,
      signingKey,
      randomBytes: (length) => Buffer.alloc(length, byte++),
    });
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain("feedback_1");
    expect(serialized).not.toContain("secret file content");
    expect(artifact.encryptionKeyId).toBe("recovery-kek-1");
    expect(artifact.signingKeyId).toBe("recovery-sign-1");
    expect(openRecoveryArtifact({ artifact, encryptionKey, signingKey })).toEqual({
      manifest,
      entries: [...entries].sort((left, right) => left.path.localeCompare(right.path)),
    });
  });

  it("BDD-REC-006 fails closed for tampering, wrong keys and metadata substitution", () => {
    const artifact = createRecoveryArtifact({
      manifest,
      entries,
      encryptionKey,
      signingKey,
    });
    for (const candidate of [
      { ...artifact, ciphertext: `${artifact.ciphertext.slice(0, -1)}A` },
      { ...artifact, expiresAt: "2027-01-01T00:00:00.000Z" },
    ])
      expect(() =>
        openRecoveryArtifact({ artifact: candidate, encryptionKey, signingKey }),
      ).toThrow("RECOVERY_ARTIFACT_INVALID");
    expect(() =>
      openRecoveryArtifact({
        artifact,
        encryptionKey: Buffer.alloc(32, 9),
        signingKey,
      }),
    ).toThrow("RECOVERY_ARTIFACT_INVALID");
  });

  it("BDD-REC-007 publishes only verified complete generations and is idempotent", async () => {
    const objects = new Map<string, Uint8Array>();
    const repository: RecoveryObjectRepository = {
      put: (key, value, options) => {
        if (options.ifAbsent && objects.has(key)) return Promise.resolve("exists");
        objects.set(key, value);
        return Promise.resolve("stored");
      },
      get: (key) => Promise.resolve(objects.get(key)),
      delete: (key) => {
        objects.delete(key);
        return Promise.resolve();
      },
    };
    const artifact = createRecoveryArtifact({
      manifest,
      entries,
      encryptionKey,
      signingKey,
    });
    await expect(
      publishRecoveryArtifact({ repository, artifact, digest }),
    ).resolves.toEqual({ status: "published", recoverySetId: "recovery_1" });
    expect([...objects.keys()].sort()).toEqual([
      "complete/recovery_1.json",
      "generations/recovery_1.recovery",
    ]);
    await expect(
      publishRecoveryArtifact({ repository, artifact, digest }),
    ).resolves.toEqual({ status: "replayed", recoverySetId: "recovery_1" });
  });

  it("BDD-REC-008 never writes the complete marker after staged corruption", async () => {
    const objects = new Map<string, Uint8Array>();
    const repository: RecoveryObjectRepository = {
      put: (key, value) => {
        objects.set(key, key.endsWith(".recovery") ? new Uint8Array([0]) : value);
        return Promise.resolve("stored");
      },
      get: (key) => Promise.resolve(objects.get(key)),
      delete: (key) => {
        objects.delete(key);
        return Promise.resolve();
      },
    };
    const artifact = createRecoveryArtifact({
      manifest,
      entries,
      encryptionKey,
      signingKey,
    });
    await expect(
      publishRecoveryArtifact({ repository, artifact, digest }),
    ).rejects.toThrow("RECOVERY_STAGING_VERIFICATION_FAILED");
    expect(objects.has("complete/recovery_1.json")).toBe(false);
    expect(objects.has("generations/recovery_1.recovery")).toBe(false);
  });

  it("BDD-REC-008A expires at the exact boundary and replays cleanup", async () => {
    const deleted: string[] = [];
    const repository: RecoveryObjectRepository = {
      put: () => Promise.resolve("stored"),
      get: () => Promise.resolve(undefined),
      delete: (key) => {
        deleted.push(key);
        return Promise.resolve();
      },
    };
    await expect(
      expireRecoveryArtifact({
        repository,
        artifact: recoveryArtifact(),
        now: "2026-10-03T09:00:59.999Z",
      }),
    ).resolves.toEqual({ status: "retained" });
    await expect(
      expireRecoveryArtifact({
        repository,
        artifact: recoveryArtifact(),
        now: "2026-10-03T09:01:00.000Z",
      }),
    ).resolves.toEqual({ status: "expired" });
    expect(deleted).toEqual([
      "complete/recovery_1.json",
      "generations/recovery_1.recovery",
    ]);
  });
});
