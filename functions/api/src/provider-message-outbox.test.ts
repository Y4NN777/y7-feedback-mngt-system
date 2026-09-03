import { expect, it, vi } from "vitest";

import { ProviderMessageError } from "./provider-message";
import {
  createProviderMessageOutboxWorker,
  type ClaimedProviderMessage,
} from "./provider-message-outbox";

const claim: ClaimedProviderMessage = {
  outboxId: "outbox_1",
  linkId: "link_1",
  operationId: "message_1",
  provider: "github",
  encryptedGrantRef: "grant_1",
  repository: { id: "repo_1", owner: "owner", name: "repo" },
  issueId: "41",
  attempt: 1,
  kind: "publish_message",
  content: "Visible",
};

function target(value: ClaimedProviderMessage = claim) {
  const store = {
    claim: vi.fn().mockResolvedValue(value),
    delivered: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined),
    failed: vi.fn().mockResolvedValue(undefined),
  };
  const github = {
    provider: "github" as const,
    inspect: vi.fn(),
    publish: vi.fn().mockResolvedValue({ commentId: "91", replayed: false }),
    remove: vi.fn().mockResolvedValue({ missing: false }),
  };
  const gitlab = {
    ...github,
    provider: "gitlab" as const,
    inspect: vi.fn(),
    publish: vi.fn(),
    remove: vi.fn(),
  };
  const dates = [new Date("2026-09-02T02:00:00Z"), new Date("2026-09-02T02:00:01Z")];
  return {
    store,
    github,
    worker: createProviderMessageOutboxWorker({
      workerId: "preview-message-worker",
      store,
      providers: [github, gitlab],
      now: () => dates.shift() ?? new Date("2026-09-02T02:00:02Z"),
      staleAfterMs: 300_000,
      maximumAttempts: 5,
      retryDelayMs: (attempt) => 2 ** attempt * 1_000,
    }),
  };
}

it("BDD-SYNC-WORKER-001 delivers a visible Message and records the provider comment", async () => {
  const x = target();
  await expect(x.worker.runOnce()).resolves.toMatchObject({
    status: "delivered",
    kind: "publish_message",
  });
  expect(x.github.publish).toHaveBeenCalledWith(claim);
  expect(x.store.delivered).toHaveBeenCalledWith(
    expect.objectContaining({ providerObjectId: "91" }),
  );
});

it("BDD-SYNC-WORKER-002 performs best-effort external cleanup", async () => {
  const cleanup: ClaimedProviderMessage = {
    ...claim,
    kind: "remove_message",
    commentId: "91",
  };
  const x = target(cleanup);
  await expect(x.worker.runOnce()).resolves.toMatchObject({
    status: "delivered",
    kind: "remove_message",
  });
  expect(x.github.remove).toHaveBeenCalledWith(cleanup);
});

it("BDD-SYNC-WORKER-003 retries outage without rolling back the Y7 Message", async () => {
  const x = target();
  x.github.publish.mockRejectedValue(new ProviderMessageError("retryable"));
  await expect(x.worker.runOnce()).resolves.toMatchObject({
    status: "retry_scheduled",
  });
  expect(x.store.retry).toHaveBeenCalledOnce();
  expect(x.store.failed).not.toHaveBeenCalled();
});

it("BDD-SYNC-WORKER-004 records permanent denial without retry loops", async () => {
  const x = target();
  x.github.publish.mockRejectedValue(new ProviderMessageError("permanent"));
  await expect(x.worker.runOnce()).resolves.toEqual({
    status: "failed",
    errorCode: "provider_permanent",
  });
  expect(x.store.failed).toHaveBeenCalledOnce();
});

it("validates worker configuration, clocks, claims and retry bounds", async () => {
  const baseDependencies = {
    workerId: "preview-message-worker",
    store: target().store,
    providers: [target().github, { ...target().github, provider: "gitlab" as const }],
    now: () => new Date("2026-09-02T02:00:00Z"),
    staleAfterMs: 300_000,
    maximumAttempts: 5,
    retryDelayMs: () => 2_000,
  };
  for (const mutation of [
    { workerId: "short" },
    { providers: [target().github] },
    { providers: [target().github, target().github] },
    { staleAfterMs: 999 },
    { staleAfterMs: 1.5 },
    { maximumAttempts: 0 },
    { maximumAttempts: 21 },
    { maximumAttempts: 1.5 },
  ]) {
    expect(() =>
      createProviderMessageOutboxWorker({ ...baseDependencies, ...mutation }),
    ).toThrow("PROVIDER_MESSAGE_OUTBOX_CONFIG_INVALID");
  }

  const idle = target();
  idle.store.claim.mockResolvedValue(null);
  await expect(idle.worker.runOnce()).resolves.toEqual({ status: "idle" });

  const invalidAttempt = target({ ...claim, attempt: 0 });
  await expect(invalidAttempt.worker.runOnce()).rejects.toThrow(
    "PROVIDER_MESSAGE_OUTBOX_CLAIM_INVALID",
  );

  const invalidClock = target();
  invalidClock.store.claim.mockImplementation(() => Promise.resolve(claim));
  const clockWorker = createProviderMessageOutboxWorker({
    ...baseDependencies,
    store: invalidClock.store,
    now: () => new Date("invalid"),
  });
  await expect(clockWorker.runOnce()).rejects.toThrow(
    "PROVIDER_MESSAGE_OUTBOX_CLOCK_INVALID",
  );

  const invalidRetry = target();
  invalidRetry.github.publish.mockRejectedValue(new Error("network"));
  const retryWorker = createProviderMessageOutboxWorker({
    ...baseDependencies,
    store: invalidRetry.store,
    providers: [invalidRetry.github, { ...invalidRetry.github, provider: "gitlab" }],
    now: (() => {
      const dates = [
        new Date("2026-09-02T02:00:00Z"),
        new Date("2026-09-02T02:00:01Z"),
      ];
      return () => dates.shift() ?? new Date("2026-09-02T02:00:02Z");
    })(),
    retryDelayMs: () => 999,
  });
  await expect(retryWorker.runOnce()).rejects.toThrow(
    "PROVIDER_MESSAGE_OUTBOX_RETRY_INVALID",
  );
});

it("exhausts retryable attempts and records missing cleanup truth", async () => {
  const exhausted = target({ ...claim, attempt: 5 });
  exhausted.github.publish.mockRejectedValue(new Error("network"));
  await expect(exhausted.worker.runOnce()).resolves.toEqual({
    status: "failed",
    errorCode: "attempts_exhausted",
  });
  const cleanup = target({ ...claim, kind: "remove_message", commentId: "91" });
  cleanup.github.remove.mockResolvedValue({ missing: true });
  await expect(cleanup.worker.runOnce()).resolves.toMatchObject({ missing: true });
  expect(cleanup.store.delivered).toHaveBeenCalledWith(
    expect.objectContaining({ missing: true }),
  );
});

it("rejects a runtime claim for a provider outside the closed adapter union", async () => {
  const invalid = target({ ...claim, provider: "unknown" as never });
  await expect(invalid.worker.runOnce()).rejects.toThrow(
    "PROVIDER_MESSAGE_OUTBOX_CLAIM_INVALID",
  );
});
