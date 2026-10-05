import { describe, expect, it } from "vitest";
import type { TablesDB } from "node-appwrite";

import type { ProjectAdministrationCommand } from "@y7-feedback/domain";

import {
  AppwriteProjectAdministrationError,
  createAppwriteProjectAdministrationStore,
  createNodeAppwriteProjectAdministrationStore,
  type AppwriteProjectAdministrationTablesPort,
} from "./appwrite-project-administration-store";

const schema = {
  databaseId: "feedback",
  projectsTableId: "projects",
  projectSlugsTableId: "project_slugs",
  projectAssignmentsTableId: "project_assignments",
  workspaceMembershipsTableId: "workspace_memberships",
  administrationAuditTableId: "administration_audit",
  administrationIdempotencyTableId: "administration_idempotency",
};
const queries = {
  equal: (attribute: string, values: readonly (string | boolean)[]) => {
    if (attribute === "current" && values[0] !== true) {
      throw new Error("current query must preserve its boolean type");
    }
    return `equal:${attribute}:${values.map(String).join(",")}`;
  },
  limit: (limit: number) => `limit:${String(limit)}`,
};
const identity = {
  operationId: "operation_2",
  workspaceId: "workspace_1",
  projectId: "project_1",
};
const project = {
  $id: "project_1",
  workspaceId: "workspace_1",
  slug: "current-slug",
  active: true,
  enabledTypesJson: '["bug"]',
  contextDeclarationsJson: "[]",
  reporterPurposeFr: "But français",
  reporterPurposeEn: "English purpose",
};

class FakeMutationTables implements AppwriteProjectAdministrationTablesPort {
  readonly created: Array<Record<string, unknown>> = [];
  readonly updated: Array<Record<string, unknown>> = [];
  readonly transactions: Array<Record<string, unknown>> = [];
  project: unknown = project;
  idempotencyRows: readonly unknown[] = [];
  reservationRows: readonly unknown[] = [];
  currentSlugRows: readonly unknown[] = [
    {
      $id: "slug_current",
      slug: "current-slug",
      workspaceId: "workspace_1",
      projectId: "project_1",
      current: true,
    },
  ];
  membershipRows: readonly unknown[] = [
    {
      $id: "membership_maintainer",
      workspaceId: "workspace_1",
      userId: "maintainer_1",
      role: "project_maintainer",
      status: "active",
    },
  ];
  assignmentRows: readonly unknown[] = [];
  assignmentQueries: readonly string[] = [];
  failUpdateAt: number | undefined;
  transactionId = "transaction_2";
  invalidCreatedRowAt: number | undefined;
  invalidUpdatedRowAt: number | undefined;
  failRollback = false;

  createTransaction(): Promise<{ readonly $id: string }> {
    return Promise.resolve({ $id: this.transactionId });
  }

  getRow(): Promise<unknown> {
    return Promise.resolve(this.project);
  }

  listRows(
    input: Parameters<AppwriteProjectAdministrationTablesPort["listRows"]>[0],
  ): Promise<{ readonly rows: readonly unknown[] }> {
    if (input.tableId === "administration_idempotency") {
      return Promise.resolve({ rows: this.idempotencyRows });
    }
    if (input.tableId === "workspace_memberships") {
      return Promise.resolve({ rows: this.membershipRows });
    }
    if (input.tableId === "project_assignments") {
      this.assignmentQueries = input.queries;
      return Promise.resolve({ rows: this.assignmentRows });
    }
    const current = input.queries.some((query) => query === "equal:current:true");
    return Promise.resolve({
      rows: current ? this.currentSlugRows : this.reservationRows,
    });
  }

  createRow(
    input: Parameters<AppwriteProjectAdministrationTablesPort["createRow"]>[0],
  ): Promise<unknown> {
    this.created.push(input);
    return Promise.resolve({
      $id: this.created.length === this.invalidCreatedRowAt ? "wrong_row" : input.rowId,
    });
  }

  updateRow(
    input: Parameters<AppwriteProjectAdministrationTablesPort["updateRow"]>[0],
  ): Promise<unknown> {
    this.updated.push(input);
    return this.updated.length === this.failUpdateAt
      ? Promise.reject(new Error("forced update failure"))
      : Promise.resolve({
          $id:
            this.updated.length === this.invalidUpdatedRowAt
              ? "wrong_row"
              : input.rowId,
        });
  }

  updateTransaction(
    input: Parameters<AppwriteProjectAdministrationTablesPort["updateTransaction"]>[0],
  ): Promise<unknown> {
    this.transactions.push(input);
    if (input.rollback === true && this.failRollback) {
      return Promise.reject(new Error("forced rollback failure"));
    }
    return Promise.resolve({ $id: "transaction_2" });
  }
}

function mutate(
  tables: FakeMutationTables,
  command: Exclude<ProjectAdministrationCommand, { kind: "create_project" }>,
) {
  return createAppwriteProjectAdministrationStore(tables, schema, queries).mutate({
    command,
    actorId: "owner_1",
    auditId: "audit_2",
    occurredAt: "2026-08-28T10:00:00.000Z",
    payloadDigest: "digest_2",
  });
}

describe("Appwrite Project administration mutations", () => {
  it("BDD-ADMIN-003 replaces the complete validated Project configuration", async () => {
    const tables = new FakeMutationTables();
    const command = {
      kind: "configure_project" as const,
      ...identity,
      enabledTypes: ["bug", "review"] as const,
      contextDeclarations: [
        { name: "version", type: "string" as const, purpose: "Reproduce" },
      ],
      reporterPurpose: { fr: "Nouveau but", en: "New purpose" },
    };

    await expect(mutate(tables, command)).resolves.toMatchObject({
      status: "applied",
      action: "configure_project",
    });
    expect(tables.updated).toHaveLength(1);
    expect(tables.updated[0]).toMatchObject({
      tableId: "projects",
      rowId: "project_1",
      transactionId: "transaction_2",
      data: {
        enabledTypesJson: '["bug","review"]',
        contextDeclarationsJson:
          '[{"name":"version","type":"string","purpose":"Reproduce"}]',
        reporterPurposeFr: "Nouveau but",
        reporterPurposeEn: "New purpose",
      },
    });
    expect(tables.created.map((row) => row.tableId)).toEqual([
      "administration_audit",
      "administration_idempotency",
    ]);
  });

  it("BDD-ADMIN-006 keeps historical slug reservation and creates a canonical one", async () => {
    const tables = new FakeMutationTables();

    await expect(
      mutate(tables, {
        kind: "rename_project",
        ...identity,
        slug: "new-slug",
      }),
    ).resolves.toMatchObject({
      status: "applied",
      action: "rename_project",
      slug: "new-slug",
    });
    expect(tables.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableId: "project_slugs",
          rowId: "slug_current",
          data: { current: false },
        }),
        expect.objectContaining({
          tableId: "projects",
          rowId: "project_1",
          data: { slug: "new-slug" },
        }),
      ]),
    );
    expect(tables.created.map((row) => row.tableId)).toEqual([
      "project_slugs",
      "administration_audit",
      "administration_idempotency",
    ]);
  });

  it("BDD-ADMIN-007 changes activation exactly once", async () => {
    const tables = new FakeMutationTables();
    await expect(
      mutate(tables, {
        kind: "set_project_activation",
        ...identity,
        active: false,
      }),
    ).resolves.toMatchObject({
      status: "applied",
      action: "set_project_activation",
      active: false,
    });
    expect(tables.updated[0]).toMatchObject({ data: { active: false } });
  });

  it("BDD-ADMIN-008 assigns an eligible Maintainer and removes access immediately", async () => {
    const assigned = new FakeMutationTables();
    await expect(
      mutate(assigned, {
        kind: "assign_maintainer",
        ...identity,
        maintainerId: "maintainer_1",
      }),
    ).resolves.toMatchObject({
      status: "applied",
      action: "assign_maintainer",
      maintainerId: "maintainer_1",
    });
    expect(assigned.created[0]?.tableId).toBe("project_assignments");
    expect(String(assigned.created[0]?.rowId)).toHaveLength(36);
    expect((assigned.created[0]?.data as Record<string, unknown>).status).toBe(
      "active",
    );
    expect(assigned.assignmentQueries).toEqual([
      "equal:projectId:project_1",
      "equal:userId:maintainer_1",
      "limit:2",
    ]);

    const removed = new FakeMutationTables();
    removed.assignmentRows = [
      {
        $id: "assignment_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        userId: "maintainer_1",
        status: "active",
      },
    ];
    await expect(
      mutate(removed, {
        kind: "remove_maintainer",
        ...identity,
        operationId: "operation_3",
        maintainerId: "maintainer_1",
      }),
    ).resolves.toMatchObject({ action: "remove_maintainer" });
    expect(removed.updated[0]?.tableId).toBe("project_assignments");
    expect(removed.updated[0]?.rowId).toBe("assignment_1");
    expect((removed.updated[0]?.data as Record<string, unknown>).status).toBe(
      "inactive",
    );
  });

  it("BDD-ADMIN-004 and BDD-ADMIN-007 reject every no-op without facts", async () => {
    for (const command of [
      {
        kind: "configure_project" as const,
        ...identity,
        ...{
          enabledTypes: ["bug"] as const,
          contextDeclarations: [] as const,
          reporterPurpose: { fr: "But français", en: "English purpose" },
        },
      },
      { kind: "rename_project" as const, ...identity, slug: "current-slug" },
      { kind: "set_project_activation" as const, ...identity, active: true },
    ]) {
      const tables = new FakeMutationTables();
      await expect(mutate(tables, command)).rejects.toEqual(
        new AppwriteProjectAdministrationError("ERR-ADMIN-MUTATION-INVALID"),
      );
      expect(tables.created).toHaveLength(0);
      expect(tables.updated).toHaveLength(0);
    }
  });

  it("BDD-ADMIN-002 denies a cross-Workspace Project without mutation", async () => {
    const tables = new FakeMutationTables();
    tables.project = { ...project, workspaceId: "workspace_2" };
    await expect(
      mutate(tables, { kind: "rename_project", ...identity, slug: "new-slug" }),
    ).rejects.toEqual(new AppwriteProjectAdministrationError("ERR-ADMIN-DENIED"));
    expect(tables.created).toHaveLength(0);
  });

  it("BDD-ADMIN-005 rejects current or historical slug reuse", async () => {
    const tables = new FakeMutationTables();
    tables.reservationRows = [{ $id: "historical_slug" }];
    await expect(
      mutate(tables, { kind: "rename_project", ...identity, slug: "new-slug" }),
    ).rejects.toEqual(
      new AppwriteProjectAdministrationError("ERR-ADMIN-SLUG-RESERVED"),
    );
    expect(tables.updated).toHaveLength(0);
  });

  it("BDD-ADMIN-009 replays a completed mutation without duplicate facts", async () => {
    const tables = new FakeMutationTables();
    tables.idempotencyRows = [
      {
        $id: "idempotency_2",
        workspaceId: "workspace_1",
        operationId: "operation_2",
        payloadDigest: "digest_2",
        action: "set_project_activation",
        resultJson:
          '{"projectId":"project_1","action":"set_project_activation","active":false}',
      },
    ];
    await expect(
      mutate(tables, {
        kind: "set_project_activation",
        ...identity,
        active: false,
      }),
    ).resolves.toMatchObject({ status: "replayed", active: false });
    expect(tables.created).toHaveLength(0);
    expect(tables.updated).toHaveLength(0);
  });

  it("BDD-ADMIN-011 rolls back a failed mutation and exposes retryable only", async () => {
    const tables = new FakeMutationTables();
    tables.failUpdateAt = 1;
    await expect(
      mutate(tables, {
        kind: "set_project_activation",
        ...identity,
        active: false,
      }),
    ).rejects.toEqual(new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE"));
    expect(tables.transactions.at(-1)).toEqual({
      transactionId: "transaction_2",
      rollback: true,
    });
  });

  it("BDD-ADMIN-009 rejects conflicting, ambiguous, or corrupt replays", async () => {
    const valid = {
      $id: "idempotency_2",
      workspaceId: "workspace_1",
      operationId: "operation_2",
      payloadDigest: "digest_2",
      action: "set_project_activation",
      resultJson:
        '{"projectId":"project_1","action":"set_project_activation","active":false}',
    };
    for (const rows of [
      [valid, valid],
      [{ ...valid, payloadDigest: "different" }],
      [{ ...valid, workspaceId: "workspace_2" }],
      [{ ...valid, resultJson: "not-json" }],
      [{ ...valid, resultJson: "{}" }],
    ]) {
      const tables = new FakeMutationTables();
      tables.idempotencyRows = rows;
      await expect(
        mutate(tables, {
          kind: "set_project_activation",
          ...identity,
          active: false,
        }),
      ).rejects.toBeInstanceOf(AppwriteProjectAdministrationError);
      expect(tables.created).toHaveLength(0);
    }
  });

  it("BDD-ADMIN-002 fails closed for malformed authoritative Project state", async () => {
    for (const malformed of [
      undefined,
      { ...project, $id: "other_project" },
      { ...project, enabledTypesJson: 1 },
      { ...project, enabledTypesJson: "{}" },
      { ...project, contextDeclarationsJson: "{}" },
      { ...project, reporterPurposeFr: " " },
    ]) {
      const tables = new FakeMutationTables();
      tables.project = malformed;
      await expect(
        mutate(tables, { kind: "rename_project", ...identity, slug: "new-slug" }),
      ).rejects.toEqual(new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE"));
    }
  });

  it("BDD-ADMIN-008 reactivates an eligible inactive assignment", async () => {
    const tables = new FakeMutationTables();
    tables.assignmentRows = [
      {
        $id: "assignment_1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        userId: "maintainer_1",
        status: "inactive",
      },
    ];
    await expect(
      mutate(tables, {
        kind: "assign_maintainer",
        ...identity,
        maintainerId: "maintainer_1",
      }),
    ).resolves.toMatchObject({ status: "applied" });
    expect(tables.updated[0]?.rowId).toBe("assignment_1");
    expect((tables.updated[0]?.data as Record<string, unknown>).status).toBe("active");
  });

  it("BDD-ADMIN-008 fails closed for ineligible or ambiguous Maintainer state", async () => {
    const validAssignment = {
      $id: "assignment_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      userId: "maintainer_1",
      status: "active",
    };
    const cases = [
      { membershipRows: [] as readonly unknown[], assignmentRows: [] },
      {
        membershipRows: [
          new FakeMutationTables().membershipRows[0],
          new FakeMutationTables().membershipRows[0],
        ],
        assignmentRows: [],
      },
      { membershipRows: [], assignmentRows: [validAssignment, validAssignment] },
      { membershipRows: [], assignmentRows: [{ ...validAssignment, status: "bad" }] },
    ];
    for (const candidate of cases) {
      const tables = new FakeMutationTables();
      tables.membershipRows = candidate.membershipRows;
      tables.assignmentRows = candidate.assignmentRows;
      await expect(
        mutate(tables, {
          kind: "assign_maintainer",
          ...identity,
          maintainerId: "maintainer_1",
        }),
      ).rejects.toBeInstanceOf(AppwriteProjectAdministrationError);
    }
  });

  it("BDD-ADMIN-006 fails closed when the canonical slug row is ambiguous", async () => {
    for (const rows of [
      [],
      [
        {
          $id: "slug_current",
          slug: "current-slug",
          workspaceId: "workspace_1",
          projectId: "project_1",
          current: false,
        },
      ],
    ]) {
      const tables = new FakeMutationTables();
      tables.currentSlugRows = rows;
      await expect(
        mutate(tables, { kind: "rename_project", ...identity, slug: "new-slug" }),
      ).rejects.toEqual(new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE"));
    }
  });

  it("BDD-ADMIN-011 rejects invalid transaction and row acknowledgements", async () => {
    const invalidTransaction = new FakeMutationTables();
    invalidTransaction.transactionId = "bad/id";
    await expect(
      mutate(invalidTransaction, {
        kind: "set_project_activation",
        ...identity,
        active: false,
      }),
    ).rejects.toEqual(new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE"));

    for (const kind of ["update", "create"] as const) {
      const tables = new FakeMutationTables();
      if (kind === "update") tables.invalidUpdatedRowAt = 1;
      else tables.invalidCreatedRowAt = 1;
      tables.failRollback = true;
      await expect(
        mutate(tables, {
          kind: "set_project_activation",
          ...identity,
          active: false,
        }),
      ).rejects.toEqual(new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE"));
    }
  });

  it("uses the Node Appwrite adapter for authoritative reads and updates", async () => {
    const tables = new FakeMutationTables();
    const store = createNodeAppwriteProjectAdministrationStore(
      tables as unknown as TablesDB,
      schema,
    );
    await expect(
      store.mutate({
        command: {
          kind: "set_project_activation",
          ...identity,
          active: false,
        },
        actorId: "owner_1",
        auditId: "audit_2",
        occurredAt: "2026-08-28T10:00:00.000Z",
        payloadDigest: "digest_2",
      }),
    ).resolves.toMatchObject({ status: "applied", active: false });
  });
});
