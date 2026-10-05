import { createHash } from "node:crypto";

import type { ServerConfig } from "@y7-feedback/config/server";

import type { AccountlessAccessCoordinator } from "../../accountless-access.js";
import { createNodeAppwriteIntelligenceProvenanceStore } from "../../infrastructure/appwrite/intelligence/appwrite-intelligence-provenance-store.js";
import { createNodeAppwriteIntelligenceStore } from "../../infrastructure/appwrite/intelligence/appwrite-intelligence-store.js";
import { createNodeAppwritePrivacyStore } from "../../infrastructure/appwrite/privacy/appwrite-privacy-store.js";
import type { WorkspaceCapabilityScopeResolver } from "../../infrastructure/appwrite/platform-access/appwrite-workspace-capability-scope.js";
import { createIntelligenceCoordinator } from "../../capabilities/intelligence/intelligence.js";
import { createIntelligenceHttp } from "../http/intelligence-http.js";
import { createIntelligenceProvenanceCoordinator } from "../../capabilities/intelligence/intelligence-provenance.js";
import { createPrivacyCoordinator } from "../../capabilities/privacy/privacy.js";
import { createPrivacyHttp } from "../http/privacy-http.js";
import type { AppwriteSensitivePersistence } from "../../sensitive-data-protector.js";
import type { AppwritePrincipalVerifier } from "../../capabilities/platform-access/access-contracts.js";
import type { ApplicationRuntime } from "./application-runtime.js";

export function composeGovernanceCapability(
  config: ServerConfig,
  runtime: ApplicationRuntime,
  sensitive: AppwriteSensitivePersistence,
  principalVerifier: AppwritePrincipalVerifier,
  workspaceScope: WorkspaceCapabilityScopeResolver,
  accountless: AccountlessAccessCoordinator,
) {
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

  /* v8 ignore start -- privacy composition is exercised by verify:appwrite:privacy. */
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

  return { intelligence, privacy };
}
