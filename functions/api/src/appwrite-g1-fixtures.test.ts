import { describe, expect, it } from "vitest";

import type { ServerConfig } from "@y7-feedback/config/server";

import {
  createG1FixtureRows,
  seedG1Fixtures,
  type G1FixtureStore,
} from "./appwrite-g1-fixtures";

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
};

class MemoryFixtureStore implements G1FixtureStore {
  readonly rows = new Map<string, Readonly<Record<string, unknown>>>();
  readonly created: string[] = [];

  getRow(tableId: string, rowId: string) {
    return Promise.resolve(this.rows.get(`${tableId}:${rowId}`) ?? null);
  }

  createTransaction() {
    return Promise.resolve("transaction_1");
  }

  createRow(input: {
    readonly tableId: string;
    readonly rowId: string;
    readonly data: Readonly<Record<string, unknown>>;
  }) {
    this.created.push(`${input.tableId}:${input.rowId}`);
    this.rows.set(`${input.tableId}:${input.rowId}`, input.data);
    return Promise.resolve();
  }

  commitTransaction() {
    return Promise.resolve();
  }

  rollbackTransaction() {
    return Promise.resolve();
  }
}

describe("real-service G1 fixtures", () => {
  it("BDD-G1-FIX-001 binds two Projects to two distinct Workspaces", () => {
    const rows = createG1FixtureRows(schema);
    const workspaces = rows.filter(({ tableId }) => tableId === "workspaces");
    const projects = rows.filter(({ tableId }) => tableId === "projects");
    const slugs = rows.filter(({ tableId }) => tableId === "project_slugs");

    expect(workspaces).toHaveLength(2);
    expect(projects.map(({ data }) => data.workspaceId)).toEqual([
      "workspace_alpha",
      "workspace_beta",
    ]);
    expect(slugs.map(({ data }) => [data.slug, data.projectId, data.current])).toEqual([
      ["wisemoney-legacy", "project_alpha", false],
      ["wisemoney", "project_alpha", true],
      ["lantern", "project_beta", true],
    ]);
    expect(rows.map(({ permissions }) => permissions)).toEqual(rows.map(() => []));
  });

  it("BDD-G1-FIX-002 seeds once and verifies an exact replay", async () => {
    const store = new MemoryFixtureStore();
    const rows = createG1FixtureRows(schema);

    await expect(seedG1Fixtures(store, rows)).resolves.toEqual({
      created: rows.length,
      verified: 0,
    });
    store.created.length = 0;
    await expect(seedG1Fixtures(store, rows)).resolves.toEqual({
      created: 0,
      verified: rows.length,
    });
    expect(store.created).toEqual([]);
  });

  it("BDD-G1-FIX-003 rejects fixture drift before starting a transaction", async () => {
    const store = new MemoryFixtureStore();
    const rows = createG1FixtureRows(schema);
    store.rows.set("workspaces:workspace_alpha", {
      ...rows[0]?.data,
      name: "Forged workspace",
    });

    await expect(seedG1Fixtures(store, rows)).rejects.toThrow(
      "APPWRITE_G1_FIXTURE_DRIFT:workspaces:workspace_alpha",
    );
    expect(store.created).toEqual([]);
  });
});
