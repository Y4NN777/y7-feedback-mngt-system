import {
  planAdditiveTableMigration,
  type AdditiveTableMigration,
} from "./appwrite-additive-migration.js";
import type {
  AppwriteColumn,
  AppwriteIndex,
  AppwriteTableDefinition,
} from "./appwrite-schema.js";

export const day4TableIds = [
  "provider_event_inbox",
  "provider_sync_outbox",
  "offline_conflict_projections",
  "intelligence_provenance",
  "deletion_records",
  "abuse_counters",
  "exceptional_access_grants",
  "exceptional_access_audit",
  "exceptional_access_operations",
] as const;

export interface Day4SchemaIds {
  readonly providerEventInboxTableId: string;
  readonly providerSyncOutboxTableId: string;
  readonly offlineConflictProjectionsTableId: string;
  readonly intelligenceProvenanceTableId: string;
  readonly deletionRecordsTableId: string;
  readonly abuseCountersTableId: string;
  readonly exceptionalAccessGrantsTableId: string;
  readonly exceptionalAccessAuditTableId: string;
  readonly exceptionalAccessOperationsTableId: string;
}

export const canonicalDay4SchemaIds: Day4SchemaIds = {
  providerEventInboxTableId: day4TableIds[0],
  providerSyncOutboxTableId: day4TableIds[1],
  offlineConflictProjectionsTableId: day4TableIds[2],
  intelligenceProvenanceTableId: day4TableIds[3],
  deletionRecordsTableId: day4TableIds[4],
  abuseCountersTableId: day4TableIds[5],
  exceptionalAccessGrantsTableId: day4TableIds[6],
  exceptionalAccessAuditTableId: day4TableIds[7],
  exceptionalAccessOperationsTableId: day4TableIds[8],
};

const varchar = (key: string, size: number, required = true): AppwriteColumn => ({
  key,
  type: "varchar",
  size,
  required,
});
const text = (key: string, required = true): AppwriteColumn => ({
  key,
  type: "text",
  required,
});
const datetime = (key: string, required = true): AppwriteColumn => ({
  key,
  type: "datetime",
  required,
});
const integer = (key: string, required = true): AppwriteColumn => ({
  key,
  type: "integer",
  required,
});
const boolean = (key: string, required = true): AppwriteColumn => ({
  key,
  type: "boolean",
  required,
});
const index = (
  key: string,
  columns: readonly string[],
  type: AppwriteIndex["type"] = "key",
): AppwriteIndex => ({ key, columns, type });
const table = (
  id: string,
  name: string,
  columns: readonly AppwriteColumn[],
  indexes: readonly AppwriteIndex[],
): AppwriteTableDefinition => ({
  id,
  name,
  permissions: [],
  rowSecurity: true,
  enabled: true,
  columns,
  indexes,
});

export function createDay4TableDefinitions(
  ids: Day4SchemaIds = canonicalDay4SchemaIds,
): readonly AppwriteTableDefinition[] {
  return [
    table(
      ids.providerEventInboxTableId,
      "Provider event inbox",
      [
        varchar("provider", 16),
        varchar("deliveryId", 128),
        varchar("eventType", 64),
        varchar("connectionId", 36),
        varchar("workspaceId", 36),
        varchar("projectId", 36),
        varchar("repositoryId", 100),
        varchar("providerEventId", 128, false),
        varchar("originMarker", 128, false),
        varchar("status", 32),
        integer("attempts"),
        text("payloadEnvelope"),
        varchar("payloadDigest", 128),
        datetime("receivedAt"),
        datetime("availableAt"),
        datetime("claimedAt", false),
        datetime("completedAt", false),
        varchar("claimedBy", 64, false),
        varchar("lastErrorCode", 64, false),
        varchar("providerObjectId", 128, false),
        boolean("cleanupMissing", false),
      ],
      [
        index("provider_delivery_unique", ["provider", "deliveryId"], "unique"),
        index("status_available", ["status", "availableAt"]),
        index("connection_order", ["connectionId", "receivedAt"]),
        index("workspace_project", ["workspaceId", "projectId"]),
      ],
    ),
    table(
      ids.providerSyncOutboxTableId,
      "Provider synchronization outbox",
      [
        varchar("operationId", 36),
        varchar("linkId", 36),
        varchar("feedbackId", 36),
        varchar("workspaceId", 36),
        varchar("projectId", 36),
        varchar("connectionId", 36),
        varchar("provider", 16),
        varchar("repositoryId", 100),
        varchar("kind", 32),
        varchar("status", 32),
        integer("sequence"),
        integer("attempts"),
        text("payloadEnvelope"),
        varchar("payloadDigest", 128),
        varchar("originMarker", 128),
        datetime("createdAt"),
        datetime("updatedAt"),
        datetime("nextAttemptAt", false),
        varchar("claimedBy", 64, false),
        varchar("lastErrorCode", 64, false),
      ],
      [
        index("operation_unique", ["operationId"], "unique"),
        index("status_next_attempt", ["status", "nextAttemptAt"]),
        index("link_order", ["linkId", "sequence"], "unique"),
        index("workspace_project", ["workspaceId", "projectId"]),
      ],
    ),
    table(
      ids.offlineConflictProjectionsTableId,
      "Offline conflict projections",
      [
        varchar("operationId", 36),
        varchar("workspaceId", 36),
        varchar("projectId", 36),
        varchar("actorContextDigest", 128),
        varchar("entityType", 32),
        varchar("entityId", 36),
        integer("clientVersion"),
        integer("serverVersion"),
        varchar("status", 32),
        text("summaryEnvelope"),
        datetime("createdAt"),
        datetime("resolvedAt", false),
      ],
      [
        index("operation_unique", ["operationId"], "unique"),
        index("actor_status", ["actorContextDigest", "status"]),
        index("entity_status", ["entityType", "entityId", "status"]),
        index("workspace_project", ["workspaceId", "projectId"]),
      ],
    ),
    table(
      ids.intelligenceProvenanceTableId,
      "Intelligence provenance",
      [
        varchar("workspaceId", 36),
        varchar("projectId", 36),
        varchar("themeId", 36),
        varchar("feedbackId", 36),
        varchar("relationType", 32),
        integer("sourceVersion"),
        varchar("actorId", 36),
        datetime("createdAt"),
        datetime("removedAt", false),
        varchar("associationKind", 16, false),
        text("targetEnvelope", false),
        varchar("relatedFeedbackId", 36, false),
        text("provenanceEnvelope", false),
        integer("revision", false),
        varchar("updatedByActorId", 36, false),
        datetime("updatedAt", false),
        text("operationIdsJson", false),
      ],
      [
        index("theme_feedback_unique", ["themeId", "feedbackId"], "unique"),
        index("feedback", ["feedbackId"]),
        index("workspace_project", ["workspaceId", "projectId"]),
      ],
    ),
    table(
      ids.deletionRecordsTableId,
      "Deletion records",
      [
        varchar("feedbackId", 36),
        varchar("workspaceId", 36),
        varchar("projectId", 36),
        varchar("requesterKind", 32),
        varchar("requesterDigest", 128),
        varchar("state", 32),
        varchar("reasonCode", 64),
        datetime("requestedAt"),
        datetime("softDeletedAt"),
        datetime("purgeEligibleAt"),
        datetime("restoredAt", false),
        datetime("purgedAt", false),
        integer("revision", false),
        boolean("identityErased", false),
        text("auditEnvelope", false),
        text("operationIdsJson", false),
        datetime("updatedAt", false),
        varchar("purgeWorkerId", 36, false),
        datetime("purgeClaimedAt", false),
      ],
      [
        index("feedback_unique", ["feedbackId"], "unique"),
        index("state_purge", ["state", "purgeEligibleAt"]),
        index("workspace_project", ["workspaceId", "projectId"]),
      ],
    ),
    table(
      ids.abuseCountersTableId,
      "Expiring abuse counters",
      [
        varchar("dimension", 32),
        varchar("subjectDigest", 128),
        varchar("keyId", 32),
        integer("count"),
        datetime("windowStartedAt"),
        datetime("expiresAt"),
      ],
      [
        index(
          "dimension_subject_window_unique",
          ["dimension", "subjectDigest", "windowStartedAt"],
          "unique",
        ),
        index("expiry", ["expiresAt"]),
      ],
    ),
    table(
      ids.exceptionalAccessGrantsTableId,
      "Exceptional access grants",
      [
        varchar("requesterId", 36),
        varchar("approverId", 36, false),
        varchar("workspaceId", 36),
        varchar("projectId", 36, false),
        varchar("feedbackId", 36, false),
        varchar("state", 32),
        varchar("reasonCode", 64),
        boolean("breakGlass"),
        integer("useCount"),
        integer("revision", false),
        integer("auditSequence", false),
        text("justificationEnvelope", false),
        varchar("incidentSeverity", 16, false),
        text("actionsJson", false),
        datetime("requestedAt"),
        datetime("approvedAt", false),
        datetime("expiresAt", false),
        datetime("expiredAt", false),
        datetime("revokedAt", false),
        datetime("reviewedAt", false),
      ],
      [
        index("requester_state", ["requesterId", "state"]),
        index("approver_state", ["approverId", "state"]),
        index("scope_state", ["workspaceId", "projectId", "feedbackId", "state"]),
        index("state_expiry", ["state", "expiresAt"]),
      ],
    ),
    table(
      ids.exceptionalAccessAuditTableId,
      "Exceptional access audit",
      [
        varchar("grantId", 36),
        integer("sequence"),
        varchar("eventType", 32),
        varchar("actorId", 36),
        varchar("scopeDigest", 128),
        varchar("reasonCode", 64),
        datetime("occurredAt"),
      ],
      [
        index("grant_sequence_unique", ["grantId", "sequence"], "unique"),
        index("actor_time", ["actorId", "occurredAt"]),
      ],
    ),
    table(
      ids.exceptionalAccessOperationsTableId,
      "Exceptional access idempotent operations",
      [
        varchar("grantId", 36),
        varchar("operationId", 36),
        varchar("actorId", 36),
        varchar("payloadDigest", 64),
        varchar("outcome", 16),
        varchar("state", 32, false),
        integer("revision"),
        text("resultEnvelope", false),
        datetime("createdAt"),
        datetime("expiresAt"),
      ],
      [
        index("grant_operation_unique", ["grantId", "operationId"], "unique"),
        index("expiry", ["expiresAt"]),
      ],
    ),
  ];
}

export function createDay4AdditiveMigration(
  currentTables: readonly AppwriteTableDefinition[],
  ids: Day4SchemaIds = canonicalDay4SchemaIds,
): AdditiveTableMigration {
  const additions = createDay4TableDefinitions(ids);
  const existing = new Set(currentTables.map(({ id }) => id));
  return planAdditiveTableMigration({
    version: "day4-control-plane-v1",
    currentTables,
    targetTables: [
      ...currentTables,
      ...additions.filter(({ id }) => !existing.has(id)),
    ],
    additiveTableIds: additions.map(({ id }) => id),
  });
}
