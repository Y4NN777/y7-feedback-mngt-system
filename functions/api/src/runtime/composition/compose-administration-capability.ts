import { createHash } from "node:crypto";

import type { ServerConfig } from "@y7-feedback/config/server";

import {
  AppwriteNotificationFeedError,
  createNodeAppwriteNotificationFeedStore,
} from "../../appwrite-notification-feed-store.js";
import {
  createNodeAppwritePlatformAccessExpiryWorker,
  createNodeAppwritePlatformAccessStore,
} from "../../appwrite-platform-access-store.js";
import { createNodeAppwritePlatformAuthority } from "../../appwrite-platform-authority.js";
import { createNodeAppwritePlatformContentReader } from "../../appwrite-platform-content-reader.js";
import { createNodeAppwritePrincipalVerifier } from "../../appwrite-principal-verifier.js";
import { createNodeAppwriteProjectAdministrationStore } from "../../appwrite-project-administration-store.js";
import { createNodeAppwriteWorkbenchMutationStore } from "../../appwrite-workbench-mutation-store.js";
import { createNodeAppwriteWorkbenchStore } from "../../appwrite-workbench-store.js";
import { createNodeAppwriteWorkspaceAttachmentScopeResolver } from "../../infrastructure/appwrite/attachments/appwrite-workspace-attachment-scope.js";
import { createNodeAppwriteWorkspaceCapabilityScopeResolver } from "../../appwrite-workspace-capability-scope.js";
import { createNodeAppwriteWorkspaceOwnerScopeResolver } from "../../appwrite-workspace-owner-scope.js";
import { createNodeAppwriteWorkspaceProjectOperationPorts } from "../../appwrite-workspace-project-ports.js";
import { createAttachmentDownload } from "../../capabilities/attachments/attachment-download.js";
import { createPlatformAccessAuditId } from "../../platform-access-audit-id.js";
import { createPlatformAccessCoordinator } from "../../platform-access.js";
import { createPlatformAccessHttp } from "../../platform-access-http.js";
import { createProjectAdministration } from "../../project-administration.js";
import { createProjectAdministrationHttp } from "../../project-administration-http.js";
import type { AppwriteSensitivePersistence } from "../../sensitive-data-protector.js";
import { createWorkbenchCoordinator } from "../../workbench.js";
import { createWorkbenchHttp } from "../../workbench-http.js";
import { createWorkspaceAttachmentDownload } from "../../capabilities/attachments/workspace-attachment-download.js";
import {
  WorkspaceOperationDeniedError,
  createWorkspaceProjectOperations,
} from "../../workspace-project-operations.js";
import type { ApplicationRuntime } from "./application-runtime.js";
import type { composeAttachmentCapability } from "./compose-attachment-capability.js";

export function composeAdministrationCapability(
  config: ServerConfig,
  runtime: ApplicationRuntime,
  sensitive: AppwriteSensitivePersistence,
  attachments: ReturnType<typeof composeAttachmentCapability>,
) {
  const principalVerifier =
    runtime.principalVerifier ??
    createNodeAppwritePrincipalVerifier({
      endpoint: config.appwriteEndpoint,
      projectId: config.appwriteProjectId,
    });

  /* v8 ignore start -- Platform composition is exercised by the real Preview matrix. */
  const platformAccess = config.platformAccess
    ? (() => {
        if (!runtime.users) throw new Error("PLATFORM_ACCESS_USERS_UNAVAILABLE");
        return createPlatformAccessHttp(
          createPlatformAccessCoordinator(
            principalVerifier,
            createNodeAppwritePlatformAuthority(
              runtime.users,
              config.platformAccess,
              runtime.nowMs,
            ),
            createNodeAppwritePlatformAccessStore(
              runtime.tables,
              {
                databaseId: config.appwriteSchema.databaseId,
                grantsTableId: config.appwriteSchema.exceptionalAccessGrantsTableId,
                auditTableId: config.appwriteSchema.exceptionalAccessAuditTableId,
                operationsTableId:
                  config.appwriteSchema.exceptionalAccessOperationsTableId,
              },
              sensitive,
              {
                now: runtime.nowIso,
                createAuditId: createPlatformAccessAuditId,
                content: createNodeAppwritePlatformContentReader(
                  runtime.tables,
                  {
                    databaseId: config.appwriteSchema.databaseId,
                    feedbackTableId: config.appwriteSchema.feedbackTableId,
                    messagesTableId: config.appwriteSchema.conversationMessagesTableId,
                    internalNotesTableId:
                      config.appwriteSchema.conversationInternalNotesTableId,
                    attachmentsTableId: config.appwriteSchema.attachmentsTableId,
                    attachmentStagingTableId:
                      config.appwriteSchema.attachmentStagingTableId,
                  },
                  sensitive,
                ),
              },
            ),
          ),
        );
      })()
    : undefined;
  /* v8 ignore stop */
  /* v8 ignore start -- scheduled expiry is exercised by the real Preview matrix. */
  const platformExpiry = config.platformAccess
    ? createNodeAppwritePlatformAccessExpiryWorker(
        runtime.tables,
        {
          databaseId: config.appwriteSchema.databaseId,
          grantsTableId: config.appwriteSchema.exceptionalAccessGrantsTableId,
          auditTableId: config.appwriteSchema.exceptionalAccessAuditTableId,
          operationsTableId: config.appwriteSchema.exceptionalAccessOperationsTableId,
        },
        sensitive,
        { now: runtime.nowIso, createAuditId: createPlatformAccessAuditId },
      )
    : undefined;
  /* v8 ignore stop */

  const workspaceScopeSchema = {
    databaseId: config.appwriteSchema.databaseId,
    projectsTableId: config.appwriteSchema.projectsTableId,
    workspaceMembershipsTableId: config.appwriteSchema.workspaceMembershipsTableId,
    projectAssignmentsTableId: config.appwriteSchema.projectAssignmentsTableId,
  };
  const workspaceAttachmentDownload = createWorkspaceAttachmentDownload(
    principalVerifier,
    createNodeAppwriteWorkspaceAttachmentScopeResolver(
      runtime.tables,
      workspaceScopeSchema,
    ),
    createAttachmentDownload(attachments.metadata, attachments.storage),
  );
  const workspaceScope = createNodeAppwriteWorkspaceCapabilityScopeResolver(
    runtime.tables,
    workspaceScopeSchema,
  );
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
        /* v8 ignore next -- Workbench digest delegation is covered by its coordinator contract suite. */
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
  const workspaceOperations = createWorkspaceProjectOperations(
    principalVerifier,
    workspaceScope,
    {
      ...workspaceProjectPorts,
      notifications: {
        list: (scope, actor) =>
          translateNotificationDenial(() =>
            notificationFeed.list({
              actor,
              workspaceId: scope.workspaceId,
              projectId: scope.projectId,
            }),
          ),
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
  /* v8 ignore stop */

  return {
    platformAccess,
    platformExpiry,
    principalVerifier,
    projectAdministration,
    workbench,
    workspaceAttachmentDownload,
    workspaceOperations,
    workspaceScope,
  };
}
