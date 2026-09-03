import { describe, expect, it, vi } from "vitest";

import {
  createAppwritePrivacyStore,
  type AppwritePrivacyTables,
} from "./appwrite-privacy-store";

const schema = {
  databaseId: "feedback",
  feedbackTableId: "feedback_items",
  reportersTableId: "reporters",
  accessGrantsTableId: "access_grants",
  attachmentsTableId: "attachments",
  notificationsTableId: "notifications",
  publicationConsentsTableId: "publication_consents",
  externalIssueLinksTableId: "external_issue_links",
  offlineConflictProjectionsTableId: "offline_conflicts",
  intelligenceProvenanceTableId: "intelligence_provenance",
  deletionRecordsTableId: "deletion_records",
} as const;
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(",")}`,
  limit: (value: number) => `limit:${String(value)}`,
};
const sensitive = {
  environment: "preview" as const,
  protector: {
    activeKeyId: "key",
    seal: (_context: unknown, value: string) => value,
    open: (_context: unknown, value: string) => value,
  },
};

class FakeTables implements AppwritePrivacyTables {
  readonly rows = new Map<string, Map<string, Readonly<Record<string, unknown>>>>();
  readonly writes: Array<Readonly<Record<string, unknown>>> = [];
  readonly transactions: Array<Readonly<Record<string, unknown>>> = [];
  fail: "get" | "list" | "write" | "commit" | "rollback" | undefined;

  table(id: string) {
    let table = this.rows.get(id);
    if (!table) {
      table = new Map();
      this.rows.set(id, table);
    }
    return table;
  }

  createTransaction = vi.fn(() => Promise.resolve({ $id: "transaction_1" }));
  getRow = vi.fn((input: Parameters<AppwritePrivacyTables["getRow"]>[0]) => {
    if (this.fail === "get") return Promise.reject(new Error("transport"));
    const row = this.table(input.tableId).get(input.rowId);
    return row
      ? Promise.resolve(row)
      : Promise.reject(Object.assign(new Error("absent"), { code: 404 }));
  });
  listRows = vi.fn((input: Parameters<AppwritePrivacyTables["listRows"]>[0]) => {
    if (this.fail === "list") return Promise.reject(new Error("transport"));
    const equal = input.queries.find((query) => query.startsWith("equal:"));
    const [, field, expected] = equal?.split(":") ?? [];
    const rows = [...this.table(input.tableId).values()].filter(
      (row) => field === undefined || row[field] === expected,
    );
    return Promise.resolve({ rows });
  });
  createRow = vi.fn((input: Parameters<AppwritePrivacyTables["createRow"]>[0]) => {
    if (this.fail === "write") return Promise.reject(new Error("write"));
    const row = { $id: input.rowId, ...input.data };
    this.table(input.tableId).set(input.rowId, row);
    this.writes.push({ kind: "create", ...input });
    return Promise.resolve(row);
  });
  updateRow = vi.fn((input: Parameters<AppwritePrivacyTables["updateRow"]>[0]) => {
    if (this.fail === "write") return Promise.reject(new Error("write"));
    const row = { ...this.table(input.tableId).get(input.rowId), ...input.data };
    this.table(input.tableId).set(input.rowId, row);
    this.writes.push({ kind: "update", ...input });
    return Promise.resolve(row);
  });
  deleteRow = vi.fn((input: Parameters<AppwritePrivacyTables["deleteRow"]>[0]) => {
    if (this.fail === "write") return Promise.reject(new Error("write"));
    this.table(input.tableId).delete(input.rowId);
    this.writes.push({ kind: "delete", ...input });
    return Promise.resolve({});
  });
  updateTransaction = vi.fn(
    (input: Parameters<AppwritePrivacyTables["updateTransaction"]>[0]) => {
      this.transactions.push(input);
      if (
        (input.commit && this.fail === "commit") ||
        (input.rollback && this.fail === "rollback")
      )
        return Promise.reject(new Error("transaction"));
      return Promise.resolve({});
    },
  );
}

function setup(
  sharedReporter = false,
  now: string | (() => string) = "2026-09-02T00:00:00.000Z",
  createId = (() => {
    let index = 0;
    return () => `generated_${String(++index)}`;
  })(),
) {
  const tables = new FakeTables();
  tables.table(schema.feedbackTableId).set("feedback_1", {
    $id: "feedback_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    reporterId: "reporter_1",
    deletedAt: null,
  });
  if (sharedReporter)
    tables.table(schema.feedbackTableId).set("feedback_2", {
      $id: "feedback_2",
      workspaceId: "workspace_1",
      projectId: "project_1",
      reporterId: "reporter_1",
      deletedAt: null,
    });
  tables.table(schema.reportersTableId).set("reporter_1", {
    $id: "reporter_1",
    workspaceId: "workspace_1",
    attributionJson: JSON.stringify({ kind: "contact" }),
  });
  for (const [tableId, rowId, data] of [
    [
      schema.accessGrantsTableId,
      "grant_1",
      { feedbackId: "feedback_1", status: "active" },
    ],
    [
      schema.attachmentsTableId,
      "attachment_1",
      { feedbackId: "feedback_1", lifecycle: "available" },
    ],
    [schema.notificationsTableId, "notification_1", { feedbackId: "feedback_1" }],
    [
      schema.offlineConflictProjectionsTableId,
      "offline_1",
      { feedbackId: "feedback_1" },
    ],
    [schema.intelligenceProvenanceTableId, "theme_1", { feedbackId: "feedback_1" }],
    [
      schema.externalIssueLinksTableId,
      "link_1",
      { feedbackId: "feedback_1", synchronizationState: "current" },
    ],
    [
      schema.publicationConsentsTableId,
      "consent_1",
      {
        feedbackId: "feedback_1",
        reporterId: "reporter_1",
        version: 1,
        state: "active",
        disclosureVersion: "v1",
        audience: "public",
      },
    ],
  ] as const)
    tables.table(tableId).set(rowId, { $id: rowId, ...data });
  let eventIndex = 0;
  const store = createAppwritePrivacyStore(tables, schema, queries, sensitive, {
    createId,
    createEventId: () => `event_${String(++eventIndex)}`,
    now: typeof now === "string" ? () => now : now,
  });
  return { store, tables };
}

const request = {
  workspaceId: "workspace_1",
  projectId: "project_1",
  actorDigest: "a".repeat(64),
  requesterKind: "access_proof" as const,
  requesterDigest: "b".repeat(64),
  command: {
    kind: "request_deletion" as const,
    operationId: "operation_1",
    feedbackId: "feedback_1",
    reasonCode: "reporter_request",
  },
};

describe("Appwrite privacy store", () => {
  it("BDD-PRIV-018 derives exact scope without disclosing absent feedback", async () => {
    const { store, tables } = setup();
    await expect(store.resolveScope?.("feedback_1")).resolves.toEqual({
      workspaceId: "workspace_1",
      projectId: "project_1",
    });
    await expect(store.resolveScope?.("missing")).resolves.toEqual({
      status: "denied",
    });
    tables.fail = "get";
    await expect(store.resolveScope?.("feedback_1")).resolves.toEqual({
      status: "retryable",
    });
    tables.fail = undefined;
    tables.table(schema.feedbackTableId).set("malformed", {
      $id: "malformed",
      workspaceId: "bad id",
      projectId: "project_1",
    });
    await expect(store.resolveScope?.("malformed")).resolves.toEqual({
      status: "retryable",
    });
  });
  it("BDD-PRIV-020 atomically hides, revokes, anonymizes and removes projections", async () => {
    const { store, tables } = setup();
    await expect(store.execute(request)).resolves.toEqual({
      status: "applied",
      feedbackId: "feedback_1",
      revision: 1,
      purgeEligibleAt: "2026-10-02T00:00:00.000Z",
    });
    expect(tables.table(schema.feedbackTableId).get("feedback_1")?.deletedAt).toBe(
      "2026-09-02T00:00:00.000Z",
    );
    expect(tables.table(schema.accessGrantsTableId).get("grant_1")?.status).toBe(
      "revoked",
    );
    expect(tables.table(schema.attachmentsTableId).get("attachment_1")?.lifecycle).toBe(
      "soft_deleted",
    );
    expect(tables.table(schema.notificationsTableId)).toHaveLength(0);
    expect(tables.table(schema.offlineConflictProjectionsTableId)).toHaveLength(0);
    expect(tables.table(schema.intelligenceProvenanceTableId)).toHaveLength(0);
    expect(
      tables.table(schema.reportersTableId).get("reporter_1")?.attributionJson,
    ).toBe(JSON.stringify({ kind: "unidentified" }));
    expect(
      tables.table(schema.externalIssueLinksTableId).get("link_1")
        ?.synchronizationState,
    ).toBe("privacy_cleanup_pending");
    expect([
      ...tables.table(schema.publicationConsentsTableId).values(),
    ]).toContainEqual(expect.objectContaining({ state: "revoked", version: 2 }));
    expect(tables.transactions).toContainEqual({
      transactionId: "transaction_1",
      commit: true,
    });
  });

  it("BDD-PRIV-021 restores content and attachments without resurrecting authority", async () => {
    const { store, tables } = setup();
    await store.execute(request);
    await expect(
      store.execute({
        ...request,
        command: {
          kind: "restore_feedback",
          operationId: "operation_2",
          feedbackId: "feedback_1",
          expectedRevision: 1,
        },
      }),
    ).resolves.toMatchObject({ status: "applied", revision: 2 });
    expect(
      tables.table(schema.feedbackTableId).get("feedback_1")?.deletedAt,
    ).toBeNull();
    expect(tables.table(schema.attachmentsTableId).get("attachment_1")?.lifecycle).toBe(
      "available",
    );
    expect(tables.table(schema.accessGrantsTableId).get("grant_1")?.status).toBe(
      "revoked",
    );
    expect(
      tables.table(schema.reportersTableId).get("reporter_1")?.attributionJson,
    ).toBe(JSON.stringify({ kind: "unidentified" }));
  });

  it("BDD-PRIV-022 preserves a Reporter still used by another active Feedback", async () => {
    const { store, tables } = setup(true);
    await store.execute(request);
    expect(
      tables.table(schema.reportersTableId).get("reporter_1")?.attributionJson,
    ).toBe(JSON.stringify({ kind: "contact" }));
  });

  it("BDD-PRIV-023 replays exactly and denies sibling scope", async () => {
    const { store, tables } = setup();
    await store.execute(request);
    await expect(store.execute(request)).resolves.toMatchObject({
      status: "replayed",
      revision: 1,
    });
    await expect(
      store.execute({ ...request, workspaceId: "workspace_2" }),
    ).resolves.toEqual({ status: "denied" });
    expect(tables.transactions.filter(({ rollback }) => rollback)).toHaveLength(2);
  });

  it("BDD-PRIV-024 rolls back transport, write, commit and rollback failures", async () => {
    for (const failure of ["get", "list", "write", "commit"] as const) {
      const { store, tables } = setup();
      tables.fail = failure;
      await expect(store.execute(request)).resolves.toEqual({ status: "retryable" });
    }
    const rollback = setup();
    rollback.tables.fail = "rollback";
    rollback.tables.createTransaction.mockResolvedValueOnce({ $id: "bad id" });
    await expect(rollback.store.execute(request)).resolves.toEqual({
      status: "retryable",
    });
  });

  it("BDD-PRIV-025 fails closed for schema and persisted-record corruption", async () => {
    const { tables } = setup();
    expect(() =>
      createAppwritePrivacyStore(
        tables,
        { ...schema, feedbackTableId: "bad id" },
        queries,
        sensitive,
        { createId: () => "id", createEventId: () => "event", now: () => "now" },
      ),
    ).toThrow("APPWRITE_PRIVACY_SCHEMA_INVALID");
    const corrupted = setup();
    corrupted.tables.table(schema.deletionRecordsTableId).set("deletion_1", {
      $id: "deletion_1",
      feedbackId: "feedback_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      auditEnvelope: "{}",
    });
    await expect(corrupted.store.execute(request)).resolves.toEqual({
      status: "retryable",
    });
  });

  it("BDD-PRIV-026 rejects duplicate, cross-scope and malformed deletion history", async () => {
    const duplicate = setup();
    for (const rowId of ["deletion_1", "deletion_2"])
      duplicate.tables.table(schema.deletionRecordsTableId).set(rowId, {
        $id: rowId,
        feedbackId: "feedback_1",
      });
    await expect(duplicate.store.execute(request)).resolves.toEqual({
      status: "retryable",
    });

    const seeded = setup();
    await seeded.store.execute(request);
    const row = seeded.tables.table(schema.deletionRecordsTableId).get("generated_1");
    if (!row) throw new Error("fixture");
    for (const replacement of [
      { ...row, auditEnvelope: 1 },
      { ...row, workspaceId: "workspace_2" },
      { ...row, state: "restored", restoredAt: "2026-09-03T00:00:00.000Z" },
      { ...row, state: "purged", purgedAt: "2026-10-02T00:00:00.000Z" },
    ]) {
      const candidate = setup();
      candidate.tables
        .table(schema.deletionRecordsTableId)
        .set("generated_1", replacement);
      await expect(candidate.store.execute(request)).resolves.toMatchObject({
        status:
          "workspaceId" in replacement && replacement.workspaceId === "workspace_2"
            ? "denied"
            : "auditEnvelope" in replacement && replacement.auditEnvelope === 1
              ? "retryable"
              : "replayed",
      });
    }
  });

  it("BDD-PRIV-027 fails closed for malformed related rows and generated IDs", async () => {
    for (const [tableId, rowId] of [
      [schema.attachmentsTableId, "attachment_1"],
      [schema.accessGrantsTableId, "grant_1"],
      [schema.notificationsTableId, "notification_1"],
      [schema.externalIssueLinksTableId, "link_1"],
    ] as const) {
      const candidate = setup();
      candidate.tables.table(tableId).set(rowId, { feedbackId: "feedback_1" });
      await expect(candidate.store.execute(request)).resolves.toEqual({
        status: "retryable",
      });
    }
    const malformedConsent = setup();
    malformedConsent.tables.table(schema.publicationConsentsTableId).set("consent_1", {
      $id: "consent_1",
      feedbackId: "feedback_1",
      version: 1,
      state: "active",
    });
    await expect(malformedConsent.store.execute(request)).resolves.toEqual({
      status: "retryable",
    });
    const invalidId = setup(false, undefined, () => "bad id");
    await expect(invalidId.store.execute(request)).resolves.toEqual({
      status: "retryable",
    });
  });

  it("BDD-PRIV-028 returns domain conflicts and expiry without partial writes", async () => {
    const conflict = setup();
    await conflict.store.execute(request);
    await expect(
      conflict.store.execute({
        ...request,
        command: { ...request.command, operationId: "operation_2" },
      }),
    ).resolves.toEqual({ status: "conflict" });

    let clock = "2026-09-02T00:00:00.000Z";
    const expired = setup(false, () => clock);
    await expired.store.execute(request);
    clock = "2026-10-02T00:00:00.000Z";
    await expect(
      expired.store.execute({
        ...request,
        command: {
          kind: "restore_feedback",
          operationId: "operation_2",
          feedbackId: "feedback_1",
          expectedRevision: 1,
        },
      }),
    ).resolves.toEqual({ status: "expired" });
  });

  it("BDD-PRIV-029 rejects malformed audit envelopes after structural validation", async () => {
    const candidate = setup();
    candidate.tables.table(schema.deletionRecordsTableId).set("deletion_1", {
      $id: "deletion_1",
      feedbackId: "feedback_1",
      workspaceId: "workspace_1",
      projectId: "project_1",
      requesterKind: "access_proof",
      requesterDigest: "b".repeat(64),
      reasonCode: "reporter_request",
      requestedAt: "2026-09-02T00:00:00.000Z",
      purgeEligibleAt: "2026-10-02T00:00:00.000Z",
      revision: 1,
      identityErased: true,
      state: "soft_deleted",
      auditEnvelope: "{}",
    });
    await expect(candidate.store.execute(request)).resolves.toEqual({
      status: "retryable",
    });
  });

  it("BDD-PRIV-030 ignores inactive consent history and rejects its generated revocation ID", async () => {
    const inactive = setup();
    inactive.tables.table(schema.publicationConsentsTableId).set("consent_1", {
      $id: "consent_1",
      feedbackId: "feedback_1",
      version: "invalid",
      state: "active",
    });
    inactive.tables.table(schema.publicationConsentsTableId).set("consent_2", {
      $id: "consent_2",
      feedbackId: "feedback_1",
      version: 2,
      state: "revoked",
    });
    inactive.tables.table(schema.publicationConsentsTableId).set("consent_3", {
      $id: "consent_3",
      feedbackId: "feedback_1",
      version: 1,
      state: "active",
    });
    await expect(inactive.store.execute(request)).resolves.toMatchObject({
      status: "applied",
    });

    let generated = 0;
    const invalidConsentId = setup(false, undefined, () =>
      ++generated === 1 ? "deletion_1" : "bad id",
    );
    await expect(invalidConsentId.store.execute(request)).resolves.toEqual({
      status: "retryable",
    });
  });
});
