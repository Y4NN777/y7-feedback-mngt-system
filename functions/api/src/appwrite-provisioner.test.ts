import { describe, expect, it } from "vitest";

import type { ServerConfig } from "@y7-feedback/config/server";

import {
  provisionAppwriteInfrastructure,
  safeAppwriteProvisioningErrorCode,
  type AppwriteProvisioningPort,
  type ExistingAppwriteBucket,
  type ExistingAppwriteDatabase,
  type ExistingAppwriteTable,
} from "./appwrite-provisioner";
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

class MemoryProvisioningPort implements AppwriteProvisioningPort {
  database: ExistingAppwriteDatabase | null = null;
  readonly tables = new Map<string, ExistingAppwriteTable>();
  bucket: ExistingAppwriteBucket | null = null;
  readonly mutations: string[] = [];

  async getDatabase() {
    return Promise.resolve(this.database);
  }

  createDatabase(definition: ExistingAppwriteDatabase) {
    this.mutations.push(`database:${definition.id}`);
    this.database = definition;
    return Promise.resolve();
  }

  async getTable(_databaseId: string, tableId: string) {
    return Promise.resolve(this.tables.get(tableId) ?? null);
  }

  createTable(_databaseId: string, definition: ExistingAppwriteTable) {
    this.mutations.push(`table:${definition.id}`);
    this.tables.set(definition.id, definition);
    return Promise.resolve();
  }

  async getBucket() {
    return Promise.resolve(this.bucket);
  }

  createBucket(definition: ExistingAppwriteBucket) {
    this.mutations.push(`bucket:${definition.id}`);
    this.bucket = definition;
    return Promise.resolve();
  }
}

describe("Appwrite infrastructure provisioner", () => {
  it("BDD-INFRA-005 creates every absent resource from the manifest", async () => {
    const port = new MemoryProvisioningPort();
    const manifest = createAppwriteInfrastructureManifest(schema);
    const resourceCount = manifest.tables.length + 2;

    await expect(provisionAppwriteInfrastructure(port, manifest)).resolves.toEqual({
      created: resourceCount,
      verified: 0,
    });
    expect(port.mutations).toEqual([
      "database:feedback",
      ...manifest.tables.map(({ id }) => `table:${id}`),
      "bucket:private_attachments",
    ]);
  });

  it("BDD-INFRA-006 verifies a conforming replay without mutation", async () => {
    const port = new MemoryProvisioningPort();
    const manifest = createAppwriteInfrastructureManifest(schema);
    const resourceCount = manifest.tables.length + 2;
    await provisionAppwriteInfrastructure(port, manifest);
    port.mutations.length = 0;

    await expect(provisionAppwriteInfrastructure(port, manifest)).resolves.toEqual({
      created: 0,
      verified: resourceCount,
    });
    expect(port.mutations).toEqual([]);
  });

  it("BDD-INFRA-007 rejects drift before creating any absent resource", async () => {
    const port = new MemoryProvisioningPort();
    const manifest = createAppwriteInfrastructureManifest(schema);
    port.database = manifest.database;
    const projects = manifest.tables.find(({ id }) => id === "projects");
    if (!projects) throw new Error("test manifest lacks projects");
    port.tables.set("projects", {
      ...projects,
      permissions: ['read("any")'],
    });

    await expect(provisionAppwriteInfrastructure(port, manifest)).rejects.toThrow(
      "APPWRITE_INFRASTRUCTURE_DRIFT:table:projects",
    );
    expect(port.mutations).toEqual([]);
  });

  it("BDD-INFRA-012 redacts unexpected SDK errors", () => {
    expect(
      safeAppwriteProvisioningErrorCode(
        new Error("request failed with API key server-only-secret"),
      ),
    ).toBe("APPWRITE_PROVISION_FAILED");
    expect(
      safeAppwriteProvisioningErrorCode(
        new Error("APPWRITE_INFRASTRUCTURE_DRIFT:table:projects"),
      ),
    ).toBe("APPWRITE_INFRASTRUCTURE_DRIFT:table:projects");
  });
});
