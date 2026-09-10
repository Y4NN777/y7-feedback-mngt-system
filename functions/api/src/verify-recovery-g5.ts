import { createHash, randomBytes } from "node:crypto";

import { Client, Functions, Storage, TablesDB } from "node-appwrite";
import { InputFile } from "node-appwrite/file";

import { buildRecoveryManifest, evaluateRecoveryExercise } from "@y7-feedback/domain";

import { createAppwriteRecoverySource } from "./appwrite-recovery-source.js";
import { createAzureRecoveryRepositoryFromEnvironment } from "./azure-recovery-object-repository.js";
import {
  createRecoveryArtifact,
  expireRecoveryArtifact,
  publishRecoveryArtifact,
  type RecoveryArtifact,
} from "./recovery-artifact.js";
import { restoreRecoveryArtifact } from "./recovery-restore.js";
import { collectRecoveryEntries } from "./recovery-source.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("RECOVERY_G5_CONFIGURATION_MISSING");
  return value;
}

function object(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown) {
  return object(error) && error.code === 404;
}

function customData(value: Readonly<Record<string, unknown>>) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !key.startsWith("$")),
  );
}

function artifact(value: Uint8Array): RecoveryArtifact {
  const parsed: unknown = JSON.parse(Buffer.from(value).toString("utf8"));
  if (!object(parsed) || parsed.version !== 1)
    throw new Error("RECOVERY_G5_ARTIFACT_INVALID");
  return parsed as unknown as RecoveryArtifact;
}

const digest = (value: Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function main() {
  if (!process.argv.includes("--apply")) throw new Error("RECOVERY_G5_APPLY_REQUIRED");
  if ((process.env.Y7_ENVIRONMENT?.trim() || "preview") !== "preview")
    throw new Error("RECOVERY_G5_PREVIEW_REQUIRED");
  const suffix = randomBytes(5).toString("hex");
  const sourceDatabaseId = `rec_src_${suffix}`;
  const targetDatabaseId = `rec_dst_${suffix}`;
  const sourceBucketId = `rec_src_${suffix}`;
  const targetBucketId = `rec_dst_${suffix}`;
  const feedbackTableId = "feedback";
  const deletionTableId = "deletion_records";
  const fileId = `file_${suffix}`;
  const client = new Client()
    .setEndpoint(required("APPWRITE_ENDPOINT"))
    .setProject(required("APPWRITE_PROJECT_ID"))
    .setKey(required("APPWRITE_API_KEY"));
  const tables = new TablesDB(client);
  const storage = new Storage(client);
  const functions = new Functions(client);
  const repository = createAzureRecoveryRepositoryFromEnvironment(process.env);
  const encryptionKey = randomBytes(32);
  const signingKey = randomBytes(32);
  let recoveryArtifact: RecoveryArtifact | undefined;
  let sourceDatabaseCreated = false;
  let targetDatabaseCreated = false;
  let sourceBucketCreated = false;
  let targetBucketCreated = false;
  let targetDestroyed = false;
  try {
    await tables.create({
      databaseId: sourceDatabaseId,
      name: `Recovery source ${suffix}`,
      enabled: false,
    });
    sourceDatabaseCreated = true;
    await tables.createTable({
      databaseId: sourceDatabaseId,
      tableId: feedbackTableId,
      name: "Recovery feedback",
      permissions: [],
      rowSecurity: true,
      enabled: true,
      columns: [
        { key: "title", type: "string", size: 128, required: true },
        { key: "visible", type: "boolean", required: true },
      ],
    });
    await tables.createTable({
      databaseId: sourceDatabaseId,
      tableId: deletionTableId,
      name: "Recovery deletions",
      permissions: [],
      rowSecurity: false,
      enabled: true,
      columns: [
        { key: "feedbackId", type: "string", size: 64, required: true },
        { key: "state", type: "string", size: 32, required: true },
        { key: "requestedAt", type: "datetime", required: false },
        { key: "purgedAt", type: "datetime", required: false },
      ],
    });
    for (const row of [
      { id: "feedback_live", title: "Recovery live fixture" },
      { id: "feedback_deleted", title: "Recovery deleted fixture" },
      { id: "feedback_purged", title: "Recovery purged fixture" },
    ])
      await tables.createRow({
        databaseId: sourceDatabaseId,
        tableId: feedbackTableId,
        rowId: row.id,
        data: { title: row.title, visible: true },
        permissions: [],
      });
    const fixtureAt = new Date().toISOString();
    await tables.createRow({
      databaseId: sourceDatabaseId,
      tableId: deletionTableId,
      rowId: "event_deleted",
      data: {
        feedbackId: "feedback_deleted",
        state: "soft_deleted",
        requestedAt: fixtureAt,
      },
      permissions: [],
    });
    await tables.createRow({
      databaseId: sourceDatabaseId,
      tableId: deletionTableId,
      rowId: "event_purged",
      data: {
        feedbackId: "feedback_purged",
        state: "purged",
        purgedAt: fixtureAt,
      },
      permissions: [],
    });
    await storage.createBucket({
      bucketId: sourceBucketId,
      name: `Recovery source ${suffix}`,
      permissions: [],
      fileSecurity: true,
      enabled: false,
      maximumFileSize: 10 * 1024 * 1024,
      encryption: true,
      antivirus: false,
    });
    sourceBucketCreated = true;
    const privateBytes = Buffer.from(`private recovery fixture ${suffix}`);
    await storage.createFile({
      bucketId: sourceBucketId,
      fileId,
      file: InputFile.fromBuffer(privateBytes, "recovery-private.txt"),
      permissions: [],
    });

    const source = createAppwriteRecoverySource(
      {
        tables: {
          listTables: (input) => tables.listTables(input),
          listRows: (input) => tables.listRows(input),
          getRow: (input) => tables.getRow(input),
        },
        storage: {
          getBucket: (input) => storage.getBucket(input),
          listFiles: (input) => storage.listFiles(input),
          getFileDownload: (input) => storage.getFileDownload(input),
        },
        functions: { get: (input) => functions.get(input) },
      },
      {
        databaseId: sourceDatabaseId,
        bucketId: sourceBucketId,
        functionId:
          process.env.APPWRITE_FUNCTION_ID?.trim() || "y7-feedback-api-preview",
        now: () => new Date().toISOString(),
      },
    );
    const snapshotStartedAt = new Date().toISOString();
    const collected = await collectRecoveryEntries({
      source,
      deletionTableIds: [deletionTableId],
    });
    const snapshotCompletedAt = new Date().toISOString();
    const manifest = buildRecoveryManifest({
      recoverySetId: `g5_${suffix}`,
      sourceEnvironment: "preview",
      snapshotStartedAt,
      snapshotCompletedAt,
      encryptionKeyId: "g5-ephemeral-kek",
      signingKeyId: "g5-ephemeral-signing",
      entries: collected.entries,
      digest,
    });
    recoveryArtifact = createRecoveryArtifact({
      manifest,
      entries: collected.entries,
      encryptionKey,
      signingKey,
    });
    await publishRecoveryArtifact({ repository, artifact: recoveryArtifact, digest });
    const stored = await repository.get(
      `generations/${recoveryArtifact.recoverySetId}.recovery`,
    );
    if (!stored) throw new Error("RECOVERY_G5_AZURE_READ_FAILED");

    await tables.create({
      databaseId: targetDatabaseId,
      name: `Recovery target ${suffix}`,
      enabled: false,
    });
    targetDatabaseCreated = true;
    await tables.createTable({
      databaseId: targetDatabaseId,
      tableId: feedbackTableId,
      name: "Recovery feedback",
      permissions: [],
      rowSecurity: true,
      enabled: true,
      columns: [
        { key: "title", type: "string", size: 128, required: true },
        { key: "visible", type: "boolean", required: true },
      ],
    });
    await storage.createBucket({
      bucketId: targetBucketId,
      name: `Recovery target ${suffix}`,
      permissions: [],
      fileSecurity: true,
      enabled: false,
      maximumFileSize: 10 * 1024 * 1024,
      encryption: true,
      antivirus: false,
    });
    targetBucketCreated = true;
    const restoreStartedAt = new Date().toISOString();
    const restored = await restoreRecoveryArtifact({
      artifact: artifact(stored),
      encryptionKey,
      signingKey,
      feedbackTableId,
      target: {
        assertIsolation: async () => {
          const [database, bucket] = await Promise.all([
            tables.get({ databaseId: targetDatabaseId }),
            storage.getBucket({ bucketId: targetBucketId }),
          ]);
          return {
            isolated:
              targetDatabaseId.startsWith("rec_dst_") &&
              targetBucketId.startsWith("rec_dst_"),
            exposed: database.enabled || bucket.enabled,
          };
        },
        restoreConfiguration: (configuration) => {
          if (!object(configuration))
            return Promise.reject(new Error("RECOVERY_G5_CONFIG_INVALID"));
          return Promise.resolve();
        },
        restoreRow: (tableId, rowId, row) => {
          if (!object(row)) return Promise.reject(new Error("RECOVERY_G5_ROW_INVALID"));
          return tables
            .createRow({
              databaseId: targetDatabaseId,
              tableId,
              rowId,
              data: customData(row),
              permissions: [],
            })
            .then(() => undefined);
        },
        restorePrivateFile: (_sourceBucketId, restoredFileId, bytes) =>
          storage
            .createFile({
              bucketId: targetBucketId,
              fileId: restoredFileId,
              file: InputFile.fromBuffer(Buffer.from(bytes), "restored-private.txt"),
              permissions: [],
            })
            .then(() => undefined),
        hideFeedback: (feedbackId) =>
          tables
            .updateRow({
              databaseId: targetDatabaseId,
              tableId: feedbackTableId,
              rowId: feedbackId,
              data: { visible: false },
            })
            .then(() => undefined),
        purgeFeedback: (feedbackId) =>
          tables
            .deleteRow({
              databaseId: targetDatabaseId,
              tableId: feedbackTableId,
              rowId: feedbackId,
            })
            .then(() => undefined),
        verifyApplicationData: async () => {
          const rows = await tables.listRows({
            databaseId: targetDatabaseId,
            tableId: feedbackTableId,
            total: false,
          });
          return (
            rows.rows.length === 2 &&
            rows.rows.some(
              (row) => row.$id === "feedback_live" && row.visible === true,
            ) &&
            rows.rows.some(
              (row) => row.$id === "feedback_deleted" && row.visible === false,
            )
          );
        },
        verifyPrivateFiles: async () => {
          const bytes = await storage.getFileDownload({
            bucketId: targetBucketId,
            fileId,
          });
          return Buffer.compare(Buffer.from(bytes), privateBytes) === 0;
        },
        verifyDeletedContentUnavailable: async () => {
          const deleted = await tables.getRow({
            databaseId: targetDatabaseId,
            tableId: feedbackTableId,
            rowId: "feedback_deleted",
          });
          try {
            await tables.getRow({
              databaseId: targetDatabaseId,
              tableId: feedbackTableId,
              rowId: "feedback_purged",
            });
            return false;
          } catch (error) {
            return deleted.visible === false && absent(error);
          }
        },
        expose: async () => {
          await tables.update({ databaseId: targetDatabaseId, enabled: true });
          await storage.updateBucket({
            bucketId: targetBucketId,
            name: `Recovery target ${suffix}`,
            enabled: true,
          });
          return new Date().toISOString();
        },
      },
      now: () => new Date().toISOString(),
    });
    const restoreCompletedAt = new Date().toISOString();

    await storage.deleteBucket({ bucketId: targetBucketId });
    targetBucketCreated = false;
    await tables.delete({ databaseId: targetDatabaseId });
    targetDatabaseCreated = false;
    targetDestroyed = true;
    const exercise = evaluateRecoveryExercise({
      backupCompletedAt: snapshotCompletedAt,
      latestSourceMutationAt: collected.latestSourceMutationAt,
      restoreStartedAt,
      restoreCompletedAt,
      deletionReplayCompletedAt: restored.deletionReplayCompletedAt,
      exposedAt: restored.exposedAt,
      isolated: true,
      privateFilesVerified: true,
      applicationDataVerified: true,
      deletedContentUnavailable: true,
      destroyed: targetDestroyed,
    });
    if (exercise.status !== "passed") throw new Error("RECOVERY_G5_OBJECTIVES_FAILED");

    const beforeExpiry = new Date(Date.parse(manifest.expiresAt) - 1).toISOString();
    const retained = await expireRecoveryArtifact({
      repository,
      artifact: recoveryArtifact,
      now: beforeExpiry,
    });
    const expired = await expireRecoveryArtifact({
      repository,
      artifact: recoveryArtifact,
      now: manifest.expiresAt,
    });
    const [expiredArtifact, expiredMarker] = await Promise.all([
      repository.get(`generations/${recoveryArtifact.recoverySetId}.recovery`),
      repository.get(`complete/${recoveryArtifact.recoverySetId}.json`),
    ]);
    if (
      retained.status !== "retained" ||
      expired.status !== "expired" ||
      expiredArtifact !== undefined ||
      expiredMarker !== undefined
    )
      throw new Error("RECOVERY_G5_EXPIRY_FAILED");

    process.stdout.write(
      `${JSON.stringify({
        result: "RECOVERY_G5_PASSED",
        azurePrivateRepositoryPassed: true,
        encryptedRoundTripPassed: true,
        applicationDataRestored: true,
        privateFilesRestored: true,
        deletionReplayBeforeExposurePassed: true,
        deletedContentUnavailable: true,
        exactExpiryBoundaryPassed: true,
        isolatedEnvironmentDestroyed: true,
        rpoSeconds: exercise.rpoSeconds,
        rtoSeconds: exercise.rtoSeconds,
      })}\n`,
    );
  } finally {
    if (targetBucketCreated)
      await storage.deleteBucket({ bucketId: targetBucketId }).catch(() => undefined);
    if (targetDatabaseCreated)
      await tables.delete({ databaseId: targetDatabaseId }).catch(() => undefined);
    if (sourceBucketCreated)
      await storage.deleteBucket({ bucketId: sourceBucketId }).catch(() => undefined);
    if (sourceDatabaseCreated)
      await tables.delete({ databaseId: sourceDatabaseId }).catch(() => undefined);
    if (recoveryArtifact) {
      await repository
        .delete(`complete/${recoveryArtifact.recoverySetId}.json`)
        .catch(() => undefined);
      await repository
        .delete(`generations/${recoveryArtifact.recoverySetId}.recovery`)
        .catch(() => undefined);
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "RECOVERY_G5_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
});
