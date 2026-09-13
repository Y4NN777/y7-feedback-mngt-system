import { describe, expect, it, vi } from "vitest";

import { planAuthoritativeCommit } from "@y7-feedback/domain";

import { createAppwriteAuthoritativeProjectionStore } from "./appwrite-authoritative-projection-store.js";

const commit = planAuthoritativeCommit(
  {
    environment: "preview",
    aggregateKind: "feedback",
    aggregateId: "feedback_1",
    operationId: "operation_1",
    commandKind: "feedback.accepted",
    workspaceId: "workspace_1",
    projectId: "project_1",
    actorKind: "system",
    actorId: "intake",
    payloadDigest: "digest_0123456789abcdef",
    sealedPayload: "sealed_payload",
    acceptedAt: "2026-09-13T02:00:00.000Z",
  },
  () => "commit_a",
);

const now = "2026-09-13T02:01:00.000Z";
const leaseUntil = "2026-09-13T02:06:00.000Z";

function row(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    $id: commit.id,
    ...commit,
    availableAt: commit.acceptedAt,
    claimedBy: null,
    claimToken: null,
    claimedUntil: null,
    ...overrides,
  };
}

function setup(rows: readonly unknown[] = [row()]) {
  const createTransaction = vi.fn<() => Promise<{ $id: string }>>(() =>
    Promise.resolve({ $id: "tx_a" }),
  );
  const updateTransaction = vi.fn<() => Promise<unknown>>(() => Promise.resolve({}));
  const listRows = vi.fn<() => Promise<{ rows: readonly unknown[] }>>(() =>
    Promise.resolve({ rows }),
  );
  const getRow = vi.fn<() => Promise<unknown>>(() => Promise.resolve(row()));
  const updateRow = vi.fn<
    (input: { data: Readonly<Record<string, unknown>> }) => Promise<unknown>
  >((input) =>
    Promise.resolve(
      row({
        ...input.data,
        $id: commit.id,
      }),
    ),
  );
  const equal = vi.fn(
    (field: string, values: readonly string[]) => `equal:${field}:${values.join(",")}`,
  );
  const orderAsc = vi.fn((field: string) => `asc:${field}`);
  const limit = vi.fn((value: number) => `limit:${String(value)}`);
  const store = createAppwriteAuthoritativeProjectionStore(
    { createTransaction, updateTransaction, listRows, getRow, updateRow },
    { databaseId: "feedback", authoritativeCommitsTableId: "authoritative_commits" },
    { equal, orderAsc, limit },
  );
  return {
    store,
    createTransaction,
    updateTransaction,
    listRows,
    getRow,
    updateRow,
  };
}

describe("ADR-015 Appwrite authoritative projection leases", () => {
  it("BDD-SLO-431 atomically leases the oldest due commit", async () => {
    const target = setup();
    const claimed = await target.store.claim({ workerId: "worker_a", now, leaseUntil });
    expect(claimed).toMatchObject({ commit, attempt: 1 });
    expect(claimed?.leaseToken).toMatch(/^lease_[a-f0-9]{30}$/u);
    expect(target.listRows).toHaveBeenCalledWith({
      databaseId: "feedback",
      tableId: "authoritative_commits",
      queries: [
        "equal:projectionState:pending,failed,processing",
        "asc:availableAt",
        "limit:25",
      ],
      total: false,
      ttl: 60,
      transactionId: "tx_a",
    });
    expect(target.updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "tx_a",
      commit: true,
    });
  });

  it("BDD-SLO-431A canonicalizes the Appwrite UTC datetime representation", async () => {
    const target = setup([row({ acceptedAt: "2026-09-13T02:00:00.000+00:00" })]);
    await expect(
      target.store.claim({ workerId: "worker_a", now, leaseUntil }),
    ).resolves.toMatchObject({
      commit: { acceptedAt: "2026-09-13T02:00:00.000Z" },
    });
  });

  it("BDD-SLO-432 returns idle for future, active and projected rows", async () => {
    const target = setup([
      row({ availableAt: "2026-09-13T03:00:00.000Z" }),
      row({
        projectionState: "processing",
        claimedUntil: "2026-09-13T02:05:00.000Z",
      }),
      row({ projectionState: "projected" }),
      null,
    ]);
    await expect(
      target.store.claim({ workerId: "worker_a", now, leaseUntil }),
    ).resolves.toBeNull();
    expect(target.updateRow).not.toHaveBeenCalled();
  });

  it("BDD-SLO-433 reclaims an expired lease and increments its attempt", async () => {
    const target = setup([
      row({
        projectionState: "processing",
        projectionAttempts: 2,
        claimedUntil: "2026-09-13T02:00:59.000Z",
      }),
    ]);
    await expect(
      target.store.claim({ workerId: "worker_b", now, leaseUntil }),
    ).resolves.toMatchObject({ attempt: 3 });
  });

  it("BDD-SLO-434 converts a claim conflict into idle", async () => {
    const target = setup();
    target.updateRow.mockRejectedValueOnce({ code: 409 });
    await expect(
      target.store.claim({ workerId: "worker_a", now, leaseUntil }),
    ).resolves.toBeNull();
    expect(target.updateTransaction).toHaveBeenLastCalledWith({
      transactionId: "tx_a",
      rollback: true,
    });
  });

  it("BDD-SLO-435 checkpoints projection only for the current lease", async () => {
    const target = setup();
    const claimed = await target.store.claim({ workerId: "worker_a", now, leaseUntil });
    target.getRow.mockResolvedValueOnce(
      row({
        projectionState: "processing",
        projectionAttempts: claimed?.attempt,
        claimToken: claimed?.leaseToken,
      }),
    );
    await target.store.projected({
      commitId: commit.id,
      leaseToken: claimed?.leaseToken ?? "missing",
      attempt: claimed?.attempt ?? 0,
      projectedAt: "2026-09-13T02:01:01.000Z",
    });
    expect(target.updateRow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          projectionState: "projected",
          projectedAt: "2026-09-13T02:01:01.000Z",
          lastErrorCode: null,
          claimedBy: null,
          claimToken: null,
          claimedUntil: null,
        },
      }),
    );
  });

  it("BDD-SLO-436 schedules a retry and clears the lease", async () => {
    const target = setup();
    target.getRow.mockResolvedValueOnce(
      row({
        projectionState: "processing",
        projectionAttempts: 1,
        claimToken: "lease_a",
      }),
    );
    await target.store.retry({
      commitId: commit.id,
      leaseToken: "lease_a",
      attempt: 1,
      availableAt: "2026-09-13T02:02:00.000Z",
      errorCode: "PROJECTION_RETRYABLE",
    });
    const lastWrite = target.updateRow.mock.calls.at(-1)?.[0];
    expect(lastWrite?.data.projectionState).toBe("failed");
    expect(lastWrite?.data.lastErrorCode).toBe("PROJECTION_RETRYABLE");
  });

  it.each([
    ["worker", { workerId: "bad/worker", now, leaseUntil }],
    ["now", { workerId: "worker_a", now: "invalid", leaseUntil }],
    ["lease", { workerId: "worker_a", now, leaseUntil: "invalid" }],
    ["lease order", { workerId: "worker_a", now, leaseUntil: now }],
  ])("BDD-SLO-437 rejects an invalid %s claim", async (_label, input) => {
    const target = setup();
    await expect(target.store.claim(input)).rejects.toThrow(
      "AUTHORITATIVE_PROJECTION_CLAIM_INVALID",
    );
  });

  it("BDD-SLO-438 rejects malformed rows, transactions, writes and schemas", async () => {
    expect(() =>
      createAppwriteAuthoritativeProjectionStore(
        {} as never,
        { databaseId: "bad/id", authoritativeCommitsTableId: "commits" },
        {} as never,
      ),
    ).toThrow("AUTHORITATIVE_PROJECTION_SCHEMA_INVALID");
    expect(() =>
      createAppwriteAuthoritativeProjectionStore(
        {} as never,
        { databaseId: "feedback", authoritativeCommitsTableId: "feedback" },
        {} as never,
      ),
    ).toThrow("AUTHORITATIVE_PROJECTION_SCHEMA_INVALID");
    const invalidTransaction = setup();
    invalidTransaction.createTransaction.mockResolvedValueOnce({ $id: "bad/id" });
    await expect(
      invalidTransaction.store.claim({ workerId: "worker_a", now, leaseUntil }),
    ).rejects.toThrow("AUTHORITATIVE_PROJECTION_TRANSACTION_INVALID");
    const invalidRow = setup([row({ aggregateId: "bad/id" })]);
    await expect(
      invalidRow.store.claim({ workerId: "worker_a", now, leaseUntil }),
    ).rejects.toThrow("AUTHORITATIVE_PROJECTION_ROW_INVALID");
    const invalidWrite = setup();
    invalidWrite.updateRow.mockResolvedValueOnce(null);
    await expect(
      invalidWrite.store.claim({ workerId: "worker_a", now, leaseUntil }),
    ).rejects.toThrow("AUTHORITATIVE_PROJECTION_WRITE_INVALID");
  });

  it("BDD-SLO-439 rejects a lost lease and preserves rollback errors", async () => {
    const target = setup();
    target.getRow.mockResolvedValueOnce(row({ projectionState: "failed" }));
    target.updateTransaction.mockRejectedValueOnce(new Error("rollback unavailable"));
    await expect(
      target.store.projected({
        commitId: commit.id,
        leaseToken: "lease_a",
        attempt: 1,
        projectedAt: "2026-09-13T02:01:01.000Z",
      }),
    ).rejects.toThrow("AUTHORITATIVE_PROJECTION_LEASE_LOST");
  });

  it.each([
    ["projected time", "projected", { projectedAt: "invalid" }],
    ["retry time", "retry", { availableAt: "invalid", errorCode: "SAFE_CODE" }],
    ["retry code", "retry", { availableAt: now, errorCode: "unsafe code" }],
  ])("BDD-SLO-440 rejects an invalid %s", async (_label, operation, extra) => {
    const target = setup();
    const input = { commitId: commit.id, leaseToken: "lease_a", attempt: 1, ...extra };
    const result =
      operation === "projected"
        ? target.store.projected(input as never)
        : target.store.retry(input as never);
    await expect(result).rejects.toThrow("AUTHORITATIVE_PROJECTION_TRANSITION_INVALID");
  });

  it.each([
    ["commit", { commitId: "bad/id", leaseToken: "lease_a", attempt: 1 }],
    ["token", { commitId: commit.id, leaseToken: "bad/token", attempt: 1 }],
    ["attempt type", { commitId: commit.id, leaseToken: "lease_a", attempt: 1.5 }],
    ["attempt range", { commitId: commit.id, leaseToken: "lease_a", attempt: 0 }],
  ])("BDD-SLO-441 rejects an invalid transition %s", async (_label, input) => {
    const target = setup();
    await expect(
      target.store.projected({
        ...input,
        projectedAt: "2026-09-13T02:01:01.000Z",
      }),
    ).rejects.toThrow("AUTHORITATIVE_PROJECTION_TRANSITION_INVALID");
  });

  it("BDD-SLO-442 rejects an invalid transition write", async () => {
    const target = setup();
    target.getRow.mockResolvedValueOnce(
      row({
        projectionState: "processing",
        projectionAttempts: 1,
        claimToken: "lease_a",
      }),
    );
    target.updateRow.mockResolvedValueOnce(null);
    await expect(
      target.store.projected({
        commitId: commit.id,
        leaseToken: "lease_a",
        attempt: 1,
        projectedAt: "2026-09-13T02:01:01.000Z",
      }),
    ).rejects.toThrow("AUTHORITATIVE_PROJECTION_WRITE_INVALID");
  });
});
