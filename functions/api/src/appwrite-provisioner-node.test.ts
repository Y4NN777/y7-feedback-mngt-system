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
  outboxTableId: "notification_outbox",
  idempotencyTableId: "intake_idempotency",
  attachmentBucketId: "private_attachments",
  attachmentStagingTableId: "attachment_staging",
  attachmentsTableId: "attachments",
  providerGrantsTableId: "provider_grants",
  sourceConnectionsTableId: "source_connections",
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
    },
    storage: {
      getBucket: vi.fn(),
      createBucket: vi.fn(),
    },
  };
}

describe("Node Appwrite provisioning adapter", () => {
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
      indexes: definition.indexes,
    });
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
});
