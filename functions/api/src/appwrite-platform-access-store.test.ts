import { describe, expect, it, vi } from "vitest";

import {
  createAppwritePlatformAccessStore,
  createAppwritePlatformAccessExpiryWorker,
  createNodeAppwritePlatformAccessStore,
  type AppwritePlatformAccessTables,
} from "./appwrite-platform-access-store";

const schema = {
  databaseId: "feedback",
  grantsTableId: "exceptional_access_grants",
  auditTableId: "exceptional_access_audit",
} as const;

const sensitive = {
  environment: "preview",
  protector: {
    seal: (_context: unknown, value: string) => `sealed:${value}`,
    open: (_context: unknown, value: string) => {
      if (!value.startsWith("sealed:")) throw new Error("invalid");
      return value.slice(7);
    },
  },
};

class FakeTables implements AppwritePlatformAccessTables {
  readonly grants = new Map<string, Readonly<Record<string, unknown>>>();
  readonly audits = new Map<string, Readonly<Record<string, unknown>>>();
  readonly calls: Readonly<Record<string, unknown>>[] = [];
  fail: "create" | "update" | "commit" | "rollback" | undefined;
  private pending:
    | {
        grants: Map<string, Readonly<Record<string, unknown>>>;
        audits: Map<string, Readonly<Record<string, unknown>>>;
      }
    | undefined;

  createTransaction = vi.fn(() => {
    this.pending = {
      grants: new Map(this.grants),
      audits: new Map(this.audits),
    };
    return Promise.resolve({ $id: "transaction_1" });
  });

  getRow = vi.fn((input: Parameters<AppwritePlatformAccessTables["getRow"]>[0]) => {
    const row = this.pending?.grants.get(input.rowId);
    return row
      ? Promise.resolve(row)
      : Promise.reject(Object.assign(new Error("absent"), { code: 404 }));
  });

  listRows = vi.fn(() =>
    Promise.resolve({
      rows: [...this.grants.values()].filter((row) => row.state === "active"),
    }),
  );

  createRow = vi.fn(
    (input: Parameters<AppwritePlatformAccessTables["createRow"]>[0]) => {
      if (this.fail === "create") return Promise.reject(new Error("write"));
      const target =
        input.tableId === schema.grantsTableId
          ? this.pending?.grants
          : this.pending?.audits;
      if (!target || target.has(input.rowId))
        return Promise.reject(new Error("duplicate"));
      target.set(input.rowId, { $id: input.rowId, ...input.data });
      this.calls.push({ kind: "create", ...input });
      return Promise.resolve({ $id: input.rowId, ...input.data });
    },
  );

  updateRow = vi.fn(
    (input: Parameters<AppwritePlatformAccessTables["updateRow"]>[0]) => {
      if (this.fail === "update") return Promise.reject(new Error("write"));
      const current = this.pending?.grants.get(input.rowId);
      if (!current) return Promise.reject(new Error("absent"));
      const updated = { ...current, ...input.data };
      this.pending?.grants.set(input.rowId, updated);
      this.calls.push({ kind: "update", ...input });
      return Promise.resolve(updated);
    },
  );

  updateTransaction = vi.fn(
    (input: Parameters<AppwritePlatformAccessTables["updateTransaction"]>[0]) => {
      if (input.commit && this.fail === "commit")
        return Promise.reject(new Error("commit"));
      if (input.rollback && this.fail === "rollback")
        return Promise.reject(new Error("rollback"));
      if (input.commit && this.pending) {
        this.grants.clear();
        this.audits.clear();
        for (const [key, value] of this.pending.grants) this.grants.set(key, value);
        for (const [key, value] of this.pending.audits) this.audits.set(key, value);
      }
      this.pending = undefined;
      return Promise.resolve({});
    },
  );
}

function setup(now = "2026-09-03T12:00:00.000Z") {
  const tables = new FakeTables();
  let audit = 0;
  const store = createAppwritePlatformAccessStore(tables, schema, sensitive, {
    now: () => now,
    createAuditId: () => `audit_${String(++audit)}`,
  });
  return { store, tables };
}

const request = {
  actorId: "operator_1",
  freshMfa: true,
  command: {
    kind: "request" as const,
    grantId: "grant_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    feedbackId: "feedback_1",
    actions: ["feedback.read" as const],
    reasonCode: "INCIDENT_RESPONSE",
    justification: "Investigating a critical customer incident",
    incidentSeverity: "critical" as const,
    breakGlass: true,
  },
};

describe("Appwrite exceptional access persistence", () => {
  it("BDD-PLAT-021 atomically encrypts a request and appends immutable audit", async () => {
    const { store, tables } = setup();
    await expect(store.execute(request)).resolves.toEqual({
      status: "applied",
      grantId: "grant_1",
      state: "requested",
      revision: 0,
    });
    expect(tables.grants.get("grant_1")).toMatchObject({
      justificationEnvelope: "sealed:Investigating a critical customer incident",
      auditSequence: 1,
      revision: 0,
    });
    expect(tables.audits.get("audit_1")).toMatchObject({
      sequence: 1,
      eventType: "requested",
      actorId: "operator_1",
    });
    expect(tables.audits.get("audit_1")?.scopeDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect("updateAudit" in store).toBe(false);
    expect("deleteAudit" in store).toBe(false);
  });

  it("BDD-PLAT-022 replays the identical request and conflicts on key reuse", async () => {
    const { store, tables } = setup();
    await store.execute(request);
    await expect(store.execute(request)).resolves.toMatchObject({
      status: "replayed",
      grantId: "grant_1",
    });
    await expect(
      store.execute({
        ...request,
        command: { ...request.command, reasonCode: "OTHER_INCIDENT" },
      }),
    ).resolves.toEqual({ status: "conflict" });
    expect(tables.audits).toHaveLength(1);
  });

  it("BDD-PLAT-023 persists approval, use, revocation and review in order", async () => {
    const candidate = setup();
    await candidate.store.execute(request);
    await expect(
      candidate.store.execute({
        actorId: "owner_1",
        freshMfa: true,
        command: {
          kind: "approve",
          grantId: "grant_1",
          expectedRevision: 0,
          expiresAt: "2026-09-03T12:30:00.000Z",
        },
      }),
    ).resolves.toMatchObject({ status: "applied", state: "active", revision: 1 });
    await expect(
      candidate.store.execute({
        actorId: "operator_1",
        freshMfa: true,
        command: {
          kind: "use",
          grantId: "grant_1",
          expectedRevision: 1,
          workspaceId: "workspace_1",
          projectId: "project_1",
          feedbackId: "feedback_1",
          action: "feedback.read",
        },
      }),
    ).resolves.toMatchObject({ status: "applied", revision: 2 });
    await expect(
      candidate.store.execute({
        actorId: "operator_1",
        freshMfa: true,
        command: { kind: "revoke", grantId: "grant_1", expectedRevision: 2 },
      }),
    ).resolves.toMatchObject({ status: "applied", state: "review_required" });
    await expect(
      candidate.store.execute({
        actorId: "owner_1",
        freshMfa: true,
        command: { kind: "review", grantId: "grant_1", expectedRevision: 3 },
      }),
    ).resolves.toMatchObject({ status: "applied", state: "reviewed" });
    expect([...candidate.tables.audits.values()].map((row) => row.sequence)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("BDD-PLAT-024 audits an authorized command denial without advancing revision", async () => {
    const candidate = setup();
    await candidate.store.execute(request);
    await expect(
      candidate.store.execute({
        actorId: "operator_1",
        freshMfa: true,
        command: {
          kind: "use",
          grantId: "grant_1",
          expectedRevision: 0,
          workspaceId: "workspace_1",
          projectId: "project_1",
          feedbackId: "feedback_1",
          action: "feedback.read",
        },
      }),
    ).resolves.toEqual({ status: "denied" });
    expect(candidate.tables.grants.get("grant_1")).toMatchObject({
      revision: 0,
      auditSequence: 2,
    });
    expect(candidate.tables.audits.get("audit_2")).toMatchObject({
      eventType: "use_denied",
      reasonCode: "EXCEPTIONAL_ACCESS_NOT_ACTIVE",
    });
  });

  it("BDD-PLAT-025 rolls back both writes when audit or commit is unavailable", async () => {
    const createFailure = setup();
    createFailure.tables.fail = "create";
    await expect(createFailure.store.execute(request)).resolves.toEqual({
      status: "retryable",
    });
    expect(createFailure.tables.grants).toHaveLength(0);
    expect(createFailure.tables.audits).toHaveLength(0);

    const commitFailure = setup();
    commitFailure.tables.fail = "commit";
    await expect(commitFailure.store.execute(request)).resolves.toEqual({
      status: "retryable",
    });
    expect(commitFailure.tables.grants).toHaveLength(0);
    expect(commitFailure.tables.audits).toHaveLength(0);
  });

  it("BDD-PLAT-026 fails closed for absent, corrupt, invalid and conflicting grants", async () => {
    const candidate = setup();
    await expect(
      candidate.store.execute({
        actorId: "owner_1",
        freshMfa: true,
        command: { kind: "deny", grantId: "missing", expectedRevision: 0 },
      }),
    ).resolves.toEqual({ status: "denied" });
    candidate.tables.grants.set("corrupt", { $id: "corrupt" });
    await expect(
      candidate.store.execute({
        actorId: "owner_1",
        freshMfa: true,
        command: { kind: "deny", grantId: "corrupt", expectedRevision: 0 },
      }),
    ).resolves.toEqual({ status: "retryable" });
    await expect(
      candidate.store.execute({
        ...request,
        command: { ...request.command, grantId: "bad id" },
      }),
    ).resolves.toEqual({ status: "invalid" });
    await candidate.store.execute(request);
    await expect(
      candidate.store.execute({
        actorId: "owner_1",
        freshMfa: true,
        command: { kind: "deny", grantId: "grant_1", expectedRevision: 9 },
      }),
    ).resolves.toEqual({ status: "denied" });
  });

  it("BDD-PLAT-027 validates schema and maps the Node SDK without audit mutation", async () => {
    expect(() =>
      createAppwritePlatformAccessStore(
        new FakeTables(),
        { ...schema, auditTableId: schema.grantsTableId },
        sensitive,
        { now: () => "now", createAuditId: () => "audit" },
      ),
    ).toThrow("PLATFORM_ACCESS_SCHEMA_INVALID");
    const tables = new FakeTables();
    const node = createNodeAppwritePlatformAccessStore(
      tables as never,
      schema,
      sensitive,
      { now: () => "2026-09-03T12:00:00.000Z", createAuditId: () => "audit_1" },
    );
    await expect(node.execute(request)).resolves.toMatchObject({ status: "applied" });
  });

  it("BDD-PLAT-028 covers workspace grants and rejects malformed persisted fields", async () => {
    const minimalRequest = {
      actorId: request.actorId,
      freshMfa: request.freshMfa,
      command: {
        kind: "request" as const,
        grantId: "grant_minimal",
        workspaceId: request.command.workspaceId,
        actions: request.command.actions,
        reasonCode: request.command.reasonCode,
        justification: request.command.justification,
        breakGlass: false,
        incidentSeverity: "ordinary" as const,
      },
    };
    const candidate = setup();
    await candidate.store.execute(minimalRequest);
    await expect(candidate.store.execute(minimalRequest)).resolves.toMatchObject({
      status: "replayed",
    });
    const stored = candidate.tables.grants.get("grant_minimal");
    if (!stored) throw new Error("fixture invalid");

    candidate.tables.grants.set("grant_minimal", {
      ...stored,
      expiredAt: "2026-09-03T12:30:00.000Z",
      reviewedAt: "2026-09-03T12:40:00.000Z",
    });
    await expect(candidate.store.execute(minimalRequest)).resolves.toMatchObject({
      status: "replayed",
    });

    for (const mutation of [
      { projectId: 42 },
      { justificationEnvelope: "invalid" },
      { actionsJson: "{}" },
      { actionsJson: "[]" },
      { actionsJson: '["unknown"]' },
      { actionsJson: "[42]" },
    ]) {
      candidate.tables.grants.set("grant_minimal", { ...stored, ...mutation });
      await expect(candidate.store.execute(minimalRequest)).resolves.toEqual({
        status: "retryable",
      });
    }
  });

  it("BDD-PLAT-029 fails closed across transaction and audit infrastructure faults", async () => {
    const rejected = setup();
    rejected.tables.createTransaction.mockRejectedValueOnce(new Error("transport"));
    await expect(rejected.store.execute(request)).resolves.toEqual({
      status: "retryable",
    });

    const invalidTransaction = setup();
    invalidTransaction.tables.createTransaction.mockResolvedValueOnce({
      $id: "bad id",
    });
    await expect(invalidTransaction.store.execute(request)).resolves.toEqual({
      status: "retryable",
    });

    const readFailure = setup();
    readFailure.tables.getRow.mockRejectedValueOnce(new Error("transport"));
    await expect(readFailure.store.execute(request)).resolves.toEqual({
      status: "retryable",
    });

    const invalidAudit = new FakeTables();
    const invalidAuditStore = createAppwritePlatformAccessStore(
      invalidAudit,
      schema,
      sensitive,
      {
        now: () => "2026-09-03T12:00:00.000Z",
        createAuditId: () => "bad id",
      },
    );
    await expect(invalidAuditStore.execute(request)).resolves.toEqual({
      status: "retryable",
    });
    invalidAudit.fail = "rollback";
    await expect(invalidAuditStore.execute(request)).resolves.toEqual({
      status: "retryable",
    });
  });

  it("BDD-PLAT-030 applies an exact workspace-only grant", async () => {
    const candidate = setup();
    const workspaceRequest = {
      actorId: request.actorId,
      freshMfa: request.freshMfa,
      command: {
        kind: "request" as const,
        grantId: "workspace_grant",
        workspaceId: request.command.workspaceId,
        actions: request.command.actions,
        reasonCode: request.command.reasonCode,
        justification: request.command.justification,
        breakGlass: false,
        incidentSeverity: "ordinary" as const,
      },
    };
    await candidate.store.execute(workspaceRequest);
    await candidate.store.execute({
      actorId: "owner_1",
      freshMfa: true,
      command: {
        kind: "approve",
        grantId: "workspace_grant",
        expectedRevision: 0,
        expiresAt: "2026-09-03T12:30:00.000Z",
      },
    });
    await expect(
      candidate.store.execute({
        actorId: "operator_1",
        freshMfa: true,
        command: {
          kind: "use",
          grantId: "workspace_grant",
          expectedRevision: 1,
          workspaceId: "workspace_1",
          action: "feedback.read",
        },
      }),
    ).resolves.toMatchObject({ status: "applied", revision: 2 });
  });

  it("BDD-PLAT-031 expires grants and their immutable audits atomically", async () => {
    const candidate = setup("2026-09-03T13:00:00.000Z");
    const row = {
      $id: "grant_due",
      requesterId: "operator_1",
      approverId: "owner_1",
      workspaceId: "workspace_1",
      projectId: null,
      feedbackId: null,
      state: "active",
      reasonCode: "INCIDENT_RESPONSE",
      breakGlass: false,
      useCount: 0,
      revision: 1,
      auditSequence: 2,
      justificationEnvelope: "sealed:Investigating the customer incident",
      incidentSeverity: "ordinary",
      actionsJson: '["feedback.read"]',
      requestedAt: "2026-09-03T11:00:00.000Z",
      approvedAt: "2026-09-03T11:30:00.000Z",
      expiresAt: "2026-09-03T12:30:00.000Z",
    };
    candidate.tables.grants.set("grant_due", row);
    const worker = createAppwritePlatformAccessExpiryWorker(
      candidate.tables,
      schema,
      {
        equal: (attribute, values) => `equal:${attribute}:${values.join(",")}`,
        lessThanEqual: (attribute, value) => `lte:${attribute}:${value}`,
        limit: (value) => `limit:${String(value)}`,
      },
      sensitive,
      {
        now: () => "2026-09-03T13:00:00.000Z",
        createAuditId: (_grantId, sequence) => `expiry_${String(sequence)}`,
      },
    );
    await expect(worker.runOnce()).resolves.toEqual({
      status: "completed",
      inspected: 1,
      expired: 1,
    });
    expect(candidate.tables.listRows).toHaveBeenCalledWith(
      expect.objectContaining({
        queries: [
          "equal:state:active",
          "lte:expiresAt:2026-09-03T13:00:00.000Z",
          "limit:25",
        ],
      }),
    );
    expect(candidate.tables.grants.get("grant_due")).toMatchObject({
      state: "expired",
      revision: 2,
      auditSequence: 3,
      expiredAt: "2026-09-03T13:00:00.000Z",
    });
    expect(candidate.tables.audits.get("expiry_3")).toMatchObject({
      eventType: "expired",
      sequence: 3,
      actorId: "platform_expiry_worker",
    });
  });

  it("BDD-PLAT-032 skips a concurrently changed grant and fails closed on faults", async () => {
    const candidate = setup();
    candidate.tables.grants.set("grant_changed", {
      $id: "grant_changed",
      requesterId: "operator_1",
      workspaceId: "workspace_1",
      state: "revoked",
      reasonCode: "INCIDENT_RESPONSE",
      breakGlass: false,
      useCount: 0,
      revision: 2,
      auditSequence: 3,
      justificationEnvelope: "sealed:Investigating the customer incident",
      incidentSeverity: "ordinary",
      actionsJson: '["feedback.read"]',
      requestedAt: "2026-09-03T11:00:00.000Z",
      expiresAt: "2026-09-03T11:30:00.000Z",
    });
    candidate.tables.listRows.mockResolvedValueOnce({
      rows: [{ $id: "grant_changed", state: "active" }],
    });
    const worker = createAppwritePlatformAccessExpiryWorker(
      candidate.tables,
      schema,
      { equal: () => "equal", lessThanEqual: () => "lte", limit: () => "limit" },
      sensitive,
      { now: () => "2026-09-03T12:00:00.000Z", createAuditId: () => "audit" },
    );
    await expect(worker.runOnce()).resolves.toEqual({
      status: "completed",
      inspected: 1,
      expired: 0,
    });

    expect(() =>
      createAppwritePlatformAccessExpiryWorker(
        candidate.tables,
        schema,
        { equal: () => "", lessThanEqual: () => "", limit: () => "" },
        sensitive,
        { now: () => "now", createAuditId: () => "audit" },
        0,
      ),
    ).toThrow("PLATFORM_EXPIRY_BATCH_INVALID");
    candidate.tables.listRows.mockResolvedValueOnce({ rows: [{}] });
    await expect(worker.runOnce()).rejects.toThrow("PLATFORM_EXPIRY_UNAVAILABLE");

    candidate.tables.listRows.mockResolvedValueOnce({
      rows: [{ $id: "grant_changed" }],
    });
    candidate.tables.createTransaction.mockResolvedValueOnce({ $id: "bad id" });
    await expect(worker.runOnce()).rejects.toThrow("PLATFORM_EXPIRY_UNAVAILABLE");

    const due = setup("2026-09-03T13:00:00.000Z");
    due.tables.grants.set("grant_due", {
      ...candidate.tables.grants.get("grant_changed"),
      $id: "grant_due",
      state: "active",
      revision: 1,
    });
    due.tables.listRows.mockResolvedValue({ rows: [{ $id: "grant_due" }] });
    const badAuditWorker = createAppwritePlatformAccessExpiryWorker(
      due.tables,
      schema,
      { equal: () => "equal", lessThanEqual: () => "lte", limit: () => "limit" },
      sensitive,
      { now: () => "2026-09-03T13:00:00.000Z", createAuditId: () => "bad id" },
    );
    await expect(badAuditWorker.runOnce()).rejects.toThrow("invalid audit id");
    due.tables.fail = "rollback";
    await expect(badAuditWorker.runOnce()).rejects.toThrow("invalid audit id");
  });
});
