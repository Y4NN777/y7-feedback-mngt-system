import type { TablesDB } from "node-appwrite";

import type { ServerConfig } from "@y7-feedback/config/server";

import { createAccountlessAccessCoordinator } from "./accountless-access";
import { createNodeAppwriteAccountlessRepository } from "./appwrite-accountless-repository";
import { createNodeAppwriteIntakeStore } from "./appwrite-intake-store";
import { createNodeAppwritePublicProjectReader } from "./appwrite-public-project-reader";
import type { HttpDependencies } from "./http";
import { createIntakeCoordinator } from "./intake";
import {
  createAccessProof,
  createProofProtector,
  digestValidatedDraft,
  hashAccessProof,
  matchesAccessProof,
} from "./proof-crypto";
import { createPublicApi } from "./public-api";

export interface ApplicationRuntime {
  readonly tables: TablesDB;
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
  const intakeStore = createNodeAppwriteIntakeStore(
    runtime.tables,
    config.appwriteSchema,
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

  return {
    createCorrelationId: runtime.createCorrelationId,
    environment: config.environment,
    now: runtime.nowMs,
    publicApi: createPublicApi(projects, intake, accountless),
    release: config.release,
    startedAt: runtime.startedAt,
  };
}
