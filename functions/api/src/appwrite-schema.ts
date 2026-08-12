import type { ServerConfig } from "@y7-feedback/config/server";

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
  readonly columns: readonly AppwriteColumn[];
  readonly indexes: readonly AppwriteIndex[];
}

export interface AppwriteInfrastructureManifest {
  readonly database: { readonly id: string; readonly name: string };
  readonly tables: readonly AppwriteTableDefinition[];
  readonly attachmentBucket: {
    readonly id: string;
    readonly name: string;
    readonly permissions: readonly [];
    readonly fileSecurity: true;
    readonly maximumFileSize: number;
    readonly allowedFileExtensions: readonly [];
    readonly encryption: true;
    readonly antivirus: true;
    readonly transformations: false;
  };
}

const varchar = (
  key: string,
  size: number,
  options: { readonly required?: boolean; readonly encrypt?: boolean } = {},
): AppwriteColumn => ({
  key,
  type: "varchar",
  size,
  required: options.required ?? true,
  ...(options.encrypt === undefined ? {} : { encrypt: options.encrypt }),
});

const text = (
  key: string,
  options: { readonly required?: boolean; readonly encrypt?: boolean } = {},
): AppwriteColumn => ({
  key,
  type: "text",
  required: options.required ?? true,
  ...(options.encrypt === undefined ? {} : { encrypt: options.encrypt }),
});

const datetime = (key: string): AppwriteColumn => ({
  key,
  type: "datetime",
  required: true,
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
  columns,
  indexes,
});

export function createAppwriteInfrastructureManifest(
  schema: ServerConfig["appwriteSchema"],
): AppwriteInfrastructureManifest {
  return {
    database: { id: schema.databaseId, name: "Y7 Feedback" },
    tables: [
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
        [varchar("workspaceId", 36), text("attributionJson", { encrypt: true })],
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
          text("originalSourceJson", { encrypt: true }),
          text("currentSourceJson", { encrypt: true }),
          text("contextJson", { encrypt: true }),
          text("attachmentNamesJson", { encrypt: true }),
          varchar("state", 32),
          datetime("acceptedAt"),
          text("reporterHistoryJson", { encrypt: true }),
          text("reporterMessagesJson", { encrypt: true }),
          text("reporterAttachmentsJson", { encrypt: true }),
          text("sourceRevisionsJson", { encrypt: true }),
          text("deletionRequestsJson", { encrypt: true }),
          text("internalNotesJson", { encrypt: true }),
          text("workspaceClassification", { required: false, encrypt: true }),
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
          varchar("verifier", 200, { encrypt: true }),
          integer("generation"),
          varchar("status", 16),
        ],
        [index("reference_unique", ["reference"], "unique")],
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
        ],
        [index("feedback", ["feedbackId"]), index("reporter", ["reporterId"])],
      ),
      table(
        schema.outboxTableId,
        "Notification outbox",
        [
          varchar("notificationId", 36),
          varchar("channel", 32),
          varchar("status", 32),
          datetime("createdAt"),
          text("payloadJson", { encrypt: true }),
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
          text("protectedProof", { encrypt: true }),
          varchar("proofVerifier", 200, { encrypt: true }),
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
          varchar("displayName", 255, { encrypt: true }),
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
        [varchar("provider", 16), text("envelope", { encrypt: true })],
        [index("provider", ["provider"])],
      ),
    ],
    attachmentBucket: {
      id: schema.attachmentBucketId,
      name: "Private attachments",
      permissions: [],
      fileSecurity: true,
      maximumFileSize: 10 * 1024 * 1024,
      allowedFileExtensions: [],
      encryption: true,
      antivirus: true,
      transformations: false,
    },
  };
}
