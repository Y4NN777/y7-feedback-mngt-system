/* eslint-disable @typescript-eslint/unbound-method -- Vitest verifies port method spies by reference. */
import { describe, expect, it, vi } from "vitest";

import { ProviderIssueError, type ProviderIssueAdapter } from "./provider-issue";
import {
  createProviderIssueOutboxWorker,
  type ClaimedProviderIssue,
  type ProviderIssueOutboxDependencies,
  type ProviderIssueOutboxStore,
} from "./provider-issue-outbox";

const claim: ClaimedProviderIssue = {
  outboxId: "outbox_1",
  linkId: "link_1",
  operationId: "operation_1",
  provider: "github",
  encryptedGrantRef: "grant_1",
  repository: { id: "123", owner: "Y4NN777", name: "feedback" },
  payload: {
    reference: "Y7-ABC123",
    protectedWorkspaceUrl: "https://feedback.example/workbench?feedbackId=feedback_1",
    feedbackType: "bug",
    origin: "y7-feedback",
  },
  attempt: 1,
};

function setup(
  claimed: ClaimedProviderIssue | null = claim,
  delivery: "ok" | "retryable" | "permanent" | "throw" = "ok",
) {
  const store: ProviderIssueOutboxStore = {
    claim: vi.fn().mockResolvedValue(claimed),
    delivered: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn().mockResolvedValue(undefined),
    failed: vi.fn().mockResolvedValue(undefined),
  };
  const github: ProviderIssueAdapter = {
    provider: "github",
    createIssue: vi.fn().mockImplementation(() => {
      if (delivery === "throw") return Promise.reject(new Error("timeout"));
      if (delivery !== "ok") {
        return Promise.reject(new ProviderIssueError(delivery));
      }
      return Promise.resolve({
        issueId: "42",
        issueUrl: "https://github.com/Y4NN777/feedback/issues/1",
        replayed: false,
      });
    }),
  };
  const gitlab: ProviderIssueAdapter = {
    provider: "gitlab",
    createIssue: vi.fn(),
  };
  const instants = [
    new Date("2026-08-28T12:00:00.000Z"),
    new Date("2026-08-28T12:00:01.000Z"),
  ];
  const dependencies: ProviderIssueOutboxDependencies = {
    workerId: "worker-preview-1",
    store,
    providers: [github, gitlab],
    now: vi.fn(() => instants.shift() ?? new Date("2026-08-28T12:00:02.000Z")),
    staleAfterMs: 60_000,
    maximumAttempts: 3,
    retryDelayMs: () => 60_000,
  };
  return { store, github, gitlab, dependencies };
}

describe("Provider issue outbox worker", () => {
  it("BDD-ISSUE-OUTBOX-001 claims and records provider delivery", async () => {
    const target = setup();
    await expect(
      createProviderIssueOutboxWorker(target.dependencies).runOnce(),
    ).resolves.toEqual({ status: "delivered", attempt: 1, replayed: false });
    expect(target.store.claim).toHaveBeenCalledWith({
      workerId: "worker-preview-1",
      now: "2026-08-28T12:00:00.000Z",
      staleBefore: "2026-08-28T11:59:00.000Z",
    });
    expect(target.store.delivered).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "42", attempt: 1 }),
    );
    expect(target.gitlab.createIssue).not.toHaveBeenCalled();
  });

  it("BDD-ISSUE-OUTBOX-002 stays idle without a due operation", async () => {
    await expect(
      createProviderIssueOutboxWorker(setup(null).dependencies).runOnce(),
    ).resolves.toEqual({ status: "idle" });
  });

  it.each(["retryable", "throw"] as const)(
    "BDD-ISSUE-OUTBOX-003 reschedules %s failure",
    async (failure) => {
      const target = setup(claim, failure);
      await expect(
        createProviderIssueOutboxWorker(target.dependencies).runOnce(),
      ).resolves.toEqual({
        status: "retry_scheduled",
        attempt: 1,
        nextAttemptAt: "2026-08-28T12:01:01.000Z",
      });
      expect(target.store.retry).toHaveBeenCalledWith(
        expect.objectContaining({ errorCode: "provider_retryable" }),
      );
    },
  );

  it("BDD-ISSUE-OUTBOX-004 records permanent and exhausted failure", async () => {
    const permanent = setup(claim, "permanent");
    await expect(
      createProviderIssueOutboxWorker(permanent.dependencies).runOnce(),
    ).resolves.toMatchObject({ status: "failed", errorCode: "provider_permanent" });
    const exhausted = setup({ ...claim, attempt: 3 }, "retryable");
    await expect(
      createProviderIssueOutboxWorker(exhausted.dependencies).runOnce(),
    ).resolves.toMatchObject({ status: "failed", errorCode: "attempts_exhausted" });
  });

  it.each([
    { workerId: "short" },
    { staleAfterMs: 0 },
    { maximumAttempts: 0 },
    { maximumAttempts: 21 },
    { providers: [] },
    { providers: [setup().github, setup().github] },
  ])("BDD-ISSUE-OUTBOX-005 rejects invalid config %#", (override) => {
    expect(() =>
      createProviderIssueOutboxWorker({ ...setup().dependencies, ...override }),
    ).toThrow("PROVIDER_OUTBOX_CONFIG_INVALID");
  });

  it.each([
    { ...claim, attempt: 0 },
    { ...claim, attempt: 4 },
  ])("BDD-ISSUE-OUTBOX-006 rejects invalid claims %#", async (invalid) => {
    await expect(
      createProviderIssueOutboxWorker(setup(invalid).dependencies).runOnce(),
    ).rejects.toThrow("PROVIDER_OUTBOX_CLAIM_INVALID");
  });

  it("BDD-ISSUE-OUTBOX-006B rejects an unknown claimed provider", async () => {
    await expect(
      createProviderIssueOutboxWorker(
        setup({ ...claim, provider: "bitbucket" as never }).dependencies,
      ).runOnce(),
    ).rejects.toThrow("PROVIDER_OUTBOX_CLAIM_INVALID");
  });

  it("BDD-ISSUE-OUTBOX-007 validates clocks, provider and retry schedule", async () => {
    const clock = setup();
    await expect(
      createProviderIssueOutboxWorker({
        ...clock.dependencies,
        now: () => new Date("invalid"),
      }).runOnce(),
    ).rejects.toThrow("PROVIDER_OUTBOX_CLOCK_INVALID");
    const provider = setup({ ...claim, provider: "gitlab" });
    vi.mocked(provider.gitlab.createIssue).mockResolvedValue({
      issueId: "51",
      issueUrl: "https://gitlab.com/group/project/-/issues/1",
      replayed: true,
    });
    await expect(
      createProviderIssueOutboxWorker(provider.dependencies).runOnce(),
    ).resolves.toMatchObject({ status: "delivered", replayed: true });
    const retry = setup(claim, "retryable");
    await expect(
      createProviderIssueOutboxWorker({
        ...retry.dependencies,
        retryDelayMs: () => 0,
      }).runOnce(),
    ).rejects.toThrow("PROVIDER_OUTBOX_RETRY_INVALID");
  });
});
