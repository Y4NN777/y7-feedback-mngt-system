import { createHash, randomBytes } from "node:crypto";

import type { ServerConfig } from "@y7-feedback/config/server";

import { createNodeAppwriteAuthoritativeProjectionStore } from "../../appwrite-authoritative-projection-store.js";
import { createAuthoritativeIntakeProjectionHandler } from "../../capabilities/intake/authoritative-intake-projector.js";
import { createAuthoritativeConversationEnvelope } from "../../authoritative-conversation-envelope.js";
import {
  authoritativeProjectionErrorCode,
  createAuthoritativeConversationProjectionHandler,
} from "../../authoritative-conversation-projector.js";
import { createAuthoritativeProjector } from "../../authoritative-projector.js";
import { drainAuthoritativeProjectionEvent } from "../../authoritative-projection-event.js";
import { createAuthoritativeProjectionRouter } from "../../authoritative-projection-router.js";
import { createNodeAppwriteOutboxStore } from "../../appwrite-outbox-store.js";
import { createNodeAppwriteNotificationRecipientResolver } from "../../appwrite-notification-recipient-resolver.js";
import { createNodeAppwritePrivacyPurgeRepository } from "../../appwrite-privacy-purge-repository.js";
import { createNodeAppwritePrivacyCleanup } from "../../appwrite-privacy-cleanup.js";
import { createNodeAppwritePrivacyProviderCleanup } from "../../appwrite-privacy-provider-cleanup.js";
import { createNodeAppwriteConversationLifecycleStore } from "../../appwrite-conversation-lifecycle-store.js";
import { createNodeAppwriteExternalIssueStore } from "../../appwrite-external-issue-store.js";
import { createNodeAppwriteProviderIssueOutboxStore } from "../../appwrite-provider-issue-outbox-store.js";
import { createNodeAppwriteProviderEventInboxStore } from "../../appwrite-provider-event-inbox-store.js";
import { createAppwriteProviderWebhookAuthorityStore } from "../../appwrite-provider-webhook-authority-store.js";
import { createNodeAppwriteProviderIssueStateStore } from "../../appwrite-provider-issue-state-store.js";
import { createNodeAppwriteProviderMessageStore } from "../../appwrite-provider-message-store.js";
import { createNodeAppwriteProviderMessageFanout } from "../../appwrite-provider-message-fanout.js";
import { createNodeAppwriteProviderConsentCleanup } from "../../appwrite-provider-consent-cleanup.js";
import { createNodeAppwriteReporterConsentVerifier } from "../../appwrite-reporter-consent-verifier.js";
import { createNodeAppwriteProviderGrantVault } from "../../appwrite-provider-grant-vault.js";
import { createNodeAppwriteActiveSourceGrantReader } from "../../appwrite-active-source-grant-reader.js";
import { createPrivacyPurgeWorker } from "../../privacy-cleanup.js";
import { createPrivacyProviderCleanup } from "../../privacy-provider-cleanup.js";
import { createGitHubIssueProvider } from "../../github-issue-provider.js";
import { createGitLabIssueProvider } from "../../gitlab-issue-provider.js";
import { createProviderSourceHttp } from "../../provider-source-composition.js";
import { createExternalIssueCoordinator } from "../../external-issue-coordination.js";
import { createExternalIssueHttp } from "../../external-issue-http.js";
import { createProviderIssueOutboxWorker } from "../../provider-issue-outbox.js";
import { createProviderIssueOutboxHttp } from "../../provider-issue-outbox-http.js";
import { createProviderWebhookIngress } from "../../provider-webhook-ingress.js";
import { createProviderWebhookHttp } from "../../provider-webhook-http.js";
import { createProviderWebhookProvisioner } from "../../provider-webhook-provisioner.js";
import { createProviderIssueEventHandler } from "../../provider-issue-event.js";
import { createProviderMessageAuthorVerifier } from "../../provider-message-authority.js";
import { createProviderMessageEventHandler } from "../../provider-message-event.js";
import { createProviderEventInboxWorker } from "../../provider-event-inbox.js";
import { createProviderEventInboxHttp } from "../../provider-event-inbox-http.js";
import {
  createProviderMaintenance,
  type ProviderMaintenanceCapability,
} from "../../provider-maintenance.js";
import { createProviderWebhookReconciliation } from "../../provider-webhook-reconciliation.js";
import { createNodeAppwriteProviderMessageOutboxStore } from "../../appwrite-provider-message-outbox-store.js";
import { createProviderMessageOutboxWorker } from "../../provider-message-outbox.js";
import { createGitHubMessageProvider } from "../../github-message-provider.js";
import { createGitLabMessageProvider } from "../../gitlab-message-provider.js";
import { createNodeAppwriteProviderMessageReconciliationReader } from "../../appwrite-provider-message-reconciliation-reader.js";
import { createProviderMessageReconciliation } from "../../provider-message-reconciliation.js";
import { createOutboxWorker } from "../../outbox.js";
import { createNodeSmtpNotificationSender } from "../../smtp-notification-node.js";
import {
  createProtectedFeedbackUrl,
  digestExternalIssueCommand,
  type ApplicationRuntime,
} from "./application-runtime.js";

import type { AccountlessAccessCoordinator } from "../../accountless-access.js";
import type { createNodeAppwriteIntakeStore } from "../../infrastructure/appwrite/intake/appwrite-intake-store.js";
import type { createNodeAppwritePlatformAccessExpiryWorker } from "../../appwrite-platform-access-store.js";
import type { WorkspaceCapabilityScopeResolver } from "../../appwrite-workspace-capability-scope.js";
import type { createAuthoritativeIntakeEnvelope } from "../../capabilities/intake/authoritative-intake-envelope.js";
import type { AppwriteSensitivePersistence } from "../../sensitive-data-protector.js";
import type { AppwritePrincipalVerifier } from "../../capabilities/attachments/workspace-attachment-download.js";

interface ProviderCompositionContext {
  readonly accountless: AccountlessAccessCoordinator;
  readonly authoritativeEnvelope: ReturnType<typeof createAuthoritativeIntakeEnvelope>;
  readonly config: ServerConfig;
  readonly normalizedIntakeStore: ReturnType<typeof createNodeAppwriteIntakeStore>;
  readonly platformExpiry:
    ReturnType<typeof createNodeAppwritePlatformAccessExpiryWorker> | undefined;
  readonly principalVerifier: AppwritePrincipalVerifier;
  readonly runtime: ApplicationRuntime;
  readonly sensitive: AppwriteSensitivePersistence;
  readonly workspaceScope: WorkspaceCapabilityScopeResolver;
}

export function composeProviderCapability({
  accountless,
  authoritativeEnvelope,
  config,
  normalizedIntakeStore,
  platformExpiry,
  principalVerifier,
  runtime,
  sensitive,
  workspaceScope,
}: ProviderCompositionContext) {
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
      consentCleanup: createNodeAppwriteProviderConsentCleanup(
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          externalIssueLinksTableId: config.appwriteSchema.externalIssueLinksTableId,
          providerSyncOutboxTableId: config.appwriteSchema.providerSyncOutboxTableId,
        },
        sensitive,
      ),
    }),
  );
  const sourceConnections = config.providers
    ? createProviderSourceHttp({
        config: { ...config, providers: config.providers },
        runtime,
        principalVerifier,
        scopeResolver: workspaceScope,
        sensitive,
      })
    : undefined;
  /* v8 ignore start -- provider workers require live grants; source wiring is contract-tested separately */
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
  const providerMessageOutboxWorker =
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
          return createProviderMessageOutboxWorker({
            workerId: `${config.environment}-message-worker`,
            store: createNodeAppwriteProviderMessageOutboxStore(
              runtime.tables,
              {
                databaseId: config.appwriteSchema.databaseId,
                providerSyncOutboxTableId:
                  config.appwriteSchema.providerSyncOutboxTableId,
                externalIssueLinksTableId:
                  config.appwriteSchema.externalIssueLinksTableId,
                sourceConnectionsTableId:
                  config.appwriteSchema.sourceConnectionsTableId,
              },
              sensitive,
            ),
            providers: [
              createGitHubMessageProvider(vault),
              createGitLabMessageProvider(config.providers.gitlab.origin, vault),
            ],
            now: () => new Date(runtime.nowIso()),
            staleAfterMs: 5 * 60 * 1_000,
            maximumAttempts: 5,
            retryDelayMs: (attempt) => 2 ** attempt * 1_000,
          });
        })()
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
  const providerEventInboxWorker =
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
          const messages = createNodeAppwriteProviderMessageStore(
            runtime.tables,
            {
              databaseId: config.appwriteSchema.databaseId,
              sourceConnectionsTableId: config.appwriteSchema.sourceConnectionsTableId,
              externalIssueLinksTableId:
                config.appwriteSchema.externalIssueLinksTableId,
              conversationMessagesTableId:
                config.appwriteSchema.conversationMessagesTableId,
            },
            sensitive,
          );
          return createProviderEventInboxWorker({
            store: providerWebhookInbox,
            handler: createProviderMessageEventHandler({
              contexts: messages,
              authors: createProviderMessageAuthorVerifier(
                config.providers.gitlab.origin,
                vault,
              ),
              facts: messages,
              fallback: createProviderIssueEventHandler(
                createNodeAppwriteProviderIssueStateStore(runtime.tables, {
                  databaseId: config.appwriteSchema.databaseId,
                  externalIssueLinksTableId:
                    config.appwriteSchema.externalIssueLinksTableId,
                }),
              ),
            }),
            workerId: "provider-event-worker",
            now: () => new Date(runtime.nowIso()),
            staleAfterMs: 5 * 60 * 1_000,
            maximumAttempts: 5,
            retryDelayMs: (attempt) => 2 ** attempt * 1_000,
          });
        })()
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
  const notificationOutboxWorker =
    config.notificationEmail && runtime.users
      ? createOutboxWorker({
          store: createNodeAppwriteOutboxStore(
            runtime.tables,
            {
              databaseId: config.appwriteSchema.databaseId,
              outboxTableId: config.appwriteSchema.outboxTableId,
            },
            sensitive,
          ),
          sender: createNodeSmtpNotificationSender(
            config.notificationEmail,
            createNodeAppwriteNotificationRecipientResolver(
              runtime.tables,
              runtime.users,
              {
                databaseId: config.appwriteSchema.databaseId,
                notificationsTableId: config.appwriteSchema.notificationsTableId,
                reportersTableId: config.appwriteSchema.reportersTableId,
                feedbackTableId: config.appwriteSchema.feedbackTableId,
              },
              sensitive,
            ),
          ),
          workerId: `${config.environment}-notification-worker`,
          createLeaseToken: () => randomBytes(24).toString("base64url"),
          now: () => new Date(runtime.nowIso()),
          leaseDurationMs: 60_000,
          retryDelayMs: (attempt) => 2 ** attempt * 1_000,
          maximumAttempts: 5,
          log: (event) => runtime.notificationDiagnostic?.(event),
        })
      : undefined;
  let authoritativeProjection: ProviderMaintenanceCapability | undefined;
  const providerMaintenance = (() => {
    const normalizedConversationStore = createNodeAppwriteConversationLifecycleStore(
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
        workspaceMembershipsTableId: config.appwriteSchema.workspaceMembershipsTableId,
        projectAssignmentsTableId: config.appwriteSchema.projectAssignmentsTableId,
        notificationsTableId: config.appwriteSchema.notificationsTableId,
        notificationSignalsTableId: config.appwriteSchema.notificationSignalsTableId,
        outboxTableId: config.appwriteSchema.outboxTableId,
      },
      sensitive,
      undefined,
      createNodeAppwriteProviderMessageFanout(
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          externalIssueLinksTableId: config.appwriteSchema.externalIssueLinksTableId,
          publicationConsentsTableId: config.appwriteSchema.publicationConsentsTableId,
          providerSyncOutboxTableId: config.appwriteSchema.providerSyncOutboxTableId,
        },
        sensitive,
      ),
    );
    const conversationEnvelope = createAuthoritativeConversationEnvelope(
      sensitive,
      config.appwriteSchema.authoritativeCommitsTableId,
    );
    const authoritativeProjector = createAuthoritativeProjector(
      createNodeAppwriteAuthoritativeProjectionStore(
        runtime.tables,
        config.appwriteSchema,
      ),
      createAuthoritativeProjectionRouter({
        feedback: createAuthoritativeIntakeProjectionHandler(
          authoritativeEnvelope,
          normalizedIntakeStore,
        ),
        conversation: createAuthoritativeConversationProjectionHandler(
          conversationEnvelope,
          normalizedConversationStore,
        ),
      }),
      {
        now: runtime.nowIso,
        leaseUntil: (now) => new Date(Date.parse(now) + 5 * 60_000).toISOString(),
        retryAt: (now, attempt) =>
          new Date(
            Date.parse(now) + Math.min(2 ** attempt * 1_000, 15 * 60_000),
          ).toISOString(),
        errorCode: authoritativeProjectionErrorCode,
      },
    );
    const authoritativeProjections = {
      runOnce: () =>
        authoritativeProjector.runBatch(`${config.environment}-commit-projector`, 25),
    };
    authoritativeProjection = {
      runOnce: () =>
        drainAuthoritativeProjectionEvent(
          authoritativeProjector,
          `${config.environment}-commit-event`,
          (milliseconds) =>
            new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
        ),
    };
    if (
      config.providers &&
      providerIssueOutboxWorker &&
      providerMessageOutboxWorker &&
      providerEventInboxWorker
    ) {
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
      const messages = createNodeAppwriteProviderMessageStore(
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          sourceConnectionsTableId: config.appwriteSchema.sourceConnectionsTableId,
          externalIssueLinksTableId: config.appwriteSchema.externalIssueLinksTableId,
          conversationMessagesTableId:
            config.appwriteSchema.conversationMessagesTableId,
        },
        sensitive,
      );
      const messageAdapters = [
        createGitHubMessageProvider(vault),
        createGitLabMessageProvider(config.providers.gitlab.origin, vault),
      ];
      return createProviderMaintenance({
        authoritativeProjections,
        inbox: providerEventInboxWorker,
        outbox: providerIssueOutboxWorker,
        messages: providerMessageOutboxWorker,
        ...(notificationOutboxWorker === undefined
          ? {}
          : { notifications: notificationOutboxWorker }),
        messageReconciliation: createProviderMessageReconciliation({
          reader: createNodeAppwriteProviderMessageReconciliationReader(
            runtime.tables,
            {
              databaseId: config.appwriteSchema.databaseId,
              conversationMessagesTableId:
                config.appwriteSchema.conversationMessagesTableId,
              externalIssueLinksTableId:
                config.appwriteSchema.externalIssueLinksTableId,
            },
            sensitive,
          ),
          contexts: messages,
          authors: createProviderMessageAuthorVerifier(
            config.providers.gitlab.origin,
            vault,
          ),
          facts: messages,
          providers: messageAdapters,
          now: runtime.nowIso,
        }),
        privacy: {
          async runOnce() {
            const providerCleanup = await privacyProviderCleanup.runOnce();
            if (providerCleanup.failed > 0)
              throw new Error("PRIVACY_PROVIDER_CLEANUP_RETRYABLE");
            const purge = await privacyPurgeWorker.runOnce();
            return { status: "completed", purge, providerCleanup };
          },
        },
        ...(platformExpiry === undefined ? {} : { platform: platformExpiry }),
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
    return createProviderMaintenance({
      authoritativeProjections,
      privacy: privacyPurgeWorker,
      ...(notificationOutboxWorker === undefined
        ? {}
        : { notifications: notificationOutboxWorker }),
      ...(platformExpiry === undefined ? {} : { platform: platformExpiry }),
    });
  })();
  /* v8 ignore stop */

  return {
    authoritativeProjection,
    externalIssue,
    providerEventInbox,
    providerIssueOutbox,
    providerMaintenance,
    providerWebhook,
    sourceConnections,
  };
}
