import type { Storage, TablesDB } from "node-appwrite";
import { createHash, randomBytes } from "node:crypto";

import type { ServerConfig } from "@y7-feedback/config/server";

import { createAccountlessAccessCoordinator } from "./accountless-access.js";
import { createNodeAppwriteAccountlessRepository } from "./appwrite-accountless-repository.js";
import { createNodeAppwriteAttachmentAcceptanceStore } from "./appwrite-attachment-acceptance-store.js";
import { createNodeAppwriteIntakeStore } from "./appwrite-intake-store.js";
import { createNodeAppwriteIntelligenceStore } from "./appwrite-intelligence-store.js";
import { createNodeAppwriteIntelligenceProvenanceStore } from "./appwrite-intelligence-provenance-store.js";
import { createNodeAppwritePrivacyStore } from "./appwrite-privacy-store.js";
import { createNodeAppwritePrivacyPurgeRepository } from "./appwrite-privacy-purge-repository.js";
import { createNodeAppwritePrivacyCleanup } from "./appwrite-privacy-cleanup.js";
import { createNodeAppwritePrivacyProviderCleanup } from "./appwrite-privacy-provider-cleanup.js";
import { createNodeAppwriteAbuseCounterStore } from "./appwrite-abuse-counter-store.js";
import { createNodeAppwritePrivateAttachmentStorage } from "./appwrite-private-attachment-storage.js";
import { createNodeAppwritePrincipalVerifier } from "./appwrite-principal-verifier.js";
import { createNodeAppwriteConversationLifecycleStore } from "./appwrite-conversation-lifecycle-store.js";
import { createNodeAppwriteConversationProjectionStore } from "./appwrite-conversation-projection-store.js";
import { createNodeAppwriteProjectAdministrationStore } from "./appwrite-project-administration-store.js";
import { createNodeAppwritePublicProjectReader } from "./appwrite-public-project-reader.js";
import { createNodeAppwriteWorkspaceAttachmentScopeResolver } from "./appwrite-workspace-attachment-scope.js";
import { createNodeAppwriteWorkspaceCapabilityScopeResolver } from "./appwrite-workspace-capability-scope.js";
import { createNodeAppwriteWorkspaceOwnerScopeResolver } from "./appwrite-workspace-owner-scope.js";
import { createNodeAppwriteWorkspaceProjectOperationPorts } from "./appwrite-workspace-project-ports.js";
import {
  AppwriteNotificationFeedError,
  createNodeAppwriteNotificationFeedStore,
} from "./appwrite-notification-feed-store.js";
import { createNodeAppwriteWorkbenchStore } from "./appwrite-workbench-store.js";
import { createNodeAppwriteWorkbenchMutationStore } from "./appwrite-workbench-mutation-store.js";
import { createNodeAppwriteExternalIssueStore } from "./appwrite-external-issue-store.js";
import { createNodeAppwriteProviderIssueOutboxStore } from "./appwrite-provider-issue-outbox-store.js";
import { createNodeAppwriteProviderEventInboxStore } from "./appwrite-provider-event-inbox-store.js";
import { createAppwriteProviderWebhookAuthorityStore } from "./appwrite-provider-webhook-authority-store.js";
import { createNodeAppwriteProviderIssueStateStore } from "./appwrite-provider-issue-state-store.js";
import { createNodeAppwriteReporterConsentVerifier } from "./appwrite-reporter-consent-verifier.js";
import { createNodeAppwriteProviderGrantVault } from "./appwrite-provider-grant-vault.js";
import { createNodeAppwriteSourceConnectionStore } from "./appwrite-source-connection-store.js";
import { createNodeAppwriteActiveSourceGrantReader } from "./appwrite-active-source-grant-reader.js";
import {
  createAppwriteSourceProjectSlugPort,
  createNodeAppwriteSourceManagementStore,
} from "./appwrite-source-management-store.js";
import type { HttpDependencies } from "./http.js";
import { createIntakeCoordinator } from "./intake.js";
import { createIntelligenceCoordinator } from "./intelligence.js";
import { createIntelligenceProvenanceCoordinator } from "./intelligence-provenance.js";
import { createIntelligenceHttp } from "./intelligence-http.js";
import { createPrivacyCoordinator } from "./privacy.js";
import { createPrivacyHttp } from "./privacy-http.js";
import { createPrivacyPurgeWorker } from "./privacy-cleanup.js";
import { createPrivacyProviderCleanup } from "./privacy-provider-cleanup.js";
import { createConversationLifecycleCoordinator } from "./conversation-lifecycle.js";
import { createConversationLifecycleHttp } from "./conversation-lifecycle-http.js";
import { createGitHubSourceProvider } from "./github-source-provider.js";
import { createGitLabSourceProvider } from "./gitlab-source-provider.js";
import { createGitHubIssueProvider } from "./github-issue-provider.js";
import { createGitLabIssueProvider } from "./gitlab-issue-provider.js";
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
import { createSourceManagementCoordinator } from "./source-management.js";
import {
  createWorkspaceAttachmentDownload,
  type AppwritePrincipalVerifier,
} from "./workspace-attachment-download.js";
import {
  WorkspaceOperationDeniedError,
  createWorkspaceProjectOperations,
} from "./workspace-project-operations.js";
import { createWorkbenchCoordinator } from "./workbench.js";
import { createWorkbenchHttp } from "./workbench-http.js";
import { createExternalIssueCoordinator } from "./external-issue-coordination.js";
import { createExternalIssueHttp } from "./external-issue-http.js";
import { createProviderIssueOutboxWorker } from "./provider-issue-outbox.js";
import { createProviderIssueOutboxHttp } from "./provider-issue-outbox-http.js";
import { createProviderWebhookIngress } from "./provider-webhook-ingress.js";
import { createProviderWebhookHttp } from "./provider-webhook-http.js";
import { createProviderWebhookProvisioner } from "./provider-webhook-provisioner.js";
import { createProviderIssueEventHandler } from "./provider-issue-event.js";
import { createProviderEventInboxWorker } from "./provider-event-inbox.js";
import { createProviderEventInboxHttp } from "./provider-event-inbox-http.js";
import { createProviderMaintenance } from "./provider-maintenance.js";
import { createProviderWebhookReconciliation } from "./provider-webhook-reconciliation.js";
import { createAbuseGate } from "./abuse.js";

export function digestExternalIssueCommand(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}

export function createProtectedFeedbackUrl(
  webOrigin: string,
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly feedbackId: string;
  },
): string {
  const query = new URLSearchParams(input);
  return `${webOrigin}/workbench?${query.toString()}`;
}

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
    readonly stage:
      "token_exchange" | "installations" | "repositories" | "metadata" | "releases";
    readonly status: number;
  }) => void;
  readonly principalVerifier?: AppwritePrincipalVerifier;
}

export function deriveReporterActorId(reference: string): string {
  return `reporter_${createHash("sha256").update(reference).digest("hex").slice(0, 27)}`;
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
      async resolve(slug) {
        const result = await projects.resolve(slug);
        if (result.kind !== "current") return { status: "denied" } as const;
        return {
          workspaceId: result.project.feedbackConfig.workspaceId,
          projectId: result.project.feedbackConfig.projectId,
        };
      },
    },
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
  const intelligence = createIntelligenceHttp(
    createIntelligenceCoordinator(
      principalVerifier,
      workspaceScope,
      createNodeAppwriteIntelligenceStore(
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          feedbackTableId: config.appwriteSchema.feedbackTableId,
          reportersTableId: config.appwriteSchema.reportersTableId,
        },
        sensitive,
      ),
    ),
    createIntelligenceProvenanceCoordinator(
      principalVerifier,
      workspaceScope,
      createNodeAppwriteIntelligenceProvenanceStore(
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          feedbackTableId: config.appwriteSchema.feedbackTableId,
          provenanceTableId: config.appwriteSchema.intelligenceProvenanceTableId,
        },
        sensitive,
        {
          createAssociationId: runtime.createId,
          createEventId: runtime.createId,
          now: runtime.nowIso,
        },
      ),
    ),
  );
  /* v8 ignore start -- privacy composition is exercised by verify:appwrite:g4:privacy. */
  const privacy = createPrivacyHttp(
    createPrivacyCoordinator(
      principalVerifier,
      workspaceScope,
      {
        authorize: async ({ reference, proof }) => {
          const outcome = await accountless.authorize({ reference, proof });
          return outcome.status === "ok"
            ? { status: "authorized" as const, feedbackId: outcome.feedbackId }
            : outcome.status === "denied"
              ? { status: "denied" as const }
              : { status: "retryable" as const };
        },
      },
      createNodeAppwritePrivacyStore(
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          feedbackTableId: config.appwriteSchema.feedbackTableId,
          reportersTableId: config.appwriteSchema.reportersTableId,
          accessGrantsTableId: config.appwriteSchema.accessGrantsTableId,
          attachmentsTableId: config.appwriteSchema.attachmentsTableId,
          notificationsTableId: config.appwriteSchema.notificationsTableId,
          publicationConsentsTableId: config.appwriteSchema.publicationConsentsTableId,
          externalIssueLinksTableId: config.appwriteSchema.externalIssueLinksTableId,
          providerOutboxTableId: config.appwriteSchema.providerOutboxTableId,
          providerSyncOutboxTableId: config.appwriteSchema.providerSyncOutboxTableId,
          offlineConflictProjectionsTableId:
            config.appwriteSchema.offlineConflictProjectionsTableId,
          intelligenceProvenanceTableId:
            config.appwriteSchema.intelligenceProvenanceTableId,
          deletionRecordsTableId: config.appwriteSchema.deletionRecordsTableId,
        },
        sensitive,
        {
          createId: runtime.createId,
          createEventId: runtime.createId,
          now: runtime.nowIso,
        },
      ),
      (value) => createHash("sha256").update(value).digest("base64url"),
    ),
  );
  /* v8 ignore stop */
  const workbench = createWorkbenchHttp(
    createWorkbenchCoordinator(
      principalVerifier,
      workspaceScope,
      createNodeAppwriteWorkbenchStore(
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          feedbackTableId: config.appwriteSchema.feedbackTableId,
        },
        sensitive,
      ),
      createNodeAppwriteWorkbenchMutationStore(
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          feedbackTableId: config.appwriteSchema.feedbackTableId,
          idempotencyTableId: config.appwriteSchema.conversationIdempotencyTableId,
          projectAssignmentsTableId: config.appwriteSchema.projectAssignmentsTableId,
          accessGrantsTableId: config.appwriteSchema.accessGrantsTableId,
          reportersTableId: config.appwriteSchema.reportersTableId,
          workspaceMembershipsTableId:
            config.appwriteSchema.workspaceMembershipsTableId,
          notificationsTableId: config.appwriteSchema.notificationsTableId,
          notificationSignalsTableId: config.appwriteSchema.notificationSignalsTableId,
          outboxTableId: config.appwriteSchema.outboxTableId,
        },
        sensitive,
      ),
      {
        /* v8 ignore next -- composition callback is exercised by deployed mutations */
        digest: (command) =>
          createHash("sha256").update(JSON.stringify(command)).digest("base64url"),
        now: runtime.nowIso,
      },
    ),
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
  const workspaceProjectPorts = createNodeAppwriteWorkspaceProjectOperationPorts(
    runtime.tables,
    {
      databaseId: config.appwriteSchema.databaseId,
      feedbackTableId: config.appwriteSchema.feedbackTableId,
      notificationsTableId: config.appwriteSchema.notificationsTableId,
      notificationSignalsTableId: config.appwriteSchema.notificationSignalsTableId,
    },
    runtime.createId,
  );
  const notificationFeed = createNodeAppwriteNotificationFeedStore(runtime.tables, {
    databaseId: config.appwriteSchema.databaseId,
    feedbackTableId: config.appwriteSchema.feedbackTableId,
    notificationsTableId: config.appwriteSchema.notificationsTableId,
  });
  /* v8 ignore start -- denial translation is exercised by the deployed removal matrix */
  const translateNotificationDenial = async <Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        error instanceof AppwriteNotificationFeedError &&
        error.code === "ERR-NOT-DENIED"
      )
        throw new WorkspaceOperationDeniedError();
      throw error;
    }
  };
  /* v8 ignore stop */
  const workspaceOperations = createWorkspaceProjectOperations(
    principalVerifier,
    workspaceScope,
    {
      ...workspaceProjectPorts,
      notifications: {
        /* v8 ignore next -- composition callback is exercised by deployed feed matrix */
        list: (scope, actor) =>
          translateNotificationDenial(() =>
            notificationFeed.list({
              actor,
              workspaceId: scope.workspaceId,
              projectId: scope.projectId,
            }),
          ),
        /* v8 ignore next -- composition callback is exercised by deployed read matrix */
        markRead: (scope, actor, notificationId) =>
          translateNotificationDenial(() =>
            notificationFeed.markRead({
              actor,
              workspaceId: scope.workspaceId,
              projectId: scope.projectId,
              notificationId,
              readAt: runtime.nowIso(),
            }),
          ),
      },
    },
  );
  const conversationLifecycle = createConversationLifecycleHttp(
    createConversationLifecycleCoordinator(
      principalVerifier,
      workspaceScope,
      accountless,
      createNodeAppwriteConversationLifecycleStore(
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          feedbackTableId: config.appwriteSchema.feedbackTableId,
          messagesTableId: config.appwriteSchema.conversationMessagesTableId,
          internalNotesTableId: config.appwriteSchema.conversationInternalNotesTableId,
          lifecycleTableId: config.appwriteSchema.conversationLifecycleTableId,
          idempotencyTableId: config.appwriteSchema.conversationIdempotencyTableId,
          accessGrantsTableId: config.appwriteSchema.accessGrantsTableId,
          reportersTableId: config.appwriteSchema.reportersTableId,
          workspaceMembershipsTableId:
            config.appwriteSchema.workspaceMembershipsTableId,
          projectAssignmentsTableId: config.appwriteSchema.projectAssignmentsTableId,
          notificationsTableId: config.appwriteSchema.notificationsTableId,
          notificationSignalsTableId: config.appwriteSchema.notificationSignalsTableId,
          outboxTableId: config.appwriteSchema.outboxTableId,
        },
        sensitive,
      ),
      createNodeAppwriteConversationProjectionStore(
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          feedbackTableId: config.appwriteSchema.feedbackTableId,
          messagesTableId: config.appwriteSchema.conversationMessagesTableId,
          internalNotesTableId: config.appwriteSchema.conversationInternalNotesTableId,
          lifecycleTableId: config.appwriteSchema.conversationLifecycleTableId,
        },
        sensitive,
      ),
      {
        digest: (command) =>
          createHash("sha256").update(JSON.stringify(command)).digest("base64url"),
        now: runtime.nowIso,
        reporterActorId: deriveReporterActorId,
      },
    ),
  );
  const externalIssue = createExternalIssueHttp(
    createExternalIssueCoordinator({
      principalVerifier,
      scopeResolver: workspaceScope,
      reporterProofVerifier: createNodeAppwriteReporterConsentVerifier(
        accountless,
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          feedbackTableId: config.appwriteSchema.feedbackTableId,
        },
      ),
      persistence: createNodeAppwriteExternalIssueStore(
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          feedbackTableId: config.appwriteSchema.feedbackTableId,
          accessGrantsTableId: config.appwriteSchema.accessGrantsTableId,
          sourceConnectionsTableId: config.appwriteSchema.sourceConnectionsTableId,
          publicationConsentsTableId: config.appwriteSchema.publicationConsentsTableId,
          externalIssueLinksTableId: config.appwriteSchema.externalIssueLinksTableId,
          providerOutboxTableId: config.appwriteSchema.providerOutboxTableId,
        },
        sensitive,
      ),
      digest: digestExternalIssueCommand,
      feedbackUrl: createProtectedFeedbackUrl.bind(null, config.webOrigin),
      now: runtime.nowIso,
    }),
  );
  /* v8 ignore start -- provider composition is exercised by real Preview OAuth */
  const sourceConnections = config.providers
    ? (() => {
        const vault = createNodeAppwriteProviderGrantVault(
          runtime.tables,
          {
            databaseId: config.appwriteSchema.databaseId,
            providerGrantsTableId: config.appwriteSchema.providerGrantsTableId,
          },
          Buffer.from(config.providerGrantEnvelopeKey, "base64url"),
        );
        const providers = [
          createGitHubSourceProvider(
            config.providers.github,
            vault,
            globalThis.fetch,
            Date.now,
            100,
            (event) => runtime.providerDiagnostic?.({ provider: "github", ...event }),
          ),
          createGitLabSourceProvider(config.providers.gitlab, vault),
        ] as const;
        const webhookAuthority = createAppwriteProviderWebhookAuthorityStore(
          runtime.tables,
          {
            databaseId: config.appwriteSchema.databaseId,
            sourceConnectionsTableId: config.appwriteSchema.sourceConnectionsTableId,
            providerGrantsTableId: config.appwriteSchema.providerGrantsTableId,
          },
          sensitive,
        );
        const webhookBase = (callbackUrl: string, provider: "github" | "gitlab") => {
          const origin = new URL(callbackUrl).origin;
          return `${origin}/providers/${provider}/webhooks/`;
        };
        return createSourceConnectionHttp(
          createSourceConnectionCoordinator({
            principalVerifier,
            scopeResolver: workspaceScope,
            store: createNodeAppwriteSourceConnectionStore(runtime.tables, {
              databaseId: config.appwriteSchema.databaseId,
              sourceConnectionsTableId: config.appwriteSchema.sourceConnectionsTableId,
            }),
            providers,
            webhooks: createProviderWebhookProvisioner(
              {
                githubApiOrigin: "https://api.github.com/",
                gitlabOrigin: config.providers.gitlab.origin,
                callbackBaseUrls: {
                  github: webhookBase(config.providers.github.callbackUrl, "github"),
                  gitlab: webhookBase(config.providers.gitlab.callbackUrl, "gitlab"),
                },
              },
              vault,
              webhookAuthority,
              () => randomBytes(32).toString("base64url"),
            ),
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
          createSourceManagementCoordinator({
            principalVerifier,
            scopeResolver: workspaceScope,
            store: createNodeAppwriteSourceManagementStore(runtime.tables, {
              databaseId: config.appwriteSchema.databaseId,
              sourceConnectionsTableId: config.appwriteSchema.sourceConnectionsTableId,
            }),
            providers,
            projectSlug: createAppwriteSourceProjectSlugPort(
              (input) => runtime.tables.getRow(input),
              {
                databaseId: config.appwriteSchema.databaseId,
                projectsTableId: config.appwriteSchema.projectsTableId,
              },
            ),
            nowIso: runtime.nowIso,
          }),
        );
      })()
    : undefined;
  const providerIssueOutboxWorker =
    config.providers && config.providerOutboxTriggerSecret
      ? (() => {
          const vault = createNodeAppwriteProviderGrantVault(
            runtime.tables,
            {
              databaseId: config.appwriteSchema.databaseId,
              providerGrantsTableId: config.appwriteSchema.providerGrantsTableId,
            },
            Buffer.from(config.providerGrantEnvelopeKey, "base64url"),
          );
          return createProviderIssueOutboxWorker({
            workerId: `${config.environment}-provider-worker`,
            store: createNodeAppwriteProviderIssueOutboxStore(runtime.tables, {
              databaseId: config.appwriteSchema.databaseId,
              providerOutboxTableId: config.appwriteSchema.providerOutboxTableId,
              externalIssueLinksTableId:
                config.appwriteSchema.externalIssueLinksTableId,
              sourceConnectionsTableId: config.appwriteSchema.sourceConnectionsTableId,
            }),
            providers: [
              createGitHubIssueProvider(vault),
              createGitLabIssueProvider(config.providers.gitlab.origin, vault),
            ],
            now: () => new Date(runtime.nowIso()),
            staleAfterMs: 5 * 60 * 1_000,
            maximumAttempts: 5,
            retryDelayMs: (attempt) => 2 ** attempt * 1_000,
          });
        })()
      : undefined;
  const providerIssueOutbox =
    providerIssueOutboxWorker && config.providerOutboxTriggerSecret
      ? createProviderIssueOutboxHttp(
          providerIssueOutboxWorker,
          config.providerOutboxTriggerSecret,
        )
      : undefined;
  const providerWebhookAuthority = createAppwriteProviderWebhookAuthorityStore(
    runtime.tables,
    {
      databaseId: config.appwriteSchema.databaseId,
      sourceConnectionsTableId: config.appwriteSchema.sourceConnectionsTableId,
      providerGrantsTableId: config.appwriteSchema.providerGrantsTableId,
    },
    sensitive,
  );
  const providerWebhookInbox = createNodeAppwriteProviderEventInboxStore(
    runtime.tables,
    {
      databaseId: config.appwriteSchema.databaseId,
      providerEventInboxTableId: config.appwriteSchema.providerEventInboxTableId,
    },
    sensitive,
    { createId: runtime.createId },
  );
  const providerWebhook = createProviderWebhookHttp(
    createProviderWebhookIngress({
      authorities: providerWebhookAuthority,
      inbox: providerWebhookInbox,
      now: () => new Date(runtime.nowIso()),
    }),
  );
  const providerEventInboxWorker = config.providerOutboxTriggerSecret
    ? createProviderEventInboxWorker({
        store: providerWebhookInbox,
        handler: createProviderIssueEventHandler(
          createNodeAppwriteProviderIssueStateStore(runtime.tables, {
            databaseId: config.appwriteSchema.databaseId,
            externalIssueLinksTableId: config.appwriteSchema.externalIssueLinksTableId,
          }),
        ),
        workerId: "provider-event-worker",
        now: () => new Date(runtime.nowIso()),
        staleAfterMs: 5 * 60 * 1_000,
        maximumAttempts: 5,
        retryDelayMs: (attempt) => 2 ** attempt * 1_000,
      })
    : undefined;
  const providerEventInbox =
    providerEventInboxWorker && config.providerOutboxTriggerSecret
      ? createProviderEventInboxHttp(
          providerEventInboxWorker,
          config.providerOutboxTriggerSecret,
        )
      : undefined;
  const privacyPurgeWorker = createPrivacyPurgeWorker(
    createNodeAppwritePrivacyPurgeRepository(
      runtime.tables,
      {
        databaseId: config.appwriteSchema.databaseId,
        deletionRecordsTableId: config.appwriteSchema.deletionRecordsTableId,
      },
      sensitive,
      {
        createEventId: runtime.createId,
        workerDigest: (workerId) =>
          createHash("sha256").update(workerId).digest("base64url"),
      },
    ),
    [
      createNodeAppwritePrivacyCleanup(runtime.tables, runtime.storage, {
        databaseId: config.appwriteSchema.databaseId,
        attachmentBucketId: config.appwriteSchema.attachmentBucketId,
        feedbackTableId: config.appwriteSchema.feedbackTableId,
        reportersTableId: config.appwriteSchema.reportersTableId,
        accessGrantsTableId: config.appwriteSchema.accessGrantsTableId,
        attachmentsTableId: config.appwriteSchema.attachmentsTableId,
        attachmentStagingTableId: config.appwriteSchema.attachmentStagingTableId,
        lifecycleTableId: config.appwriteSchema.lifecycleTableId,
        notificationsTableId: config.appwriteSchema.notificationsTableId,
        conversationMessagesTableId: config.appwriteSchema.conversationMessagesTableId,
        conversationInternalNotesTableId:
          config.appwriteSchema.conversationInternalNotesTableId,
        conversationIdempotencyTableId:
          config.appwriteSchema.conversationIdempotencyTableId,
        conversationLifecycleTableId:
          config.appwriteSchema.conversationLifecycleTableId,
        publicationConsentsTableId: config.appwriteSchema.publicationConsentsTableId,
        externalIssueLinksTableId: config.appwriteSchema.externalIssueLinksTableId,
        providerOutboxTableId: config.appwriteSchema.providerOutboxTableId,
        providerSyncOutboxTableId: config.appwriteSchema.providerSyncOutboxTableId,
        offlineConflictProjectionsTableId:
          config.appwriteSchema.offlineConflictProjectionsTableId,
        intelligenceProvenanceTableId:
          config.appwriteSchema.intelligenceProvenanceTableId,
      }),
    ],
    {
      workerId: `${config.environment}-privacy-worker`,
      batchSize: 25,
      now: runtime.nowIso,
      createOperationId: (deletionId) =>
        `privacy_purge_${createHash("sha256").update(deletionId).digest("hex").slice(0, 24)}`,
    },
  );
  const providerMaintenance = (() => {
    if (config.providers && providerIssueOutboxWorker && providerEventInboxWorker) {
      const vault = createNodeAppwriteProviderGrantVault(
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          providerGrantsTableId: config.appwriteSchema.providerGrantsTableId,
        },
        Buffer.from(config.providerGrantEnvelopeKey, "base64url"),
      );
      const webhookBase = (callbackUrl: string, provider: "github" | "gitlab") => {
        const origin = new URL(callbackUrl).origin;
        return `${origin}/providers/${provider}/webhooks/`;
      };
      const webhooks = createProviderWebhookProvisioner(
        {
          githubApiOrigin: "https://api.github.com/",
          gitlabOrigin: config.providers.gitlab.origin,
          callbackBaseUrls: {
            github: webhookBase(config.providers.github.callbackUrl, "github"),
            gitlab: webhookBase(config.providers.gitlab.callbackUrl, "gitlab"),
          },
        },
        vault,
        providerWebhookAuthority,
        () => randomBytes(32).toString("base64url"),
      );
      const privacyProviderPorts = createNodeAppwritePrivacyProviderCleanup(
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          externalIssueLinksTableId: config.appwriteSchema.externalIssueLinksTableId,
          sourceConnectionsTableId: config.appwriteSchema.sourceConnectionsTableId,
          providerGrantsTableId: config.appwriteSchema.providerGrantsTableId,
        },
        {
          providerGrantEnvelopeKey: config.providerGrantEnvelopeKey,
          gitlabOrigin: config.providers.gitlab.origin,
        },
      );
      const privacyProviderCleanup = createPrivacyProviderCleanup(
        privacyProviderPorts.store,
        privacyProviderPorts.closer,
        { limit: 25, now: runtime.nowIso },
      );
      return createProviderMaintenance({
        inbox: providerEventInboxWorker,
        outbox: providerIssueOutboxWorker,
        privacy: {
          async runOnce() {
            const providerCleanup = await privacyProviderCleanup.runOnce();
            if (providerCleanup.failed > 0)
              throw new Error("PRIVACY_PROVIDER_CLEANUP_RETRYABLE");
            const purge = await privacyPurgeWorker.runOnce();
            return { status: "completed", purge, providerCleanup };
          },
        },
        webhooks: createProviderWebhookReconciliation(
          createNodeAppwriteActiveSourceGrantReader(runtime.tables, {
            databaseId: config.appwriteSchema.databaseId,
            sourceConnectionsTableId: config.appwriteSchema.sourceConnectionsTableId,
          }),
          webhooks,
          25,
          runtime.nowIso,
        ),
      });
    }
    return createProviderMaintenance({ privacy: privacyPurgeWorker });
  })();
  /* v8 ignore stop */

  return {
    abuse,
    createCorrelationId: runtime.createCorrelationId,
    environment: config.environment,
    intelligence,
    privacy,
    conversationLifecycle,
    externalIssue,
    now: runtime.nowMs,
    projectAdministration,
    providerWebhook,
    /* v8 ignore next -- optional composition is covered by configuration parsing. */
    ...(providerEventInbox === undefined ? {} : { providerEventInbox }),
    providerMaintenance,
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
    /* v8 ignore next -- provider worker composition requires deployed provider authority */
    ...(providerIssueOutbox === undefined ? {} : { providerIssueOutbox }),
    release: config.release,
    startedAt: runtime.startedAt,
    workbench,
  };
}
