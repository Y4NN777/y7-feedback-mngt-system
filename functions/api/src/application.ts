import type { Storage, TablesDB } from "node-appwrite";
import { createHash, randomBytes } from "node:crypto";

import type { ServerConfig } from "@y7-feedback/config/server";

import { createAccountlessAccessCoordinator } from "./accountless-access.js";
import { createNodeAppwriteAccountlessRepository } from "./appwrite-accountless-repository.js";
import { createNodeAppwriteAttachmentAcceptanceStore } from "./appwrite-attachment-acceptance-store.js";
import { createNodeAppwriteIntakeStore } from "./appwrite-intake-store.js";
import { createNodeAppwritePrivateAttachmentStorage } from "./appwrite-private-attachment-storage.js";
import { createNodeAppwritePrincipalVerifier } from "./appwrite-principal-verifier.js";
import { createNodeAppwriteProjectAdministrationStore } from "./appwrite-project-administration-store.js";
import { createNodeAppwritePublicProjectReader } from "./appwrite-public-project-reader.js";
import { createNodeAppwriteWorkspaceAttachmentScopeResolver } from "./appwrite-workspace-attachment-scope.js";
import { createNodeAppwriteWorkspaceCapabilityScopeResolver } from "./appwrite-workspace-capability-scope.js";
import { createNodeAppwriteWorkspaceOwnerScopeResolver } from "./appwrite-workspace-owner-scope.js";
import { createNodeAppwriteWorkspaceProjectOperationPorts } from "./appwrite-workspace-project-ports.js";
import { createNodeAppwriteProviderGrantVault } from "./appwrite-provider-grant-vault.js";
import { createNodeAppwriteSourceConnectionStore } from "./appwrite-source-connection-store.js";
import type { HttpDependencies } from "./http.js";
import { createIntakeCoordinator } from "./intake.js";
import { createGitHubSourceProvider } from "./github-source-provider.js";
import { createGitLabSourceProvider } from "./gitlab-source-provider.js";
import { createAttachmentDownload } from "./attachment-download.js";
import {
  createAccessProof,
  createProofProtector,
  digestValidatedDraft,
  hashAccessProof,
  matchesAccessProof,
} from "./proof-crypto.js";
import { createPublicApi } from "./public-api.js";
import { createProjectAdministration } from "./project-administration.js";
import { createProjectAdministrationHttp } from "./project-administration-http.js";
import { createReporterAttachmentDownload } from "./reporter-attachment-download.js";
import { createSensitiveDataProtector } from "./sensitive-data-protector.js";
import { createSourceConnectionCoordinator } from "./source-connection-coordinator.js";
import { createSourceConnectionHttp } from "./source-connection-http.js";
import {
  createWorkspaceAttachmentDownload,
  type AppwritePrincipalVerifier,
} from "./workspace-attachment-download.js";
import { createWorkspaceProjectOperations } from "./workspace-project-operations.js";

export interface ApplicationRuntime {
  readonly tables: TablesDB;
  readonly storage: Storage;
  readonly createId: () => string;
  readonly createReference: () => string;
  readonly createCorrelationId: () => string;
  readonly nowIso: () => string;
  readonly nowMs: () => number;
  readonly startedAt: () => number;
  readonly createProviderNonce?: () => string;
  readonly digestProviderNonce?: (nonce: string) => string;
  readonly providerDiagnostic?: (event: {
    readonly provider: "github";
    readonly stage: "token_exchange" | "installations" | "repositories";
    readonly status: number;
  }) => void;
  readonly principalVerifier?: AppwritePrincipalVerifier;
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
  const principalVerifier =
    runtime.principalVerifier ??
    createNodeAppwritePrincipalVerifier({
      endpoint: config.appwriteEndpoint,
      projectId: config.appwriteProjectId,
    });
  const workspaceScopeSchema = {
    databaseId: config.appwriteSchema.databaseId,
    projectsTableId: config.appwriteSchema.projectsTableId,
    workspaceMembershipsTableId: config.appwriteSchema.workspaceMembershipsTableId,
    projectAssignmentsTableId: config.appwriteSchema.projectAssignmentsTableId,
  };
  const workspaceAttachmentDownload = createWorkspaceAttachmentDownload(
    principalVerifier,
    createNodeAppwriteWorkspaceAttachmentScopeResolver(runtime.tables, {
      ...workspaceScopeSchema,
    }),
    createAttachmentDownload(attachmentMetadata, attachmentStorage),
  );
  const workspaceScope = createNodeAppwriteWorkspaceCapabilityScopeResolver(
    runtime.tables,
    workspaceScopeSchema,
  );
  const projectAdministration = createProjectAdministrationHttp(
    createProjectAdministration(
      principalVerifier,
      createNodeAppwriteWorkspaceOwnerScopeResolver(runtime.tables, {
        databaseId: config.appwriteSchema.databaseId,
        workspaceMembershipsTableId: config.appwriteSchema.workspaceMembershipsTableId,
      }),
      createNodeAppwriteProjectAdministrationStore(runtime.tables, {
        databaseId: config.appwriteSchema.databaseId,
        projectsTableId: config.appwriteSchema.projectsTableId,
        projectSlugsTableId: config.appwriteSchema.projectSlugsTableId,
        projectAssignmentsTableId: config.appwriteSchema.projectAssignmentsTableId,
        workspaceMembershipsTableId: config.appwriteSchema.workspaceMembershipsTableId,
        administrationAuditTableId: config.appwriteSchema.administrationAuditTableId,
        administrationIdempotencyTableId:
          config.appwriteSchema.administrationIdempotencyTableId,
      }),
      {
        createAuditId: runtime.createId,
        digest: (command) =>
          createHash("sha256").update(JSON.stringify(command)).digest("base64url"),
        now: runtime.nowIso,
      },
    ),
  );
  const workspaceOperations = createWorkspaceProjectOperations(
    principalVerifier,
    workspaceScope,
    createNodeAppwriteWorkspaceProjectOperationPorts(
      runtime.tables,
      {
        databaseId: config.appwriteSchema.databaseId,
        feedbackTableId: config.appwriteSchema.feedbackTableId,
        notificationsTableId: config.appwriteSchema.notificationsTableId,
      },
      runtime.createId,
    ),
  );
  /* v8 ignore start -- provider composition is exercised by real Preview OAuth */
  const sourceConnections = config.providers
    ? createSourceConnectionHttp(
        createSourceConnectionCoordinator({
          principalVerifier,
          scopeResolver: workspaceScope,
          store: createNodeAppwriteSourceConnectionStore(runtime.tables, {
            databaseId: config.appwriteSchema.databaseId,
            sourceConnectionsTableId: config.appwriteSchema.sourceConnectionsTableId,
          }),
          providers: (() => {
            const vault = createNodeAppwriteProviderGrantVault(
              runtime.tables,
              {
                databaseId: config.appwriteSchema.databaseId,
                providerGrantsTableId: config.appwriteSchema.providerGrantsTableId,
              },
              Buffer.from(config.providerGrantEnvelopeKey, "base64url"),
            );
            return [
              createGitHubSourceProvider(
                config.providers.github,
                vault,
                globalThis.fetch,
                Date.now,
                100,
                (event) =>
                  runtime.providerDiagnostic?.({ provider: "github", ...event }),
              ),
              createGitLabSourceProvider(config.providers.gitlab, vault),
            ];
          })(),
          createStateId: runtime.createId,
          createNonce:
            runtime.createProviderNonce ??
            (() => randomBytes(24).toString("base64url")),
          digestNonce:
            runtime.digestProviderNonce ??
            ((nonce) => createHash("sha256").update(nonce).digest("base64url")),
          now: runtime.nowMs,
          nowIso: runtime.nowIso,
          ttlMs: 5 * 60 * 1_000,
        }),
        {
          github: config.providers.github.callbackUrl,
          gitlab: config.providers.gitlab.callbackUrl,
        },
      )
    : undefined;
  /* v8 ignore stop */

  return {
    createCorrelationId: runtime.createCorrelationId,
    environment: config.environment,
    now: runtime.nowMs,
    projectAdministration,
    publicApi: createPublicApi(
      projects,
      intake,
      accountless,
      reporterAttachmentDownload,
      workspaceAttachmentDownload,
      workspaceOperations,
    ),
    /* v8 ignore next -- both compositions are exercised by deployed environments */
    ...(sourceConnections === undefined ? {} : { sourceConnections }),
    release: config.release,
    startedAt: runtime.startedAt,
  };
}
