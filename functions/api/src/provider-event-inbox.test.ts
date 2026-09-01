import { describe, expect, it, vi } from "vitest";

import {
  createProviderEventInboxWorker,
  type ClaimedProviderEvent,
} from "./provider-event-inbox.js";

const claim: ClaimedProviderEvent = {
  inboxId: "inbox_1",
  provider: "github",
  deliveryId: "delivery_1",
  eventType: "issues",
  connectionId: "connection_1",
  workspaceId: "workspace_1",
  projectId: "project_1",
  repositoryId: "repository_1",
  payloadEnvelope: "v1.encrypted",
  attempt: 1,
};

function harness(
  outcome: "applied" | "ignored" | "retryable" | "permanent",
  value: ClaimedProviderEvent | null = claim,
) {
  const store = {
    claim: vi.fn(() => Promise.resolve(value)),
    complete: vi.fn(() => Promise.resolve()),
    retry: vi.fn(() => Promise.resolve()),
    fail: vi.fn(() => Promise.resolve()),
  };
  const handler = { handle: vi.fn(() => Promise.resolve(outcome)) };
  const dates = [
    new Date("2026-09-01T12:00:00.000Z"),
    new Date("2026-09-01T12:00:01.000Z"),
  ];
  const worker = createProviderEventInboxWorker({
    store,
    handler,
    workerId: "sync-worker-1",
    now: () => dates.shift() ?? new Date("2026-09-01T12:00:02.000Z"),
    staleAfterMs: 60_000,
    maximumAttempts: 3,
    retryDelayMs: (attempt) => attempt * 10_000,
  });
  return { worker, store, handler };
}

describe("provider event inbox worker", () => {
  it("BDD-SYNC-011 stays idle without a due ordered event", async () => {
    const { worker, handler } = harness("applied", null);
    await expect(worker.runOnce()).resolves.toEqual({ status: "idle" });
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it.each(["applied", "ignored"] as const)(
    "BDD-SYNC-012 completes an %s event exactly once",
    async (outcome) => {
      const { worker, store, handler } = harness(outcome);
      await expect(worker.runOnce()).resolves.toEqual({
        status: "completed",
        outcome,
        attempt: 1,
      });
      expect(handler.handle).toHaveBeenCalledWith(claim);
      expect(store.complete).toHaveBeenCalledWith({
        inboxId: "inbox_1",
        attempt: 1,
        completedAt: "2026-09-01T12:00:01.000Z",
      });
    },
  );

  it("BDD-SYNC-013 schedules bounded retry when the handler is unavailable", async () => {
    const { worker, store } = harness("retryable");
    await expect(worker.runOnce()).resolves.toEqual({
      status: "retry_scheduled",
      attempt: 1,
      availableAt: "2026-09-01T12:00:11.000Z",
    });
    expect(store.retry).toHaveBeenCalledWith({
      inboxId: "inbox_1",
      attempt: 1,
      availableAt: "2026-09-01T12:00:11.000Z",
      errorCode: "handler_retryable",
    });
  });

  it.each([
    ["permanent", 1, "handler_permanent"],
    ["retryable", 3, "attempts_exhausted"],
  ] as const)(
    "BDD-SYNC-014 records terminal %s failure",
    async (outcome, attempt, errorCode) => {
      const { worker, store } = harness(outcome, { ...claim, attempt });
      await expect(worker.runOnce()).resolves.toEqual({
        status: "failed",
        errorCode,
        attempt,
      });
      expect(store.fail).toHaveBeenCalledWith({
        inboxId: "inbox_1",
        attempt,
        failedAt: "2026-09-01T12:00:01.000Z",
        errorCode,
      });
    },
  );

  it("BDD-SYNC-015 treats a thrown handler as retryable", async () => {
    const { worker, handler, store } = harness("applied");
    handler.handle.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(worker.runOnce()).resolves.toMatchObject({
      status: "retry_scheduled",
    });
    expect(store.retry).toHaveBeenCalledOnce();
  });

  it("BDD-SYNC-016 rejects invalid configuration, claims, clocks and retry schedules", async () => {
    expect(() =>
      createProviderEventInboxWorker({
        store: harness("applied").store,
        handler: harness("applied").handler,
        workerId: "bad",
        now: () => new Date(),
        staleAfterMs: 999,
        maximumAttempts: 0,
        retryDelayMs: () => 0,
      }),
    ).toThrow("PROVIDER_INBOX_CONFIG_INVALID");

    await expect(
      harness("applied", { ...claim, attempt: 0 }).worker.runOnce(),
    ).rejects.toThrow("PROVIDER_INBOX_CLAIM_INVALID");

    const invalidClock = harness("applied");
    const worker = createProviderEventInboxWorker({
      store: invalidClock.store,
      handler: invalidClock.handler,
      workerId: "sync-worker-1",
      now: () => new Date(Number.NaN),
      staleAfterMs: 60_000,
      maximumAttempts: 3,
      retryDelayMs: () => 10_000,
    });
    await expect(worker.runOnce()).rejects.toThrow("PROVIDER_INBOX_CLOCK_INVALID");

    const invalidRetry = harness("retryable");
    const retryWorker = createProviderEventInboxWorker({
      store: invalidRetry.store,
      handler: invalidRetry.handler,
      workerId: "sync-worker-1",
      now: () => new Date("2026-09-01T12:00:00.000Z"),
      staleAfterMs: 60_000,
      maximumAttempts: 3,
      retryDelayMs: () => 0,
    });
    await expect(retryWorker.runOnce()).rejects.toThrow("PROVIDER_INBOX_RETRY_INVALID");
  });
});
