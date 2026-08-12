import { describe, expect, it } from "vitest";

import type { ServerConfig } from "@y7-feedback/config/server";

import { createAppwriteInfrastructureManifest } from "./appwrite-schema";

const schema: ServerConfig["appwriteSchema"] = {
  databaseId: "feedback",
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

    expect(manifest.database).toEqual({ id: "feedback", name: "Y7 Feedback" });
    expect(manifest.tables.map(({ id }) => id)).toEqual(expected);
    expect(new Set(manifest.tables.map(({ id }) => id)).size).toBe(expected.length);
    expect(
      manifest.tables.map(({ permissions, rowSecurity }) => ({
        permissions,
        rowSecurity,
      })),
    ).toEqual(manifest.tables.map(() => ({ permissions: [], rowSecurity: true })));
  });

  it("BDD-INFRA-002 declares indexes for every concrete adapter query", () => {
    const requirements = [
      [schema.projectsTableId, ["slug"]],
      [schema.accessGrantsTableId, ["reference"]],
      [schema.idempotencyTableId, ["scopeKey", "clientOperationId"]],
      [schema.attachmentStagingTableId, ["objectId"]],
      [schema.attachmentStagingTableId, ["objectId", "operationId"]],
      [schema.attachmentStagingTableId, ["stagedAt"]],
      [schema.attachmentsTableId, ["objectId"]],
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

  it("BDD-INFRA-003 keeps secrets private, encrypted, and unqueryable", () => {
    const manifest = createAppwriteInfrastructureManifest(schema);
    const encrypted = new Set(
      manifest.tables.flatMap(({ id, columns }) =>
        columns
          .filter((column) => "encrypt" in column && column.encrypt)
          .map((column) => `${id}.${column.key}`),
      ),
    );

    expect(encrypted).toEqual(
      new Set([
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
      ]),
    );
    for (const definition of manifest.tables) {
      const indexed = new Set(definition.indexes.flatMap(({ columns }) => columns));
      expect(
        definition.columns.some(
          (column) => "encrypt" in column && column.encrypt && indexed.has(column.key),
        ),
      ).toBe(false);
    }
  });

  it("BDD-INFRA-004 declares a private encrypted antivirus attachment bucket", () => {
    expect(createAppwriteInfrastructureManifest(schema).attachmentBucket).toEqual({
      id: "private_attachments",
      name: "Private attachments",
      permissions: [],
      fileSecurity: true,
      maximumFileSize: 10 * 1024 * 1024,
      allowedFileExtensions: [],
      encryption: true,
      antivirus: true,
      transformations: false,
    });
  });
});
