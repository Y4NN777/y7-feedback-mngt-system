import type { ServerConfig } from "@y7-feedback/config/server";

import { createDay4TableDefinitions } from "./appwrite-day4-migration.js";

export type AppwriteColumn =
  | {
      readonly key: string;
      readonly type: "boolean" | "integer" | "datetime";
      readonly required: boolean;
    }
  | {
      readonly key: string;
      readonly type: "varchar";
      readonly size: number;
      readonly required: boolean;
      readonly encrypt?: boolean;
    }
  | {
      readonly key: string;
      readonly type: "text";
      readonly required: boolean;
      readonly encrypt?: boolean;
    };

export interface AppwriteIndex {
  readonly key: string;
  readonly type: "key" | "unique";
  readonly columns: readonly string[];
}

export interface AppwriteTableDefinition {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly [];
  readonly rowSecurity: true;
  readonly enabled: true;
  readonly columns: readonly AppwriteColumn[];
  readonly indexes: readonly AppwriteIndex[];
}

export interface AppwriteInfrastructureManifest {
  readonly database: {
    readonly id: string;
    readonly name: string;
    readonly enabled: true;
  };
  readonly tables: readonly AppwriteTableDefinition[];
  readonly attachmentBucket: {
    readonly id: string;
    readonly name: string;
    readonly permissions: readonly [];
    readonly fileSecurity: true;
    readonly enabled: true;
    readonly maximumFileSize: number;
    readonly allowedFileExtensions: readonly [];
    readonly compression: "none";
    readonly encryption: true;
    readonly antivirus: true;
    readonly transformations: false;
  };
}

const varchar = (
  key: string,
  size: number,
  options: { readonly required?: boolean } = {},
): AppwriteColumn => ({
  key,
  type: "varchar",
  size,
  required: options.required ?? true,
});

const text = (
  key: string,
  options: { readonly required?: boolean } = {},
): AppwriteColumn => ({
  key,
  type: "text",
  required: options.required ?? true,
});

const datetime = (
  key: string,
  options: { readonly required?: boolean } = {},
): AppwriteColumn => ({
  key,
  type: "datetime",
  required: options.required ?? true,
});

const integer = (key: string): AppwriteColumn => ({
  key,
  type: "integer",
  required: true,
});

const boolean = (key: string): AppwriteColumn => ({
  key,
  type: "boolean",
  required: true,
});

const index = (
  key: string,
  columns: readonly string[],
  type: AppwriteIndex["type"] = "key",
): AppwriteIndex => ({ key, type, columns });

const table = (
  id: string,
  name: string,
  columns: readonly AppwriteColumn[],
  indexes: readonly AppwriteIndex[] = [],
): AppwriteTableDefinition => ({
  id,
  name,
  permissions: [],
  rowSecurity: true,
  enabled: true,
  columns,
  indexes,
});

export function createAppwriteInfrastructureManifest(
  schema: ServerConfig["appwriteSchema"],
): AppwriteInfrastructureManifest {
  return {
    database: { id: schema.databaseId, name: "Y7 Feedback", enabled: true },
    tables: [
      table(
        schema.workspacesTableId,
        "Workspaces",
        [varchar("name", 128), boolean("active"), datetime("createdAt")],
        [index("active", ["active"])],
      ),
      table(
        schema.workspaceMembershipsTableId,
        "Workspace memberships",
        [
          varchar("workspaceId", 36),
          varchar("userId", 36),
          varchar("role", 32),
          varchar("status", 16),
          datetime("createdAt"),
          datetime("updatedAt"),
        ],
        [
          index("workspace_user_unique", ["workspaceId", "userId"], "unique"),
          index("user_status", ["userId", "status"]),
        ],
      ),
      table(
        schema.projectAssignmentsTableId,
        "Project assignments",
        [
          varchar("workspaceId", 36),
          varchar("projectId", 36),
          varchar("userId", 36),
          varchar("status", 16),
          datetime("createdAt"),
          datetime("updatedAt"),
        ],
        [
          index("project_user_unique", ["projectId", "userId"], "unique"),
          index("workspace_user_status", ["workspaceId", "userId", "status"]),
        ],
      ),
      table(
        schema.projectSlugsTableId,
        "Project slug reservations",
        [
          varchar("slug", 63),
          varchar("workspaceId", 36),
          varchar("projectId", 36),
          boolean("current"),
          datetime("claimedAt"),
        ],
        [
          index("slug_unique", ["slug"], "unique"),
          index("project_current", ["projectId", "current"]),
          index("workspace", ["workspaceId"]),
        ],
      ),
      table(
        schema.projectsTableId,
        "Projects",
        [
          varchar("workspaceId", 36),
          varchar("slug", 63),
          boolean("active"),
          text("enabledTypesJson"),
          text("contextDeclarationsJson"),
          varchar("reporterPurposeFr", 300),
          varchar("reporterPurposeEn", 300),
        ],
        [index("slug_unique", ["slug"], "unique"), index("workspace", ["workspaceId"])],
      ),
      table(
        schema.reportersTableId,
        "Reporters",
        [varchar("workspaceId", 36), text("attributionJson")],
        [index("workspace", ["workspaceId"])],
      ),
      table(
        schema.feedbackTableId,
        "Feedback",
        [
          varchar("projectId", 36),
          varchar("workspaceId", 36),
          varchar("reporterId", 36),
          varchar("type", 16),
          text("originalSourceJson"),
          text("currentSourceJson"),
          text("contextJson"),
          text("attachmentNamesJson"),
          varchar("state", 32),
          datetime("acceptedAt"),
          text("reporterHistoryJson"),
          text("reporterMessagesJson"),
          text("reporterAttachmentsJson"),
          text("sourceRevisionsJson"),
          text("deletionRequestsJson"),
          text("internalNotesJson"),
          text("workspaceClassification", { required: false }),
          varchar("assignedMaintainerId", 36, { required: false }),
          datetime("deletedAt", { required: false }),
        ],
        [
          index("project", ["projectId"]),
          index("workspace", ["workspaceId"]),
          index("reporter", ["reporterId"]),
          index("workspace_state", ["workspaceId", "state"]),
        ],
      ),
      table(
        schema.lifecycleTableId,
        "Feedback lifecycle",
        [
          varchar("feedbackId", 36),
          varchar("priorState", 32, { required: false }),
          varchar("state", 32),
          varchar("actor", 200),
          datetime("occurredAt"),
          integer("sequence"),
        ],
        [index("feedback_sequence", ["feedbackId", "sequence"], "unique")],
      ),
      table(
        schema.accessGrantsTableId,
        "Accountless access grants",
        [
          varchar("feedbackId", 36),
          varchar("reference", 100),
          varchar("verifier", 200),
          integer("generation"),
          varchar("status", 16),
        ],
        [
          index("reference_unique", ["reference"], "unique"),
          index("feedback", ["feedbackId"]),
        ],
      ),
      table(
        schema.notificationsTableId,
        "Notifications",
        [
          varchar("feedbackId", 36),
          varchar("reporterId", 36),
          varchar("kind", 64),
          varchar("reference", 100),
          datetime("createdAt"),
          varchar("eventId", 36, { required: false }),
          varchar("workspaceId", 36, { required: false }),
          varchar("projectId", 36, { required: false }),
          varchar("recipientId", 36, { required: false }),
          varchar("recipientKind", 32, { required: false }),
          varchar("locale", 2, { required: false }),
          datetime("readAt", { required: false }),
        ],
        [
          index("feedback", ["feedbackId"]),
          index("reporter", ["reporterId"]),
          index("event_recipient", ["eventId", "recipientId"], "unique"),
          index("recipient_scope", ["recipientId", "workspaceId", "projectId"]),
        ],
      ),
      table(
        schema.notificationSignalsTableId,
        "Notification invalidation signals",
        [varchar("recipientId", 36), datetime("createdAt")],
        [index("recipient_created", ["recipientId", "createdAt"])],
      ),
      table(
        schema.outboxTableId,
        "Notification outbox",
        [
          varchar("notificationId", 36),
          varchar("channel", 32),
          varchar("status", 32),
          datetime("createdAt"),
          text("payloadJson"),
        ],
        [index("status_created", ["status", "createdAt"])],
      ),
      table(
        schema.idempotencyTableId,
        "Intake idempotency",
        [
          varchar("scopeKey", 100),
          varchar("clientOperationId", 36),
          varchar("payloadDigest", 128),
          varchar("feedbackId", 36),
          varchar("reference", 100),
          text("protectedProof"),
          varchar("proofVerifier", 200),
          datetime("createdAt"),
        ],
        [index("scope_operation_unique", ["scopeKey", "clientOperationId"], "unique")],
      ),
      table(
        schema.attachmentStagingTableId,
        "Attachment staging",
        [
          varchar("objectId", 500),
          varchar("operationId", 36),
          datetime("stagedAt"),
          varchar("fileId", 36),
        ],
        [
          index("object_unique", ["objectId"], "unique"),
          index("object_operation", ["objectId", "operationId"]),
          index("staged_at", ["stagedAt"]),
          index("file_unique", ["fileId"], "unique"),
        ],
      ),
      table(
        schema.attachmentsTableId,
        "Attachments",
        [
          varchar("objectId", 500),
          varchar("feedbackId", 200),
          varchar("workspaceId", 200),
          varchar("projectId", 200),
          varchar("audience", 16),
          varchar("sourceKind", 32),
          varchar("sourceEntryId", 200),
          varchar("displayName", 255),
          varchar("mediaType", 100),
          integer("size"),
          varchar("sha256", 200),
          datetime("createdAt"),
          varchar("lifecycle", 32),
          varchar("operationId", 36),
        ],
        [
          index("object_unique", ["objectId"], "unique"),
          index("feedback", ["feedbackId"]),
          index("workspace", ["workspaceId"]),
          index("project", ["projectId"]),
          index("operation", ["operationId"]),
        ],
      ),
      table(
        schema.providerGrantsTableId,
        "Provider grant vault",
        [varchar("provider", 16), text("envelope")],
        [index("provider", ["provider"])],
      ),
      table(
        schema.sourceConnectionsTableId,
        "Source connections",
        [
          varchar("workspaceId", 36),
          varchar("projectId", 36),
          varchar("provider", 16),
          varchar("ownerUserId", 36),
          varchar("status", 16),
          varchar("encryptedGrantRef", 36),
          text("selectedRepositoriesJson"),
          datetime("createdAt"),
          datetime("updatedAt"),
        ],
        [
          index("project_provider_unique", ["projectId", "provider"], "unique"),
          index("workspace_status", ["workspaceId", "status"]),
          index("owner_workspace_project_status", [
            "ownerUserId",
            "workspaceId",
            "projectId",
            "status",
          ]),
        ],
      ),
      table(
        schema.administrationAuditTableId,
        "Administration audit",
        [
          varchar("workspaceId", 36),
          varchar("projectId", 36),
          varchar("actorId", 36),
          varchar("action", 64),
          varchar("operationId", 36),
          varchar("payloadDigest", 128),
          datetime("occurredAt"),
        ],
        [
          index("operation_unique", ["operationId"], "unique"),
          index("workspace_project_time", ["workspaceId", "projectId", "occurredAt"]),
        ],
      ),
      table(
        schema.administrationIdempotencyTableId,
        "Administration idempotency",
        [
          varchar("workspaceId", 36),
          varchar("operationId", 36),
          varchar("payloadDigest", 128),
          varchar("action", 64),
          varchar("projectId", 36),
          varchar("auditId", 36),
          text("resultJson"),
          datetime("createdAt"),
        ],
        [index("workspace_operation_unique", ["workspaceId", "operationId"], "unique")],
      ),
      table(
        schema.conversationMessagesTableId,
        "Conversation messages",
        [
          varchar("feedbackId", 36),
          varchar("workspaceId", 36),
          varchar("projectId", 36),
          varchar("actorId", 36),
          varchar("actorKind", 16),
          varchar("audience", 16),
          text("contentEnvelope"),
          datetime("occurredAt"),
        ],
        [
          index("feedback_time", ["feedbackId", "occurredAt"]),
          index("workspace_project", ["workspaceId", "projectId"]),
        ],
      ),
      table(
        schema.conversationInternalNotesTableId,
        "Conversation internal notes",
        [
          varchar("feedbackId", 36),
          varchar("workspaceId", 36),
          varchar("projectId", 36),
          varchar("actorId", 36),
          varchar("actorKind", 16),
          varchar("audience", 16),
          text("contentEnvelope"),
          datetime("occurredAt"),
        ],
        [
          index("feedback_time", ["feedbackId", "occurredAt"]),
          index("workspace_project", ["workspaceId", "projectId"]),
        ],
      ),
      table(
        schema.conversationIdempotencyTableId,
        "Conversation idempotency",
        [
          varchar("feedbackId", 36),
          varchar("operationId", 36),
          varchar("payloadDigest", 128),
          varchar("action", 64),
          text("resultJson"),
          datetime("createdAt"),
        ],
        [index("feedback_operation_unique", ["feedbackId", "operationId"], "unique")],
      ),
      table(
        schema.conversationLifecycleTableId,
        "Conversation lifecycle facts",
        [
          varchar("feedbackId", 36),
          varchar("workspaceId", 36),
          varchar("projectId", 36),
          varchar("priorState", 32),
          varchar("state", 32),
          varchar("actorId", 36),
          varchar("actorKind", 16),
          text("reasonEnvelope"),
          datetime("occurredAt"),
          integer("sequence"),
        ],
        [
          index("feedback_sequence_unique", ["feedbackId", "sequence"], "unique"),
          index("workspace_project_time", ["workspaceId", "projectId", "occurredAt"]),
        ],
      ),
      table(
        schema.publicationConsentsTableId,
        "Publication consent facts",
        [
          varchar("feedbackId", 36),
          varchar("workspaceId", 36),
          varchar("projectId", 36),
          varchar("reporterId", 36),
          varchar("operationId", 36),
          varchar("payloadDigest", 128),
          integer("version"),
          varchar("state", 16),
          varchar("disclosureVersion", 64),
          varchar("audience", 100),
          datetime("occurredAt"),
        ],
        [
          index("feedback_version_unique", ["feedbackId", "version"], "unique"),
          index("feedback_operation_unique", ["feedbackId", "operationId"], "unique"),
          index("feedback_state", ["feedbackId", "state"]),
          index("workspace_project", ["workspaceId", "projectId"]),
        ],
      ),
      table(
        schema.externalIssueLinksTableId,
        "External issue links",
        [
          varchar("feedbackId", 36),
          varchar("workspaceId", 36),
          varchar("projectId", 36),
          varchar("connectionId", 36),
          varchar("provider", 16),
          varchar("repositoryId", 36),
          varchar("visibility", 16),
          varchar("providerIssueId", 100, { required: false }),
          varchar("providerIssueUrl", 500, { required: false }),
          varchar("state", 16),
          varchar("synchronizationState", 32),
          varchar("actorId", 36),
          datetime("createdAt"),
          datetime("updatedAt"),
        ],
        [
          index("feedback_state", ["feedbackId", "state"]),
          index("workspace_project", ["workspaceId", "projectId"]),
          index("provider_repository_issue", [
            "provider",
            "repositoryId",
            "providerIssueId",
          ]),
        ],
      ),
      table(
        schema.providerOutboxTableId,
        "Provider outbox",
        [
          varchar("operationId", 36),
          varchar("feedbackId", 36),
          varchar("workspaceId", 36),
          varchar("projectId", 36),
          varchar("linkId", 36),
          varchar("connectionId", 36),
          varchar("provider", 16),
          varchar("repositoryId", 36),
          varchar("kind", 32),
          varchar("status", 32),
          integer("attempts"),
          text("payloadJson"),
          varchar("payloadDigest", 128),
          datetime("createdAt"),
          datetime("updatedAt"),
          datetime("nextAttemptAt", { required: false }),
          varchar("lastErrorCode", 64, { required: false }),
          varchar("claimedBy", 64, { required: false }),
        ],
        [
          index("operation_unique", ["operationId"], "unique"),
          index("status_next_attempt", ["status", "nextAttemptAt"]),
          index("feedback", ["feedbackId"]),
          index("workspace_project", ["workspaceId", "projectId"]),
        ],
      ),
      ...createDay4TableDefinitions(schema),
    ],
    attachmentBucket: {
      id: schema.attachmentBucketId,
      name: "Private attachments",
      permissions: [],
      fileSecurity: true,
      enabled: true,
      maximumFileSize: 10 * 1024 * 1024,
      allowedFileExtensions: [],
      compression: "none",
      encryption: true,
      antivirus: true,
      transformations: false,
    },
  };
}
