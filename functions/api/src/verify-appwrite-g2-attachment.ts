import { randomBytes, randomUUID } from "node:crypto";

import { Client, Storage, TablesDB } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createHttpApplication } from "./application.js";
import { createNodeAppwriteAttachmentAcceptanceStore } from "./appwrite-attachment-acceptance-store.js";
import { runAppwriteG2AttachmentMatrix } from "./appwrite-g2-attachment-matrix.js";
import type { AppwriteG1MatrixIds } from "./appwrite-g1-matrix.js";
import { createNodeAppwritePrivateAttachmentStorage } from "./appwrite-private-attachment-storage.js";
import { createAttachmentDownload } from "./attachment-download.js";
import { createAttachmentSaga } from "./attachment-saga.js";
import { validateAttachment } from "./attachment-validation.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

function ids(suffix: string): AppwriteG1MatrixIds {
  return {
    feedbackId: `g2f_${suffix}`,
    reporterId: `g2r_${suffix}`,
    notificationId: `g2n_${suffix}`,
    lifecycleId: `g2l_${suffix}`,
    outboxId: `g2o_${suffix}`,
  };
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("APPWRITE_G2_APPLY_REQUIRED");
  }
  const config = parseServerConfig(process.env);
  if (config.environment === "production") {
    throw new Error("APPWRITE_G2_NON_PRODUCTION_REQUIRED");
  }
  const suffix = randomBytes(8).toString("hex");
  const parentIds = ids(suffix);
  const idQueue = [
    parentIds.feedbackId,
    parentIds.reporterId,
    parentIds.notificationId,
    parentIds.lifecycleId,
    parentIds.outboxId,
  ];
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(client);
  const nodeStorage = new Storage(client);
  const application = createHttpApplication(config, {
    tables,
    createId: () => {
      const id = idQueue.shift();
      if (!id) throw new Error("APPWRITE_G2_ID_SEQUENCE_INVALID");
      return id;
    },
    createReference: () => `Y7-G2-${suffix.toUpperCase()}`,
    createCorrelationId: randomUUID,
    nowIso: () => new Date().toISOString(),
    nowMs: Date.now,
    startedAt: Date.now,
  });
  if (!application.publicApi) throw new Error("APPWRITE_G2_API_INVALID");

  const sensitive = {
    environment: config.environment,
    protector: createSensitiveDataProtector(
      config.sensitiveDataActiveKeyId,
      Object.entries(config.sensitiveDataEnvelopeKeys).map(([id, material]) => ({
        id,
        material: Buffer.from(material, "base64url"),
      })),
    ),
  };
  const privateStorage = createNodeAppwritePrivateAttachmentStorage(
    nodeStorage,
    tables,
    {
      bucketId: config.appwriteSchema.attachmentBucketId,
      databaseId: config.appwriteSchema.databaseId,
      stagingTableId: config.appwriteSchema.attachmentStagingTableId,
    },
  );
  const metadata = createNodeAppwriteAttachmentAcceptanceStore(
    tables,
    {
      databaseId: config.appwriteSchema.databaseId,
      stagingTableId: config.appwriteSchema.attachmentStagingTableId,
      attachmentsTableId: config.appwriteSchema.attachmentsTableId,
    },
    sensitive,
  );
  const attachmentId = `g2a_${suffix}`;
  const objectId = `private/g2_${suffix}`;
  const stagedAt = new Date().toISOString();
  const saga = createAttachmentSaga(privateStorage, metadata, {
    now: () => stagedAt,
    createAttachmentId: () => attachmentId,
    createObjectId: () => objectId,
    validate: (candidate) =>
      validateAttachment(candidate, {
        malwareScanner: { scan: () => Promise.resolve("clean") },
      }),
  });
  const result = await runAppwriteG2AttachmentMatrix(
    application.publicApi,
    saga,
    createAttachmentDownload(metadata, privateStorage),
    privateStorage,
    {
      getFile: (input) => nodeStorage.getFile(input),
      getRow: (input) => tables.getRow(input),
      deleteRow: (input) => tables.deleteRow(input),
    },
    config.appwriteSchema,
    {
      intakeIds: parentIds,
      intakeOperationId: randomUUID(),
      attachmentOperationId: randomUUID(),
      attachmentId,
      objectId,
      stagedAt,
    },
  );
  if (idQueue.length !== 0) throw new Error("APPWRITE_G2_ID_SEQUENCE_INVALID");
  process.stdout.write(
    `${JSON.stringify({ status: "ok", environment: config.environment, ...result })}\n`,
  );
}

function safeCode(error: unknown): string {
  let current = error;
  let code = "APPWRITE_G2_FAILED";
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (/^APPWRITE_G2_[A-Z_]+$/u.test(current.message)) code = current.message;
    current = current.cause;
  }
  return code;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ status: "error", code: safeCode(error) })}\n`,
  );
  process.exitCode = 1;
});
