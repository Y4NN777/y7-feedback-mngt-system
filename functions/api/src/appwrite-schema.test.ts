import { describe, expect, it } from "vitest";

import type { ServerConfig } from "@y7-feedback/config/server";

import { createAppwriteInfrastructureManifest } from "./appwrite-schema";

const schema: ServerConfig["appwriteSchema"] = {
  databaseId: "feedback",
  workspacesTableId: "workspaces",
  workspaceMembershipsTableId: "workspace_memberships",
  projectAssignmentsTableId: "project_assignments",
  projectSlugsTableId: "project_slugs",
  projectsTableId: "projects",
  reportersTableId: "reporters",
  feedbackTableId: "feedback_items",
  lifecycleTableId: "feedback_lifecycle",
  accessGrantsTableId: "access_grants",
  notificationsTableId: "notifications",
  outboxTableId: "notification_outbox",
  idempotencyTableId: "intake_idempotency",
  attachmentBucketId: "private_attachments",
  attachmentStagingTableId: "attachment_staging",
  attachmentsTableId: "attachments",
  providerGrantsTableId: "provider_grants",
  sourceConnectionsTableId: "source_connections",
  administrationAuditTableId: "administration_audit",
  administrationIdempotencyTableId: "administration_idempotency",
  conversationMessagesTableId: "conversation_messages",
  conversationInternalNotesTableId: "conversation_internal_notes",
  conversationIdempotencyTableId: "conversation_idempotency",
  conversationLifecycleTableId: "conversation_lifecycle",
};

function table(id: string) {
  const found = createAppwriteInfrastructureManifest(schema).tables.find(
    (candidate) => candidate.id === id,
  );
  if (!found) throw new Error(`missing table ${id}`);
  return found;
}

describe("Appwrite infrastructure manifest", () => {
  it("BDD-INFRA-001 declares every configured private table exactly once", () => {
    const manifest = createAppwriteInfrastructureManifest(schema);
    const expected = Object.entries(schema)
      .filter(([key]) => key.endsWith("TableId"))
      .map(([, id]) => id);

    expect(manifest.database).toEqual({
      id: "feedback",
      name: "Y7 Feedback",
      enabled: true,
    });
    expect(manifest.tables.map(({ id }) => id)).toEqual(expected);
    expect(new Set(manifest.tables.map(({ id }) => id)).size).toBe(expected.length);
    expect(
      manifest.tables.map(({ permissions, rowSecurity, enabled }) => ({
        enabled,
        permissions,
        rowSecurity,
      })),
    ).toEqual(
      manifest.tables.map(() => ({
        enabled: true,
        permissions: [],
        rowSecurity: true,
      })),
    );
  });

  it("BDD-INFRA-002 declares indexes for every concrete adapter query", () => {
    const requirements = [
      [schema.workspaceMembershipsTableId, ["workspaceId", "userId"]],
      [schema.workspaceMembershipsTableId, ["userId", "status"]],
      [schema.projectAssignmentsTableId, ["projectId", "userId"]],
      [schema.projectAssignmentsTableId, ["workspaceId", "userId", "status"]],
      [schema.projectSlugsTableId, ["slug"]],
      [schema.projectSlugsTableId, ["projectId", "current"]],
      [schema.projectsTableId, ["slug"]],
      [schema.accessGrantsTableId, ["reference"]],
      [schema.idempotencyTableId, ["scopeKey", "clientOperationId"]],
      [schema.attachmentStagingTableId, ["objectId"]],
      [schema.attachmentStagingTableId, ["objectId", "operationId"]],
      [schema.attachmentStagingTableId, ["stagedAt"]],
      [schema.attachmentsTableId, ["objectId"]],
      [schema.sourceConnectionsTableId, ["projectId", "provider"]],
      [schema.sourceConnectionsTableId, ["workspaceId", "status"]],
      [schema.administrationAuditTableId, ["workspaceId", "projectId", "occurredAt"]],
      [schema.administrationAuditTableId, ["operationId"]],
      [schema.administrationIdempotencyTableId, ["workspaceId", "operationId"]],
      [schema.conversationMessagesTableId, ["feedbackId", "occurredAt"]],
      [schema.conversationInternalNotesTableId, ["feedbackId", "occurredAt"]],
      [schema.conversationIdempotencyTableId, ["feedbackId", "operationId"]],
      [schema.conversationLifecycleTableId, ["feedbackId", "sequence"]],
    ] as const;

    for (const [tableId, queriedColumns] of requirements) {
      const indexes = table(tableId).indexes;
      expect(
        indexes.some(({ columns }) =>
          queriedColumns.every((column) => columns.includes(column)),
        ),
        `${tableId} lacks ${queriedColumns.join("+")}`,
      ).toBe(true);
    }
  });

  it("BDD-INFRA-003 reserves unqueryable columns for application envelopes", () => {
    const manifest = createAppwriteInfrastructureManifest(schema);
    const envelopeColumns = new Set([
      "reporters.attributionJson",
      "feedback_items.originalSourceJson",
      "feedback_items.currentSourceJson",
      "feedback_items.contextJson",
      "feedback_items.attachmentNamesJson",
      "feedback_items.reporterHistoryJson",
      "feedback_items.reporterMessagesJson",
      "feedback_items.reporterAttachmentsJson",
      "feedback_items.sourceRevisionsJson",
      "feedback_items.deletionRequestsJson",
      "feedback_items.internalNotesJson",
      "feedback_items.workspaceClassification",
      "access_grants.verifier",
      "notification_outbox.payloadJson",
      "intake_idempotency.protectedProof",
      "intake_idempotency.proofVerifier",
      "attachments.displayName",
      "provider_grants.envelope",
      "source_connections.selectedRepositoriesJson",
      "administration_idempotency.resultJson",
      "conversation_messages.contentEnvelope",
      "conversation_internal_notes.contentEnvelope",
      "conversation_idempotency.resultJson",
      "conversation_lifecycle.reasonEnvelope",
    ]);
    for (const definition of manifest.tables) {
      const indexed = new Set(definition.indexes.flatMap(({ columns }) => columns));
      for (const column of definition.columns) {
        const qualified = `${definition.id}.${column.key}`;
        if (!envelopeColumns.has(qualified)) continue;
        expect("encrypt" in column).toBe(false);
        expect(indexed.has(column.key)).toBe(false);
      }
    }
  });

  it("BDD-INFRA-004 declares a private encrypted antivirus attachment bucket", () => {
    expect(createAppwriteInfrastructureManifest(schema).attachmentBucket).toEqual({
      id: "private_attachments",
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
    });
  });
});
