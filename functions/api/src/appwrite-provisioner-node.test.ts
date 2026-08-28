import { describe, expect, it, vi } from "vitest";

import { createNodeAppwriteProvisioningPort } from "./appwrite-provisioner-node";
import { createAppwriteInfrastructureManifest } from "./appwrite-schema";

const manifest = createAppwriteInfrastructureManifest({
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
  notificationSignalsTableId: "notification_signals",
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
  publicationConsentsTableId: "publication_consents",
  externalIssueLinksTableId: "external_issue_links",
  providerOutboxTableId: "provider_outbox",
});

function projectsTable() {
  const definition = manifest.tables.find(({ id }) => id === "projects");
  if (!definition) throw new Error("test manifest lacks projects");
  return definition;
}

function clients() {
  return {
    tables: {
      get: vi.fn(),
      create: vi.fn(),
      getTable: vi.fn(),
      createTable: vi.fn(),
      createBooleanColumn: vi.fn(),
      createDatetimeColumn: vi.fn(),
      createIntegerColumn: vi.fn(),
      createTextColumn: vi.fn(),
      createVarcharColumn: vi.fn(),
    },
    storage: {
      getBucket: vi.fn(),
      createBucket: vi.fn(),
    },
  };
}

describe("Node Appwrite provisioning adapter", () => {
  it("BDD-INFRA-007 reads and creates a database without widening its definition", async () => {
    const sdk = clients();
    sdk.tables.get.mockResolvedValue({
      $id: "feedback",
      name: "Feedback",
      enabled: true,
    });
    sdk.tables.create.mockResolvedValue({});
    const port = createNodeAppwriteProvisioningPort(sdk.tables, sdk.storage);

    await expect(port.getDatabase("feedback")).resolves.toEqual({
      id: "feedback",
      name: "Feedback",
      enabled: true,
    });
    await port.createDatabase(manifest.database);

    expect(sdk.tables.get).toHaveBeenCalledWith({ databaseId: "feedback" });
    expect(sdk.tables.create).toHaveBeenCalledWith({
      databaseId: "feedback",
      name: "Y7 Feedback",
      enabled: true,
    });
  });

  it("BDD-INFRA-008 maps only a 404 to an absent resource", async () => {
    const sdk = clients();
    sdk.tables.get.mockRejectedValueOnce({ code: 404 });
    sdk.storage.getBucket.mockRejectedValueOnce(new Error("transport failed"));
    const port = createNodeAppwriteProvisioningPort(sdk.tables, sdk.storage);

    await expect(port.getDatabase("feedback")).resolves.toBeNull();
    await expect(port.getBucket("private_attachments")).rejects.toThrow(
      "transport failed",
    );
  });

  it("BDD-INFRA-009 translates manifest tables to the Node SDK without widening permissions", async () => {
    const sdk = clients();
    const port = createNodeAppwriteProvisioningPort(sdk.tables, sdk.storage);
    const definition = projectsTable();
    sdk.tables.createTable.mockResolvedValue({});

    await port.createTable("feedback", definition);

    expect(sdk.tables.createTable).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "projects",
      name: "Projects",
      permissions: [],
      rowSecurity: true,
      enabled: true,
      columns: definition.columns,
      indexes: definition.indexes.map(({ key, type, columns }) => ({
        key,
        type,
        attributes: columns,
      })),
    });
  });

  it("BDD-INFRA-014 translates additive optional columns without defaults", async () => {
    const sdk = clients();
    const port = createNodeAppwriteProvisioningPort(sdk.tables, sdk.storage);
    await port.createColumn("feedback", "feedback_items", {
      key: "assignedMaintainerId",
      type: "varchar",
      size: 36,
      required: false,
    });
    await port.createColumn("feedback", "feedback_items", {
      key: "deletedAt",
      type: "datetime",
      required: false,
    });
    await port.createColumn("feedback", "feedback_items", {
      key: "active",
      type: "boolean",
      required: false,
    });
    await port.createColumn("feedback", "feedback_items", {
      key: "count",
      type: "integer",
      required: false,
    });
    await port.createColumn("feedback", "feedback_items", {
      key: "secret",
      type: "text",
      required: false,
      encrypt: true,
    });
    await port.createColumn("feedback", "feedback_items", {
      key: "description",
      type: "text",
      required: false,
    });
    await port.createColumn("feedback", "feedback_items", {
      key: "proof",
      type: "varchar",
      size: 128,
      required: false,
      encrypt: true,
    });
    expect(sdk.tables.createVarcharColumn).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "feedback_items",
      key: "assignedMaintainerId",
      size: 36,
      required: false,
    });
    expect(sdk.tables.createDatetimeColumn).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "feedback_items",
      key: "deletedAt",
      required: false,
    });
    expect(sdk.tables.createBooleanColumn).toHaveBeenCalledWith(
      expect.objectContaining({ key: "active" }),
    );
    expect(sdk.tables.createIntegerColumn).toHaveBeenCalledWith(
      expect.objectContaining({ key: "count" }),
    );
    expect(sdk.tables.createTextColumn).toHaveBeenCalledWith(
      expect.objectContaining({ key: "secret", encrypt: true }),
    );
    expect(sdk.tables.createVarcharColumn).toHaveBeenCalledWith(
      expect.objectContaining({ key: "proof", encrypt: true }),
    );
  });

  it("BDD-INFRA-010 normalizes SDK metadata before drift comparison", async () => {
    const sdk = clients();
    const definition = projectsTable();
    sdk.tables.getTable.mockResolvedValue({
      $id: definition.id,
      name: definition.name,
      $permissions: [],
      rowSecurity: true,
      enabled: true,
      columns: definition.columns.map((column) => ({
        ...column,
        status: "available",
        error: "",
        $createdAt: "ignored",
        $updatedAt: "ignored",
      })),
      indexes: definition.indexes.map((item) => ({
        ...item,
        status: "available",
        error: "",
        $id: item.key,
        $createdAt: "ignored",
        $updatedAt: "ignored",
        lengths: [],
      })),
    });
    const port = createNodeAppwriteProvisioningPort(sdk.tables, sdk.storage);

    await expect(port.getTable("feedback", "projects")).resolves.toEqual(definition);
  });

  it("BDD-INFRA-010A normalizes every supported column and index variant", async () => {
    const sdk = clients();
    sdk.tables.getTable.mockResolvedValue({
      $id: "all_types",
      name: "All types",
      $permissions: [],
      rowSecurity: true,
      enabled: true,
      columns: [
        { key: "active", type: "boolean", required: true },
        { key: "count", type: "integer", required: false },
        { key: "createdAt", type: "datetime", required: true },
        { key: "slug", type: "varchar", size: 64, required: true },
        { key: "proof", type: "varchar", size: 128, required: true, encrypt: true },
        { key: "description", type: "text", required: false },
        { key: "secret", type: "text", required: true, encrypt: true },
      ],
      indexes: [
        { key: "by_slug", type: "key", columns: ["slug"] },
        { key: "unique_proof", type: "unique", columns: ["proof"] },
      ],
    });
    const port = createNodeAppwriteProvisioningPort(sdk.tables, sdk.storage);

    await expect(port.getTable("feedback", "all_types")).resolves.toEqual({
      id: "all_types",
      name: "All types",
      permissions: [],
      rowSecurity: true,
      enabled: true,
      columns: [
        { key: "active", type: "boolean", required: true },
        { key: "count", type: "integer", required: false },
        { key: "createdAt", type: "datetime", required: true },
        { key: "slug", type: "varchar", size: 64, required: true },
        { key: "proof", type: "varchar", size: 128, required: true, encrypt: true },
        { key: "description", type: "text", required: false },
        { key: "secret", type: "text", required: true, encrypt: true },
      ],
      indexes: [
        { key: "by_slug", type: "key", columns: ["slug"] },
        { key: "unique_proof", type: "unique", columns: ["proof"] },
      ],
    });
  });

  it.each([
    ["database record", "database", null],
    ["database identifier", "database", { $id: 7, name: "Feedback", enabled: true }],
    ["database name", "database", { $id: "feedback", name: 7, enabled: true }],
    [
      "database enabled flag",
      "database",
      { $id: "feedback", name: "Feedback", enabled: "yes" },
    ],
    ["table record", "table", null],
    ["table columns", "table", { columns: {}, indexes: [] }],
    ["table indexes", "table", { columns: [], indexes: {} }],
    [
      "table permissions",
      "table",
      {
        $id: "items",
        name: "Items",
        $permissions: [7],
        rowSecurity: true,
        enabled: true,
        columns: [],
        indexes: [],
      },
    ],
    [
      "column record",
      "table",
      {
        $id: "items",
        name: "Items",
        $permissions: [],
        rowSecurity: true,
        enabled: true,
        columns: [null],
        indexes: [],
      },
    ],
    [
      "column key",
      "table",
      {
        $id: "items",
        name: "Items",
        $permissions: [],
        rowSecurity: true,
        enabled: true,
        columns: [{ key: 7, type: "text", required: true }],
        indexes: [],
      },
    ],
    [
      "column type",
      "table",
      {
        $id: "items",
        name: "Items",
        $permissions: [],
        rowSecurity: true,
        enabled: true,
        columns: [{ key: "value", type: 7, required: true }],
        indexes: [],
      },
    ],
    [
      "column required flag",
      "table",
      {
        $id: "items",
        name: "Items",
        $permissions: [],
        rowSecurity: true,
        enabled: true,
        columns: [{ key: "value", type: "text", required: "yes" }],
        indexes: [],
      },
    ],
    [
      "varchar size type",
      "table",
      {
        $id: "items",
        name: "Items",
        $permissions: [],
        rowSecurity: true,
        enabled: true,
        columns: [{ key: "value", type: "varchar", size: "64", required: true }],
        indexes: [],
      },
    ],
    [
      "varchar unsafe size",
      "table",
      {
        $id: "items",
        name: "Items",
        $permissions: [],
        rowSecurity: true,
        enabled: true,
        columns: [
          {
            key: "value",
            type: "varchar",
            size: Number.MAX_SAFE_INTEGER + 1,
            required: true,
          },
        ],
        indexes: [],
      },
    ],
    [
      "unsupported column",
      "table",
      {
        $id: "items",
        name: "Items",
        $permissions: [],
        rowSecurity: true,
        enabled: true,
        columns: [{ key: "value", type: "float", required: true }],
        indexes: [],
      },
    ],
    [
      "index record",
      "table",
      {
        $id: "items",
        name: "Items",
        $permissions: [],
        rowSecurity: true,
        enabled: true,
        columns: [],
        indexes: [null],
      },
    ],
    [
      "index type",
      "table",
      {
        $id: "items",
        name: "Items",
        $permissions: [],
        rowSecurity: true,
        enabled: true,
        columns: [],
        indexes: [{ key: "by_value", type: 7, columns: ["value"] }],
      },
    ],
    [
      "unsupported index",
      "table",
      {
        $id: "items",
        name: "Items",
        $permissions: [],
        rowSecurity: true,
        enabled: true,
        columns: [],
        indexes: [{ key: "by_value", type: "fulltext", columns: ["value"] }],
      },
    ],
    [
      "index columns type",
      "table",
      {
        $id: "items",
        name: "Items",
        $permissions: [],
        rowSecurity: true,
        enabled: true,
        columns: [],
        indexes: [{ key: "by_value", type: "key", columns: {} }],
      },
    ],
    [
      "index column value",
      "table",
      {
        $id: "items",
        name: "Items",
        $permissions: [],
        rowSecurity: true,
        enabled: true,
        columns: [],
        indexes: [{ key: "by_value", type: "key", columns: [7] }],
      },
    ],
    ["bucket record", "bucket", null],
    [
      "bucket file size",
      "bucket",
      {
        $id: "files",
        name: "Files",
        $permissions: [],
        fileSecurity: true,
        enabled: true,
        maximumFileSize: 1.5,
        allowedFileExtensions: [],
        compression: "none",
        encryption: true,
        antivirus: true,
        transformations: false,
      },
    ],
  ])("BDD-INFRA-010B rejects invalid %s metadata", async (_case, resource, value) => {
    const sdk = clients();
    if (resource === "database") sdk.tables.get.mockResolvedValue(value);
    if (resource === "table") sdk.tables.getTable.mockResolvedValue(value);
    if (resource === "bucket") sdk.storage.getBucket.mockResolvedValue(value);
    const port = createNodeAppwriteProvisioningPort(sdk.tables, sdk.storage);
    const request =
      resource === "database"
        ? port.getDatabase("feedback")
        : resource === "table"
          ? port.getTable("feedback", "items")
          : port.getBucket("files");

    await expect(request).rejects.toThrow("APPWRITE_INFRASTRUCTURE_INVALID");
  });

  it("BDD-INFRA-011 creates a private encrypted antivirus bucket", async () => {
    const sdk = clients();
    const port = createNodeAppwriteProvisioningPort(sdk.tables, sdk.storage);
    sdk.storage.createBucket.mockResolvedValue({});

    await port.createBucket(manifest.attachmentBucket);

    expect(sdk.storage.createBucket).toHaveBeenCalledWith({
      bucketId: "private_attachments",
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

  it("BDD-INFRA-012 reads bucket metadata and rejects unsupported compression on creation", async () => {
    const sdk = clients();
    sdk.storage.getBucket.mockResolvedValue({
      $id: "private_attachments",
      name: "Private attachments",
      $permissions: [],
      fileSecurity: true,
      enabled: true,
      maximumFileSize: 10 * 1024 * 1024,
      allowedFileExtensions: [],
      compression: "none",
      encryption: true,
      antivirus: true,
      transformations: false,
    });
    const port = createNodeAppwriteProvisioningPort(sdk.tables, sdk.storage);

    await expect(port.getBucket("private_attachments")).resolves.toEqual(
      manifest.attachmentBucket,
    );
    await expect(
      port.createBucket({ ...manifest.attachmentBucket, compression: "gzip" }),
    ).rejects.toThrow("APPWRITE_INFRASTRUCTURE_INVALID");
    expect(sdk.storage.createBucket).not.toHaveBeenCalled();
  });
});
