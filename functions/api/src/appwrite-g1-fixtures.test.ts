import { describe, expect, it } from "vitest";

import type { ServerConfig } from "@y7-feedback/config/server";

import {
  createG1FixtureRows,
  seedG1Fixtures,
  type G1FixtureRow,
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
  administrationAuditTableId: "administration_audit",
  administrationIdempotencyTableId: "administration_idempotency",
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

  commitTransaction(_transactionId: string) {
    void _transactionId;
    return Promise.resolve();
  }

  rollbackTransaction(_transactionId: string) {
    void _transactionId;
    return Promise.resolve();
  }
}

class FailingFixtureStore extends MemoryFixtureStore {
  readonly rolledBack: string[] = [];
  failCommit = false;
  failCreate = false;
  failRollback = false;

  override createRow(input: Parameters<MemoryFixtureStore["createRow"]>[0]) {
    if (this.failCreate) return Promise.reject(new Error("create failed"));
    return super.createRow(input);
  }

  override commitTransaction(_transactionId: string) {
    void _transactionId;
    if (this.failCommit) return Promise.reject(new Error("commit failed"));
    return Promise.resolve();
  }

  override rollbackTransaction(transactionId: string) {
    this.rolledBack.push(transactionId);
    if (this.failRollback) return Promise.reject(new Error("rollback failed"));
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

  it("BDD-G1-FIX-003A compares nested fixture values canonically", async () => {
    const store = new MemoryFixtureStore();
    const rows: readonly G1FixtureRow[] = [
      {
        tableId: "projects",
        rowId: "project_nested",
        permissions: [],
        data: { context: [{ enabled: true, key: "route" }] },
      },
    ];
    store.rows.set("projects:project_nested", {
      context: [{ key: "route", enabled: true }],
    });

    await expect(seedG1Fixtures(store, rows)).resolves.toEqual({
      created: 0,
      verified: 1,
    });
  });

  it("BDD-G1-FIX-007 rolls back failed row creation and commit", async () => {
    const rows = createG1FixtureRows(schema);
    const createFailure = new FailingFixtureStore();
    createFailure.failCreate = true;
    const commitFailure = new FailingFixtureStore();
    commitFailure.failCommit = true;

    await expect(seedG1Fixtures(createFailure, rows)).rejects.toThrow("create failed");
    await expect(seedG1Fixtures(commitFailure, rows)).rejects.toThrow("commit failed");
    expect(createFailure.rolledBack).toEqual(["transaction_1"]);
    expect(commitFailure.rolledBack).toEqual(["transaction_1"]);
  });

  it("BDD-G1-FIX-008 preserves the originating failure when rollback also fails", async () => {
    const store = new FailingFixtureStore();
    store.failCreate = true;
    store.failRollback = true;

    await expect(seedG1Fixtures(store, createG1FixtureRows(schema))).rejects.toThrow(
      "create failed",
    );
    expect(store.rolledBack).toEqual(["transaction_1"]);
  });
});
