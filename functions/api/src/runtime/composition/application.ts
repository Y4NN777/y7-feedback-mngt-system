import type { ServerConfig } from "@y7-feedback/config/server";

import type { HttpDependencies } from "../http/http.js";
import { createPublicApi } from "../http/public-api.js";
import { createProviderMaintenanceHttp } from "../../provider-maintenance-http.js";
import type { ApplicationRuntime } from "./application-runtime.js";
import { composeAdministrationCapability } from "./compose-administration-capability.js";
import { composeApplicationSecurity } from "./compose-application-security.js";
import { composeAttachmentCapability } from "./compose-attachment-capability.js";
import { composeConversationCapability } from "./compose-conversation-capability.js";
import { composeGovernanceCapability } from "./compose-governance-capability.js";
import { composeIntakeCapability } from "./compose-intake-capability.js";
import { composeProviderCapability } from "./compose-provider-capability.js";

export {
  createProtectedFeedbackUrl,
  deriveReporterActorId,
  digestExternalIssueCommand,
} from "./application-runtime.js";

export function createHttpApplication(
  config: ServerConfig,
  runtime: ApplicationRuntime,
): HttpDependencies {
  const { proofProtector: protector, sensitivePersistence: sensitive } =
    composeApplicationSecurity(config);
  const {
    abuse,
    accountless,
    authoritativeCommitStore,
    authoritativeEnvelope,
    intake,
    normalizedStore: normalizedIntakeStore,
    projects,
  } = composeIntakeCapability(config, runtime, sensitive, protector);
  const attachments = composeAttachmentCapability(
    config,
    runtime,
    sensitive,
    accountless,
  );
  const {
    platformAccess,
    platformExpiry,
    principalVerifier,
    projectAdministration,
    workbench,
    workspaceAttachmentDownload,
    workspaceOperations,
    workspaceScope,
  } = composeAdministrationCapability(config, runtime, sensitive, attachments);
  const { intelligence, privacy } = composeGovernanceCapability(
    config,
    runtime,
    sensitive,
    principalVerifier,
    workspaceScope,
    accountless,
  );
  const conversationLifecycle = composeConversationCapability(
    config,
    runtime,
    sensitive,
    principalVerifier,
    workspaceScope,
    accountless,
    authoritativeCommitStore,
  );
  const {
    authoritativeProjection,
    externalIssue,
    providerEventInbox,
    providerIssueOutbox,
    providerMaintenance,
    providerWebhook,
    sourceConnections,
  } = composeProviderCapability({
    accountless,
    authoritativeEnvelope,
    config,
    normalizedIntakeStore,
    platformExpiry,
    principalVerifier,
    runtime,
    sensitive,
    workspaceScope,
  });

  return {
    abuse,
    createCorrelationId: runtime.createCorrelationId,
    environment: config.environment,
    intelligence,
    privacy,
    conversationLifecycle,
    externalIssue,
    now: runtime.nowMs,
    /* v8 ignore next -- optional deployed capability inclusion is covered by its Preview matrix. */
    ...(platformAccess === undefined ? {} : { platformAccess }),
    projectAdministration,
    providerWebhook,
    /* v8 ignore next -- optional deployed capability inclusion is covered by its Preview matrix. */
    ...(providerEventInbox === undefined ? {} : { providerEventInbox }),
    providerMaintenance,
    authoritativeProjection,
    /* v8 ignore start -- optional maintenance HTTP wiring is exercised by the Preview provider matrix. */
    ...(!config.providerOutboxTriggerSecret
      ? {}
      : {
          providerMaintenanceHttp: createProviderMaintenanceHttp(
            providerMaintenance,
            config.providerOutboxTriggerSecret,
          ),
        }),
    /* v8 ignore stop */
    publicApi: createPublicApi(
      projects,
      intake,
      accountless,
      attachments.reporterDownload,
      workspaceAttachmentDownload,
      workspaceOperations,
      attachments.staging,
      attachments.stagingTokens,
    ),
    ...(sourceConnections === undefined ? {} : { sourceConnections }),
    /* v8 ignore next -- optional deployed capability inclusion is covered by its Preview matrix. */
    ...(providerIssueOutbox === undefined ? {} : { providerIssueOutbox }),
    release: config.release,
    startedAt: runtime.startedAt,
    workbench,
  };
}
