import { randomBytes, randomUUID } from "node:crypto";

import { Client, Storage, TablesDB } from "node-appwrite";

import { parseServerConfig } from "@y7-feedback/config/server";

import { createHttpApplication } from "./application.js";
import { createNodeAppwriteAttachmentAcceptanceStore } from "./appwrite-attachment-acceptance-store.js";
import {
  runAppwriteG2AttachmentMatrix,
  type AppwriteG2DeployedAttachmentFixture,
} from "./appwrite-g2-attachment-matrix.js";
import { runAppwriteG2SweeperMatrix } from "./appwrite-g2-sweeper-matrix.js";
import {
  appwriteG1SyntheticRows,
  type AppwriteG1MatrixIds,
} from "./appwrite-g1-matrix.js";
import { createNodeAppwritePrivateAttachmentStorage } from "./appwrite-private-attachment-storage.js";
import { createAttachmentDownload } from "./attachment-download.js";
import { createAttachmentSaga } from "./attachment-saga.js";
import { validateAttachment } from "./attachment-validation.js";
import { createHttpFunctionPublicApi } from "./http-function-public-api.js";
import type { PublicApi } from "./public-api.js";
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

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return isObject(error) && error.code === 404;
}

async function acceptSiblingFeedback(
  api: PublicApi,
  clientOperationId: string,
): Promise<{ readonly reference: string; readonly accessProof: string }> {
  const response = await api.handle({
    method: "POST",
    path: "/v1/projects/wisemoney/feedback",
    headers: { "content-type": "application/json" },
    body: {
      clientOperationId,
      locale: "fr",
      feedback: {
        type: "bug",
        source: { type: "bug", problem: "G2 sibling proof marker" },
        reporter: { kind: "unidentified" },
        context: [],
        attachmentNames: [],
      },
    },
  });
  if (
    response?.statusCode !== 201 ||
    !isObject(response.body) ||
    response.body.status !== "accepted" ||
    response.body.replayed !== false ||
    typeof response.body.reference !== "string" ||
    typeof response.body.accessProof !== "string"
  ) {
    throw new Error("APPWRITE_G2_SIBLING_PARENT_FAILED");
  }
  return {
    reference: response.body.reference,
    accessProof: response.body.accessProof,
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
  const siblingIds = ids(`s${suffix}`);
  const idQueue = [
    parentIds.feedbackId,
    parentIds.reporterId,
    parentIds.notificationId,
    parentIds.lifecycleId,
    parentIds.outboxId,
    siblingIds.feedbackId,
    siblingIds.reporterId,
    siblingIds.notificationId,
    siblingIds.lifecycleId,
    siblingIds.outboxId,
  ];
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId)
    .setKey(config.appwriteApiKey);
  const tables = new TablesDB(client);
  const nodeStorage = new Storage(client);
  const application = createHttpApplication(config, {
    tables,
    storage: nodeStorage,
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
  const publicApi = application.publicApi;
  if (!publicApi) throw new Error("APPWRITE_G2_API_INVALID");

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
    publicApi,
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
    async (fixture: AppwriteG2DeployedAttachmentFixture) => {
      const siblingOperationId = randomUUID();
      let failure: unknown;
      let deployedResult:
        { readonly authorizedDownload: true; readonly siblingDenied: true } | undefined;
      try {
        const siblingAccess = await acceptSiblingFeedback(
          publicApi,
          siblingOperationId,
        );
        const domain = process.env.Y7_FUNCTION_DOMAIN_URL;
        if (!domain) throw new Error("APPWRITE_G2_FUNCTION_DOMAIN_REQUIRED");
        const deployedApi = createHttpFunctionPublicApi({
          baseUrl: domain,
          fetch: globalThis.fetch,
        });
        const authorized = await deployedApi.handle({
          method: "POST",
          path: "/v1/feedback/attachments/download",
          headers: { authorization: `FeedbackProof ${fixture.accessProof}` },
          body: {
            reference: fixture.reference,
            attachmentId: fixture.attachmentId,
          },
        });
        if (
          authorized?.statusCode !== 200 ||
          !authorized.binary ||
          authorized.binary.displayName !== fixture.displayName ||
          authorized.binary.mediaType !== fixture.mediaType ||
          !Buffer.from(authorized.binary.bytes).equals(Buffer.from(fixture.bytes))
        ) {
          throw new Error("APPWRITE_G2_DEPLOYED_DOWNLOAD_FAILED");
        }
        const sibling = await deployedApi.handle({
          method: "POST",
          path: "/v1/feedback/attachments/download",
          headers: {
            authorization: `FeedbackProof ${siblingAccess.accessProof}`,
          },
          body: {
            reference: siblingAccess.reference,
            attachmentId: fixture.attachmentId,
          },
        });
        if (
          sibling?.statusCode !== 404 ||
          !isObject(sibling.body) ||
          sibling.body.error !== "ERR-ATTACHMENT-DENIED"
        ) {
          throw new Error("APPWRITE_G2_DEPLOYED_SIBLING_FAILED");
        }
        deployedResult = {
          authorizedDownload: true,
          siblingDenied: true,
        };
      } catch (error: unknown) {
        failure = error;
      }

      let cleaned = 0;
      for (const [tableId, rowId] of [
        ...appwriteG1SyntheticRows(
          config.appwriteSchema,
          siblingIds,
          siblingOperationId,
        ),
      ].reverse()) {
        try {
          await tables.deleteRow({
            databaseId: config.appwriteSchema.databaseId,
            tableId,
            rowId,
          });
          cleaned += 1;
        } catch (error: unknown) {
          if (!absent(error)) throw error;
        }
      }
      if (failure !== undefined || cleaned !== 7 || deployedResult === undefined) {
        throw new Error("APPWRITE_G2_DEPLOYED_MATRIX_FAILED", { cause: failure });
      }
      return deployedResult;
    },
  );
  if (idQueue.length !== 0) throw new Error("APPWRITE_G2_ID_SEQUENCE_INVALID");
  const sweeper = await runAppwriteG2SweeperMatrix(
    saga,
    privateStorage,
    metadata,
    {
      getFile: (input) => nodeStorage.getFile(input),
      getRow: (input) => tables.getRow(input),
      deleteRow: (input) => tables.deleteRow(input),
    },
    config.appwriteSchema,
    {
      operationId: randomUUID(),
      attachmentId: `g2a_s${suffix}`,
      associatedObjectId: `private/g2_sweep_associated_${suffix}`,
      orphanObjectId: `private/g2_sweep_orphan_${suffix}`,
      stagedAt: "2000-01-01T00:00:00.000Z",
      sweepBefore: "2000-01-01T00:00:01.000Z",
    },
  );
  process.stdout.write(
    `${JSON.stringify({ status: "ok", environment: config.environment, ...result, sweeper })}\n`,
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
