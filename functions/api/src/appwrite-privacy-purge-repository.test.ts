import { describe, expect, it, vi } from "vitest";

import {
  createAppwritePrivacyPurgeRepository,
  type AppwritePrivacyPurgeTables,
} from "./appwrite-privacy-purge-repository";

const schema = {
  databaseId: "feedback",
  deletionRecordsTableId: "deletion_records",
} as const;
const queries = {
  equal: (attribute: string, values: readonly string[]) =>
    `equal:${attribute}:${values.join(",")}`,
  lessThanEqual: (attribute: string, value: string) => `lte:${attribute}:${value}`,
  orderAsc: (attribute: string) => `asc:${attribute}`,
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

function deletion(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
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
    auditEnvelope: JSON.stringify([
      {
        eventId: "event_1",
        operationId: "operation_1",
        type: "deletion_requested",
        occurredAt: "2026-09-02T00:00:00.000Z",
        actorDigest: "a".repeat(64),
        from: "active",
        to: "soft_deleted",
      },
    ]),
    operationIdsJson: '["operation_1"]',
    ...overrides,
  };
}

class FakeTables implements AppwritePrivacyPurgeTables {
  rows: unknown[] = [deletion()];
  current: unknown = deletion();
  transactionId = "transaction_1";
  fail: "list" | "get" | "update" | "commit" | "rollback" | undefined;
  readonly writes: Array<Readonly<Record<string, unknown>>> = [];
  readonly listInputs: Parameters<AppwritePrivacyPurgeTables["listRows"]>[0][] = [];

  createTransaction = vi.fn(() => Promise.resolve({ $id: this.transactionId }));
  listRows = vi.fn((input: Parameters<AppwritePrivacyPurgeTables["listRows"]>[0]) => {
    this.listInputs.push(input);
    return this.fail === "list"
      ? Promise.reject(new Error("transport"))
      : Promise.resolve({ rows: this.rows });
  });
  getRow = vi.fn(() =>
    this.fail === "get"
      ? Promise.reject(new Error("transport"))
      : Promise.resolve(this.current),
  );
  updateRow = vi.fn((input: Parameters<AppwritePrivacyPurgeTables["updateRow"]>[0]) => {
    if (this.fail === "update") return Promise.reject(new Error("write"));
    this.writes.push(input);
    return Promise.resolve({});
  });
  updateTransaction = vi.fn(
    (input: Parameters<AppwritePrivacyPurgeTables["updateTransaction"]>[0]) => {
      if (
        (input.commit && this.fail === "commit") ||
        (input.rollback && this.fail === "rollback")
      )
        return Promise.reject(new Error("transaction"));
      return Promise.resolve({});
    },
  );
}

function setup(tables = new FakeTables()) {
  return {
    tables,
    repository: createAppwritePrivacyPurgeRepository(
      tables,
      schema,
      queries,
      sensitive,
      {
        createEventId: () => "event_2",
        workerDigest: () => "w".repeat(64),
      },
    ),
  };
}

describe("Appwrite privacy purge repository", () => {
  it("BDD-PRIV-036 leases due work and skips an active foreign lease", async () => {
    const { repository, tables } = setup();
    tables.rows = [
      deletion(),
      deletion({
        $id: "deletion_stale",
        purgeClaimedAt: "2026-10-02T00:00:00.000Z",
        purgeWorkerId: "other_worker",
      }),
      deletion({
        $id: "deletion_owned",
        purgeClaimedAt: "2026-10-03T00:00:00.000Z",
        purgeWorkerId: "worker_1",
      }),
      deletion({
        $id: "deletion_busy",
        purgeClaimedAt: "2026-10-03T00:00:00.000Z",
        purgeWorkerId: "other_worker",
      }),
    ];

    await expect(
      repository.claimDue({
        now: "2026-10-03T00:01:00.000Z",
        limit: 10,
        workerId: "worker_1",
      }),
    ).resolves.toHaveLength(3);
    expect(tables.writes).toHaveLength(3);
    const claimQueries = tables.listInputs[0]?.queries;
    expect(claimQueries).toContain("equal:state:soft_deleted");
    expect(claimQueries).toContain("limit:10");
    expect(tables.updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "transaction_1",
      commit: true,
    });
  });

  it("BDD-PRIV-037 marks a lease purged with an immutable audit event", async () => {
    const { repository, tables } = setup();
    tables.current = deletion({ purgeWorkerId: "worker_1" });

    await expect(
      repository.markPurged({
        deletionId: "deletion_1",
        expectedRevision: 1,
        operationId: "operation_2",
        purgedAt: "2026-10-03T00:00:00.000Z",
        workerId: "worker_1",
      }),
    ).resolves.toBe("purged");
    expect(tables.writes[0]?.data).toMatchObject({
      state: "purged",
      revision: 2,
      purgeWorkerId: null,
      purgeClaimedAt: null,
      operationIdsJson: '["operation_1","operation_2"]',
    });
  });

  it("BDD-PRIV-038 distinguishes replay and stale workers", async () => {
    const replay = setup();
    replay.tables.current = deletion({
      state: "purged",
      operationIdsJson: '["operation_2"]',
    });
    const input = {
      deletionId: "deletion_1",
      expectedRevision: 1,
      operationId: "operation_2",
      purgedAt: "2026-10-03T00:00:00.000Z",
      workerId: "worker_1",
    };
    await expect(replay.repository.markPurged(input)).resolves.toBe("replayed");

    const stale = setup();
    stale.tables.current = deletion({
      purgeWorkerId: "other_worker",
      operationIdsJson: undefined,
    });
    await expect(stale.repository.markPurged(input)).resolves.toBe("stale");
    expect(stale.tables.writes).toHaveLength(0);
  });

  it("BDD-PRIV-039 rolls back transport and malformed-record failures", async () => {
    const listed = setup();
    listed.tables.fail = "list";
    await expect(
      listed.repository.claimDue({
        now: "2026-10-03T00:00:00.000Z",
        limit: 10,
        workerId: "worker_1",
      }),
    ).rejects.toThrow("transport");
    expect(listed.tables.updateTransaction).toHaveBeenCalledWith({
      transactionId: "transaction_1",
      rollback: true,
    });

    for (const current of [
      null,
      deletion({ auditEnvelope: "{", purgeWorkerId: "worker_1" }),
      deletion({ requesterDigest: null, purgeWorkerId: "worker_1" }),
      deletion({ auditEnvelope: "{}", purgeWorkerId: "worker_1" }),
    ]) {
      const malformed = setup();
      malformed.tables.current = current;
      await expect(
        malformed.repository.markPurged({
          deletionId: "deletion_1",
          expectedRevision: 1,
          operationId: "operation_2",
          purgedAt: "2026-10-03T00:00:00.000Z",
          workerId: "worker_1",
        }),
      ).rejects.toThrow("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
    }
  });

  it("fails closed for invalid schema, transaction and timestamps", async () => {
    expect(() =>
      createAppwritePrivacyPurgeRepository(
        new FakeTables(),
        { databaseId: "bad/id", deletionRecordsTableId: "same" },
        queries,
        sensitive,
        { createEventId: () => "event", workerDigest: () => "x".repeat(64) },
      ),
    ).toThrow("APPWRITE_PRIVACY_PURGE_SCHEMA_INVALID");

    const transaction = setup();
    transaction.tables.transactionId = "bad/id";
    await expect(
      transaction.repository.claimDue({
        now: "2026-10-03T00:00:00.000Z",
        limit: 1,
        workerId: "w",
      }),
    ).rejects.toThrow("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
    await expect(
      setup().repository.claimDue({ now: "not-a-date", limit: 1, workerId: "w" }),
    ).rejects.toThrow("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");

    const impossibleDate = setup();
    impossibleDate.tables.rows = [
      deletion({ purgeEligibleAt: "2026-99-99T00:00:00.000Z" }),
    ];
    await expect(
      impossibleDate.repository.claimDue({
        now: "2026-10-03T00:00:00.000Z",
        limit: 1,
        workerId: "w",
      }),
    ).rejects.toThrow("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");

    const malformedCandidate = setup();
    malformedCandidate.tables.rows = [deletion({ revision: 0 })];
    await expect(
      malformedCandidate.repository.claimDue({
        now: "2026-10-03T00:00:00.000Z",
        limit: 1,
        workerId: "w",
      }),
    ).rejects.toThrow("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");

    const markTransaction = setup();
    markTransaction.tables.transactionId = "bad/id";
    await expect(
      markTransaction.repository.markPurged({
        deletionId: "deletion_1",
        expectedRevision: 1,
        operationId: "operation_2",
        purgedAt: "2026-10-03T00:00:00.000Z",
        workerId: "worker_1",
      }),
    ).rejects.toThrow("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
  });

  it("preserves the original error when rollback also fails", async () => {
    const claim = setup();
    claim.tables.rows = [null];
    claim.tables.fail = "rollback";
    await expect(
      claim.repository.claimDue({
        now: "2026-10-03T00:00:00.000Z",
        limit: 1,
        workerId: "worker_1",
      }),
    ).rejects.toThrow("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");

    const mark = setup();
    mark.tables.current = null;
    mark.tables.fail = "rollback";
    await expect(
      mark.repository.markPurged({
        deletionId: "deletion_1",
        expectedRevision: 1,
        operationId: "operation_2",
        purgedAt: "2026-10-03T00:00:00.000Z",
        workerId: "worker_1",
      }),
    ).rejects.toThrow("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
  });

  it("rejects invalid worker authority and domain commands", async () => {
    const tables = new FakeTables();
    tables.current = deletion({ purgeWorkerId: "worker_1" });
    const invalidDigest = createAppwritePrivacyPurgeRepository(
      tables,
      schema,
      queries,
      sensitive,
      { createEventId: () => "event_2", workerDigest: () => "invalid" },
    );
    const input = {
      deletionId: "deletion_1",
      expectedRevision: 1,
      operationId: "operation_2",
      purgedAt: "2026-10-03T00:00:00.000Z",
      workerId: "worker_1",
    };
    await expect(invalidDigest.markPurged(input)).rejects.toThrow(
      "APPWRITE_PRIVACY_PURGE_UNAVAILABLE",
    );

    const invalidCommand = setup();
    invalidCommand.tables.current = deletion({ purgeWorkerId: "worker_1" });
    await expect(
      invalidCommand.repository.markPurged({ ...input, operationId: "bad/id" }),
    ).rejects.toThrow("APPWRITE_PRIVACY_PURGE_UNAVAILABLE");
  });
});
