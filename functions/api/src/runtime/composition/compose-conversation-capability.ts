import { createHash } from "node:crypto";

import type { ServerConfig } from "@y7-feedback/config/server";

import type { AccountlessAccessCoordinator } from "../../accountless-access.js";
import type { createAppwriteAuthoritativeCommitStore } from "../../appwrite-authoritative-commit-store.js";
import { createNodeAppwriteConversationLifecycleStore } from "../../infrastructure/appwrite/conversations/appwrite-conversation-lifecycle-store.js";
import { createNodeAppwriteConversationPendingCommitReader } from "../../infrastructure/appwrite/conversations/appwrite-conversation-pending-commits.js";
import { createNodeAppwriteConversationPreflight } from "../../infrastructure/appwrite/conversations/appwrite-conversation-preflight.js";
import { createNodeAppwriteConversationProjectionStore } from "../../infrastructure/appwrite/conversations/appwrite-conversation-projection-store.js";
import { createNodeAppwriteProviderMessageFanout } from "../../appwrite-provider-message-fanout.js";
import type { WorkspaceCapabilityScopeResolver } from "../../appwrite-workspace-capability-scope.js";
import { createAuthoritativeConversationEnvelope } from "../../capabilities/conversations/authoritative-conversation-envelope.js";
import { createAuthoritativeConversationStore } from "../../capabilities/conversations/authoritative-conversation-store.js";
import { createConversationLifecycleCoordinator } from "../../capabilities/conversations/conversation-lifecycle.js";
import { createConversationLifecycleHttp } from "../http/conversation-lifecycle-http.js";
import type { AppwriteSensitivePersistence } from "../../sensitive-data-protector.js";
import type { AppwritePrincipalVerifier } from "../../capabilities/attachments/workspace-attachment-download.js";
import {
  deriveReporterActorId,
  type ApplicationRuntime,
} from "./application-runtime.js";

export function composeConversationCapability(
  config: ServerConfig,
  runtime: ApplicationRuntime,
  sensitive: AppwriteSensitivePersistence,
  principalVerifier: AppwritePrincipalVerifier,
  workspaceScope: WorkspaceCapabilityScopeResolver,
  accountless: AccountlessAccessCoordinator,
  authoritativeCommitStore: ReturnType<typeof createAppwriteAuthoritativeCommitStore>,
) {
  const normalizedStore = createNodeAppwriteConversationLifecycleStore(
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
    /* v8 ignore start -- optional diagnostics are exercised by the deployed lifecycle matrix. */
    runtime.conversationLifecycleDiagnostic === undefined
      ? undefined
      : {
          nowMs: runtime.nowMs,
          observe: runtime.conversationLifecycleDiagnostic,
        },
    /* v8 ignore stop */
  );
  const store =
    config.intakePersistenceMode !== "authoritative"
      ? normalizedStore
      : (() => {
          const envelope = createAuthoritativeConversationEnvelope(
            sensitive,
            config.appwriteSchema.authoritativeCommitsTableId,
          );
          return createAuthoritativeConversationStore(
            config.environment === "preview" ? "preview" : "production",
            authoritativeCommitStore,
            envelope,
            createNodeAppwriteConversationPreflight(
              runtime.tables,
              {
                databaseId: config.appwriteSchema.databaseId,
                feedbackTableId: config.appwriteSchema.feedbackTableId,
                lifecycleTableId: config.appwriteSchema.conversationLifecycleTableId,
              },
              {
                commits: createNodeAppwriteConversationPendingCommitReader(
                  runtime.tables,
                  config.appwriteSchema,
                ),
                envelope,
              },
            ),
          );
        })();

  return createConversationLifecycleHttp(
    createConversationLifecycleCoordinator(
      principalVerifier,
      workspaceScope,
      accountless,
      store,
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
}
