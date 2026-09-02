import { describe, expect, it, vi } from "vitest";

import type { OfflineOperation, OfflineScope } from "./OfflineStore";
import {
  createHttpConnectivityProbe,
  createOfflineReplay,
  parseRetryAfter,
  type OfflineReplayStore,
} from "./OfflineReplay";

const scope: OfflineScope = {
  environment: "preview",
  workspaceId: "workspace_1",
  projectId: "project_1",
  actorId: "reporter_1",
};

function operation(
  id: string,
  input: Partial<OfflineOperation> = {},
): OfflineOperation {
  return {
    clientOperationId: id,
    kind: "intake",
    payloadDigest: `sha256_${"A".repeat(43)}`,
    payload: { id },
    dependencies: [],
    sequence: 1,
    status: "queued",
    attempts: 0,
    createdAt: "2026-09-02T04:00:00.000Z",
    updatedAt: "2026-09-02T04:00:00.000Z",
    ...input,
  };
}

function memory(initial: readonly OfflineOperation[]) {
  let operations = [...initial];
  const retryOperation = vi.fn(
    (
      _scope: OfflineScope,
      id: string,
      nextAttemptAt: string,
      lastErrorCode: string,
    ) => {
      operations = operations.map((item) =>
        item.clientOperationId === id
          ? { ...item, status: "queued", nextAttemptAt, lastErrorCode }
          : item,
      );
      return Promise.resolve();
    },
  );
  const store: OfflineReplayStore = {
    recoverOperations: vi.fn((_scope, staleBefore) => {
      let recovered = 0;
      operations = operations.map((item) => {
        if (item.status !== "processing" || item.updatedAt > staleBefore) return item;
        recovered += 1;
        return { ...item, status: "queued", lastErrorCode: "claim_recovered" };
      });
      return Promise.resolve({ recovered });
    }),
    listOperations: vi.fn(() => Promise.resolve([...operations])),
    claimOperation: vi.fn((_scope, id) => {
      const current = operations.find((item) => item.clientOperationId === id);
      if (!current || current.status !== "queued") throw new Error("conflict");
      const claimed = {
        ...current,
        status: "processing" as const,
        attempts: current.attempts + 1,
      };
      operations = operations.map((item) =>
        item.clientOperationId === id ? claimed : item,
      );
      return Promise.resolve(claimed);
    }),
    completeOperation: vi.fn((_scope, id) => {
      operations = operations.filter((item) => item.clientOperationId !== id);
      return Promise.resolve();
    }),
    retryOperation,
    conflictOperation: vi.fn((_scope, id) => {
      operations = operations.map((item) =>
        item.clientOperationId === id
          ? { ...item, status: "conflict", lastErrorCode: "payload_conflict" }
          : item,
      );
      return Promise.resolve();
    }),
  };
  return { store, retryOperation, operations: () => operations };
}

describe("offline ordered replay", () => {
  it("BDD-OFF-201 does not trust navigator state without a successful probe", async () => {
    const target = memory([operation("operation_1")]);
    const send = vi.fn();
    const replay = createOfflineReplay({
      store: target.store,
      probe: () => Promise.resolve(false),
      send,
      now: () => new Date("2026-09-02T04:00:00.000Z"),
    });

    await expect(replay.runOnce(scope)).resolves.toEqual({ status: "offline" });
    expect(send).not.toHaveBeenCalled();
  });

  it("BDD-OFF-202 replays dependencies in order exactly once", async () => {
    const target = memory([
      operation("operation_1"),
      operation("operation_2", { sequence: 2, dependencies: ["operation_1"] }),
    ]);
    const send = vi.fn(() => Promise.resolve({ status: "accepted" as const }));
    const replay = createOfflineReplay({
      store: target.store,
      probe: () => Promise.resolve(true),
      send,
      now: () => new Date("2026-09-02T04:00:00.000Z"),
    });

    await expect(replay.runOnce(scope)).resolves.toEqual({
      status: "synchronized",
      operationId: "operation_1",
    });
    await expect(replay.runOnce(scope)).resolves.toEqual({
      status: "synchronized",
      operationId: "operation_2",
    });
    await expect(replay.runOnce(scope)).resolves.toEqual({ status: "idle" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(target.operations()).toEqual([]);
  });

  it("BDD-OFF-203 honors Retry-After before exponential backoff", async () => {
    const target = memory([operation("operation_1")]);
    const replay = createOfflineReplay({
      store: target.store,
      probe: () => Promise.resolve(true),
      send: () => Promise.resolve({ status: "retryable", retryAfterMs: 30_000 }),
      now: () => new Date("2026-09-02T04:00:00.000Z"),
    });

    await expect(replay.runOnce(scope)).resolves.toEqual({
      status: "retry_scheduled",
      operationId: "operation_1",
      nextAttemptAt: "2026-09-02T04:00:30.000Z",
    });
    expect(target.retryOperation).toHaveBeenCalledWith(
      scope,
      "operation_1",
      "2026-09-02T04:00:30.000Z",
      "transport_retryable",
    );
  });

  it("BDD-OFF-204 leaves future work queued and bounds exponential backoff", async () => {
    const future = memory([
      operation("operation_1", { nextAttemptAt: "2026-09-02T04:01:00.000Z" }),
    ]);
    const futureReplay = createOfflineReplay({
      store: future.store,
      probe: () => Promise.resolve(true),
      send: vi.fn(),
      now: () => new Date("2026-09-02T04:00:00.000Z"),
    });
    await expect(futureReplay.runOnce(scope)).resolves.toEqual({
      status: "waiting",
      nextAttemptAt: "2026-09-02T04:01:00.000Z",
    });

    const retry = memory([operation("operation_2", { attempts: 20 })]);
    const retryReplay = createOfflineReplay({
      store: retry.store,
      probe: () => Promise.resolve(true),
      send: () => Promise.resolve({ status: "retryable" }),
      now: () => new Date("2026-09-02T04:00:00.000Z"),
    });
    await expect(retryReplay.runOnce(scope)).resolves.toMatchObject({
      status: "retry_scheduled",
      nextAttemptAt: "2026-09-02T04:05:00.000Z",
    });
  });

  it("BDD-OFF-205 makes payload conflicts terminal and pauses dependants", async () => {
    const target = memory([
      operation("operation_1"),
      operation("operation_2", { sequence: 2, dependencies: ["operation_1"] }),
    ]);
    const replay = createOfflineReplay({
      store: target.store,
      probe: () => Promise.resolve(true),
      send: () => Promise.resolve({ status: "conflict" }),
      now: () => new Date("2026-09-02T04:00:00.000Z"),
    });
    await expect(replay.runOnce(scope)).resolves.toEqual({
      status: "conflict",
      operationId: "operation_1",
    });
    await expect(replay.runOnce(scope)).resolves.toEqual({
      status: "conflict",
      operationId: "operation_1",
    });
  });

  it("BDD-OFF-206 parses bounded Retry-After seconds and HTTP dates", () => {
    const now = new Date("2026-09-02T04:00:00.000Z");
    expect(parseRetryAfter("30", now)).toBe(30_000);
    expect(parseRetryAfter("Wed, 02 Sep 2026 04:02:00 GMT", now)).toBe(120_000);
    expect(parseRetryAfter("0", now)).toBeNull();
    expect(parseRetryAfter("999999", now)).toBe(300_000);
    expect(parseRetryAfter("invalid", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("Wed, 02 Sep 2026 03:59:00 GMT", now)).toBeNull();
  });

  it("BDD-OFF-207 recovers thrown transports and exposes dependency deadlocks", async () => {
    const blocked = memory([
      operation("operation_1", {
        status: "processing",
        updatedAt: "2026-09-02T04:00:00.000Z",
      }),
      operation("operation_2", { sequence: 2, dependencies: ["operation_1"] }),
    ]);
    const blockedReplay = createOfflineReplay({
      store: blocked.store,
      probe: () => Promise.resolve(true),
      send: vi.fn(),
      now: () => new Date("2026-09-02T04:00:10.000Z"),
    });
    await expect(blockedReplay.runOnce(scope)).resolves.toEqual({
      status: "dependency_blocked",
    });

    const retry = memory([operation("operation_3")]);
    const retryReplay = createOfflineReplay({
      store: retry.store,
      probe: () => Promise.resolve(true),
      send: () => Promise.reject(new Error("response lost")),
      now: () => new Date("2026-09-02T04:00:00.000Z"),
    });
    await expect(retryReplay.runOnce(scope)).resolves.toEqual({
      status: "retry_scheduled",
      operationId: "operation_3",
      nextAttemptAt: "2026-09-02T04:00:01.000Z",
    });

    const responseLost = memory([
      operation("operation_4", {
        status: "processing",
        attempts: 1,
        updatedAt: "2026-09-02T03:59:00.000Z",
      }),
    ]);
    const recoveryReplay = createOfflineReplay({
      store: responseLost.store,
      probe: () => Promise.resolve(true),
      send: () => Promise.resolve({ status: "accepted" }),
      now: () => new Date("2026-09-02T04:00:00.000Z"),
    });
    await expect(recoveryReplay.runOnce(scope)).resolves.toEqual({
      status: "synchronized",
      operationId: "operation_4",
    });
  });

  it("BDD-OFF-208 probes the authoritative health endpoint without credentials", async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    const probe = createHttpConnectivityProbe("https://api.example.test/v1", fetcher);
    await expect(probe()).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/v1/health",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        credentials: "omit",
      }),
    );
    fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(probe()).resolves.toBe(false);
    fetcher.mockRejectedValueOnce(new Error("offline"));
    await expect(probe()).resolves.toBe(false);
    expect(() => createHttpConnectivityProbe("http://remote.example.test")).toThrow(
      "OFFLINE_PROBE_ENDPOINT_INVALID",
    );
  });
});
