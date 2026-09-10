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
const replaceFirstCharacter = (value: string) =>
  `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;

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
      { ...artifact, ciphertext: replaceFirstCharacter(artifact.ciphertext) },
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

  it("BDD-REC-006A validates keys, randomness, signatures and embedded inventory", () => {
    expect(() =>
      createRecoveryArtifact({
        manifest,
        entries,
        encryptionKey: Buffer.alloc(31),
        signingKey,
      }),
    ).toThrow("RECOVERY_KEY_INVALID");
    expect(() =>
      createRecoveryArtifact({
        manifest,
        entries,
        encryptionKey,
        signingKey: Buffer.alloc(31),
      }),
    ).toThrow("RECOVERY_KEY_INVALID");
    for (const invalidCall of [1, 2, 3]) {
      let call = 0;
      expect(() =>
        createRecoveryArtifact({
          manifest,
          entries,
          encryptionKey,
          signingKey,
          randomBytes: (length) =>
            Buffer.alloc(++call === invalidCall ? length - 1 : length),
        }),
      ).toThrow("RECOVERY_RANDOM_INVALID");
    }

    const candidate = recoveryArtifact();
    expect(() =>
      openRecoveryArtifact({
        artifact: { ...candidate, signature: "AA" },
        encryptionKey,
        signingKey,
      }),
    ).toThrow("RECOVERY_ARTIFACT_INVALID");
    expect(() =>
      openRecoveryArtifact({
        artifact: candidate,
        encryptionKey,
        signingKey: Buffer.alloc(31),
      }),
    ).toThrow("RECOVERY_ARTIFACT_INVALID");

    const incomplete = createRecoveryArtifact({
      manifest,
      entries: entries.slice(1),
      encryptionKey,
      signingKey,
    });
    expect(() =>
      openRecoveryArtifact({ artifact: incomplete, encryptionKey, signingKey }),
    ).toThrow("RECOVERY_ARTIFACT_INVALID");

    let recoverySetIdReads = 0;
    const inconsistentManifest = new Proxy(manifest, {
      get(target, property) {
        if (property !== "recoverySetId")
          return target[property as keyof typeof target];
        recoverySetIdReads += 1;
        return recoverySetIdReads === 2 ? "recovery_other" : target.recoverySetId;
      },
    });
    const inconsistent = createRecoveryArtifact({
      manifest: inconsistentManifest,
      entries,
      encryptionKey,
      signingKey,
    });
    expect(() =>
      openRecoveryArtifact({ artifact: inconsistent, encryptionKey, signingKey }),
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

  it("BDD-REC-008B rejects conflicting completed or concurrently published sets", async () => {
    const artifact = recoveryArtifact();
    const conflictingMarker = new TextEncoder().encode(
      JSON.stringify({ artifactDigest: "sha256:conflict" }),
    );
    const completed: RecoveryObjectRepository = {
      put: () => Promise.resolve("stored"),
      get: (key) =>
        Promise.resolve(key.startsWith("complete/") ? conflictingMarker : undefined),
      delete: () => Promise.resolve(),
    };
    await expect(
      publishRecoveryArtifact({ repository: completed, artifact, digest }),
    ).rejects.toThrow("RECOVERY_GENERATION_CONFLICT");

    for (const winner of [undefined, conflictingMarker]) {
      let reads = 0;
      const concurrent: RecoveryObjectRepository = {
        put: (_key, _value, options) =>
          Promise.resolve(options.ifAbsent && reads > 0 ? "exists" : "stored"),
        get: (key) => {
          reads += 1;
          if (key.startsWith("generations/"))
            return Promise.resolve(encodeArtifact(artifact));
          return Promise.resolve(reads > 2 ? winner : undefined);
        },
        delete: () => Promise.resolve(),
      };
      await expect(
        publishRecoveryArtifact({ repository: concurrent, artifact, digest }),
      ).rejects.toThrow("RECOVERY_GENERATION_CONFLICT");
    }
  });

  it("BDD-REC-008C rejects a missing staged generation", async () => {
    const repository: RecoveryObjectRepository = {
      put: () => Promise.resolve("stored"),
      get: () => Promise.resolve(undefined),
      delete: () => Promise.resolve(),
    };
    await expect(
      publishRecoveryArtifact({ repository, artifact: recoveryArtifact(), digest }),
    ).rejects.toThrow("RECOVERY_STAGING_VERIFICATION_FAILED");
  });

  it("BDD-REC-008D accepts an identical concurrent completion marker", async () => {
    const artifact = recoveryArtifact();
    let staged: Uint8Array | undefined;
    let attemptedMarker: Uint8Array | undefined;
    const repository: RecoveryObjectRepository = {
      put: (key, value) => {
        if (key.startsWith("generations/")) {
          staged = value;
          return Promise.resolve("stored");
        }
        attemptedMarker = value;
        return Promise.resolve("exists");
      },
      get: (key) =>
        Promise.resolve(key.startsWith("generations/") ? staged : attemptedMarker),
      delete: () => Promise.resolve(),
    };
    await expect(
      publishRecoveryArtifact({ repository, artifact, digest }),
    ).resolves.toEqual({
      status: "replayed",
      recoverySetId: "recovery_1",
    });
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
    for (const candidate of [
      { now: "invalid", expiresAt: manifest.expiresAt },
      { now: manifest.expiresAt, expiresAt: "invalid" },
    ])
      await expect(
        expireRecoveryArtifact({
          repository,
          artifact: { recoverySetId: "recovery_1", expiresAt: candidate.expiresAt },
          now: candidate.now,
        }),
      ).rejects.toThrow("RECOVERY_EXPIRY_INVALID");
  });
});

function encodeArtifact(artifact: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(artifact));
}
