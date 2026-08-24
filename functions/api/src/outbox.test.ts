/* eslint-disable @typescript-eslint/unbound-method -- Vitest inspects port mocks without invoking detached methods. */
import { describe, expect, it, vi } from "vitest";

import {
  createOutboxWorker,
  type ClaimedOutboxDelivery,
  type OutboxDeliveryStore,
  type OutboxWorkerDependencies,
} from "./outbox";

const claim: ClaimedOutboxDelivery = {
  outboxId: "outbox_internal_1",
  deliveryId: "notification_internal_1",
  channel: "email",
  payload: { private: "never log this" },
  attempt: 1,
  leaseToken: "lease_token_1234",
};

function setup(
  delivery: "delivered" | "retryable" | "permanent" = "delivered",
  claimed: ClaimedOutboxDelivery | null = claim,
) {
  const store: OutboxDeliveryStore = {
    claim: vi.fn(() => Promise.resolve(claimed)),
    markDelivered: vi.fn(() => Promise.resolve()),
    reschedule: vi.fn(() => Promise.resolve()),
    markFailed: vi.fn(() => Promise.resolve()),
  };
  const log = vi.fn();
  const dependencies: OutboxWorkerDependencies = {
    store,
    sender: { deliver: vi.fn(() => Promise.resolve(delivery)) },
    workerId: "worker_preview_1",
    createLeaseToken: () => "unused_token_123",
    now: vi
      .fn()
      .mockReturnValueOnce(new Date("2026-08-24T20:00:00.000Z"))
      .mockReturnValue(new Date("2026-08-24T20:00:01.000Z")),
    leaseDurationMs: 30_000,
    retryDelayMs: () => 60_000,
    maximumAttempts: 3,
    log,
  };
  return { dependencies, log, store };
}

describe("durable outbox worker", () => {
  it("BDD-OUTBOX-001 claims and records one successful idempotent delivery", async () => {
    const context = setup();
    await expect(createOutboxWorker(context.dependencies).runOnce()).resolves.toEqual({
      status: "delivered",
      attempt: 1,
    });
    expect(context.store.claim).toHaveBeenCalledWith({
      workerId: "worker_preview_1",
      leaseToken: "unused_token_123",
      now: "2026-08-24T20:00:00.000Z",
      leaseUntil: "2026-08-24T20:00:30.000Z",
    });
    expect(context.dependencies.sender.deliver).toHaveBeenCalledWith({
      deliveryId: "notification_internal_1",
      channel: "email",
      payload: claim.payload,
    });
    expect(context.store.markDelivered).toHaveBeenCalledWith({
      outboxId: "outbox_internal_1",
      leaseToken: "lease_token_1234",
      deliveredAt: "2026-08-24T20:00:01.000Z",
    });
    expect(context.log).toHaveBeenCalledWith({
      event: "outbox_delivery",
      channel: "email",
      attempt: 1,
      outcome: "delivered",
    });
    expect(JSON.stringify(context.log.mock.calls)).not.toContain("never log this");
  });

  it("BDD-OUTBOX-002 remains idle when deduplication or concurrency yields no claim", async () => {
    const context = setup("delivered", null);
    await expect(createOutboxWorker(context.dependencies).runOnce()).resolves.toEqual({
      status: "idle",
    });
    expect(context.dependencies.sender.deliver).not.toHaveBeenCalled();
  });

  it("BDD-OUTBOX-003 schedules retryable failure and lost response", async () => {
    for (const lostResponse of [false, true]) {
      const context = setup("retryable");
      if (lostResponse) {
        vi.mocked(context.dependencies.sender.deliver).mockRejectedValueOnce(
          new Error("response lost"),
        );
      }
      await expect(createOutboxWorker(context.dependencies).runOnce()).resolves.toEqual(
        { status: "retry_scheduled", attempt: 1 },
      );
      expect(context.store.reschedule).toHaveBeenCalledWith({
        outboxId: "outbox_internal_1",
        leaseToken: "lease_token_1234",
        nextAttemptAt: "2026-08-24T20:01:01.000Z",
      });
    }
  });

  it("BDD-OUTBOX-004 records permanent and exhausted failures as terminal", async () => {
    const permanent = setup("permanent");
    await expect(createOutboxWorker(permanent.dependencies).runOnce()).resolves.toEqual(
      { status: "failed", attempt: 1 },
    );
    expect(permanent.store.markFailed).toHaveBeenCalledWith({
      outboxId: "outbox_internal_1",
      leaseToken: "lease_token_1234",
      failedAt: "2026-08-24T20:00:01.000Z",
      reason: "permanent",
    });

    const exhausted = setup("retryable", { ...claim, attempt: 3 });
    await createOutboxWorker(exhausted.dependencies).runOnce();
    expect(exhausted.store.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "attempts_exhausted" }),
    );
  });

  it("BDD-OUTBOX-005 fails closed for invalid configuration, clock, claim, and retry", async () => {
    const invalidConfig = setup();
    expect(() =>
      createOutboxWorker({ ...invalidConfig.dependencies, workerId: "short" }),
    ).toThrow("OUTBOX_WORKER_CONFIG_INVALID");
    expect(() =>
      createOutboxWorker({ ...invalidConfig.dependencies, leaseDurationMs: 0 }),
    ).toThrow("OUTBOX_WORKER_CONFIG_INVALID");
    expect(() =>
      createOutboxWorker({ ...invalidConfig.dependencies, maximumAttempts: 0 }),
    ).toThrow("OUTBOX_WORKER_CONFIG_INVALID");

    const invalidClock = setup();
    await expect(
      createOutboxWorker({
        ...invalidClock.dependencies,
        now: () => new Date(Number.NaN),
      }).runOnce(),
    ).rejects.toThrow("OUTBOX_CLOCK_INVALID");

    for (const invalidClaim of [
      { ...claim, attempt: 0 },
      { ...claim, attempt: 4 },
      { ...claim, leaseToken: "bad" },
    ]) {
      const context = setup("delivered", invalidClaim);
      await expect(createOutboxWorker(context.dependencies).runOnce()).rejects.toThrow(
        "OUTBOX_CLAIM_INVALID",
      );
    }

    const invalidRetry = setup("retryable");
    await expect(
      createOutboxWorker({
        ...invalidRetry.dependencies,
        retryDelayMs: () => 0,
      }).runOnce(),
    ).rejects.toThrow("OUTBOX_RETRY_DELAY_INVALID");
  });

  it("BDD-OUTBOX-006 maps persistence failures to stable non-sensitive errors", async () => {
    const claimFailure = setup();
    vi.mocked(claimFailure.store.claim).mockRejectedValueOnce(new Error("private"));
    await expect(
      createOutboxWorker(claimFailure.dependencies).runOnce(),
    ).rejects.toThrow("OUTBOX_CLAIM_UNAVAILABLE");

    const deliveredFailure = setup("delivered");
    vi.mocked(deliveredFailure.store.markDelivered).mockRejectedValueOnce(
      new Error("private"),
    );
    await expect(
      createOutboxWorker(deliveredFailure.dependencies).runOnce(),
    ).rejects.toThrow("OUTBOX_DELIVERED_WRITE_UNAVAILABLE");

    const failedFailure = setup("permanent");
    vi.mocked(failedFailure.store.markFailed).mockRejectedValueOnce(
      new Error("private"),
    );
    await expect(
      createOutboxWorker(failedFailure.dependencies).runOnce(),
    ).rejects.toThrow("OUTBOX_FAILED_WRITE_UNAVAILABLE");

    const retryFailure = setup("retryable");
    vi.mocked(retryFailure.store.reschedule).mockRejectedValueOnce(
      new Error("private"),
    );
    await expect(
      createOutboxWorker(retryFailure.dependencies).runOnce(),
    ).rejects.toThrow("OUTBOX_RETRY_WRITE_UNAVAILABLE");
  });
});
