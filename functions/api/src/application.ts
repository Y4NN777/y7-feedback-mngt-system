import type { Storage, TablesDB } from "node-appwrite";

import type { ServerConfig } from "@y7-feedback/config/server";

import { createAccountlessAccessCoordinator } from "./accountless-access.js";
import { createNodeAppwriteAccountlessRepository } from "./appwrite-accountless-repository.js";
import { createNodeAppwriteAttachmentAcceptanceStore } from "./appwrite-attachment-acceptance-store.js";
import { createNodeAppwriteIntakeStore } from "./appwrite-intake-store.js";
import { createNodeAppwritePrivateAttachmentStorage } from "./appwrite-private-attachment-storage.js";
import { createNodeAppwritePublicProjectReader } from "./appwrite-public-project-reader.js";
import type { HttpDependencies } from "./http.js";
import { createIntakeCoordinator } from "./intake.js";
import { createAttachmentDownload } from "./attachment-download.js";
import {
  createAccessProof,
  createProofProtector,
  digestValidatedDraft,
  hashAccessProof,
  matchesAccessProof,
} from "./proof-crypto.js";
import { createPublicApi } from "./public-api.js";
import { createReporterAttachmentDownload } from "./reporter-attachment-download.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";

export interface ApplicationRuntime {
  readonly tables: TablesDB;
  readonly storage: Storage;
  readonly createId: () => string;
  readonly createReference: () => string;
  readonly createCorrelationId: () => string;
  readonly nowIso: () => string;
  readonly nowMs: () => number;
  readonly startedAt: () => number;
}

export function createHttpApplication(
  config: ServerConfig,
  runtime: ApplicationRuntime,
): HttpDependencies {
  const protector = createProofProtector(
    Buffer.from(config.accessProofEnvelopeKey, "base64url"),
  );
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
  const intakeStore = createNodeAppwriteIntakeStore(
    runtime.tables,
    config.appwriteSchema,
    sensitive,
  );
  const intake = createIntakeCoordinator(intakeStore, {
    createFeedbackId: runtime.createId,
    createReporterId: runtime.createId,
    createHistoryId: runtime.createId,
    createNotificationId: runtime.createId,
    createOutboxId: runtime.createId,
    createReference: runtime.createReference,
    createProof: createAccessProof,
    hashProof: hashAccessProof,
    sealProof: protector.sealProof,
    openProof: protector.openProof,
    digestPayload: digestValidatedDraft,
    now: runtime.nowIso,
  });
  const accountlessRepository = createNodeAppwriteAccountlessRepository(
    runtime.tables,
    config.appwriteSchema,
    sensitive,
  );
  const accountless = createAccountlessAccessCoordinator(accountlessRepository, {
    matchesProof: matchesAccessProof,
    rotation: {
      createProof: createAccessProof,
      hashProof: hashAccessProof,
    },
  });
  const projects = createNodeAppwritePublicProjectReader(
    runtime.tables,
    config.appwriteSchema,
  );
  const attachmentMetadata = createNodeAppwriteAttachmentAcceptanceStore(
    runtime.tables,
    {
      databaseId: config.appwriteSchema.databaseId,
      stagingTableId: config.appwriteSchema.attachmentStagingTableId,
      attachmentsTableId: config.appwriteSchema.attachmentsTableId,
    },
    sensitive,
  );
  const attachmentStorage = createNodeAppwritePrivateAttachmentStorage(
    runtime.storage,
    runtime.tables,
    {
      bucketId: config.appwriteSchema.attachmentBucketId,
      databaseId: config.appwriteSchema.databaseId,
      stagingTableId: config.appwriteSchema.attachmentStagingTableId,
    },
  );
  const reporterAttachmentDownload = createReporterAttachmentDownload(
    accountless,
    createAttachmentDownload(attachmentMetadata, attachmentStorage),
  );

  return {
    createCorrelationId: runtime.createCorrelationId,
    environment: config.environment,
    now: runtime.nowMs,
    publicApi: createPublicApi(
      projects,
      intake,
      accountless,
      reporterAttachmentDownload,
    ),
    release: config.release,
    startedAt: runtime.startedAt,
  };
}
