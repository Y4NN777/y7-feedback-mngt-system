import { describe, expect, it } from "vitest";

import type { ProjectAdministrationCommand } from "@y7-feedback/domain";

import {
  AppwriteProjectAdministrationError,
  createAppwriteProjectAdministrationStore,
  type AppwriteProjectAdministrationTablesPort,
} from "./appwrite-project-administration-store";

const schema = {
  databaseId: "feedback",
  projectsTableId: "projects",
  projectSlugsTableId: "project_slugs",
  administrationAuditTableId: "administration_audit",
  administrationIdempotencyTableId: "administration_idempotency",
};
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(",")}`,
  limit: (limit: number) => `limit:${String(limit)}`,
};
const command: Extract<ProjectAdministrationCommand, { kind: "create_project" }> = {
  kind: "create_project",
  operationId: "operation_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  slug: "wise-money",
  enabledTypes: ["bug", "suggestion", "review"],
  contextDeclarations: [
    { name: "version", type: "string", purpose: "Reproduce the issue" },
  ],
  reporterPurpose: { fr: "But français", en: "English purpose" },
};

class FakeTables implements AppwriteProjectAdministrationTablesPort {
  readonly created: Array<Record<string, unknown>> = [];
  readonly transactions: Array<Record<string, unknown>> = [];
  idempotencyRows: readonly unknown[] = [];
  slugRows: readonly unknown[] = [];
  failCreateAt: number | undefined;
  failCommit = false;
  failRollback = false;
  invalidCreatedAt: number | undefined;
  transactionId = "transaction_1";

  createTransaction(): Promise<{ readonly $id: string }> {
    return Promise.resolve({ $id: this.transactionId });
  }

  listRows(
    input: Parameters<AppwriteProjectAdministrationTablesPort["listRows"]>[0],
  ): Promise<{ readonly rows: readonly unknown[] }> {
    expect(input.transactionId).toBe("transaction_1");
    return Promise.resolve({
      rows:
        input.tableId === "administration_idempotency"
          ? this.idempotencyRows
          : this.slugRows,
    });
  }

  createRow(
    input: Parameters<AppwriteProjectAdministrationTablesPort["createRow"]>[0],
  ): Promise<unknown> {
    this.created.push(input);
    if (this.created.length === this.invalidCreatedAt) {
      return Promise.resolve({ $id: "wrong_id" });
    }
    return this.created.length === this.failCreateAt
      ? Promise.reject(new Error("forced write failure"))
      : Promise.resolve({ $id: input.rowId });
  }

  updateTransaction(
    input: Parameters<AppwriteProjectAdministrationTablesPort["updateTransaction"]>[0],
  ): Promise<unknown> {
    this.transactions.push(input);
    if (input.rollback === true && this.failRollback) {
      return Promise.reject(new Error("forced rollback failure"));
    }
    if (input.commit === true && this.failCommit) {
      return Promise.reject(new Error("forced commit failure"));
    }
    return Promise.resolve({ $id: "transaction_1" });
  }
}

function execute(tables: FakeTables) {
  return createAppwriteProjectAdministrationStore(tables, schema, queries).create({
    command,
    actorId: "owner_1",
    auditId: "audit_1",
    occurredAt: "2026-08-28T09:00:00.000Z",
    payloadDigest: "digest_1",
  });
}

describe("Appwrite Project administration transaction", () => {
  it("BDD-ADMIN-001 commits Project, current slug, audit and idempotency atomically", async () => {
    const tables = new FakeTables();

    await expect(execute(tables)).resolves.toEqual({
      status: "created",
      projectId: "project_1",
      slug: "wise-money",
    });
    expect(tables.created.map((item) => item.tableId)).toEqual([
      "projects",
      "project_slugs",
      "administration_audit",
      "administration_idempotency",
    ]);
    expect(tables.created[0]).toMatchObject({
      rowId: "project_1",
      permissions: [],
      transactionId: "transaction_1",
    });
    expect(tables.created[0]?.data).toMatchObject({
      workspaceId: "workspace_1",
      slug: "wise-money",
      active: true,
      enabledTypesJson: '["bug","suggestion","review"]',
    });
    expect(tables.created[2]).toMatchObject({ rowId: "audit_1" });
    expect(tables.created[2]?.data).toMatchObject({
      actorId: "owner_1",
      action: "create_project",
      payloadDigest: "digest_1",
    });
    expect(tables.transactions).toEqual([
      { transactionId: "transaction_1", commit: true },
    ]);
  });

  it("BDD-ADMIN-009 returns the original result without duplicate writes", async () => {
    const tables = new FakeTables();
    tables.idempotencyRows = [
      {
        $id: "idempotency_1",
        workspaceId: "workspace_1",
        operationId: "operation_1",
        payloadDigest: "digest_1",
        action: "create_project",
        projectId: "project_1",
        auditId: "audit_1",
        resultJson: '{"projectId":"project_1","slug":"wise-money"}',
        createdAt: "2026-08-28T09:00:00.000Z",
      },
    ];

    await expect(execute(tables)).resolves.toEqual({
      status: "replayed",
      projectId: "project_1",
      slug: "wise-money",
    });
    expect(tables.created).toHaveLength(0);
    expect(tables.transactions).toEqual([
      { transactionId: "transaction_1", rollback: true },
    ]);
  });

  it("BDD-ADMIN-010 rejects operation reuse with a different payload", async () => {
    const tables = new FakeTables();
    tables.idempotencyRows = [
      {
        $id: "idempotency_1",
        workspaceId: "workspace_1",
        operationId: "operation_1",
        payloadDigest: "different",
        action: "create_project",
        projectId: "project_1",
        auditId: "audit_1",
        resultJson: '{"projectId":"project_1","slug":"wise-money"}',
        createdAt: "2026-08-28T09:00:00.000Z",
      },
    ];

    await expect(execute(tables)).rejects.toEqual(
      new AppwriteProjectAdministrationError("ERR-ADMIN-IDEMPOTENCY-CONFLICT"),
    );
    expect(tables.created).toHaveLength(0);
    expect(tables.transactions).toEqual([
      { transactionId: "transaction_1", rollback: true },
    ]);
  });

  it("BDD-ADMIN-005 rejects every current or historical slug reservation", async () => {
    const tables = new FakeTables();
    tables.slugRows = [{ $id: "slug_1", slug: "wise-money" }];

    await expect(execute(tables)).rejects.toEqual(
      new AppwriteProjectAdministrationError("ERR-ADMIN-SLUG-RESERVED"),
    );
    expect(tables.created).toHaveLength(0);
  });

  it("BDD-ADMIN-011 rolls back failure at every write and commit boundary", async () => {
    for (const failCreateAt of [1, 2, 3, 4]) {
      const tables = new FakeTables();
      tables.failCreateAt = failCreateAt;
      await expect(execute(tables)).rejects.toEqual(
        new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE"),
      );
      expect(tables.transactions.at(-1)).toEqual({
        transactionId: "transaction_1",
        rollback: true,
      });
    }

    const commitFailure = new FakeTables();
    commitFailure.failCommit = true;
    commitFailure.failRollback = true;
    await expect(execute(commitFailure)).rejects.toEqual(
      new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE"),
    );
    expect(commitFailure.transactions).toEqual([
      { transactionId: "transaction_1", commit: true },
      { transactionId: "transaction_1", rollback: true },
    ]);
  });

  it("fails closed for ambiguous idempotency state and invalid transaction identity", async () => {
    const ambiguous = new FakeTables();
    ambiguous.idempotencyRows = [{}, {}];
    await expect(execute(ambiguous)).rejects.toEqual(
      new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE"),
    );

    const invalidTransaction = new FakeTables();
    invalidTransaction.transactionId = "bad/id";
    await expect(execute(invalidTransaction)).rejects.toEqual(
      new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE"),
    );

    const invalidCreated = new FakeTables();
    invalidCreated.invalidCreatedAt = 2;
    await expect(execute(invalidCreated)).rejects.toEqual(
      new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE"),
    );
  });

  it("fails closed for malformed stored idempotency results", async () => {
    const base = {
      $id: "idempotency_1",
      workspaceId: "workspace_1",
      operationId: "operation_1",
      payloadDigest: "digest_1",
      action: "create_project",
      projectId: "project_1",
      auditId: "audit_1",
      resultJson: '{"projectId":"project_1","slug":"wise-money"}',
      createdAt: "2026-08-28T09:00:00.000Z",
    };
    for (const row of [
      null,
      { ...base, $id: "bad/id" },
      { ...base, workspaceId: "workspace_2" },
      { ...base, operationId: "operation_2" },
      { ...base, action: "rename_project" },
      { ...base, payloadDigest: 1 },
      { ...base, resultJson: 1 },
      { ...base, resultJson: "not-json" },
      { ...base, resultJson: "{}" },
    ]) {
      const tables = new FakeTables();
      tables.idempotencyRows = [row];
      await expect(execute(tables)).rejects.toEqual(
        new AppwriteProjectAdministrationError("ERR-ADMIN-RETRYABLE"),
      );
    }
  });

  it("rejects malformed or overlapping schema identifiers", () => {
    for (const candidate of [
      { ...schema, databaseId: "bad/id" },
      { ...schema, projectsTableId: "project_slugs" },
    ]) {
      expect(() =>
        createAppwriteProjectAdministrationStore(new FakeTables(), candidate, queries),
      ).toThrow(new Error("APPWRITE_PROJECT_ADMINISTRATION_SCHEMA_INVALID"));
    }
  });
});
