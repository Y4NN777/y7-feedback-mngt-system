import { createHash } from "node:crypto";

import { Client, Functions, Storage, TablesDB } from "node-appwrite";

import { buildRecoveryManifest } from "@y7-feedback/domain";

import { createAppwriteRecoverySource } from "./appwrite-recovery-source.js";
import { createAzureRecoveryRepositoryFromEnvironment } from "./azure-recovery-object-repository.js";
import {
  createRecoveryArtifact,
  publishRecoveryArtifact,
} from "./recovery-artifact.js";
import { collectRecoveryEntries } from "./recovery-source.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("RECOVERY_CONFIGURATION_MISSING");
  return value;
}

function key(name: string): Uint8Array {
  const value = Buffer.from(required(name), "base64url");
  if (value.byteLength !== 32) throw new Error("RECOVERY_KEY_INVALID");
  return value;
}

const digest = (value: Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function main() {
  if (!process.argv.includes("--apply"))
    throw new Error("RECOVERY_BACKUP_APPLY_REQUIRED");
  const sourceEnvironment = required("Y7_ENVIRONMENT");
  if (sourceEnvironment !== "preview" && sourceEnvironment !== "production")
    throw new Error("RECOVERY_CONFIGURATION_INVALID");
  const endpoint = required("APPWRITE_ENDPOINT");
  const projectId = required("APPWRITE_PROJECT_ID");
  const databaseId = required("APPWRITE_DATABASE_ID");
  const bucketId = required("APPWRITE_ATTACHMENT_BUCKET_ID");
  const functionId = required("APPWRITE_FUNCTION_ID");
  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(required("APPWRITE_API_KEY"));
  const tables = new TablesDB(client);
  const storage = new Storage(client);
  const functions = new Functions(client);
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
    { databaseId, bucketId, functionId, now: () => new Date().toISOString() },
  );
  const snapshotStartedAt = new Date().toISOString();
  const collected = await collectRecoveryEntries({
    source,
    deletionTableIds: [
      process.env.APPWRITE_DELETION_RECORDS_TABLE_ID?.trim() || "deletion_records",
    ],
  });
  const snapshotCompletedAt = new Date().toISOString();
  const recoverySetId = `recovery_${sourceEnvironment}_${snapshotCompletedAt.replaceAll(/[-:.TZ]/gu, "")}`;
  const manifest = buildRecoveryManifest({
    recoverySetId,
    sourceEnvironment,
    snapshotStartedAt,
    snapshotCompletedAt,
    encryptionKeyId: required("RECOVERY_ENCRYPTION_KEY_ID"),
    signingKeyId: required("RECOVERY_SIGNING_KEY_ID"),
    entries: collected.entries,
    digest,
  });
  const artifact = createRecoveryArtifact({
    manifest,
    entries: collected.entries,
    encryptionKey: key("RECOVERY_ENCRYPTION_KEY"),
    signingKey: key("RECOVERY_SIGNING_KEY"),
  });
  const result = await publishRecoveryArtifact({
    repository: createAzureRecoveryRepositoryFromEnvironment(process.env),
    artifact,
    digest,
  });
  process.stdout.write(
    `${JSON.stringify({
      result: "RECOVERY_BACKUP_PUBLISHED",
      status: result.status,
      recoverySetId,
      sourceEnvironment,
      snapshotCompletedAt,
      expiresAt: manifest.expiresAt,
      entries: manifest.inventory.length,
      totalBytes: manifest.totalBytes,
      latestSourceMutationAt: collected.latestSourceMutationAt,
    })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "RECOVERY_BACKUP_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
});
