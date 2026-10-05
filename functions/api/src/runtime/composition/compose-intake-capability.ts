import { createHash } from "node:crypto";

import type { ServerConfig } from "@y7-feedback/config/server";

import { createAbuseGate } from "../../abuse.js";
import { createAccountlessAccessCoordinator } from "../../accountless-access.js";
import { createNodeAppwriteAbuseCounterStore } from "../../appwrite-abuse-counter-store.js";
import { createNodeAppwriteAccountlessRepository } from "../../appwrite-accountless-repository.js";
import { createAppwriteAuthoritativeCommitStore } from "../../appwrite-authoritative-commit-store.js";
import { createNodeAppwriteIntakeStore } from "../../infrastructure/appwrite/intake/appwrite-intake-store.js";
import { createNodeAppwritePublicProjectReader } from "../../infrastructure/appwrite/intake/appwrite-public-project-reader.js";
import { createAuthoritativeIntakeEnvelope } from "../../capabilities/intake/authoritative-intake-envelope.js";
import { createAuthoritativeIntakeStore } from "../../capabilities/intake/authoritative-intake-store.js";
import { createIntakeCoordinator } from "../../capabilities/intake/intake.js";
import {
  createAccessProof,
  digestValidatedDraft,
  hashAccessProof,
  matchesAccessProof,
  type ProofProtector,
} from "../../proof-crypto.js";
import type { AppwriteSensitivePersistence } from "../../sensitive-data-protector.js";
import type { ApplicationRuntime } from "./application-runtime.js";

export function composeIntakeCapability(
  config: ServerConfig,
  runtime: ApplicationRuntime,
  sensitive: AppwriteSensitivePersistence,
  proofProtector: ProofProtector,
) {
  const normalizedStore = createNodeAppwriteIntakeStore(
    runtime.tables,
    config.appwriteSchema,
    sensitive,
  );
  const authoritativeEnvelope = createAuthoritativeIntakeEnvelope(
    sensitive,
    config.appwriteSchema.authoritativeCommitsTableId,
  );
  const authoritativeCommitStore = createAppwriteAuthoritativeCommitStore(
    {
      createRow: (input) =>
        runtime.tables.createRow({ ...input, permissions: [...input.permissions] }),
      getRow: (input) => runtime.tables.getRow(input),
    },
    config.appwriteSchema,
  );
  const store =
    config.intakePersistenceMode === "authoritative"
      ? createAuthoritativeIntakeStore(
          config.environment === "preview" ? "preview" : "production",
          authoritativeCommitStore,
          authoritativeEnvelope,
        )
      : normalizedStore;
  const intake = createIntakeCoordinator(store, {
    createFeedbackId: runtime.createId,
    createReporterId: runtime.createId,
    createHistoryId: runtime.createId,
    createNotificationId: runtime.createId,
    createOutboxId: runtime.createId,
    createReference: runtime.createReference,
    createProof: createAccessProof,
    hashProof: hashAccessProof,
    sealProof: proofProtector.sealProof,
    openProof: proofProtector.openProof,
    digestPayload: (draft, grants) =>
      createHash("sha256")
        .update(digestValidatedDraft(draft))
        .update("\0")
        .update(
          JSON.stringify(
            /* v8 ignore next -- attachment grants are normalized before canonical serialization */
            grants.map(({ attachmentId, objectId, sha256 }) => ({
              attachmentId,
              objectId,
              sha256,
            })),
          ),
        )
        .digest("base64url"),
    now: runtime.nowIso,
  });
  const accountless = createAccountlessAccessCoordinator(
    createNodeAppwriteAccountlessRepository(
      runtime.tables,
      config.appwriteSchema,
      sensitive,
    ),
    {
      matchesProof: matchesAccessProof,
      rotation: { createProof: createAccessProof, hashProof: hashAccessProof },
    },
  );
  const projects = createNodeAppwritePublicProjectReader(
    runtime.tables,
    config.appwriteSchema,
  );

  /* v8 ignore start -- environment-dependent composition is exercised by Preview. */
  const abuseKeyEntries = Object.entries(config.abuseHmacKeys);
  const activeAbuseKey = config.abuseHmacKeys[config.abuseHmacActiveKeyId];
  if (!activeAbuseKey) throw new Error("ABUSE_KEYRING_INVALID");
  const previousAbuseKey = abuseKeyEntries.find(
    ([keyId]) => keyId !== config.abuseHmacActiveKeyId,
  );
  const abuse = createAbuseGate(
    createNodeAppwriteAbuseCounterStore(runtime.tables, {
      databaseId: config.appwriteSchema.databaseId,
      abuseCountersTableId: config.appwriteSchema.abuseCountersTableId,
    }),
    {
      active: {
        id: config.abuseHmacActiveKeyId,
        material: Buffer.from(activeAbuseKey, "base64url"),
      },
      ...(previousAbuseKey
        ? {
            previous: {
              id: previousAbuseKey[0],
              material: Buffer.from(previousAbuseKey[1], "base64url"),
            },
          }
        : {}),
    },
    {
      /* v8 ignore start -- composition delegates to the separately contract-tested resolver. */
      async resolve(slug) {
        const result = await projects.resolve(slug);
        if (result.kind !== "current") return { status: "denied" } as const;
        return {
          workspaceId: result.project.feedbackConfig.workspaceId,
          projectId: result.project.feedbackConfig.projectId,
        };
      },
      /* v8 ignore stop */
    },
  );
  /* v8 ignore stop */

  return {
    abuse,
    accountless,
    authoritativeCommitStore,
    authoritativeEnvelope,
    intake,
    normalizedStore,
    projects,
  };
}
